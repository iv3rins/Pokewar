# Code Context

## Files Retrieved

1. `references/RULES.md` (lines 18-52, 317-341) - 多人公开匹配、ranked 判定、最终名次、逐对手 Glicko-2、掉线/主动离开、replay 保留的规范来源。
2. `docs/ADR/0008-matchmaking-and-ranked-rating.md` (lines 1-45) - 已接受的旧“两人队列”架构决策；与现行 4/8/12 人规范存在明显漂移。
3. `docs/OPEN_QUESTIONS.md` (lines 1-13) - OQ-003 尚未决定长期匿名 summary 字段，不能擅自扩充长期收集范围。
4. `apps/server/src/rooms/model.ts` (lines 1-34) - `RoomState` 只有 kind/mode/members/game；没有 proposal/match ID、ranked 标志、开局账户资格快照或结算状态。
5. `apps/server/src/rooms/roomService.ts` (lines 39-100, 403-450) - matchmade room 创建及唯一 GAME_OVER 副作用；当前只先写 replay，再写 Redis room，没有 rating settlement。
6. `apps/server/src/matchmaking/model.ts` (lines 1-50) - queue/proposal 已支持 4/8/12、fallback、多人平均分兼容和全账户 ranked 判断，但 ranked 只是派生瞬时值。
7. `apps/server/src/matchmaking/matchmakingService.ts` (lines 16-68, 83-136, 211-329) - 组队/确认/建房数据流；finalize 没把 proposal ID、ranked、rating 快照传入房间，且 Redis/room/membership 多步落盘。
8. `apps/server/src/matchmaking/matchmakingStore.ts` (lines 1-133) - store contract 与内存幂等边界；proposal/entry 全局状态接口。
9. `apps/server/src/matchmaking/redisMatchmakingStore.ts` (lines 1-183) - Redis adapter 的 proposal 创建、接受、删除由多条命令拼成，没有 Lua/MULTI 原子性。
10. `apps/server/src/rating/glicko2.ts` (lines 1-89) - 单玩家对任意多个 opponent results 的 Glicko-2 算法已经可复用。
11. `apps/server/src/rating/glicko2.test.ts` (lines 1-32) - 仅覆盖官方三对手向量和 tier 边界，未覆盖多人结算构造、并列或同时快照。
12. `apps/server/src/rating/ratingRepository.ts` (lines 1-94) - rating 存储/榜单模型；repository 只有 ensure/read/leaderboard，没有结算写接口；wins/losses 是二元统计。
13. `apps/server/src/rating/postgresRatingRepository.ts` (lines 1-86) - PostgreSQL 实现同样只读；榜单使用 `ROW_NUMBER`，相同 rating 不共享名次。
14. `apps/server/src/db/replayRepository.ts` (lines 1-48) - `CompletedReplay` 只有 winner、参与者、任意 summary 和终局 GameState，没有 placements/ranked/rating snapshots。
15. `apps/server/src/db/postgresReplayRepository.ts` (lines 1-90) - replay 按 room_id upsert，14 天后清 payload 和 participant IDs；没有与 rating 同事务的能力。
16. `apps/server/src/db/migrate.ts` (lines 1-49) - 现有表只有账户当前 ratings 和单行 match_replays；缺 durable ranked match/participant/rating ledger/outbox。
17. `packages/domain/src/game/model.ts` (lines 1-31, 256-274) - 终局状态只有 eliminated boolean；事件能表达 player elimination 及原因，却无 resolution ID、placement 或 elimination ordinal。
18. `packages/domain/src/game/death.ts` (lines 135-210) - elimination 在 transition 内发 `player:eliminated`，最后发 `game:over`；这是构造并列 resolution group 的最可靠现有信号。
19. `packages/domain/src/game/system.ts` (lines 46-99) - leave/disconnect elimination 也发 `player:eliminated` 并可能直接 GAME_OVER。
20. `packages/domain/src/game/replay.ts` (lines 1-18) - command replay 需要 initial input + accepted commands；现有数据库却只存终局 GameState，并非这里的 `CommandReplay`。
21. `apps/server/src/storage/roomStore.ts` (lines 1-31) - room save 是独立 Redis/in-memory 操作，不可能自然加入 PostgreSQL rating 事务。
22. `apps/server/src/matchmaking/matchmakingService.test.ts` (lines 1-119) - 已覆盖 4 人创建、replacement、fallback 和 guest-unranked，但未验证 ranked 元数据进入 room/结算。

