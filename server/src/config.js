import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(serverRoot);

export const config = {
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8080),
  serverRoot,
  repoRoot,
  webRoot: process.env.WEB_ROOT || path.join(repoRoot, 'web'),

  // 生产：PostgreSQL；开发：内置 SQLite（零依赖可跑）
  databaseUrl: process.env.DATABASE_URL || '',
  sqliteFile: process.env.SQLITE_FILE || path.join(serverRoot, 'data', 'claw.db'),
  pgPoolMax: Number(process.env.PG_POOL_MAX || 20),

  // 多副本共享限流 / 缓存；未配置时降级为单进程内存
  redisUrl: process.env.REDIS_URL || '',

  jwtSecret: process.env.JWT_SECRET || 'kaozhengxia-dev-secret-change-me',
  jwtTtl: Number(process.env.JWT_TTL || 604800),

  adminPhone: process.env.ADMIN_PHONE || '13354281998',
  adminPassword: process.env.ADMIN_PASSWORD || 'sangjiexun@2026',
  adminName: process.env.ADMIN_NAME || '桑杰逊',

  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  rateMax: Number(process.env.RATE_LIMIT_MAX || 180),
  rateWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  trustProxy: process.env.TRUST_PROXY !== 'false'
};

export const isProd = config.env === 'production';
