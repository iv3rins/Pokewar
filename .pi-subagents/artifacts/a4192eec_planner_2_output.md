# Implementation Plan

## Goal
为 `game.n1komajor.top` 的全新 Debian 12（1 vCPU / 1 GB RAM）提供基于 Docker Compose、Caddy、Node、PostgreSQL 和 Redis 的可重复生产部署方案，覆盖初始化、升级、回滚、每日七天备份、恢复、UFW、Fail2ban、Swap 与最小暴露端口。

## Tasks

1. **补齐生产配置、代理信任和依赖健康检查**
   - Files: `apps/server/src/config/config.ts`, `apps/server/src/app.ts`, `apps/server/src/bootstrap.ts`, `.env.example`
   - Changes:
     - 增加并校验 `TRUST_PROXY_HOPS`（生产 Compose 固定为 `1`）与 `DATABASE_POOL_MAX`（默认 `10`，生产上限不超过 `20`）。
     - 在 Express 中设置 `app.set('trust proxy', config.trustProxyHops)`，使经 Caddy 转发的真实客户端 IP 可用于登录限流。
     - 将当前 PostgreSQL 的三个独立 `Pool`（账户、评分、回放各一个）改为共享单一连接池；由 `bootstrap.ts` 单独关闭共享池，避免 1 GB 主机上默认池上限叠加及重复关闭。
     - 扩展 `/api/health`：在生产环境中检查 Redis `PING` 与 PostgreSQL `SELECT 1`，依赖不可用时返回 `503`；Docker 的 server healthcheck 以此为准。
     - `.env.example` 记录生产变量、同源 CORS 和数据库/Redis URL 的格式，不填入任何真实密钥。
   - Acceptance:
     - 配置测试覆盖生产缺失变量、无效 `TRUST_PROXY_HOPS` 和无效连接池上限。
     - 服务在 Redis/PostgreSQL 任一不可用时健康端点返回非成功状态；两个依赖恢复后返回 `200`。

2. **补上真实的来源校验，避免把 CORS 当作访问控制**
   - Files: `apps/server/src/app.ts`, `apps/server/src/realtime/socket.ts`, `apps/server/src/http/originGuard.ts` (new), `apps/server/src/http/originGuard.test.ts` (new), `apps/server/src/realtime/socket.test.ts`
   - Changes:
     - 实现共享的 allowlist 来源校验，使用现有 `CORS_ORIGINS`。
     - 对带 `Origin` 的变更 HTTP 请求拒绝非 allowlist 来源；Socket.IO 握手也必须拒绝非 allowlist `Origin`。
     - 保留健康检查和同源浏览器请求；不依赖 CORS 响应头作为服务端授权判断。
     - 生产环境仅配置 `CORS_ORIGINS=https://game.n1komajor.top`，前端继续使用相对 `/api` 与同源 Socket.IO，无需新增 Vite 运行时变量。
   - Acceptance:
     - HTTP 与 WebSocket 测试验证 `https://game.n1komajor.top` 可连接，任意其他 Origin 被拒绝。
     - 现有本地测试配置显式保留 `http://localhost:5173`。

3. **创建可重现的多阶段 Docker 构建**
   - Files: `.dockerignore` (new), `infra/Dockerfile` (new)
   - Changes:
     - 采用 Node 22 多阶段构建：以 lockfile 执行 `pnpm install --frozen-lockfile`，构建 workspace，再分别输出 `server` 和 `caddy` 两个目标。
     - `server` 目标保留运行 Node server 所需的 `apps/server/dist`、`packages/domain/dist`、`packages/protocol/dist`、workspace manifests 和运行依赖，启动命令为 `node apps/server/dist/index.js`。
     - `caddy` 目标基于固定 Caddy 2 镜像，将 `apps/web/dist` 放入 `/srv`。
     - `.dockerignore` 排除 `.git`、`node_modules`、`dist`、本地 `.env`、日志、`data`、测试输出和子代理产物，避免密钥或开发产物进入构建上下文。
   - Acceptance:
     - `docker compose build` 成功。
     - server 镜像中能运行 `node apps/server/dist/db/migrate.js`。
     - caddy 镜像中存在 `/srv/index.html` 和构建后的静态资源。