## Key Code

### 规范结论

`references/RULES.md:32-50` 的现行明确语义是：

- Normal/Quick 各自独立的 4、8、12 人 queue 和账户 rating；
- 任一 guest 参与则整局 unranked；全账户（包括 fallback 后的最终阵容）才 ranked；
- 排名按“淘汰顺序逆序，winner 第一”；同一 resolution 淘汰者并列；
- 对每个玩家，与其余每名对手分别比较：高名次 1、低名次 0、并列 0.5；
- 主动离开、30 秒断线淘汰按真实淘汰位置处理；ranked 开始后必须完整计分；
- 初始 `(r=1500, RD=350, σ=0.06)`，`τ=0.5`，每场立即更新；mode 隔离；前五场 provisional。

注意两处文档漂移：

- **高严重度（规范/ADR 冲突）**：`docs/ADR/0008-matchmaking-and-ranked-rating.md:13-36` 仍写“两人队列/双方”，而 `references/RULES.md:32-50` 已明确 4/8/12 多人。按仓库优先级 RULES 胜出，但 ADR 应由后续实现变更另行 supersede，不能继续作为设计依据。
- **中严重度（RULES 内部残留措辞）**：`references/RULES.md:22` 仍称 public matchmaking creates two-player matches，`:34` 仍称“only when both players”，与同节 4/8/12 以及 `:48` pure-account multiplayer 冲突。现有代码和更具体的新段落均实现 4/8/12；仍建议产品修正文案，避免未来误读。

### 现有链路

```text
MatchmakingService.enqueue
  -> QueueEntry(identity kind + matching rating)
  -> MatchProposal(players, finalSize)
  -> rankedProposal(): all identity.kind === account
  -> finalizeProposal()
  -> RoomService.createMatchmade(roomId, identities, mode, seed, now)
  -> RoomState in Redis
  -> domain commands / deadline commands
  -> GAME_OVER transition
  -> RoomService.saveTransition()
       1. ReplayRepository.save(...) in PostgreSQL
       2. RoomStore.save(updated) in Redis
```

关键缺口是 `rankedProposal()` 的结果只用于 confirmation projection（`matchmaking/model.ts:45-47`、`matchmakingService.ts:39-52`），没有被保存到 `RoomState`。GAME_OVER 时 `RoomService` 也没有注入 `RatingRepository` 或 settlement repository。

### Concrete review findings

