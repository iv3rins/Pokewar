## Review

### Blocker

- **严重（部署阻断）— Nginx 无法读取前端静态文件。**  
  `scripts/deploy-debian12.sh:49` 使用：
  ```bash
  install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR"
  ```
  默认得到 `/opt/pokewar` 为 `pokewar:pokewar`、权限 `0750`。但 Nginx 配置在 `scripts/deploy-debian12.sh:133` 将该目录下的 `apps/web/dist` 作为站点根目录。Debian 12 的 Nginx worker 默认以 `www-data` 运行，不属于 `pokewar` 组，因此无法穿越 `/opt/pokewar`，首页和静态资源会返回 403。部署脚本的健康检查只访问代理到 Node 的 `/healthz`（`scripts/deploy-debian12.sh:185-188`），不会发现静态站点不可访问。

### High

- **高—重复执行脚本不会重启已经运行的应用，服务端更新实际不会生效。**  
  构建完成后，脚本只执行 `systemctl enable --now pokewar`（`scripts/deploy-debian12.sh:119-120`）。对于已经 active 的 unit，`enable --now` 不等同于 `restart`；旧 Node 进程会继续运行旧的 `dist` 代码。  
  这与 `docs/DEPLOYMENT_DEBIAN12.md:84` 所称“构建并重启服务”不符，也破坏了脚本作为更新发布工具的可重复执行语义。应在 unit 写入和 `daemon-reload` 后明确 restart，并在首次部署时兼容 start。

### Note

- **中—敏感配置目录所有权扩大了篡改面。**  
  `scripts/deploy-debian12.sh:49` 同一条 `install` 命令也将 `/etc/pokewar` 设置为 `pokewar:pokewar`、`0750`。虽然环境文件自身随后被设为 `root:pokewar 0640`（`scripts/deploy-debian12.sh:83-84`），目录所有者仍可删除或替换该文件。systemd 的 `ProtectSystem=strict` 能限制服务进程运行时写 `/etc`，但部署期间以 `pokewar` 用户运行的依赖安装、迁移和构建不在该沙箱中。敏感配置目录应保持 root 所有，仅通过文件组读权限允许服务读取。

- **低—部署文档对 GUEST_SECRET 的说明已过期且自相矛盾。**  
  `docs/DEPLOYMENT_DEBIAN12.md:47` 声称应用密钥默认每次运行都会重新生成；实际脚本在 `scripts/deploy-debian12.sh:58-64` 已从现有环境文件读取并默认复用 `GUEST_SECRET`。后续“必须显式复用”的更新步骤因此不再是必需条件。实际脚本行为更安全，但文档会误导运维人员。

- **低—关闭 TLS 时完成提示仍输出 HTTPS。**  
  `scripts/deploy-debian12.sh:191` 无条件打印 `https://$DOMAIN`，即使 `ENABLE_TLS=0`。这不影响服务启动，但会给无 TLS 的部署提供错误访问地址。

- **布局检查目前通过，但覆盖面有限。**  
  `apps/web/src/styles.css:1895-1923` 的桌面固定视口布局在本次新增的 `1366×768` 检查中通过；`tests/e2e/pve-tutorial.spec.ts:35-69` 同时检查了手牌、出牌按钮、战斗区与托盘边界及页面滚动高度。实际运行该文件的三个 desktop-chromium 测试全部通过。  
  不过布局断言只覆盖 `1366×768`，没有自动验证部署文档要求的 `360×800` 和 `1920×1080`，也没有覆盖极矮桌面视口；这些保留为人工/后续自动化风险，而非已确认回归。

- **Deadline 的精确边界实现正确。**  
  `apps/server/src/scheduler/deadlineStore.ts:21-26` 使用 `dueAt < now`；Redis 实现在 `apps/server/src/scheduler/redisDeadlineStore.ts:38-43` 查询至 `now * 10 - 1`。这与领域层“客户端动作在 deadline 毫秒仍合法、系统 timeout 必须在之后执行”的判断一致，例如 `packages/domain/src/game/system.ts:213-214`。`apps/server/src/scheduler/deadlineStore.test.ts:20-22` 明确覆盖 `199/200/201` 三个边界点。

- **Deadline 残余风险：RedisDeadlineStore 没有直接适配器测试。**  
  当前新增边界测试只实例化 `MemoryDeadlineStore`。生产路径的 Redis room/deadline 原子索引另有测试，但 `RedisDeadlineStore.claimDue()` 的分数上界、JSON 反序列化和 `remove()` 本身没有直接 mock-backed 测试。代码审查显示计算正确，但测试无法防止两种实现日后漂移。

### Correct

- `bash -n scripts/deploy-debian12.sh` 通过，未发现 Bash 语法错误。
- 服务端全部测试通过：30 个测试文件、65 个测试。
- 服务端 TypeScript typecheck 通过。
- 目标 TypeScript、CSS 和 Markdown 文件的 Prettier 检查通过；`.env.example` 和 `.prettierignore` 无可推断 parser，未计为代码格式失败。
- `apps/server/src/config/config.ts:31-36` 在 production 强制 Redis、PostgreSQL 和非开发密钥，符合生产基线。
- `apps/server/src/index.ts:13-35` 注册 SIGINT/SIGTERM 并关闭 Socket.IO、HTTP 和基础设施资源，整体关闭顺序合理。
- 仓库当前没有 staged 文件；但整个工作树均显示为 untracked，因此无法使用 Git diff 可靠重建“修改前”基线，本次审查针对指定文件的当前实际内容。