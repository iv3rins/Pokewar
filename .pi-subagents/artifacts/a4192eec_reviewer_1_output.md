## Review

结论：**当前仓库不具备生产上线条件**。核心规则、类型检查和内存适配器测试质量尚可，但排位结算、多人 Web UI、真实基础设施验证、安全控制、部署与运维闭环仍存在阻断项。

任务指定的根目录 `plan.md`、`progress.md` 均不存在，无法据此核对完成声明。本次结论以规范、代码、测试和命令结果为准。

### Correct

- Cookie 基础属性合理：
  - 访客 Cookie 使用 HMAC 签名、`HttpOnly`、`SameSite=Lax`，生产环境启用 `Secure`：`apps/server/src/identity/guest.ts:32-33,69-78`。
  - 账号 Cookie 使用随机 opaque token，服务端只哈希 token：`apps/server/src/auth/session.ts:6-12,14-27`。
- HTTP JSON 请求体限制为 16 KiB，并启用 Helmet、关闭 `x-powered-by`：`apps/server/src/app.ts:70-74`。
- 生产环境会拒绝开发默认密钥以及缺失的 Redis/PostgreSQL URL：`apps/server/src/config/config.ts:27-35`。
- Redis 房间状态与 deadline 索引通过 Lua 一起更新：`apps/server/src/storage/redisIndexedRoomStore.ts:9-19,49-57`。
- 房间命令由 Redis 分布式锁保护；锁释放使用 token 校验 Lua：`apps/server/src/rooms/redisLock.ts:4-9,37-51`。
- 私有 projection 在 Socket 广播前按身份生成，而不是广播 canonical state：`apps/server/src/realtime/socket.ts:54-59`。
- PostgreSQL replay 查询包含参与者授权与过期判断：`apps/server/src/db/postgresReplayRepository.ts:47-69`。
- 类型检查、单元/适配器测试、构建、Playwright PVE 流程和生产依赖漏洞审计均通过。

---

## Blocker

### 1. 排位分数、胜负和场次从未在比赛结束时更新

- `RatingRepository` 只有初始化和读取接口，没有赛后写入接口：`apps/server/src/rating/ratingRepository.ts:21-29`。
- PostgreSQL 实现同样只有 `ensureAccount`、查询和 leaderboard：`apps/server/src/rating/postgresRatingRepository.ts:41-86`。
- 对局结束路径只保存 replay，没有执行 Glicko-2 更新：`apps/server/src/rooms/roomService.ts:430-448`。
- 全仓搜索显示 `glicko2` 只用于单元计算和显示 tier，没有生产结算调用。
- 结果是所有账号会永久停留在 `ranked_games = 0`，排行榜不会产生正式选手。这直接违反 `references/RULES.md` 的即时赛后更新要求以及 `docs/ADR/0008-matchmaking-and-ranked-rating.md`。

**上线前必须补齐**：事务化的多人 placement/Glicko-2 更新、幂等结算记录、并发重复结束保护、PVE/含访客比赛排除、PostgreSQL 集成测试。

### 2. Web 多人对局界面仍被硬编码为 PVE，主动退出多人对局不可用

- 任意存在 `room.game` 的房间都进入同一个 `GameScene`：`apps/web/src/App.tsx:242-254`。
- 牌桌标题无条件显示“PVE 牌桌”：`apps/web/src/components/game/GameScene.tsx:529-536`。
- 结算页无条件显示 `PVE RESULT` 和“不计入天梯”：`apps/web/src/components/game/GameScene.tsx:492-503`。
- GameScene 的退出操作始终调用 `onLeavePve`：`apps/web/src/App.tsx:277`；而 `leavePve()` 对非 PVE 房间拒绝执行，导致规则要求的 active leave 无可用 UI。
- 这会让 private/matchmade/ranked 对局显示错误信息，并阻止正常主动离场及相应排名损失处理。

### 3. Redis/PostgreSQL 生产路径没有真实服务集成证明