1. **Blocker — ranked 完全没有结算写链路。** `apps/server/src/rooms/roomService.ts:430-446` 终局只调用 replay save；`apps/server/src/rating/ratingRepository.ts:21-31` 没有任何 update/settle 方法。因此 `ranked_games/rating/RD/volatility/wins/losses` 永远不会因比赛变化。
2. **Blocker — room 无法可靠判断本局是否 ranked。** `apps/server/src/rooms/model.ts:16-28` 未存 `matchId/proposalId/ranked/entrantAccountIds/preMatchRatings`；`apps/server/src/matchmaking/matchmakingService.ts:292-313` 建房只传 identities/mode/seed。终局不能仅查看“当前账户状态”重判，因为 guest 可在比赛中升级账户，而规范判定必须固定在最终开局阵容。
3. **Blocker — 无可持久化的多人 placement/并列依据。** `GamePlayer` 只有 eliminated (`packages/domain/src/game/model.ts:10-21`)；终局 replay schema 只有 winner (`apps/server/src/db/replayRepository.ts:6-13`)。Room eventHistory 又只保留最近 10 个 batch (`roomService.ts:415-419`)，长局早期淘汰顺序会丢失。仅凭终局状态无法还原第 2..12 名或同 resolution tie。
4. **Blocker — replay、rating、结果不能原子提交。** 当前 GAME_OVER 是 PostgreSQL replay save 后 Redis room save (`roomService.ts:430-448`)。PG 成功/Redis 失败会让同一终局重跑；Redis 成功/后续 rating 失败则房间已 GAME_OVER 而永不再触发 transition。独立 repository/pool 也无法把 replay 与 rating 放入同一 PG transaction。
5. **High — matchmaking finalize 存在跨 Redis 多步不一致窗口。** `matchmakingService.ts:292-313` 依次 create room、逐个 membership set、delete proposal；崩溃可留下 room 已建但 membership/proposal 不完整。`redisMatchmakingStore.ts:49-78,92-121` 的 create/update/accept/delete 也由多条 Redis 命令组成而非 Lua/MULTI。全局 matchmaking lock 降低并发但不能解决进程崩溃的原子性。
6. **High — 现有 rating schema 不支持审计/幂等。** `apps/server/src/db/migrate.ts:22-32` 只有可覆盖的当前值，无 match ledger、before/after snapshot、唯一 settlement key 或 revision/version。重复 worker 无法证明一局只计算一次，也无法重建/审计。
7. **High — wins/losses 对多人并列定义不足。** `ratingRepository.ts:4-10` 只有 wins/losses。规范定义 pairwise 0/0.5/1 与最终 placement，但没有定义多人统计 UI 中“loss”以及非第一名 tie 如何计数。不要自行猜测；结算必须至少可靠写 `ranked_matches` 和 placement，现有 wins/losses 应在产品决定前保持兼容但不可作为 rating 输入。
8. **Medium — 榜单 tie 不是并列名次。** `postgresRatingRepository.ts:68-75` 用 `ROW_NUMBER` 并以 ranked_games/identity_id 打破 tie；若“并列名次”也要求 leaderboard 同分共享名次，应改 `RANK`/`DENSE_RANK`。但 RULES 明确的“并列名次”指比赛 placement，并未规定 leaderboard 同 rating 的 rank 风格，因此榜单变更需产品确认。
9. **Medium — 所谓 full command replay 的持久模型不匹配。** 规范要求 full command replay；`packages/domain/src/game/replay.ts:5-17` 定义 initial+commands，而 `postgresReplayRepository.ts:20-43` 存的是终局 GameState。终局 state 虽含 acceptedCommands，但缺明确 initial input contract；重放/版本迁移与从事件生成 placement 都不稳健。
10. **Medium — OQ-003 限制长期 summary。** 可以增加结算所必需的匿名 placement/rating ledger，但不要把 display name、完整身份或其他行为数据随意纳入“长期匿名 summary”；`docs/OPEN_QUESTIONS.md:8-10` 尚未定字段。

### 可实现的数据模型

建议把“对局事实”和“rating 投影”放在 PostgreSQL；Redis room 只保留热状态和结算触发元数据。

#### Room / domain 侧（开局冻结）

```ts
interface RankedMatchMeta {
  matchId: string;          // 建议等于稳定 roomId，或 proposalId；全局唯一
  proposalId: string;
  ranked: boolean;          // 开局最终参与者全是 account
  finalSize: 4 | 8 | 12;
  entrants: readonly {
    playerId: string;       // 此处 identityId == domain playerId
    accountAtStart: boolean;
  }[];
}

interface EliminationRecord {
  playerId: string;
  resolutionId: string;     // 同一个 accepted/system command transition 共用
  resolutionOrdinal: number;// 单调递增，越小越早淘汰
  reason: 'characters' | 'disconnect' | 'left';
}
```

- `RoomState` 增 `match?: RankedMatchMeta`；private/PVE 明确 `ranked=false`。
- 更稳妥的是在 domain `GameState` 增 append-only `eliminations`，由一次 reducer transition 内的全部 `player:eliminated` 共用 resolution ordinal；这样 command retry/replay 是确定性的。
- 若暂不改 domain，则 server 在每个成功 transition 后把 `result.events.filter(player:eliminated)` 同 batch 持久追加到 room 的**不截断** settlement facts；不能依赖当前 `.slice(-10)` eventHistory。

#### PostgreSQL durable settlement