4. **建立 Compose 生产拓扑和 Caddy 同源反向代理**
   - Files: `infra/compose.production.yml` (new), `infra/caddy/Caddyfile` (new), `infra/deploy/production.env.example` (new), `.gitignore`
   - Changes:
     - Compose 项目名固定为 `pokewar`，服务为 `caddy`、`server`、`postgres`、`redis`。
     - 仅 `caddy` 发布 `80:80` 与 `443:443`；`server:3000`、PostgreSQL `5432`、Redis `6379` 均不发布到宿主机。
     - Caddy 配置：
       - 主机名为 `game.n1komajor.top`，使用自动 ACME HTTPS 和 HTTP 到 HTTPS 重定向。
       - `/api/*` 和 `/socket.io/*` 反向代理至 `server:3000`，Socket.IO Upgrade 由 Caddy 自动透传。
       - 其余路径从 `/srv` 提供 React SPA，并使用 `try_files {path} /index.html`。
       - 添加低风险安全响应头，例如 `X-Content-Type-Options: nosniff`、`Referrer-Policy` 与按 HTTPS 验证后启用的 HSTS；不要在未测试前强加可能影响 React/Socket.IO 的 CSP。
     - 使用 `postgres_data`、`redis_data`、`caddy_data`、`caddy_config` 命名卷；PostgreSQL 和 Redis 位于 Compose internal data network，Caddy 不连接该网络。
     - PostgreSQL 使用保守参数：`max_connections=20`、`shared_buffers=128MB`、`effective_cache_size=256MB`、`work_mem=4MB`、`maintenance_work_mem=64MB`。
     - Redis 启用 AOF（`appendfsync everysec`）和 RDB 快照，`maxmemory 96mb`、`maxmemory-policy noeviction`；设置 `requirepass`，并只通过内部网络访问。
     - 服务使用 `restart: unless-stopped`、`init: true`、健康检查、Docker 日志轮转和保守内存限额。建议上限：Caddy 64 MB、Redis 128 MB、PostgreSQL 300 MB、Node 256 MB，并设置 `NODE_OPTIONS=--max-old-space-size=192`。
     - 将真实 `infra/deploy/production.env` 加入 `.gitignore`；模板只包含占位值。
   - Acceptance:
     - `docker compose --env-file infra/deploy/production.env -f infra/compose.production.yml config` 成功。
     - `docker inspect` 显示仅 Caddy 有宿主机 PublishedPorts。
     - 在浏览器中 HTTPS 加载首页、创建 guest session、建立 Socket.IO WebSocket，并通过 `/api/health`。

5. **定义并生成生产环境变量**
   - Files: `infra/deploy/production.env.example`, `infra/deploy/first-install-debian12.sh` (new)
   - Changes:
     - 模板与首次安装脚本生成/校验以下变量：
       ```dotenv
       NODE_ENV=production
       PORT=3000
       GUEST_SECRET=<openssl rand -hex 48>
       CORS_ORIGINS=https://game.n1komajor.top
       TRUST_PROXY_HOPS=1
       DATABASE_POOL_MAX=10
       POSTGRES_DB=pokewar
       POSTGRES_USER=pokewar
       POSTGRES_PASSWORD=<openssl rand -hex 32>
       DATABASE_URL=postgresql://pokewar:<same-hex-password>@postgres:5432/pokewar
       REDIS_PASSWORD=<openssl rand -hex 32>
       REDIS_URL=redis://:<same-hex-password>@redis:6379/0
       REDIS_PREFIX=pokewar:
       CADDY_EMAIL=<operator-monitored-email>
       ```
     - 生成后的 `production.env` 必须为 `root:root`、`0600`，不可进入 Git、镜像、Docker build context 或日志。
     - 使用十六进制密码，以避免 URL 编码错误。
   - Acceptance:
     - 首次安装脚本拒绝空的 Caddy 联系邮箱、错误的管理 CIDR 或缺失的密钥文件。
     - `docker compose config` 中不输出应用密钥到版本库文件；生产运行时 `loadConfig()` 通过校验。