- 架构文档明确承认所有基础设施测试都是 mock-backed，真实 Redis、PostgreSQL、Docker 均未运行：`docs/ARCHITECTURE.md:176-178`。
- Redis 测试使用自建 fake client，例如 `apps/server/src/storage/redisIndexedRoomStore.test.ts`、`apps/server/src/matchmaking/redisMatchmakingStore.test.ts`、`apps/server/src/rooms/redisLock.test.ts`。
- PostgreSQL replay 测试使用 `FakePool`：`apps/server/src/db/postgresReplayRepository.test.ts:23-43`。
- 没有真实服务测试覆盖迁移、Redis Lua 脚本兼容性、Redis 重连、PostgreSQL JSONB/数组行为、TLS、故障恢复或多实例 Socket.IO fan-out。

鉴于 Redis 是房间、锁、deadline、匹配和跨实例消息的权威存储，而 PostgreSQL 是账号与排位的持久层，**真实服务集成套件通过前不能上线**。

### 4. 没有可执行的生产部署定义

- `infra/` 只有 `infra/.gitkeep`。
- 没有 Dockerfile、Compose/Kubernetes/systemd/反向代理配置、静态 Web 发布配置、迁移 Job 或部署 runbook。
- 架构要求生产同源提供 Web 和 API，但 Express 没有静态文件服务，仅返回写死的开发前端地址：`apps/server/src/app.ts:75-85`。
- 当前无法从仓库证明确切的 TLS 终止、WebSocket upgrade、迁移顺序、健康检查、滚动发布和环境变量注入方式。

---

## High

### 1. 缺少规定的 Origin/CSRF 强制检查

- 开发规范明确要求 mutating HTTP 和 Socket.IO handshake 强制校验 Origin：`docs/DEVELOPMENT.md:66-74`。
- 当前 HTTP 只安装 `cors(...)`：`apps/server/src/app.ts:73`。CORS 响应头策略本身不是服务端拒绝机制，非浏览器客户端或某些无 Origin 请求仍可提交变更。
- Socket.IO 只配置 `cors`，未使用 `allowRequest` 或 handshake middleware 明确比对 Origin：`apps/server/src/app.ts:104-109`。
- 测试中没有恶意 Origin、缺失 Origin或伪造跨站变更请求的拒绝用例：`apps/server/src/realtime/socket.test.ts:66-75` 只使用允许的 Origin。

### 2. 大部分敏感入口没有速率限制

- 规范要求限制 guest-session、房间 create/join 和 gameplay commands：`docs/DEVELOPMENT.md:70-72`。
- 当前只有账号登录失败限速：`apps/server/src/http/authRoutes.ts:52-70`。
- `POST /api/guest/session` 无速率限制：`apps/server/src/http/guestRoutes.ts:34-51`。
- `room:create`、`room:join`、`game:command`、PVE 创建、匹配入队均无频率或并发配额：`apps/server/src/realtime/socket.ts:148-193,273-307,420-448`。
- Socket.IO 也没有设置显式 `maxHttpBufferSize`：`apps/server/src/app.ts:104-108`。

攻击者可批量制造身份、Redis key、房间和高频锁竞争；在 1 vCPU/1 GB 环境中尤其危险。

### 3. 多实例下 duplicate-tab 控制权和断线状态不正确

- “控制 socket”只存于进程内 `Map`：`apps/server/src/realtime/socket.ts:73-74,100-108`。
- 两个标签若连接到不同实例，两边都认为自己拥有控制权，违反“一身份全局唯一控制状态”。
- 某实例收到 disconnect 时只能检查本实例的 Map：`apps/server/src/realtime/socket.ts:451-466`；即使同一身份仍连接在另一实例，也可能写入 canonical disconnect deadline 并在 30 秒后淘汰玩家。
- Socket.IO Redis adapter 只能 fan-out 事件，并不会自动共享这个控制权 Map。

### 4. 客户端重试不保留 actionId，服务端也不返回缓存结果