```sql
ranked_matches(
  match_id text primary key,
  room_id text unique not null,
  proposal_id text unique not null,
  mode text not null,
  final_size int not null,
  ranked boolean not null,
  status text not null check (status in ('pending','settled')),
  finished_at timestamptz,
  winner_identity_id text,
  settlement_version int not null default 1,
  settled_at timestamptz
)

match_participants(
  match_id text references ranked_matches,
  identity_id text,
  account_at_start boolean not null,
  placement int,              -- competition placement: 1,2,2,4
  resolution_ordinal int,
  elimination_reason text,
  pre_rating double precision,
  pre_deviation double precision,
  pre_volatility double precision,
  post_rating double precision,
  post_deviation double precision,
  post_volatility double precision,
  primary key(match_id, identity_id)
)

rating_ledger(
  match_id text,
  identity_id text,
  mode text,
  before_* double precision not null,
  after_* double precision not null,
  placement int not null,
  created_at timestamptz not null,
  primary key(match_id, identity_id)
)
```

- `account_ratings` 加 `revision bigint not null default 0`（或用 row lock 即可，但 revision 有利审计）；`ranked_games` 每局 +1。
- `match_replays` 可继续按 `room_id` 保存 14 天 payload，但建议由同一个 `MatchSettlementRepository` 使用同一个 `pg.Client` transaction 同步 upsert summary/replay、participants、ledger、current ratings。
- 长期匿名 summary 仅保留 OQ-003 已允许/结算必要的 mode、size、placements（使用不可逆/无身份的 seat 数据需产品确认）；participant authorization IDs 仍按 14 天清理。

### 并列名次算法

从 GAME_OVER 前累积的 elimination resolution groups 构造：

1. 每个 domain transition 是一个 resolution；同一 transition 内所有 `player:eliminated` 组成 tie group。
2. 淘汰越早名次越差；winner 单独是最终 group。
3. 将 groups 逆序（winner、最后淘汰组、……），采用 competition ranking：某 player 的 `placement = 1 + 严格排在其前面的玩家数`。
4. 示例：最早淘汰 `[D]`，随后同 resolution `[B,C]`，winner `[A]`，则 `A=1, B=2, C=2, D=4`。
5. leave/disconnect 事件照常进入当时 resolution group，不做额外罚分或强制末位。

如果两个独立 scheduler commands 时间戳相同，它们仍是两个 domain resolutions；不能仅按毫秒时间推断 tie。规范说“same resolution”，所以必须使用 transition/resolution ID，而不是 `finishedAt`。

### Glicko-2 多对手立即更新

现有 `updateGlicko2(player, results, 0.5)` 已接受多个结果，正确 orchestration 是：

```ts
const before = new Map(allParticipants.map(p => [p.id, p.currentRating]));
const after = new Map();
for (const p of participants) {
  const results = participants
    .filter(o => o.id !== p.id)
    .map(o => ({
      opponent: before.get(o.id)!, // 必须全部使用同一局赛前快照
      score: p.place < o.place ? 1 : p.place > o.place ? 0 : 0.5,
    }));
  after.set(p.id, updateGlicko2(before.get(p.id)!, results, 0.5));
}
```

关键约束：

- 一场多人局是一个 rating period，每个玩家一次 update，输入 `N-1` 个 opponent result；不是按 opponent 顺序连续更新 N-1 次。
- 所有人都用事务锁定后读取的赛前 rating；绝不能让先更新的玩家成为后更新玩家的 opponent snapshot，否则结果依顺序变化且非零和直觉会产生额外偏差。
- rating/RD/volatility 使用 double precision 符合 Glicko 数值计算；游戏 HP 的“禁浮点”不适用于 rating。
- Normal/Quick 以 `(identity_id, mode)` 行锁隔离。
- 全账户 fallback 仍 ranked；任何 entrant `accountAtStart=false` 则整个 match 不创建 rating ledger、不增加 ranked_games。

### 事务与幂等方案

推荐 `settleMatch(input)` 单 PostgreSQL 事务：

