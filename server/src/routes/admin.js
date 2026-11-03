import { all, get, run } from '../db/index.js';
import { currentAuth } from '../lib/auth.js';

const num = (v) => Number(v || 0);

function paging(query) {
  const page = Math.max(1, Number(query.page || 1));
  const size = Math.min(100, Math.max(5, Number(query.size || 20)));
  return { page, size, offset: (page - 1) * size };
}

export default async function adminRoutes(app) {
  // 管理端全部接口统一鉴权
  app.addHook('preHandler', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '请先登录' });
    if (auth.role !== 'admin') return reply.code(403).send({ error: '需要管理员权限' });
    req.auth = auth;
  });

  app.get('/admin/overview', async () => {
    const users = await get('SELECT COUNT(*) AS c FROM users');
    const courses = await get('SELECT COUNT(*) AS c FROM courses');
    const paid = await get(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s FROM orders WHERE status = 'paid'`
    );

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = await get(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s
       FROM orders WHERE status = 'paid' AND paid_at >= ?`,
      [startOfDay.getTime()]
    );

    const since = Date.now() - 13 * 86400000;
    const recent = await all(
      `SELECT amount, paid_at FROM orders WHERE status = 'paid' AND paid_at >= ?`,
      [since]
    );
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - i);
      const next = day.getTime() + 86400000;
      const rows = recent.filter((r) => num(r.paid_at) >= day.getTime() && num(r.paid_at) < next);
      trend.push({
        date: day.toISOString().slice(5, 10),
        orders: rows.length,
        revenue: rows.reduce((sum, r) => sum + num(r.amount), 0)
      });
    }

    const latest = await all(
      `SELECT o.*, u.name AS user_name, u.phone AS user_phone
       FROM orders o LEFT JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC LIMIT 8`
    );

    return {
      users: num(users.c),
      courses: num(courses.c),
      paidOrders: num(paid.c),
      revenue: num(paid.s),
      todayOrders: num(today.c),
      todayRevenue: num(today.s),
      trend,
      latest: latest.map((r) => ({
        id: r.id,
        userName: r.user_name || '—',
        phone: r.user_phone || '—',
        productKey: r.product_key,
        amount: num(r.amount),
        status: r.status,
        method: r.method,
        createdAt: num(r.created_at)
      }))
    };
  });

  app.get('/admin/orders', async (req) => {
    const { page, size, offset } = paging(req.query || {});
    const status = String(req.query?.status || '').trim();
    const q = String(req.query?.q || '').trim();

    let where = 'WHERE 1 = 1';
    const params = [];
    if (status) {
      where += ' AND o.status = ?';
      params.push(status);
    }
    if (q) {
      where += ' AND (u.phone LIKE ? OR u.name LIKE ? OR o.id LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const total = await get(
      `SELECT COUNT(*) AS c FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where}`,
      params
    );
    const rows = await all(
      `SELECT o.*, u.name AS user_name, u.phone AS user_phone
       FROM orders o LEFT JOIN users u ON u.id = o.user_id
       ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    return {
      total: num(total.c),
      page,
      size,
      orders: rows.map((r) => ({
        id: r.id,
        userName: r.user_name || '—',
        phone: r.user_phone || '—',
        productKey: r.product_key,
        amount: num(r.amount),
        status: r.status,
        method: r.method,
        plan: r.plan,
        createdAt: num(r.created_at),
        paidAt: r.paid_at ? num(r.paid_at) : null
      }))
    };
  });

  app.get('/admin/users', async (req) => {
    const { page, size, offset } = paging(req.query || {});
    const q = String(req.query?.q || '').trim();

    let where = 'WHERE 1 = 1';
    const params = [];
    if (q) {
      where += ' AND (u.phone LIKE ? OR u.name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    const total = await get(`SELECT COUNT(*) AS c FROM users u ${where}`, params);
    const rows = await all(
      `SELECT u.*,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS paid_count,
         (SELECT COALESCE(SUM(amount), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS spent
       FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    return {
      total: num(total.c),
      page,
      size,
      users: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        role: r.role,
        createdAt: num(r.created_at),
        paidCount: num(r.paid_count),
        spent: num(r.spent)
      }))
    };
  });

  app.get('/admin/courses', async (req) => {
    const q = String(req.query?.q || '').trim();
    let where = 'WHERE 1 = 1';
    const params = [];
    if (q) {
      where += ' AND (c.title LIKE ? OR c.key LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    const rows = await all(
      `SELECT c.*,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_key = c.key) AS lesson_count,
        (SELECT COUNT(*) FROM orders o WHERE o.product_key = c.key AND o.status = 'paid') AS sold
       FROM courses c ${where}
       ORDER BY CASE WHEN c.kind = 'cert' THEN 0 ELSE 1 END, c.sort_no LIMIT 500`,
      params
    );
    return {
      courses: rows.map((r) => ({
        key: r.key,
        kind: r.kind,
        title: r.title,
        field: r.field,
        price: num(r.price),
        hours: num(r.hours),
        examFee: num(r.exam_fee),
        enabled: num(r.enabled) === 1,
        lessonCount: num(r.lesson_count),
        sold: num(r.sold)
      }))
    };
  });

  app.patch('/admin/courses/:key', async (req, reply) => {
    const { key } = req.params;
    const row = await get('SELECT * FROM courses WHERE key = ?', [key]);
    if (!row) return reply.code(404).send({ error: '课程不存在' });

    const body = req.body || {};
    const price = body.price === undefined ? num(row.price) : Math.max(0, Math.round(Number(body.price) || 0));
    const enabled = body.enabled === undefined ? num(row.enabled) : body.enabled ? 1 : 0;

    await run('UPDATE courses SET price = ?, enabled = ? WHERE key = ?', [price, enabled, key]);
    return { ok: true, key, price, enabled: enabled === 1 };
  });

  app.post('/admin/orders/:id/refund', async (req, reply) => {
    const row = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!row) return reply.code(404).send({ error: '订单不存在' });
    if (row.status !== 'paid') return reply.code(409).send({ error: '仅支持对已支付订单退款' });

    await run(`UPDATE orders SET status = 'refunded' WHERE id = ?`, [row.id]);
    return { ok: true, id: row.id, status: 'refunded' };
  });
}