6. **实现 Debian 12 一键初始化、Swap、UFW 与 Fail2ban**
   - Files: `infra/deploy/first-install-debian12.sh` (new), `infra/deploy/fail2ban/pokewar.local` (new), `docs/DEPLOYMENT_DEBIAN12.md` (new)
   - Changes:
     - 脚本以 root 执行，要求调用方显式提供 `ADMIN_CIDR`，例如：
       ```bash
       CADDY_EMAIL=ops@example.com ADMIN_CIDR=203.0.113.10/32 \
         bash /opt/pokewar/infra/deploy/first-install-debian12.sh
       ```
     - 安装 `ca-certificates`、`curl`、`gnupg`、`git`、`ufw`、`fail2ban`、`cron` 和 Docker 官方 Debian 仓库提供的 Docker Engine/Compose plugin。
     - 创建 2 GB `/swapfile`，权限 `0600`，写入 `/etc/fstab`，设置 `vm.swappiness=10`；记录 Swap 是低内存保护而非容量替代品。
     - 防火墙顺序必须先允许管理 SSH CIDR，再允许 `80/tcp`、`443/tcp`，然后启用 UFW。使用 `ufw limit` 或 CIDR allowlist 管理 SSH；不允许 PostgreSQL、Redis、Node 端口。
     - 配置 Fail2ban 的 `sshd` jail：启用、`maxretry=5`、`findtime=10m`、`bantime=1h`；不为尚无解析规则的 Caddy 日志添加伪造的 Web jail。
     - 克隆 `https://github.com/iv3rins/Pokewar.git` 的 `main` 到 `/opt/pokewar`，生成生产 env，构建镜像，启动数据库/Redis，执行迁移，再启动 server/Caddy。
   - Acceptance:
     - `ufw status verbose` 只显示 SSH 管理规则、80、443。
     - `ss -lntup` 不显示宿主机监听的 3000、5432、6379。
     - `swapon --show` 显示 2 GB swap；`fail2ban-client status sshd` 正常。
     - DNS A 记录指向服务器；若没有已配置的 IPv6 服务，移除 AAAA 记录，避免 ACME 验证失败。

7. **实现有健康门槛的部署更新与镜像回滚**
   - Files: `infra/deploy/common.sh` (new), `infra/deploy/deploy.sh` (new), `infra/deploy/rollback.sh` (new), `docs/DEPLOYMENT_DEBIAN12.md`
   - Changes:
     - `deploy.sh` 使用 `flock` 防止与备份/恢复并发，执行：
       1. 预升级备份；
       2. `git fetch origin main` 后检出精确 `origin/main` commit；
       3. 使用 commit SHA 作为 `IMAGE_TAG` 构建 server 与 caddy 镜像；
       4. 等待 PostgreSQL/Redis healthcheck；
       5. 在 Caddy 对外切换前执行 `node apps/server/dist/db/migrate.js`；
       6. 启动/recreate server 与 Caddy；
       7. 轮询容器 healthcheck、`https://game.n1komajor.top/api/health` 和关键 Socket.IO smoke test；
       8. 将新旧镜像 tag、commit、时间写入 `/opt/pokewar/state/releases/`。
     - 只在 CI 已完成 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 后部署；不要在 1 GB 生产机上并发跑完整测试套件。
     - `rollback.sh <previous-image-tag>` 不使用 `git reset --hard`，而是恢复已保留的 server/caddy 镜像 tag，重新执行 healthcheck。
     - 对当前的仅创建式迁移，应用镜像可回滚；未来出现破坏性迁移时，必须先新增迁移兼容期或以同一备份恢复数据库，不能宣称单独镜像回滚安全。
   - Acceptance:
     - 更新前后 HTTPS healthcheck 返回 `200` 且 `storage` 为 `redis`。
     - 回滚后首页静态资源、HTTP API 与 Socket.IO 都来自同一记录的镜像版本。
     - 发布记录含 commit、镜像 tag、备份目录和结果，且至少保留一个已知可回滚镜像。

8. **实现每日保留七套的 PostgreSQL/Redis 备份**
   - Files: `infra/deploy/backup.sh` (new), `infra/systemd/pokewar-backup.service` (new), `infra/systemd/pokewar-backup.timer` (new), `docs/DEPLOYMENT_DEBIAN12.md`
   - Changes:
     - 在 `/var/backups/pokewar/YYYY-MM-DDTHHMMSSZ/` 创建一次备份集，元数据记录 UTC 时间、部署 commit、`IMAGE_TAG`、SHA-256 校验和和 Compose 项目名。
     - 使用 `pg_dump --format=custom --no-owner --no-privileges` 生成 `postgres.dump`；完成后执行 `pg_restore --list` 验证归档。
     - 请求 Redis `BGSAVE`，在 RDB 完成后复制 `dump.rdb` 并使用 Redis 自带校验器验证；保留该文件用于灾难诊断和可选的活动房间恢复。
     - 仅在 PostgreSQL dump 和 Redis RDB 都校验成功后将临时目录原子重命名为备份集。
     - 依据成功备份目录排序，仅保留最近七套，删除前先验证目录名和根目录，禁止对任意路径执行宽泛递归删除。
     - 用 systemd timer 每日固定时间运行，设置 `Persistent=true`，使关机期间错过的备份在开机后补跑。
   - Acceptance:
     - `systemctl list-timers pokewar-backup.timer` 显示下一次执行时间。
     - 手工运行备份后生成有效 `postgres.dump`、`redis.rdb`、校验和及 metadata。
     - 创建第八套成功备份后只保留最新七套完整集合。

