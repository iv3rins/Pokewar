## Review

结论：**当前仓库可以完成代码构建并启动 Node API，但尚不具备在 Debian 12 空白服务器上可重复、安全上线的部署闭环。**  
主要缺口集中在生产部署定义、静态资源发布、反向代理/TLS、服务编排、健康检查、迁移机制、备份恢复和安全加固。

另外，任务指定的 `plan.md`、`progress.md` 均不存在，读取返回 `ENOENT`；因此本审计以实际仓库、架构文档和开发规范为准。

### Correct

- **构建链路可用。**
  - 根脚本通过 `pnpm -r build` 构建所有 workspace：`package.json:9-17`。
  - Web 使用 `tsc -b && vite build`：`apps/web/package.json:6-10`。
  - Server 使用 TypeScript 生成 `dist`，并可通过 `node dist/index.js` 启动：`apps/server/package.json:6-12`。
  - 实际执行 `pnpm build` 成功，生成：
    - `apps/web/dist/index.html`
    - `apps/web/dist/assets/*.css`
    - `apps/web/dist/assets/*.js`
    - `apps/server/dist/index.js`
- **前端使用同源相对地址，适合由反向代理统一发布。**
  - API 请求使用 `/api/...`：如 `apps/web/src/services/guest.ts:17-23`、`apps/web/src/services/auth.ts:20-24`。
  - Socket.IO 使用默认同源连接，而不是硬编码生产域名：`apps/web/src/services/roomSocket.ts`。
- **生产配置会强制 Redis、PostgreSQL 和非开发 secret。**
  - `NODE_ENV=production` 下要求 `GUEST_SECRET`、`REDIS_URL`、`DATABASE_URL`：`apps/server/src/config/config.ts:27-35`。
- **Redis 初始化会在监听端口前连接。**
  - 三个 Redis client 在 bootstrap 时连接：`apps/server/src/storage/redisClients.ts:10-18`。
  - `bootstrapServer()` 完成后才调用 `listen()`：`apps/server/src/index.ts:4-8`。
- **已有基础优雅关闭。**
  - 捕获 `SIGINT`、`SIGTERM`，关闭 Socket.IO、HTTP、worker 和存储连接：`apps/server/src/index.ts:11-33`、`apps/server/src/bootstrap.ts:98-112`。
- **Cookie 基础属性正确。**
  - 账户和访客 Cookie 均设置 `HttpOnly`、`SameSite=Lax`，生产模式可设置 `Secure`：`apps/server/src/auth/session.ts:14-26`、`apps/server/src/identity/guest.ts:69-78`。
- **文档明确指出生产前仍需真实服务集成验证。**
  - `docs/ARCHITECTURE.md:176-178` 明确说明当前只有 mock-backed adapter 测试，真实 Redis/PostgreSQL 环境尚未验证。

### Blocker

1. **[Blocker] 没有任何可执行的生产部署定义。**
   - 证据：`infra/` 只有 `infra/.gitkeep`。
   - 仓库中不存在 Dockerfile、Compose、systemd 服务、Caddy/Nginx 配置或 Debian 安装脚本。
   - 从空白 Debian 12 无法根据仓库确定：
     - 如何安装固定版本 Node/pnpm；
     - 如何安装生产依赖和构建 workspace；
     - 如何启动、停止、重启服务；
     - Redis/PostgreSQL 如何初始化；
     - 服务依赖和启动顺序；
     - 如何更新与回滚。
   - **建议：**提供经验证的 Docker Compose 生产拓扑，至少包含 `server`、`postgres`、`redis`、`caddy`，并使用 multi-stage Dockerfile；或者完整提供 Node/systemd、PostgreSQL、Redis、Caddy 的原生安装 runbook。二者必须择一形成唯一受支持路径。

2. **[Blocker] 没有生产静态资源服务。**
   - `apps/server/src/app.ts:75-90` 只注册 API 和 JSON 根路由，没有 `express.static()` 或 SPA fallback。
   - 开发代理只存在于 Vite dev server：`apps/web/vite.config.ts:6-13`，不能作为生产服务。
   - 架构要求生产中前端和 API 同源：`docs/ARCHITECTURE.md:82`，但没有实现该部署层。
   - **建议：**由 Caddy/Nginx 服务 `apps/web/dist`，将 `/api/*` 和 `/socket.io/*` 转发给 Node，并为非资源路径增加 `try_files ... /index.html` SPA fallback。不要在生产运行 `vite dev`。

3. **[Blocker] 没有反向代理、WebSocket 和 TLS 配置。**
   - 仓库无 Caddyfile/Nginx 配置。
   - 无法证明：
     - 80→443 重定向；
     - ACME 证书申请和自动续期；
     - Socket.IO WebSocket Upgrade；
     - HTTPS 安全头；
     - 请求体和超时限制；
     - Node 端口不暴露公网。
   - Node 当前使用 `listen(config.port)`，未限定 loopback：`apps/server/src/index.ts:7-9`；若直接运行会监听所有可用接口。
   - **建议：**只公开 TCP 22、80、443；Node、Redis、PostgreSQL 只绑定私网/loopback/Compose 网络。Caddy 应同源代理 `/api/*` 和 `/socket.io/*`，并验证持续 WebSocket 连接。

