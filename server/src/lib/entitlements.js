import { all } from '../db/index.js';

/**
 * 权益 = 已支付订单。
 * - pro 为会员：按 expires_at 判定有效期，覆盖全部职场进化课（car-*）
 * - 其余为单品：product_key 即课程 key
 */
export async function entitlementsOf(userId) {
  if (!userId) return { items: [], proExpires: 0 };
  const rows = await all(
    `SELECT product_key, expires_at FROM orders WHERE user_id = ? AND status = 'paid'`,
    [userId]
  );
  const now = Date.now();
  const items = new Set();
  let proExpires = 0;

  for (const row of rows) {
    if (row.product_key === 'pro') {
      const exp = Number(row.expires_at || 0);
      if (!exp || exp > now) {
        items.add('pro');
        if (exp > proExpires) proExpires = exp;
      }
    } else {
      items.add(row.product_key);
    }
  }
  return { items: [...items], proExpires };
}

export async function canAccess(userId, courseKey) {
  const { items } = await entitlementsOf(userId);
  if (items.includes(courseKey)) return true;
  if (String(courseKey).startsWith('car-') && items.includes('pro')) return true;
  return false;
}
