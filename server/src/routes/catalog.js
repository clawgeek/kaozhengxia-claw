import { all, get } from '../db/index.js';
import { currentAuth } from '../lib/auth.js';
import { canAccess } from '../lib/entitlements.js';

const DOMAIN_ORDER = ['数字化转型', '国家软考', '产品研发', '信息安全', '信创 + 运维', '项目管理', '人工智能', '综合'];
const FEATURED = [62, 25, 91, 2, 78, 113];

const money = (n) => '¥' + Number(n).toLocaleString('zh-CN');

function mapCourse(row) {
  return {
    key: row.key,
    kind: row.kind,
    title: row.title,
    field: row.field,
    price: Number(row.price),
    hours: Number(row.hours),
    examFee: Number(row.exam_fee)
  };
}

/** 组装章节结构；withBody=false 时只返回目录，避免未付费用户拿到讲义 */
async function loadChapters(courseKey, withBody) {
  const rows = await all(
    `SELECT chapter_no, lesson_no, chapter_title, title, minutes, body
     FROM lessons WHERE course_key = ? ORDER BY chapter_no, lesson_no`,
    [courseKey]
  );

  const chapters = [];
  let current = null;

  for (const row of rows) {
    const chapterNo = Number(row.chapter_no);
    if (!current || current.no !== chapterNo) {
      current = { no: chapterNo, title: row.chapter_title, lessons: [] };
      chapters.push(current);
    }
    const lessonNo = Number(row.lesson_no);
    const lesson = {
      key: `${courseKey}|${chapterNo - 1}-${lessonNo - 1}`,
      title: row.title,
      minutes: Number(row.minutes)
    };
    if (withBody) {
      try {
        lesson.body = JSON.parse(row.body);
      } catch {
        lesson.body = [String(row.body)];
      }
    }
    current.lessons.push(lesson);
  }
  return chapters;
}

export default async function catalogRoutes(app) {
  // 前台目录：保持紧凑的数组结构，前端可直接渲染
  app.get('/courses', async () => {
    const rows = await all(
      `SELECT key, kind, title, field, price, hours, exam_fee
       FROM courses WHERE enabled = 1 ORDER BY sort_no`
    );

    const certRows = rows.filter((r) => r.kind === 'cert');
    const careerRows = rows.filter((r) => r.kind === 'career');

    const courses = certRows.map((r) => [
      Number(String(r.key).split('-')[1]),
      r.title,
      r.field,
      Number(r.price),
      Number(r.exam_fee),
      Number(r.hours),
      r.key
    ]);
    const career = careerRows.map((r) => [r.title, Number(r.price), Number(r.hours), r.key]);

    const domains = DOMAIN_ORDER.map((name, index) => {
      const group = certRows.filter((r) => r.field === name);
      const prices = group.map((r) => Number(r.price));
      const min = prices.length ? Math.min(...prices) : 0;
      const max = prices.length ? Math.max(...prices) : 0;
      return {
        no: String(index + 1).padStart(2, '0'),
        name,
        count: group.length,
        range: min === max ? money(min) : `${money(min)} – ${Number(max).toLocaleString('zh-CN')}`
      };
    });

    return { courses, career, domains, featured: FEATURED };
  });

  // 课程详情 + 章节目录（未付费也可见目录）
  app.get('/courses/:key', async (req, reply) => {
    const { key } = req.params;
    const row = await get(`SELECT * FROM courses WHERE key = ? AND enabled = 1`, [key]);
    if (!row) return reply.code(404).send({ error: '课程不存在或已下架' });

    const auth = currentAuth(req);
    const access = auth ? await canAccess(auth.sub, key) : false;
    const chapters = await loadChapters(key, false);

    return { course: mapCourse(row), chapters, access };
  });

  // 讲义正文：必须已拥有该课程
  app.get('/courses/:key/lessons', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '请先登录' });

    const { key } = req.params;
    const row = await get(`SELECT * FROM courses WHERE key = ? AND enabled = 1`, [key]);
    if (!row) return reply.code(404).send({ error: '课程不存在或已下架' });

    const access = await canAccess(auth.sub, key);
    if (!access) return reply.code(403).send({ error: '尚未开通该课程' });

    return { course: mapCourse(row), chapters: await loadChapters(key, true) };
  });
}
