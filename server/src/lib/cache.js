import { config } from '../config.js';

/**
 * 限流/短缓存存储。
 * - 配置 REDIS_URL：多副本共享计数，扩容后限流仍然准确
 * - 未配置：进程内内存实现，适合开发或单副本
 */
let redis = null;
const mem = new Map();

export async function initCache() {
  if (!config.redisUrl) return 'memory';
  const { default: Redis } = await import('ioredis');
  redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false
  });
  redis.on('error', () => { /* 由上层降级，不刷屏 */ });
  try {
    await redis.connect();
    return 'redis';
  } catch (err) {
    // 缓存故障不应该拖垮主流程：降级为进程内限流
    console.warn('[cache] Redis 连接失败，降级为内存限流：', err.message);
    await redis.quit().catch(() => {});
    redis = null;
    return 'memory-fallback';
  }
}

/** 固定窗口计数，返回当前窗口内第几次命中 */
export async function hit(key, windowMs) {
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, windowMs);
      return count;
    } catch {
      // 运行期 Redis 抖动：本次降级到内存计数，不阻断请求
    }
  }
  const now = Date.now();
  const record = mem.get(key);
  if (!record || record.reset <= now) {
    mem.set(key, { count: 1, reset: now + windowMs });
    return 1;
  }
  record.count += 1;
  if (mem.size > 50000) {
    for (const [k, v] of mem) if (v.reset <= now) mem.delete(k);
  }
  return record.count;
}

export async function closeCache() {
  if (redis) await redis.quit().catch(() => {});
  redis = null;
}
