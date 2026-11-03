import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config, isProd } from './config.js';
import { healthy } from './db/index.js';
import { hit } from './lib/cache.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import orderRoutes from './routes/orders.js';
import progressRoutes from './routes/progress.js';
import adminRoutes from './routes/admin.js';

const RATE_EXEMPT = new Set(['/healthz', '/readyz', '/api/health']);

export async function buildApp() {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 512 * 1024,
    logger: isProd
      ? { level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.authorization'] }
      : {
          level: process.env.LOG_LEVEL || 'info',
          redact: ['req.headers.authorization'],
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' }
          }
        }
  });

  /* ---------- 空 JSON body 容错（前端无参 POST 时常见） ---------- */
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      err.message = '请求体不是合法的 JSON';
      done(err, undefined);
    }
  });

  /* ---------- 安全响应头 ---------- */
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'SAMEORIGIN');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'geolocation=(), microphone=(), camera=()');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'"
    );
    if (isProd) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });

  /* ---------- CORS（默认同源；跨域部署时用 CORS_ORIGINS 白名单） ---------- */
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-headers', 'content-type,authorization');
      reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      reply.header('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  /* ---------- 限流：多副本共享 Redis 计数，未配置则进程内 ---------- */
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || RATE_EXEMPT.has(req.url.split('?')[0])) return;
    const bucket = Math.floor(Date.now() / config.rateWindowMs);
    const count = await hit(`rl:${req.ip}:${bucket}`, config.rateWindowMs);
    reply.header('x-ratelimit-limit', String(config.rateMax));
    reply.header('x-ratelimit-remaining', String(Math.max(0, config.rateMax - count)));
    if (count > config.rateMax) {
      return reply.code(429).send({ error: '请求过于频繁，请稍后再试' });
    }
  });

  /* ---------- 健康检查（K8s 探针 / Nginx / 负载均衡） ---------- */
  app.get('/healthz', async () => ({ status: 'ok', uptime: Math.round(process.uptime()) }));
  app.get('/readyz', async (req, reply) => {
    const ok = await healthy();
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ready' : 'degraded' });
  });
  app.get('/api/health', async () => ({ status: 'ok', service: 'kaozhengxia-claw' }));

  /* ---------- 业务路由 ---------- */
  await app.register(
    async (scope) => {
      await scope.register(authRoutes);
      await scope.register(catalogRoutes);
      await scope.register(orderRoutes);
      await scope.register(progressRoutes);
      await scope.register(adminRoutes);
    },
    { prefix: '/api' }
  );

  /* ---------- 静态站点（前台 + 管理后台） ---------- */
  if (fs.existsSync(config.webRoot)) {
    app.get('/admin', (req, reply) => reply.sendFile('admin/index.html'));
    await app.register(fastifyStatic, {
      root: config.webRoot,
      prefix: '/',
      index: ['index.html'],
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('cache-control', 'no-cache');
        else res.setHeader('cache-control', isProd ? 'public, max-age=3600' : 'no-cache');
      }
    });
  } else {
    app.log.warn({ webRoot: config.webRoot }, '未找到 web 目录，仅提供 API');
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: '接口不存在' });
    }
    return reply.code(404).type('text/plain; charset=utf-8').send('404 Not Found');
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    reply.code(status).send({ error: status >= 500 ? '服务器开小差了，请稍后再试' : err.message });
  });

  return app;
}