- 规范要求 retry 保留相同 actionId：`docs/DEVELOPMENT.md:61-62`。
- 当前每次 `gameCommand` 调用都会生成新的 UUID：`apps/web/src/services/roomSocket.ts:121-123`。
- 若服务端已经提交命令但 ack 丢失，用户重试会成为新命令；是否被 version 拒绝取决于客户端快照到达顺序。
- Domain 对重复 actionId 返回 `ACTION_ID_REUSED`，没有返回第一次结果：`packages/domain/src/game/reducer.ts:95-110`。
- 架构声明的“idempotent command results keyed by identity and action ID”尚未真正实现：`docs/ARCHITECTURE.md:134-140`。

### 5. PostgreSQL 被拆成三个默认连接池，不适合 1 GB 小实例/小数据库套餐

- bootstrap 为 replay、accounts、ratings 分别创建独立 `Pool`：`apps/server/src/bootstrap.ts:64-68`。
- 没有设置 `max`、连接超时、idle timeout、statement timeout 或 TLS 选项。
- node-postgres 默认每池最多 10 个连接，单实例可占用约 30 个数据库连接；横向扩容会线性增加。
- 在 1 vCPU/1 GB 环境中，这同时增加 Node 连接管理开销，并可能耗尽托管 PostgreSQL 的低套餐连接上限。

应共享一个受限 Pool，并按实际容量配置超时、TLS 和连接预算。

### 6. Replay 持久化位于房间提交热路径且先于 Redis 保存

- `saveTransition()` 在 game over 时先等待 PostgreSQL replay save，然后才保存 Redis room：`apps/server/src/rooms/roomService.ts:430-448`。
- PostgreSQL 抖动会阻断最终游戏状态提交，违背“PostgreSQL 不在每次牌局动作热路径、异步记录完成比赛”的架构设计：`docs/ARCHITECTURE.md:32-40,142`。
- 也没有 outbox、重试队列或持久化失败告警。

### 7. Redis matchmaking 的多 key 更新不是原子的

- `createProposal()` 逐个检查 entry/proposal，再逐个删除队列 entry，最后保存 proposal：`apps/server/src/matchmaking/redisMatchmakingStore.ts:69-80`。
- `saveProposal()` 又分别写 proposal、identity 索引和 sorted sets：`apps/server/src/matchmaking/redisMatchmakingStore.ts:145-159`。
- 进程在中途退出会留下玩家丢队、孤立 proposal 或缺失 identity 索引。
- 外层锁是固定 10 秒 lease 且没有续租/fencing：`apps/server/src/rooms/redisLock.ts:22-50`；超时后旧任务仍可能继续写入。

应使用 Lua/事务完成状态转换，或增加可恢复状态机和 fencing token。

### 8. 生产配置没有验证允许来源，默认值仍是 localhost

- `CORS_ORIGINS` 默认开发来源，即使 `NODE_ENV=production` 也不会拒绝：`apps/server/src/config/config.ts:11,29-35`。
- 允许解析为空数组，也没有验证 HTTPS origin、禁止 wildcard、生产域名一致性。
- 这与“production startup validates allowed origins”要求不符：`docs/DEVELOPMENT.md:54`。

### 9. 缺少真实多人关键旅程 E2E

- Playwright 只有两个 PVE tutorial 测试：`tests/e2e/pve-tutorial.spec.ts:3-55`。
- 没有两个或更多 browser context 的 private room、matchmaking confirmation、多人出牌、Joker、断线恢复、排位结算、隐私网络断言。
- 这不满足 `docs/DEVELOPMENT.md:94-100` 的关键多人流程要求。

### 10. 无监控、告警、备份和恢复证明

全仓未发现：

- 结构化日志和 request/correlation ID；
- Redis/PostgreSQL/Socket.IO 指标；
- deadline backlog、lock timeout、replay cleanup、匹配队列、断线淘汰异常告警；
- `/ready` 依赖检查；
- Redis/PostgreSQL 备份策略；
- restore 演练、RPO/RTO；
- 数据库迁移回滚说明；
- 容量、磁盘和连接池告警。

对于有账号、排位和 14 天 replay 的系统，这是生产上线前必须补齐的运维能力。

---

