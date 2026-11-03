import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { initDb, run, get, closeDb, dbKind } from './db/index.js';
import { flattenLessons } from './lib/lessons.js';
import { hashPassword, newId } from './lib/auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'data', 'catalog.json'), 'utf8'));
const reset = process.argv.includes('--reset');

async function seed() {
  const kind = await initDb();
  console.log(`[seed] database: ${kind}`);

  if (reset) {
    await run('DELETE FROM lessons');
    await run('DELETE FROM courses');
    console.log('[seed] 已清空课程与课时');
  }

  let courses = 0;
  let lessons = 0;

  for (const course of [...catalog.courses, ...catalog.career]) {
    await run(
      `INSERT INTO courses (key, kind, title, field, price, hours, exam_fee, sort_no, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         field = excluded.field,
         hours = excluded.hours,
         exam_fee = excluded.exam_fee,
         sort_no = excluded.sort_no`,
      [course.key, course.kind, course.title, course.field, course.price, course.hours, course.examFee, course.sort]
    );
    courses++;

    // 默认只在缺失时补齐，避免覆盖后台已编辑的讲义
    const rows = flattenLessons(course.key, course);
    for (const row of rows) {
      const res = await run(
        `INSERT INTO lessons (course_key, chapter_no, lesson_no, chapter_title, title, minutes, body)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(course_key, chapter_no, lesson_no) DO NOTHING`,
        [row.courseKey, row.chapterNo, row.lessonNo, row.chapterTitle, row.title, row.minutes, row.body]
      );
      lessons += res.changes ? 1 : 0;
    }
  }

  const admin = await get('SELECT id FROM users WHERE phone = ?', [config.adminPhone]);
  if (!admin) {
    await run(
      `INSERT INTO users (id, name, phone, pass_hash, role, created_at)
       VALUES (?, ?, ?, ?, 'admin', ?)`,
      [newId('u'), config.adminName, config.adminPhone, hashPassword(config.adminPassword), Date.now()]
    );
    console.log(`[seed] 管理员已创建：${config.adminPhone} / ${config.adminPassword}`);
  } else if (admin.role !== 'admin') {
    await run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.id]);
    console.log('[seed] 已把管理员手机号对应账号提升为 admin');
  }

  console.log(`[seed] 课程 ${courses} 门，新增课时 ${lessons} 节`);
  await closeDb();
}

seed().catch(async (err) => {
  console.error('[seed] 失败：', err);
  await closeDb().catch(() => {});
  process.exit(1);
});
