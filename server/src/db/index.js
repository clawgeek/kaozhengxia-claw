import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isProd } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let kind = 'sqlite';
let sqlite = null;
let pool = null;

/** 把 ? 占位符转成 PG 的 $1..$n */
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + ++i);
}

function readSchema(name) {
  return fs.readFileSync(path.join(here, name), 'utf8');
}

async function migrate() {
  if (kind === 'pg') {
    await pool.query(readSchema('schema.pg.sql'));
  } else {
    sqlite.exec(readSchema('schema.sqlite.sql'));
  }
}

export async function initDb() {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: config.pgPoolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: false
    });
    // 启动时给数据库一点重试窗口，避免容器编排里 DB 稍晚就绪导致进程崩掉
    let lastErr;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await pool.query('SELECT 1');
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, Math.min(500 * attempt, 3000)));
      }
    }
    if (lastErr) throw lastErr;
    kind = 'pg';
  } else {
    if (isProd) {
      // 生产不建议用 SQLite 跑多副本：共享文件在容器间不可靠
      console.warn('[db] NODE_ENV=production 但未配置 DATABASE_URL，已回退 SQLite（仅适合单副本）');
    }
    const { DatabaseSync } = await import('node:sqlite');
    fs.mkdirSync(path.dirname(config.sqliteFile), { recursive: true });
    sqlite = new DatabaseSync(config.sqliteFile);
    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA synchronous = NORMAL');
    sqlite.exec('PRAGMA busy_timeout = 5000');
    sqlite.exec('PRAGMA foreign_keys = ON');
    kind = 'sqlite';
  }
  await migrate();
  return kind;
}

export function dbKind() {
  return kind;
}

export async function all(sql, params = []) {
  if (kind === 'pg') {
    const res = await pool.query(toPg(sql), params);
    return res.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

export async function get(sql, params = []) {
  if (kind === 'pg') {
    const res = await pool.query(toPg(sql), params);
    return res.rows[0] || null;
  }
  return sqlite.prepare(sql).get(...params) || null;
}

export async function run(sql, params = []) {
  if (kind === 'pg') {
    const res = await pool.query(toPg(sql), params);
    return { changes: res.rowCount, rows: res.rows };
  }
  const res = sqlite.prepare(sql).run(...params);
  return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
}

export async function healthy() {
  try {
    if (kind === 'pg') {
      await pool.query('SELECT 1');
    } else {
      sqlite.prepare('SELECT 1').get();
    }
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  if (kind === 'pg' && pool) {
    await pool.end().catch(() => {});
  } else if (sqlite) {
    try { sqlite.close(); } catch { /* ignore */ }
  }
}
