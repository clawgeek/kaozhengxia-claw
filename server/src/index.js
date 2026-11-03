import { buildApp } from './app.js';
import { config } from './config.js';
import { initDb, closeDb } from './db/index.js';
import { initCache, closeCache } from './lib/cache.js';

async function main() {
  const db = await initDb();
  const cache = await initCache();
  const app = await buildApp();

  app.log.info({ db, cache, env: config.env, port: config.port }, 'dependencies ready');

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'graceful shutdown start');

    // 兜底：15 秒内没退干净就强退，避免拖死编排层的滚动发布
    const hardStop = setTimeout(() => {
      app.log.error('graceful shutdown timeout');
      process.exit(1);
    }, 15000);
    hardStop.unref();

    try {
      await app.close();
    } catch (err) {
      app.log.error({ err }, 'fastify close failed');
    }
    await closeCache().catch(() => {});
    await closeDb().catch(() => {});
    clearTimeout(hardStop);
    app.log.info('bye');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaughtException');
    shutdown('uncaughtException');
  });

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error({ err }, 'listen failed');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('bootstrap failed', err);
  process.exit(1);
});