## Medium

### 1. `/api/health` 是始终成功的浅健康检查

- 只返回 `{ok:true, storage}`，不检查 Redis、PostgreSQL、deadline worker、matchmaking worker或迁移版本：`apps/server/src/app.ts:83-85`。
- Redis/PostgreSQL 在启动时也没有显式 ping/query 验证；PostgreSQL Pool 是惰性连接。
- 容器可能被标记 ready，实际所有生产请求随后失败。

### 2. 1 vCPU/1 GB 下存在状态膨胀和广播放大风险

- 每个 canonical game 永久保存全部 accepted commands：`packages/domain/src/game/model.ts:41-59`、`packages/domain/src/game/reducer.ts:103-110`。
- 每个命令都会序列化完整 room 到 Redis：`apps/server/src/storage/redisIndexedRoomStore.ts:49-57`。
- 每次更新为每个玩家构造并发送完整 snapshot：`apps/server/src/realtime/socket.ts:54-59`。
- 最多 12 人时形成“完整状态序列化 + 12 次 projection + 12 次 Socket 广播”；长局 command log 会持续增大。
- deadline worker 每 250ms 扫描一次：`apps/server/src/scheduler/deadlineWorker.ts:5,54-58`。

上线前应进行 4/8/12 人长局压测，记录 RSS、GC pause、event-loop lag、Redis payload、网络流量和 1 vCPU 下的 p95/p99。

### 3. 格式门禁失败

- `pnpm format:check` 因 `.pi-subagents/artifacts/*.md` 未被 `.prettierignore` 忽略而失败。
- `.prettierignore:1-6` 没有覆盖 `.pi-subagents/`。
- 这不是产品运行时缺陷，但当前提交不满足 `docs/DEVELOPMENT.md:102-110` 的完成门禁。

### 4. Graceful shutdown 没有明确 drain 在途命令

- 收到信号后关闭 Socket.IO 和 HTTP，再关闭 worker/storage：`apps/server/src/index.ts:11-20`。
- 没有 readiness 先置为 false、停止接收命令、等待在途 room lock 操作、设置强制退出超时。
- 发布期间可能使尚未 ack 的命令失败，客户端当前又不能可靠复用 actionId。

### 5. 无容量或压力测试

未发现针对以下场景的测试或预算：

- 12 人房间持续 full snapshot；
- 数百/数千房间 deadline backlog；
- Redis/PostgreSQL 暂停和恢复；
- 多实例同时处理同一身份；
- Socket reconnect storm；
- 1 vCPU CPU 饱和和 1 GB OOM。

---

## Optional

- 将服务日志改为结构化 JSON，并统一脱敏、trace ID、room ID 和 action ID；当前主要依赖 `console.*`，如 `apps/server/src/app.ts:99`、`apps/server/src/realtime/socket.ts:32-40`。
- 为 schema 迁移引入版本化迁移工具；当前 `CREATE TABLE IF NOT EXISTS` 脚本无法可靠表达后续变更或回滚：`apps/server/src/db/migrate.ts:4-59`。
- 为 PostgreSQL session 过期数据增加清理任务；当前迁移有 expiry index，但未见 session cleanup worker：`apps/server/src/db/migrate.ts:13-21`。
- 增加 Redis keyspace 容量文档和 eviction 策略要求，避免生产 Redis 使用会淘汰权威房间状态的策略。
- 补充移动端 Playwright 项目和 360px 非重叠验收；当前只配置 1920×1080 Chromium：`playwright.config.ts:17-22`。

## Residual risks

- 未连接真实 Redis/PostgreSQL，因此无法证明 Lua、TTL、数据库类型、连接重试和故障恢复行为。
- 未进行多实例测试，Socket 控制权、断线和跨实例匹配仍有确定性风险。
- 未进行 1 vCPU/1 GB 负载测试，无法给出安全并发上限。
- 仓库所有文件当前均显示为 untracked，无法基于提交历史或 PR diff 判断变更边界；但没有 staged 文件。
- 指定的 `plan.md`、`progress.md` 不存在。