9. **实现明确区分持久数据和活动对局的恢复流程**
   - Files: `infra/deploy/restore.sh` (new), `docs/DEPLOYMENT_DEBIAN12.md`
   - Changes:
     - `restore.sh --backup <UTC-directory> --yes` 默认恢复 PostgreSQL，并从备份 metadata 选择匹配的 image tag；先停止应用，校验 checksum，重建指定 PostgreSQL 卷，恢复 custom dump，启动与备份兼容的 server/caddy，然后执行健康检查。
     - 默认**不恢复 Redis 活动对局状态**：Redis 存储的是有 TTL 的房间、锁、连接和 deadline，跨日恢复会回退或复活旧对局。恢复后启动空 Redis，用户重新进入大厅；PostgreSQL 中已完成对局、账户和会话数据以备份时间为准。
     - 仅提供显式危险选项 `--restore-redis-active-state` 恢复 RDB，并在脚本和文档中说明它只适用于同日灾难恢复；deadline worker 会根据已持久化 deadline 自动处理逾期转换。
     - 恢复前后记录原卷名称和备份 metadata；不得使用 `docker compose down -v`，以免误删 Caddy 证书卷。
   - Acceptance:
     - 在测试环境恢复后可查询 accounts、ratings、replay schema，并通过 `/api/health`。
     - 默认恢复时 Redis 数据卷为空且应用可创建新房间。
     - 显式 Redis 恢复仅在操作者确认后执行，且文档说明对进行中游戏的风险。

10. **编写运维文档和执行验证**
    - Files: `docs/DEPLOYMENT_DEBIAN12.md`, `docs/DEVELOPMENT.md`
    - Changes:
      - 文档包含 DNS 前置条件、首次安装、环境变量、发布、回滚、备份、恢复、证书、日志、磁盘空间、资源限制和故障排查。
      - 在 `docs/DEVELOPMENT.md` 的生产要求中链接部署文档，并说明真实 PostgreSQL/Redis/Caddy 集成验证必须在已配置环境运行。
      - 文档列出关键运维命令：
        ```bash
        cd /opt/pokewar
        docker compose --env-file infra/deploy/production.env -f infra/compose.production.yml ps
        docker compose --env-file infra/deploy/production.env -f infra/compose.production.yml logs -f server
        curl --fail --silent --show-error https://game.n1komajor.top/api/health
        sudo /opt/pokewar/infra/deploy/deploy.sh
        sudo /opt/pokewar/infra/deploy/rollback.sh <image-tag>
        sudo /opt/pokewar/infra/deploy/backup.sh
        sudo /opt/pokewar/infra/deploy/restore.sh --backup <UTC-directory> --yes
        ```
   - Acceptance:
     - 从一台新 Debian 12 虚拟机按文档执行，可得到 HTTPS 首页、可用 API、Socket.IO、Redis-backed storage 和已迁移 PostgreSQL。
     - 360px 浏览器与桌面浏览器均能完成 guest session 和房间创建的关键路径。
     - 发布、备份和恢复操作均有可审计日志。

## Files to Modify

- `.env.example` - 记录新的生产配置字段及安全示例。
- `.gitignore` - 忽略 `infra/deploy/production.env`，保留可提交模板。
- `apps/server/src/config/config.ts` - 校验代理与数据库连接池配置。
- `apps/server/src/app.ts` - 代理设置、来源保护挂载、依赖健康端点。
- `apps/server/src/bootstrap.ts` - Redis/PostgreSQL 依赖探针与单一 PostgreSQL Pool 生命周期。
- `apps/server/src/realtime/socket.ts` - Socket.IO 握手来源校验。
- `apps/server/src/config/config.test.ts` - 新环境变量的合法/非法测试。
- `apps/server/src/app.test.ts` - healthcheck 与代理配置测试。
- `apps/server/src/realtime/socket.test.ts` - 允许/拒绝 Origin 的握手测试。
- `docs/DEVELOPMENT.md` - 链接生产部署与真实服务验证要求。

## New Files