4. **[Blocker] 没有进程管理和开机恢复。**
   - 虽然应用处理 SIGTERM，但没有 systemd unit、Docker restart policy 或健康驱动重启配置。
   - 服务器重启、Node 崩溃、Redis/PostgreSQL 延迟启动后，应用是否自动恢复没有定义。
   - **建议：**
     - Compose 路径：为所有服务设置 `restart: unless-stopped`，数据库/Redis healthcheck，server 依赖健康状态。
     - 原生路径：提供 systemd unit，包含 `After=network-online.target redis-server.service postgresql.service`、`Restart=on-failure`、合理的停止超时和环境文件权限。

5. **[Blocker] 没有备份、保留和恢复机制。**
   - 仓库不存在 backup/restore 脚本、systemd timer 或恢复演练说明。
   - PostgreSQL 保存账户、会话、rating 和 replay；Redis 保存活动房间、截止时间、身份和锁。任一服务丢失都可能造成用户数据或活动牌局丢失。
   - **建议：**
     - PostgreSQL 每日 `pg_dump --format=custom`，至少保留 7 天并复制到异机/对象存储。
     - Redis 启用 AOF，必要时同时保存 RDB；备份必须包含 Redis 持久化数据。
     - 记录部署 commit、镜像 tag 和校验和。
     - 编写并实际演练恢复流程；未经恢复测试的备份不能视为有效。
     - 备份文件使用 root-only 权限并加密异地副本。

6. **[Blocker] 生产迁移流程不足以支持可靠发布。**
   - 当前命令是 `tsx src/db/migrate.ts`：`apps/server/package.json:9-10`。`tsx` 位于 devDependencies：`apps/server/package.json:26-33`，若生产镜像只安装 production dependencies，该命令不可执行。
   - 迁移只是一组 `CREATE TABLE IF NOT EXISTS`：`apps/server/src/db/migrate.ts:4-49`；没有版本表、迁移序号、事务、迁移锁或回滚/前向兼容策略。
   - 启动应用不会自动检查 schema 版本。
   - **建议：**
     - 将迁移编译为可直接执行的 `dist/db/migrate.js`，或采用正式版本化迁移工具。
     - 在启动新应用版本前运行一次 migration job。
     - 使用 migration history 和 PostgreSQL advisory lock 防止并发执行。
     - 迁移失败必须阻止新版本启动。
     - 制定向后兼容迁移与镜像回滚政策；破坏性迁移不能只靠回滚应用镜像。

### Note

1. **[High] 健康检查不能证明服务已准备好。**
   - `/api/health` 无条件返回 200，只报告配置中的存储名称：`apps/server/src/app.ts:83-85`。
   - 它不查询 Redis、PostgreSQL，不检查迁移版本、deadline worker 或 matchmaking worker。
   - PostgreSQL `Pool` 是惰性连接；bootstrap 只构造三个 Pool：`apps/server/src/bootstrap.ts:64-68`。数据库地址无效或 schema 未迁移时，进程仍可能开始监听。
   - **建议：**区分：
     - `/api/health/live`：仅进程存活；
     - `/api/health/ready`：执行短超时 Redis ping、PostgreSQL `SELECT 1`、schema version 检查，并确认关键 worker 已启动。
   - 反向代理和 Compose/systemd 应使用 readiness，而不是当前无条件 200。

2. **[High] 生产允许来源没有得到强制验证。**
   - `CORS_ORIGINS` 默认仍是 localhost：`apps/server/src/config/config.ts:11`。
   - production 分支只验证 secret、Redis、PostgreSQL，不验证 origin 非空、为 HTTPS 或与生产域名一致：`apps/server/src/config/config.ts:29-35`。
   - 这不满足 `docs/DEVELOPMENT.md:54,70` 所述“生产启动验证 allowed origins”和“对变更 HTTP、Socket.IO handshake 执行 origin checks”。
   - Express/Socket.IO 只配置 CORS 响应策略：`apps/server/src/app.ts:73,105-108`；Socket 身份中间件只检查 Cookie：`apps/server/src/realtime/socket.ts:76-91`。
   - **建议：**production 启动必须拒绝 localhost、空 origin 列表和非 HTTPS origin；对变更 HTTP 请求及 Socket.IO handshake 显式拒绝不在 allowlist 的 `Origin`。

3. **[High] `.env.example` 不是可直接使用的生产配置模板。**
   - 默认 `NODE_ENV=development`，CORS 为本地地址：`.env.example:1-5`。
   - 未说明 URL 格式、TLS、密码编码、secret 生成、文件权限和容器服务名。
   - **建议：**新增生产模板及部署文档，至少说明：
     - `NODE_ENV=production`
     - `PORT`
     - 生产 HTTPS origin
     - 32 字节以上随机 `GUEST_SECRET`
     - 带认证的 `REDIS_URL`
     - 最小权限数据库用户的 `DATABASE_URL`
     - `REDIS_PREFIX`
   - 实际环境文件应为 `0600`，不得进入 Git、镜像层、构建日志或备份元数据。