1. `BEGIN`。
2. `INSERT ranked_matches ... ON CONFLICT (match_id) DO NOTHING`；读取现有行。
3. 若 status=`settled`，校验 immutable digest（mode、participants、placements、finishedAt）一致后直接返回已存结果；不重复更新。
4. 对所有 `(identity_id, mode)` 按 identity_id 排序后 `SELECT ... FOR UPDATE`，避免两局并发结算同一账户时死锁；缺行则初始化。
5. 在锁内冻结全部 before snapshots，计算所有 after。
6. 插入 `match_participants` 和 `rating_ledger`，唯一键 `(match_id, identity_id)`；更新每个 `account_ratings`（ranked_games +1，rating/RD/σ 替换，revision +1）。
7. 同事务 upsert replay/summary；将 match status 改 `settled`。
8. `COMMIT`。随后更新 Redis room 的 `settlement.status='settled'` 并广播结果。

跨 Redis/PG 不能做真正 ACID，采用 PG 为结算真相 + 可重试 inbox/outbox：

- GAME_OVER 后以确定性 `matchId` 调 `settleMatch`；PG 成功但 Redis save 失败，重试命中 settled no-op。
- Redis 已保存 GAME_OVER 但 PG 暂时失败：room 上保留 `settlement.status='pending'`，另写 Redis due set，startup/periodic worker 扫描重试；不要只依赖“phase edge”再次出现。
- 更强方案是在 PG transaction 插 `settlement_outbox`，worker 标记广播完成；HTTP/profile 可直接读 PG，不受 Redis ack 丢失影响。
- replay upsert 不应允许后来不一致 payload 静默覆盖；对 settled match 比较 digest，冲突应告警/拒绝。

匹配建房幂等：proposal 预先拥有稳定 `roomId`，`createMatchmade` 已能在相同成员/mode 时返回 existing (`roomService.ts:55-69`)；补充一个 Lua/MULTI finalize，把 proposal 状态 CAS 为 `finalizing/finalized` 并原子写 membership indexes，worker 可凭 proposal->room 关系恢复。不要在建房后立即无条件 delete proposal 而丢失恢复证据。

### 测试清单

#### Rating 纯逻辑

- 官方 Glicko-2 vector（已有）；新增 4/8/12 人全序 placements，每人恰有 N-1 results。
- `1,2,2,4`：B/C 互相 0.5，对 A 0，对 D 1；A 全 1，D 全 0。
- 输入 participants 排列随机化后所有 after 完全一致（证明统一 before snapshot、无顺序连续更新）。
- Normal/Quick 相同账户只更新目标 mode。
- 初始值、tau=0.5、极高/极低 RD、volatility 收敛边界及无 NaN/Infinity。

#### Domain / placement facts

- 普通淘汰、double Joker、turn timeout、leave、disconnect 都追加 elimination fact 和 reason。
- 一个 transition 多个 elimination events 共用 resolution ID 并形成 tie；不同 command 即使 `now` 相同也不 tie。
- winner=1；4/8/12 人完整覆盖；无重复/遗漏 placement，competition rank 跳号正确。
- replay commands 重建后 elimination facts/placements 与原局一致。

#### Settlement repository（真实 PostgreSQL 集成优先）

- 全账户 4/8/12 局更新每人一次，创建 N 条 ledger；guest 混入时零 rating writes。
- fallback 全账户局仍 ranked。
- 同 `matchId` 重试 2 次/并发 20 次，ranked_games 只 +1、ledger 仅 N 行、after 相同。
- 同一账户两场不同 match 并发：行锁序无 deadlock，revision +2，结果等价于某个完整串行顺序。
- 中途 SQL fault/rollback 后 current ratings、ledger、match status、replay 均无部分提交；重试成功。
- settled digest 不一致（参与者/placement/mode 改变）必须拒绝并告警。
- provisional 第 4->5 场后进入榜单；mode 独立。

#### Redis / orchestration

- PG commit 后 Redis room save 失败：worker 重试不重复 rating。
- Redis GAME_OVER 成功、PG 暂时不可用：pending task 重启后恢复结算。
- 两 server 同时处理相同 GAME_OVER/settlement，唯一键和 row lock 保证 once-only effect。
- proposal finalize 在 create room、写第 k 个 membership、delete proposal 各点注入 crash；恢复后恰好一房、完整 N memberships、无重复 queue/proposal。
- guest 在 queued/confirming/started 后升级账户：started match 的 frozen ranked flag 不变化（具体冻结点建议最终 accept 后建房时）。

#### Replay/privacy

