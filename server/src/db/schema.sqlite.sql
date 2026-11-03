-- 开发环境 schema（SQLite）。时间统一存 epoch 毫秒整数。
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  key         TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  field       TEXT NOT NULL,
  price       INTEGER NOT NULL DEFAULT 0,
  hours       REAL NOT NULL DEFAULT 0,
  exam_fee    INTEGER NOT NULL DEFAULT 0,
  sort_no     INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_courses_field ON courses(field, sort_no);

CREATE TABLE IF NOT EXISTS lessons (
  course_key    TEXT NOT NULL,
  chapter_no    INTEGER NOT NULL,
  lesson_no     INTEGER NOT NULL,
  chapter_title TEXT NOT NULL,
  title         TEXT NOT NULL,
  minutes       INTEGER NOT NULL,
  body          TEXT NOT NULL,
  PRIMARY KEY (course_key, chapter_no, lesson_no)
);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  product_key TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  method      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  plan        TEXT,
  created_at  INTEGER NOT NULL,
  paid_at     INTEGER,
  expires_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS progress (
  user_id      TEXT NOT NULL,
  course_key   TEXT NOT NULL,
  lesson_key   TEXT NOT NULL,
  last_seen    INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (user_id, lesson_key)
);
CREATE INDEX IF NOT EXISTS idx_progress_course ON progress(user_id, course_key);
