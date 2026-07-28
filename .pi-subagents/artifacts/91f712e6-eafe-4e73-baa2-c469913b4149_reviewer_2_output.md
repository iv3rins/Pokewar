## Review

### Correct

- **规则核心已有较完整的纯 Domain 实现与单元测试。**  
  `packages/domain/src/game/` 已覆盖普通出牌、万化、花色效果、Joker 救援/处决、替补、超时、断线和淘汰；本次运行的 Domain 测试为 **9 files / 61 tests 全部通过**。
- **隐藏信息投影边界基本正确。**  
  `apps/server/src/rooms/projection.ts:31-49` 仅向本人投影 `hand` 和完整 `characters`，对手只得到 `handCount` 与当前角色；`apps/server/src/rooms/projection.test.ts` 和 `packages/protocol/src/rooms/projection.test.ts` 均通过。
- **生产基础设施适配器和恢复机制已有实现。**  
  `apps/server/src/bootstrap.ts:52-68` 根据配置切换 Redis/PostgreSQL 实现；Redis 房间、锁、成员关系、deadline、matchmaking 适配器均有 mock-backed 测试。
- **静态验证总体良好。**  
  `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和当前的 Playwright 用例均通过。

---

### Blocker

1. **Deadline worker 会在恰好到达截止时间时永久丢弃任务，可能导致整局卡死。**  
   - `apps/server/src/scheduler/deadlineStore.ts:24` 在 `task.dueAt <= now` 时领取任务。
   - 但 Domain 的系统超时命令均要求时间必须严格晚于截止时间，例如：
     - `packages/domain/src/game/death.ts:227-229`：Joker timeout 在 `now <= rescueDeadline` 时拒绝；
     - `packages/domain/src/game/death.ts:297-299`：替补 timeout 同样拒绝；
     - `packages/domain/src/game/system.ts:211-213`：回合 timeout 同样拒绝；
     - `packages/domain/src/game/system.ts:358-360`：断线 timeout 同样拒绝。
   - `RoomService.processDeadline()` 将这类拒绝转换为成功但无更新：`apps/server/src/rooms/roomService.ts:397-399`。
   - worker 随后无条件删除任务：`apps/server/src/scheduler/deadlineWorker.ts:39-45`。
   - 因此 poll 恰好发生在 deadline 毫秒时，任务会被删除且不会重新索引，回合、Joker、选将或断线淘汰可能永远不执行。现有 `apps/server/src/scheduler/deadlineWorker.test.ts` 只用 mock service，没有覆盖这个真实边界组合。

2. **账号排位赛从未写回 Glicko-2 结果，天梯产品闭环未实现。**  
   - `references/RULES.md §1.2` 要求完成排位赛后立即进行多人 Glicko-2 更新。
   - `apps/server/src/rating/ratingRepository.ts:21-28` 的 repository 接口只有初始化、查询和 leaderboard，没有任何提交比赛结果或更新 rating 的方法。
   - `apps/server/src/bootstrap.ts:65-67` 虽创建 `PostgresRatingRepository`，但只把它用于 matchmaking/profile 查询。
   - `apps/server/src/rooms/roomService.ts:432-456` 在 `GAME_OVER` 时只保存 replay，不调用 rating 更新，也未记录并列淘汰、最终名次或 ranked 状态。
   - 结果是 UI 可显示“排位匹配”，但胜负不会改变 rating、场次、胜负数或榜单，不能作为已完成的上线功能。

3. **Web 牌桌只实现了 PVE 呈现，私人房与公开匹配进入游戏后被错误当成人机局处理。**  
   - `apps/web/src/App.tsx:242-253` 对任何 `room.game` 都无条件渲染同一个 `GameScene`，没有按 `room.kind` 区分。
   - `apps/web/src/components/game/GameScene.tsx:496` 固定显示 `PVE RESULT`；
     `:536` 固定标题为“PVE 牌桌”；
     `:556` 固定把所有对手标为“机器人对手”。
   - 退出按钮始终调用 `onLeavePve`：`GameScene.tsx:688-691`；而 `apps/web/src/App.tsx:206-210` 明确拒绝非 PVE 房间。
   - 因而真人私人局和公开匹配虽然服务端可创建、开局，但客户端会误标对手、误标结算，且无法通过牌桌退出。这阻断了规范中的主要在线多人流程。

---

### High

1. **命令重试不是幂等成功，而是返回错误；不符合断线重试要求。**  
   - `AGENTS.md` 和 `docs/ARCHITECTURE.md` 要求按身份与 `actionId` 缓存并返回原 action result。
   - `packages/domain/src/game/reducer.ts:95-98` 对已接受 `actionId` 返回 `ACTION_ID_REUSED`。
   - `apps/server/src/rooms/roomService.ts:328-344` 没有先查询持久化 action-result cache；重复命令直接经过 Domain。
   - 因此客户端在服务端已提交、但 acknowledgement 丢失后重试，会收到失败而不是原成功结果。Redis 当前也没有独立的 action-result adapter；`acceptedCommands` 只是不断增长的 canonical history。
   - `apps/server/src/rooms/roomService.test.ts` 未覆盖重复成功结果回放；现有 reducer 测试只是确认返回 `ACTION_ID_REUSED`，实际上固化了与工程规范冲突的行为。

2. **Replay 存储并非 ADR 0005 定义的可重放记录，也没有 PVE/ranked/placement 元数据。**  
   - ADR 0005 要求保存初始配置、私有 seed、权威命令序列和 domain version，从初态重新执行得到终态。
   - `apps/server/src/db/replayRepository.ts:5-13` 的 `CompletedReplay` 仅保存最终 `game` 对象及松散 `summary`。
   - `apps/server/src/rooms/roomService.ts:432-456` 保存的是终态 `result.state`，没有明确初始配置或可验证 replay execution 的持久化结构。
   - `apps/server/src/db/postgresReplayRepository.ts:13-44` 直接把终态序列化进 `replay_payload`。
   - ADR 0010 还要求 PVE replay 被明确标记并排除 ladder，但当前 replay schema/API 没有 `kind`、`ranked`、placements 或同批淘汰信息。
   - `packages/domain/src/game/replay.ts` 存在重放函数，但服务端 replay repository 测试没有证明数据库 payload 能由初态重新执行并验证终态。

3. **缺少玩法命令的服务端速率限制。**  
   - `docs/DEVELOPMENT.md` 明确要求限制 guest-session、room create/join 和 gameplay commands。
   - 代码搜索只发现登录失败 limiter：`apps/server/src/auth/loginRateLimit.ts`、`apps/server/src/http/authRoutes.ts:59-66`。
   - `apps/server/src/realtime/socket.ts:150-426` 的 matchmaking、PVE、room create/join 和 `game:command` handler 均未调用 rate limiter。
   - 上线后任意身份可高频轰炸队列、建房/加房和游戏命令，增加 Redis lock、数据库及 Socket.IO fan-out 压力。

4. **Avatar ADR 尚未实现，而且仍被 OPEN_QUESTIONS 阻塞。**  
   - ADR 0009 要求 32 个审核过的本地 avatar、访客随机不可变 avatar、注册时一次性选择。
   - `docs/OPEN_QUESTIONS.md §OQ-005` 仍说明最终资产 ID/作品未提供，历史账号 enrollment 未决。
   - 服务端身份、协议和持久化代码中没有 avatar 字段；Web 仅使用装饰性首字母标识，如 `apps/web/src/components/home/ProfileRail.tsx:36`。
   - 在产品方补齐资产与 OQ-005 决策前，不能把 ADR 0009 的玩家识别系统宣称为完成。

5. **上线所需关键真人多人 E2E 覆盖缺失。**  
   - `tests/e2e/` 只有 `pve-tutorial.spec.ts` 两条教学状态测试。
   - 没有多 browser context 的私人房创建/加入/准备/开局/隐藏手牌、公开匹配确认、真人出牌、Joker、断线恢复或版本不匹配快照恢复旅程。
   - 这也未满足 `docs/DEVELOPMENT.md` 中“Critical multiplayer flows use two or more Playwright browser contexts”的要求，且无法捕获上述“真人局被渲染成 PVE”问题。

6. **生产 Redis/PostgreSQL 尚未经过真实服务集成验证。**  
   - `docs/ARCHITECTURE.md` 已明确记录当前只有严格 mock-backed adapter 测试，真实服务集成必须在 CI 或 provisioned environment 执行。
   - 本次环境也没有执行 Redis/PostgreSQL 容器或真实服务测试。
   - 上线前必须验证 Lua 原子更新、TTL、锁竞争、跨实例 Socket.IO 广播、迁移、replay 清理和数据库连接关闭行为。

---

### Medium

1. **ADR 0008 与当前规范规则已经文档冲突，需要正式 supersede。**  
   - `docs/ADR/0008-matchmaking-and-ranked-rating.md` 仍定义 Normal/Quick 的“两人队列”及“两人都为账号才 ranked”。
   - `references/RULES.md §1.2` 当前权威规则改为独立的 4/8/12 人队列，纯账号多人局按最终 placement 做全对手比较。
   - 代码采用 4/8/12：`apps/server/src/matchmaking/model.ts`、`matchmakingService.ts`。
   - 根据仓库纪律，不应让已接受 ADR 长期描述过时架构；应新增 superseding ADR，而不是继续保留相互矛盾的 Accepted 决策。

2. **格式化完成门禁当前失败。**  
   - `pnpm format:check` 失败，Prettier 报告 `.pi-subagents/artifacts/**` 下 14 个文件格式不符。
   - 虽然问题不在产品源码，但 `docs/DEVELOPMENT.md` 的完成门禁要求该命令整体通过。需要调整忽略范围或保证工作区生成物不进入检查范围，而不是跳过 gate。

3. **前端可访问性测试覆盖远低于设计规范。**  
   - `apps/web/src/styles.css:62-68` 有明确 focus ring，`:1719` 有 reduced-motion CSS，这是正向实现。
   - 但测试未覆盖 Fusion/确认 Modal 的 focus trap 与关闭后焦点恢复；`GameScene.tsx:315-380` 的两个 dialog 也看不到显式 focus management。
   - 没有 360px、768px、1920px 非重叠的自动化或截图验证，也没有真人桌面/移动 opponent navigation 测试，未充分满足 `design.md §13` 和 ADR 0009 后果项。

4. **请求指定的 `plan.md` 和 `progress.md` 在仓库根目录不存在。**  
   - 读取 `D:\iverins_workspace\game\pokewar-final\plan.md` 与 `progress.md` 均返回 `ENOENT`。
   - 因此无法核验计划承诺、阶段完成声明与实际代码之间的差异；本审查只能基于规范、ADR、OPEN_QUESTIONS、代码和测试现状。

---

## Residual risks

- Git 仓库当前没有首个 commit，`git status` 显示项目文件全部未跟踪；虽然确认没有 staged files，但无法通过历史 diff 判断改动范围或回归来源。
- 未执行真实 Redis/PostgreSQL、跨进程 Socket.IO 或故障注入验证。
- 当前全套单元测试通过并不代表真人多人用户旅程可用；现有 Web 测试高度集中于 PVE。
- Deadline 边界、action acknowledgement 丢失重试、多人同批淘汰与 rating 更新没有端到端验证。