import { all, get, run } from '../db/index.js';
import { currentAuth, publicUser } from '../lib/auth.js';
import { entitlementsOf } from '../lib/entitlements.js';

function groupProgress(rows) {
  const map = {};
  for (const row of rows) {
    const key = row.course_key;
    if (!map[key]) map[key] = { done: {}, last: null, _lastSeen: 0 };
    const item = map[key];
    if (row.completed_at) item.done[row.lesson_key] = 1;
    const seen = Number(row.last_seen || 0);
    if (seen >= item._lastSeen) {
      item._lastSeen = seen;
      item.last = row.lesson_key;
    }
  }
  for (const key of Object.keys(map)) delete map[key]._lastSeen;
  return map;
}

export default async function progressRoutes(app) {
  // 登录后一次性拉齐身份、权益、进度、订单，前端本地缓存后即可同步渲染
  app.get('/me/bootstrap', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '未登录' });

    const user = await get('SELECT * FROM users WHERE id = ?', [auth.sub]);
    if (!user) return reply.code(401).send({ error: '账号不存在' });

    const ent = await entitlementsOf(auth.sub);
    const progressRows = await all(
      `SELECT course_key, lesson_key, last_seen, completed_at FROM progress WHERE user_id = ?`,
      [auth.sub]
    );
    const orderRows = await all(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
      [auth.sub]
    );
    const totalRows = await all(
      `SELECT course_key, COUNT(*) AS c FROM lessons GROUP BY course_key`
    );
    const lessonTotals = {};
    for (const row of totalRows) lessonTotals[row.course_key] = Number(row.c);

    return {
      user: publicUser(user),
      entitlements: ent.items,
      proExpires: ent.proExpires,
      progress: groupProgress(progressRows),
      lessonTotals,
      orders: orderRows.map((row) => ({
        id: row.id,
        productKey: row.product_key,
        amount: Number(row.amount),
        status: row.status,
        method: row.method,
        plan: row.plan || null,
        createdAt: Number(row.created_at),
        paidAt: row.paid_at ? Number(row.paid_at) : null,
        expiresAt: row.expires_at ? Number(row.expires_at) : null
      }))
    };
  });

  app.post('/progress', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '请先登录' });

    const { courseKey, lessonKey, completed } = req.body || {};
    if (!courseKey || !lessonKey) return reply.code(400).send({ error: '缺少课程或课时参数' });
    if (!String(lessonKey).startsWith(String(courseKey) + '|')) {
      return reply.code(400).send({ error: '课时与课程不匹配' });
    }

    const now = Date.now();
    await run(
      `INSERT INTO progress (user_id, course_key, lesson_key, last_seen, completed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, lesson_key) DO UPDATE SET
         last_seen = excluded.last_seen,
         completed_at = COALESCE(progress.completed_at, excluded.completed_at)`,
      [auth.sub, courseKey, lessonKey, now, completed ? now : null]
    );

    return { ok: true, lastSeen: now };
  });

  app.get('/progress/:courseKey', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '请先登录' });

    const rows = await all(
      `SELECT course_key, lesson_key, last_seen, completed_at
       FROM progress WHERE user_id = ? AND course_key = ?`,
      [auth.sub, req.params.courseKey]
    );
    const grouped = groupProgress(rows);
    return { progress: grouped[req.params.courseKey] || { done: {}, last: null } };
  });
}
