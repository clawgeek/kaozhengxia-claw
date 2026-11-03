import { all, get, run } from '../db/index.js';
import { currentAuth, newId } from '../lib/auth.js';
import { entitlementsOf } from '../lib/entitlements.js';

const PLANS = {
  '1y': { label: '1 年', days: 365, price: 980 },
  '2y': { label: '2 年', days: 730, price: 1680 },
  '3y': { label: '3 年', days: 1095, price: 2180 }
};

function mapOrder(row) {
  return {
    id: row.id,
    productKey: row.product_key,
    amount: Number(row.amount),
    status: row.status,
    method: row.method,
    plan: row.plan || null,
    planLabel: row.plan ? PLANS[row.plan]?.label || row.plan : null,
    createdAt: Number(row.created_at),
    paidAt: row.paid_at ? Number(row.paid_at) : null,
    expiresAt: row.expires_at ? Number(row.expires_at) : null
  };
}

export default async function orderRoutes(app) {
  // 下单：返回待支付订单；0 元课直接标记已支付
  app.post('/orders', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '请先登录' });

    const { productKey, plan } = req.body || {};
    if (!productKey) return reply.code(400).send({ error: '缺少课程参数' });

    let amount = 0;
    let planKey = null;
    let days = 0;

    if (productKey === 'pro') {
      planKey = PLANS[plan] ? plan : '1y';
      amount = PLANS[planKey].price;
      days = PLANS[planKey].days;
    } else {
      const course = await get(`SELECT * FROM courses WHERE key = ? AND enabled = 1`, [productKey]);
      if (!course) return reply.code(404).send({ error: '课程不存在或已下架' });
      amount = Number(course.price);
    }

    if (productKey !== 'pro') {
      const owned = await get(
        `SELECT id FROM orders WHERE user_id = ? AND product_key = ? AND status = 'paid'`,
        [auth.sub, productKey]
      );
      if (owned) return reply.code(409).send({ error: '该课程已开通，可直接学习' });
    }

    const id = newId('o');
    const now = Date.now();

    if (amount === 0) {
      await run(
        `INSERT INTO orders (id, user_id, product_key, amount, method, status, plan, created_at, paid_at)
         VALUES (?, ?, ?, 0, 'free', 'paid', NULL, ?, ?)`,
        [id, auth.sub, productKey, now, now]
      );
      const row = await get('SELECT * FROM orders WHERE id = ?', [id]);
      return { order: mapOrder(row), free: true };
    }

    await run(
      `INSERT INTO orders (id, user_id, product_key, amount, method, status, plan, created_at)
       VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?)`,
      [id, auth.sub, productKey, amount, planKey, now]
    );
    const row = await get('SELECT * FROM orders WHERE id = ?', [id]);
    return { order: mapOrder(row), planDays: days };
  });

  // 支付确认（当前为演示支付：调用即视为支付成功，不产生真实扣款）
  app.post('/orders/:id/pay', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '请先登录' });

    const order = await get('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, auth.sub]);
    if (!order) return reply.code(404).send({ error: '订单不存在' });
    if (order.status === 'refunded') return reply.code(409).send({ error: '订单已退款' });

    if (order.status !== 'paid') {
      const now = Date.now();
      let expiresAt = null;
      if (order.product_key === 'pro') {
        const plan = PLANS[order.plan] || PLANS['1y'];
        expiresAt = now + plan.days * 86400000;
      }
      const method = String(req.body?.method || '微信支付');
      await run(
        `UPDATE orders SET status = 'paid', method = ?, paid_at = ?, expires_at = ? WHERE id = ?`,
        [method, now, expiresAt, order.id]
      );
    }

    const fresh = await get('SELECT * FROM orders WHERE id = ?', [order.id]);
    const ent = await entitlementsOf(auth.sub);
    return { order: mapOrder(fresh), entitlements: ent.items, proExpires: ent.proExpires };
  });

  app.get('/orders/mine', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '请先登录' });
    const rows = await all(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
      [auth.sub]
    );
    return { orders: rows.map(mapOrder) };
  });
}