- 仅 participant 在 14 天内访问；非 participant/过期拒绝（已有基础覆盖）。
- 14 天 cleanup 清 full payload 和 authorization IDs，但不删除结算 ledger/current rating。
- replay/settlement 不泄露给非参与者；长期 summary 不超出 OQ-003 已决定字段。
- 终局 replay 能重建 command stream、随机结果、elimination resolutions 和 placements；版本不兼容明确失败而非产生不同 rating。

## Architecture

建议所有权如下：

- `packages/domain`：确定性产生 elimination resolution facts（不计算账户 rating，不接触数据库）。
- `apps/server/src/matchmaking`：在最终 accepted group 建房时冻结 ranked eligibility、proposal/match identity 和 finalSize。
- `apps/server/src/rooms`：观察 GAME_OVER，构造 immutable settlement input，并持久化 pending/settled 状态；不在 room reducer 内算 Glicko。
- `apps/server/src/rating` 或新 `settlement/`：从 placement 构建 pairwise results，单 PG transaction 锁 rating 行、运行现有 `updateGlicko2`、写 ledger/current ratings/replay。
- PostgreSQL：完成结果、rating ledger、当前 rating、14 天 replay 的真相；Redis：active room、deadline、settlement retry wake-up。

## Start Here

先打开 `apps/server/src/rooms/roomService.ts:403-450`。这里是唯一 GAME_OVER 边界，也是当前 replay-before-room-save 的失败窗口；从这里定义 `CompletedMatchSettlement` 接口，再向上补 room 的 frozen ranked metadata、向下补 PostgreSQL transaction repository，能最小化改动扩散。

## Residual Risks

- RULES 自身及 ADR 仍残留“两人”措辞，虽依据优先级可按 4/8/12 实现，但应由产品/文档变更消除歧义。
- “wins/losses”多人统计语义、leaderboard 同 rating 是否共享名次、长期匿名 summary 字段均未被 RULES 完整定义；不要猜测。
- 若不把 elimination facts纳入 domain/replay contract，而只在 server 临时解析最近 event history，长局 placement 必然不可恢复。
- 多实例 Redis finalize 目前依赖粗粒度 lock 与多命令写；进程崩溃恢复仍需要显式状态机/Lua。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "已给出 10 条带 severity 与精确文件行范围的 review findings，并覆盖 room/matchmaking/rating/replay 缺口、数据模型、多人 Glicko-2、并列、事务幂等和测试清单。"
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read/grep/find static inspection only",
      "result": "passed",
      "summary": "只读检索规范、ADR、room、matchmaking、rating、replay、domain elimination 和现有测试。"
    }
  ],
  "validationOutput": [
    "确认 GAME_OVER 当前只写 replay，不更新 rating。",
    "确认 rankedProposal 仅投影到 confirmation，未冻结进 RoomState。",
    "确认现有 schema 无 placement、rating ledger、settlement idempotency key。"
  ],
  "residualRisks": [
    "规范/ADR 仍有 two-player 残留措辞。",
    "wins/losses、leaderboard 同分名次和长期匿名 summary 字段需产品决定。",
    "真实 Redis/PostgreSQL 故障恢复尚未运行验证，本任务为只读梳理。"
  ],
  "noStagedFiles": true,
  "diffSummary": "未修改仓库源文件；仅写入要求的 scout artifact 与 progress artifact。",
  "reviewFindings": [
    "blocker: apps/server/src/rooms/roomService.ts:430-446 - GAME_OVER 只保存 replay，完全没有 ranked rating 更新。",
    "blocker: apps/server/src/rooms/model.ts:16-28 - RoomState 未冻结 ranked eligibility/proposal/account-at-start 元数据。",
    "blocker: packages/domain/src/game/model.ts:10-21 - 终局状态无 elimination ordinal/resolution，无法可靠生成多人 placement/tie。",
    "blocker: apps/server/src/rooms/roomService.ts:430-448 - PostgreSQL replay 与 Redis room 非原子，且无持久 settlement retry 状态。",
    "high: apps/server/src/db/migrate.ts:22-47 - 无 ranked match/participant/rating ledger 与 once-only 幂等约束。"
  ],
  "manualNotes": "输出为只读设计审查；没有执行测试或修改项目代码。"
}
```
