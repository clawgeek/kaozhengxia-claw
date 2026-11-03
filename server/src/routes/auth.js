import { run, get } from '../db/index.js';
import {
  currentAuth,
  hashPassword,
  verifyPassword,
  signToken,
  publicUser,
  newId
} from '../lib/auth.js';

const PHONE = /^1[3-9]\d{9}$/;

export default async function authRoutes(app) {
  app.post('/auth/register', async (req, reply) => {
    const { name, phone, password } = req.body || {};
    const nick = String(name || '').trim();
    const tel = String(phone || '').trim();

    if (!nick) return reply.code(400).send({ error: '请填写昵称' });
    if (!PHONE.test(tel)) return reply.code(400).send({ error: '请输入正确的 11 位手机号' });
    if (String(password || '').length < 6) return reply.code(400).send({ error: '密码至少 6 位' });

    const exists = await get('SELECT id FROM users WHERE phone = ?', [tel]);
    if (exists) return reply.code(409).send({ error: '该手机号已注册，请直接登录' });

    const id = newId('u');
    await run(
      `INSERT INTO users (id, name, phone, pass_hash, role, created_at)
       VALUES (?, ?, ?, ?, 'user', ?)`,
      [id, nick, tel, hashPassword(String(password)), Date.now()]
    );
    const row = await get('SELECT * FROM users WHERE id = ?', [id]);
    return { token: signToken({ sub: id, role: 'user' }), user: publicUser(row) };
  });

  app.post('/auth/login', async (req, reply) => {
    const { phone, password } = req.body || {};
    const tel = String(phone || '').trim();
    if (!PHONE.test(tel)) return reply.code(400).send({ error: '请输入正确的 11 位手机号' });

    const row = await get('SELECT * FROM users WHERE phone = ?', [tel]);
    if (!row) return reply.code(404).send({ error: '该手机号尚未注册，请先注册' });
    if (!verifyPassword(String(password || ''), row.pass_hash)) {
      return reply.code(401).send({ error: '密码不正确' });
    }
    return {
      token: signToken({ sub: row.id, role: row.role }),
      user: publicUser(row)
    };
  });

  app.get('/auth/me', async (req, reply) => {
    const auth = currentAuth(req);
    if (!auth) return reply.code(401).send({ error: '未登录' });
    const row = await get('SELECT * FROM users WHERE id = ?', [auth.sub]);
    if (!row) return reply.code(401).send({ error: '账号不存在' });
    return { user: publicUser(row) };
  });
}
