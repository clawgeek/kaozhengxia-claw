# 架构说明

本文说明考证虾 Claw 的部署形态、扩展方式、容量估算与故障降级策略。

## 1. 设计目标

| 目标 | 落地方式 |
|---|---|
| 无状态、可水平扩展 | 会话只依赖 JWT；API 进程不保存任何本地状态 |
| 发布不中断 | 滚动更新 `maxUnavailable: 0` + 就绪探针 + `preStop` 缓冲 |
| 过载可控 | 边缘 Nginx 限流 + 应用层每 IP 限流，Redis 多副本共享计数 |
| 依赖可降级 | Redis 不可用自动退回进程内限流；数据库不可用则就绪探针失败、停止接流量 |
| 开发零门槛 | 无 `DATABASE_URL` 时使用内置 SQLite（`node:sqlite`），`npm start` 即可跑 |

## 2. 组件与职责

| 组件 | 职责 | 是否无状态 |
|---|---|---|
| Nginx / Ingress | TLS 终止、静态资源、反向代理、负载均衡、边缘限流 | 是 |
| API（Node 22 + Fastify 5） | 认证、目录、订单、权益、进度、管理端 | 是 |
| PostgreSQL 16 | 用户、课程、课时、订单、进度 | 数据层 |
| Redis 7 | 多副本共享限流计数（可选） | 是（可重建） |

单机开发时 PostgreSQL 由 SQLite 替代，Redis 由进程内 Map 替代，**业务代码不变**。

## 3. 关键链路

### 登录
1. `POST /api/auth/login` → 校验 scrypt 口令 → 签发 HS256 JWT（含 `sub`、`role`、`exp`）
2. 前端存 token，后续请求带 `Authorization: Bearer`
3. 任意副本都能用同一 `JWT_SECRET` 独立验签，无需共享会话

### 购买
1. `POST /api/orders` → 校验商品、写 `pending` 订单（0 元课直接 `paid`）
2. `POST /api/orders/:id/pay` → 置 `paid`，会员写 `expires_at`
3. 权益 = `status='paid'` 的订单集合；会员（`pro`）额外覆盖全部 `car-*`

### 学习
1. `GET /api/me/bootstrap` → 一次拉齐身份 / 权益 / 进度 / 课时总数
2. `GET /api/courses/:key/lessons` → 校验权益后返回讲义正文
3. `POST /api/progress` → upsert 课时状态（`last_seen` / `completed_at`）

## 4. 数据模型

```
users(id PK, name, phone UNIQUE, pass_hash, role, created_at)
courses(key PK, kind, title, field, price, hours, exam_fee, sort_no, enabled)
lessons(course_key, chapter_no, lesson_no, chapter_title, title, minutes, body)  PK(course_key, chapter_no, lesson_no)
orders(id PK, user_id, product_key, amount, method, status, plan, created_at, paid_at, expires_at)
progress(user_id, course_key, lesson_key, last_seen, completed_at)  PK(user_id, lesson_key)
```

索引：
- `orders(user_id, created_at DESC)` — 我的订单 / 我的课程
- `orders(status, created_at DESC)` — 后台订单筛选
- `progress(user_id, course_key)` — 课程进度
- `courses(field, sort_no)` — 目录筛选

## 5. 扩展性与容量

**单副本吞吐**：简单读写接口在 150m CPU / 192Mi 下通常可稳定承载 300–800 rps；实际以压测为准。

**连接池是首要约束**：

```
总连接数 = API 副本数 × PG_POOL_MAX
```

PostgreSQL 默认 `max_connections=100`。若 HPA 扩到 12 副本且 `PG_POOL_MAX=20`，总量 240 会打爆数据库。二选一：

- 把 `PG_POOL_MAX` 降到 8（12 × 8 = 96），或
- 在 API 与 PG 之间加 **PgBouncer**（transaction 模式），API 侧可放开连接池

`docker-compose.yml` 固定 3 副本、`PG_POOL_MAX=20`（共 60 连接），留有余量。

**扩容建议**
- API：首选加副本（线性）
- 读多写少：加只读副本，把目录查询指向只读库
- 静态资源：交给 Nginx / CDN，不经过 API

## 6. 故障与降级

| 故障 | 表现 | 处理 |
|---|---|---|
| 单个 API 副本挂掉 | 连接拒绝 / 5xx | Nginx `proxy_next_upstream` 重试到健康副本；K8s 就绪探针摘除 Pod |
| 数据库不可用 | `/readyz` 返回 503 | 负载均衡停止导流；恢复后自动回归 |
| Redis 不可用 | 限流计数退化 | 启动时降级为内存；运行期异常自动回落，不阻断业务 |
| 发布期间 | 旧 Pod 摘流中 | `preStop` 8s + 就绪探针，`maxUnavailable: 0` 保证容量 |
| Seed Job 失败 | 无课程数据 | Job `backoffLimit: 5`，脚本幂等可重复执行 |

**单点提示**：单机 Compose 里的 Nginx 仍是单点。生产请使用云负载均衡 + 多 Ingress 副本，或直接把 `k8s/ingress.yaml` 挂到多副本 Ingress Controller 后面。

## 7. 发布与回滚

```bash
# 构建并推送镜像
docker build -t ghcr.io/chinaopenclaw/kaozhengxia-claw:1.0.1 .
docker push ghcr.io/chinaopenclaw/kaozhengxia-claw:1.0.1

# 更新镜像（滚动）
kubectl set image deployment/claw-api api=ghcr.io/chinaopenclaw/kaozhengxia-claw:1.0.1
kubectl rollout status deployment/claw-api

# 回滚
kubectl rollout undo deployment/claw-api
```

数据库迁移：服务启动时执行 `CREATE TABLE IF NOT EXISTS`，属于向前兼容的加法迁移；破坏性变更需单独写迁移脚本并先备份。

## 8. 观测

当前已具备：
- 结构化 JSON 日志（生产）、彩色日志（开发），带请求 id
- `/healthz`（存活）与 `/readyz`（含数据库探测）
- 响应头 `x-ratelimit-limit` / `x-ratelimit-remaining`

建议补齐：
- Prometheus 指标：请求量、P95 延迟、5xx 比例、连接池占用
- OpenTelemetry 链路追踪（Nginx → API → PG）
- 告警：5xx > 1%、就绪失败、连接池 > 80%

## 9. 演进路线

1. 真实支付网关 + 回调验签 + 对账
2. 课程视频对象存储 + 防盗链 + 转码
3. 题库 / 模考 / 结业证书
4. 企业子账号、部门报表、审计日志
5. 多地域部署 + 数据库读写分离