4. **[High] Redis/PostgreSQL 尚未进行真实服务验证。**
   - `docs/ARCHITECTURE.md:178` 已明确承认缺口。
   - 当前测试无法证明 Redis Lua/事务、重连、AOF 恢复、PostgreSQL JSONB/数组、迁移、Socket.IO Redis adapter fan-out 在真实版本上工作。
   - **建议：**上线前在与生产一致的 PostgreSQL/Redis 版本上验证 migration、登录、创建房间、断线恢复、deadline recovery、replay、rankings 和重启恢复。

5. **[Medium] PostgreSQL 连接池未配置容量和超时，且创建三个独立 Pool。**
   - `apps/server/src/bootstrap.ts:64-68` 分别为 replay、account、rating 创建 Pool。
   - 没有设置 `max`、`connectionTimeoutMillis`、`idleTimeoutMillis`、statement timeout 或 TLS 选项。
   - 在低内存服务器或多实例扩展时会造成不可控连接预算。
   - **建议：**共享一个受限 Pool；根据 PostgreSQL `max_connections` 和应用实例数设置连接预算及查询超时。若数据库不是同机私网连接，启用并验证 TLS。

6. **[Medium] Redis 安全和持久化完全依赖尚不存在的部署层。**
   - client 只接收一个 URL：`apps/server/src/storage/redisClients.ts:10-18`。
   - 仓库没有 Redis ACL/password、`protected-mode`、AOF、内存上限或 eviction 策略。
   - **建议：**Redis 禁止公网监听，配置认证/ACL；启用 AOF；活动房间不能使用会任意逐出 key 的策略。设置内存监控与磁盘告警。

7. **[Medium] 没有资源限制和容量规划。**
   - 仓库没有 Compose/systemd CPU、内存、文件描述符或日志限制。
   - Node、PostgreSQL、Redis 和 Caddy 同机时，空白小规格 Debian 服务器可能发生 OOM。
   - **建议：**记录最低硬件要求；低内存机器配置 swap、容器内存预算、PostgreSQL shared buffers、Redis maxmemory、Node heap 和日志轮转，并进行 12 人牌局及 WebSocket 并发压测。

8. **[Medium] 可观测性不足。**
   - 只有 `console.log/error`，例如 `apps/server/src/index.ts:8,12,26`、`apps/server/src/app.ts:99`。
   - 没有结构化日志、request ID、指标、告警或磁盘轮转配置。
   - **建议：**至少提供 journald/Docker log rotation、结构化日志和告警；监控进程重启、5xx、WebSocket 连接、Redis/PostgreSQL 可用性、内存、磁盘和备份结果。

9. **[Medium] 数据库和缓存版本没有固定。**
   - 由于没有 Compose/package installation runbook，无法知道生产部署使用哪个 PostgreSQL/Redis 版本。
   - **建议：**固定经过验证的 major/minor image tag，避免使用 `latest`，并记录升级和兼容测试步骤。

10. **[Medium] Debian 主机安全基线缺失。**
    - 没有 UFW/nftables、SSH hardening、Fail2ban、自动安全更新或非 root 服务用户说明。
    - **建议：**
      - 只开放 SSH、HTTP、HTTPS；
      - 禁止公网访问 3000、5432、6379；
      - SSH 使用 key，关闭密码登录和直接 root 登录；
      - 启用 Fail2ban 和 unattended-upgrades；
      - 应用容器/服务使用非 root 用户、只读文件系统及最小 Linux capabilities；
      - 定期轮换数据库、Redis 和 Cookie secret。

11. **[Low] API 根路由包含开发地址。**
    - `apps/server/src/app.ts:75-81` 返回 `frontend: 'http://localhost:5173/'`。
    - 不会阻止运行，但属于生产错误信息。
    - **建议：**删除该字段或从已验证的 public origin 生成。

12. **[Low] 缺少部署文档和验收清单。**
    - `docs/` 没有 Debian/production deployment runbook。
    - **建议：**文档应涵盖首次安装、DNS、TLS、迁移、启动、升级、回滚、日志、健康检查、备份、恢复、证书续期验证和故障处理。

### 建议的上线门槛

在解除阻塞前，至少应能从全新 Debian 12 主机重复执行并证明：

1. 安装固定版本运行时或 Docker Engine/Compose。
2. 生成权限为 `0600` 的 production env。
3. 启动 PostgreSQL、Redis 并通过各自健康检查。
4. 执行版本化迁移且失败时停止部署。
5. 构建/拉取固定 commit 对应的 server 和 web artifact。
6. 启动 Node，并通过依赖感知 readiness。
7. Caddy/Nginx 发布 SPA 并代理 API、Socket.IO。
8. HTTPS 证书签发、续期和 WebSocket 实测通过。
9. 服务重启和主机重启后自动恢复。
10. PostgreSQL 与 Redis 备份成功，并从备份完成一次恢复演练。
11. 运行真实服务集成测试和关键 Playwright 多浏览器流程。
12. 验证公网仅暴露 22/80/443。