- `.dockerignore` - 排除密钥、依赖和本地生成物。
- `infra/Dockerfile` - Node build/server 与 Caddy static 多阶段镜像。
- `infra/compose.production.yml` - Caddy、server、PostgreSQL、Redis 的生产编排。
- `infra/caddy/Caddyfile` - HTTPS、SPA 静态服务、API/WebSocket 反向代理。
- `infra/deploy/production.env.example` - 不含秘密的生产环境变量模板。
- `infra/deploy/common.sh` - Compose、锁、状态目录、env 加载公共函数。
- `infra/deploy/first-install-debian12.sh` - Debian 12/Docker/Swap/UFW/Fail2ban/首次部署脚本。
- `infra/deploy/deploy.sh` - 带预备份和健康验证的升级脚本。
- `infra/deploy/rollback.sh` - 使用保留镜像 tag 的回滚脚本。
- `infra/deploy/backup.sh` - PostgreSQL/Redis 备份与七代轮换。
- `infra/deploy/restore.sh` - 默认数据库恢复及可选 Redis 恢复。
- `infra/deploy/fail2ban/pokewar.local` - SSH Fail2ban jail。
- `infra/systemd/pokewar-backup.service` - 备份服务定义。
- `infra/systemd/pokewar-backup.timer` - 每日、持久化 backup timer。
- `apps/server/src/http/originGuard.ts` - HTTP 变更请求的来源校验。
- `apps/server/src/http/originGuard.test.ts` - 来源校验单元测试。
- `docs/DEPLOYMENT_DEBIAN12.md` - 完整部署与运维手册。

## Dependencies

1. 任务 1 和任务 2 必须先完成，才能安全配置 Caddy 代理、真实 IP 限流和容器健康检查。
2. 任务 3 依赖应用构建产物与生产配置约定。
3. 任务 4 依赖任务 1、任务 3 和变量模板。
4. 任务 5 依赖任务 4 的 Compose 服务名、网络名与 URL 格式。
5. 任务 6 依赖任务 4、任务 5，首次安装脚本才能生成正确 env 并启动服务。
6. 任务 7、任务 8、任务 9 都依赖固定 Compose 项目名、命名卷、镜像 tag 和 env 路径。
7. 任务 10 在全部脚本、服务名和验证命令稳定后完成。

## Risks

- **High**: 指定的 `context.md` 在工作区不存在，读取 `D:\iverins_workspace\game\pokewar-final\context.md` 返回 `ENOENT`。若该文件包含额外域名、邮箱、备份位置、SSH 管理 CIDR 或数据保留要求，部署计划需在实施前与其对齐。
- **High**: [`apps/server/src/app.ts`](D:/iverins_workspace/game/pokewar-final/apps/server/src/app.ts:66) 当前只设置 CORS 响应头，未对 HTTP 变更请求进行来源拒绝；[`apps/server/src/realtime/socket.ts`](D:/iverins_workspace/game/pokewar-final/apps/server/src/realtime/socket.ts:76) 也未显式拒绝非 allowlist Socket Origin。必须先完成任务 2，不能将 Caddy 部署视为替代授权控制。
- **High**: [`apps/server/src/bootstrap.ts`](D:/iverins_workspace/game/pokewar-final/apps/server/src/bootstrap.ts:65) 当前为回放、账户和评分创建三个 PostgreSQL Pool。在默认每池连接上限下，1 GB 主机上的 PostgreSQL `max_connections` 和内存预算会失控；必须共享一个受限连接池。
- **Medium**: [`apps/server/src/app.ts`](D:/iverins_workspace/game/pokewar-final/apps/server/src/app.ts:83) 当前 `/api/health` 仅报告存储名称，不能发现 PostgreSQL 断连。没有任务 1 的依赖探针，Compose 的“healthy”会产生误报。
- **Medium**: 每日全量 PostgreSQL 备份的 RPO 最大为 24 小时；如果需要更低 RPO，应在未来设计 PostgreSQL WAL 归档和异地对象存储，这超出本次 1 GB 单机、七天本地备份范围。
- **Medium**: Redis 是有 TTL 的活动状态。默认恢复 Redis 会引入过时对局和 deadline 风险，因此必须默认清空，只有操作者显式选择才恢复 RDB。
- **Medium**: 2 GB Swap 可以避免瞬时 OOM，但会使内存压力期间响应明显变慢。应监控 `docker stats`、磁盘和 `free -h`，而不是依赖 Swap 支撑长期负载。
- **Medium**: Let’s Encrypt 需要 `game.n1komajor.top` 的正确 A/AAAA 解析与公网 80/443 可达。错误 AAAA、CDN 代理策略或安全组限制会导致首次证书签发失败。
- **Low**: 目前迁移仅为 `CREATE TABLE IF NOT EXISTS`，适合本方案的镜像回滚；未来若加入破坏性 schema 迁移，必须增加向后兼容窗口、数据库恢复策略或 ADR。