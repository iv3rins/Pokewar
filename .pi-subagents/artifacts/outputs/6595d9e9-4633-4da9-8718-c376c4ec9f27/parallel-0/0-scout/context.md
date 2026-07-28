# Code Context

## Files Retrieved
1. `apps/web/src/components/game/GameScene.tsx` (lines 111-165, 393-510, 529-695, 699-755) - 当前牌局 UI、阶段分支、退出按钮和 PVE 文案/回调。
2. `apps/web/src/App.tsx` (lines 209-238, 242-275) - active game 路由及现有 `leavePve` 专用退出流程；所有 `GameScene` 回调在此绑定。
3. `apps/web/src/services/roomSocket.ts` (lines 43-60, 91-129) - 客户端 socket 接口与现有事件封装；`gameCommand` 会自动加入 actionId，`leavePve` 发 `pve:leave`。
4. `apps/server/src/realtime/socket.ts` (lines 402-448) - `game:return-lobby` 与 `game:command` 服务端入口；后者已支持 `game:leave-match`，并在 PVE 下触发 dissolve。
5. `packages/protocol/src/commands/envelope.ts` (lines 1-60) - `game:leave-match` 是合法 room command，要求 roomId/actionId/expectedVersion。
6. `packages/protocol/src/rooms/projection.ts` (lines 112-125) - `RoomProjection.kind` 精确为 `private | matchmade | pve`。
7. `apps/web/src/App.test.tsx` (lines 1-125, 350-405) - web mock、PVE fixture、现有 PVE table/leave 测试。
8. `apps/server/src/realtime/socket.test.ts` (lines 1-210) - Socket.IO 房间启动、PVE 专用 leave、真人房启动/快照和断线测试入口。
9. `packages/domain/src/game/system.ts` (lines 367-374, 420-430) 与 `packages/domain/src/game/system.test.ts` (lines 324-349) - active leave 的领域语义和已有单测。
10. `apps/server/src/rooms/roomService.ts` (lines 430-515) - 将协议 command 转成 domain command，已包含 `game:leave-match`。

## Key Code

### 当前前端流
`App` 以 `const activeGame = identity && room?.game ? room : null` 将任何有 game 的 room（不区分 kind）交给 `GameScene`（`apps/web/src/App.tsx:242-253`）。`GameScene` 仅按 `room.game.phase` 分 Starter/Table，并把同一组 PVE 专用回调传下去（`GameScene.tsx:729-746`）。因此 private/matchmade 当前会直接显示 PVE 牌桌。

关键 PVE-only 证据：
- Starter 头部固定 `NORMAL MODE · ROOM`、退出按钮直接 `onLeavePve`，等待文案为“机器人”（`GameScene.tsx:130-151`）。
- GAME_OVER 固定 `PVE RESULT` 和“不计入天梯”（`GameScene.tsx:492-505`）。
- Table 固定标题 `PVE 牌桌`，对手区域 aria-label `机器人对手`，行动提示“等待机器人行动”（`GameScene.tsx:529-570`）。
- 确认退出固定调用 `onLeavePve()`，说明是“主动退出…所有角色…普通失败结算”（`GameScene.tsx:683-692`）。

### 退出真人 active game 的正确现有事件
不要调用 `room:leave`：服务端它只进入 `rooms.leaveLobby`，而 active room 会被拒绝（`apps/server/src/realtime/socket.ts:346-364` 附近的 room:leave handler；`roomService.updateLobby` 对 `room.game` 返回 ROOM_ALREADY_STARTED）。也不要调用 `game:return-lobby`：它要求 GAME_OVER（`socket.ts:402-417`）。

应发送现有 `game:command` event，command 为：
```ts
socket.gameCommand({
  kind: 'game:leave-match',
  roomId: currentRoom.id,
  expectedVersion: currentRoom.game.version,
})
```
`RoomSocketClient.gameCommand` 在 `apps/web/src/services/roomSocket.ts:121-123` 自动补 `actionId: crypto.randomUUID()`；协议在 `packages/protocol/src/commands/envelope.ts:55-58` 校验。服务端 `rooms.command` 后广播更新，领域 reducer `leaveMatch` 立即淘汰玩家且不走断线恢复窗口（`packages/domain/src/game/system.ts:372, 420-430`）；真人房不会 dissolve，因为 socket handler 的 `shouldDissolve` 仅 `room.kind === 'pve'`（`apps/server/src/realtime/socket.ts:429-441`）。这符合 active leave 作为普通失败/实际淘汰的规则。PVE 仍应保留专用 `pve:leave`：它直接 dissolve 整个人机房并清 membership，当前 `App.leavePve` 与测试已覆盖。

## Architecture

最小修复应把 `room.kind` 作为 presentation 与退出策略的唯一分流，而不是复制整套牌局：

1. 在 `GameScene` 计算 `isPve = room.kind === 'pve'`（或传显式 `roomKind`），所有标题、结果标签、对手 aria-label、等待机器人文案、教程（PVE tutorial）按 kind 选择真人/机器人文本。
2. 将当前 `onLeavePve` 改为语义中性的 `onLeave`，或新增 `onLeaveMatch`；GameScene 内确认退出调用它。App 按 `room.kind` 分派：PVE -> 现有 `leavePve(room.id)`；private/matchmade -> `gameCommand({kind:'game:leave-match', roomId, expectedVersion})`。
3. 真人 active leave 成功后，应立即清 `room`/回大厅（最好共用一个 `leaveActiveGame` 状态处理），但不要把 `ignoredRoomIds` 的 PVE late-snapshot 逻辑误用于真人；服务端会广播更新，当前 socket 仍会收到 snapshot，清理应在前端 state handler/离开确认中避免被旧快照复活（可按 room id 短暂忽略，或让 onRoom 判断离开中的 room）。
4. GAME_OVER 的 `onReturnLobby` 可继续调用 `game:return-lobby`；如果真人结果页也使用它，文案/结果标识需按 kind 改成真人版，且不要显示 PVE 教学。注意房间 Projection 的 `kind` 已可用，不需要协议变更。

## Start Here
先打开 `apps/web/src/components/game/GameScene.tsx:393-755`：这里是 bug 的集中点——所有活跃房都走 PVE 牌桌、PVE 退出回调和 PVE 结果文案。随后改 `apps/web/src/App.tsx:209-238,252-275`，以 room.kind 选择专用 PVE leave 或通用 `game:command` leave-match。

## 建议测试修改

### 必改 web
- `apps/web/src/App.test.tsx`：保留现有 PVE leave 测试（应继续断言 `leavePve('A2BCD')`），并给 mock 增加/断言真人 active leave 的 `gameCommand`。
- 增加 private quick PLAYING fixture（可从 `pveRoom` 复制，改 `kind:'private'`、成员不使用 bot 文案；协议 fixture 的 players 可沿用但 UI 不应以 bot 为依据），断言标题不是“PVE 牌桌”、真人对手 aria-label/等待文案、正常退出确认后调用 `gameCommand` `{kind:'game:leave-match', roomId:'A2BCD', expectedVersion:3}`，并回到“私人房间”。
- 增加 `kind:'matchmade'` fixture/测试，断言公开匹配也走真人牌桌分支（不能误当 private lobby/PVE），真人退出使用同一 leave-match command。
- 若将 GAME_OVER 文案/教程按 kind 分流，新增 private/matchmade GAME_OVER 断言“真人结果/不显示 PVE tutorial”，同时保留 PVE 结果回归测试。现有 PVE tests 中 `PVE 牌桌`、`PVE RESULT`、PVE tutorial 是回归基线。

### 必改 server/integration
- `apps/server/src/realtime/socket.test.ts`：在已有真实 private room `creates, joins, ... starts` 流程后，发送 `game:command` payload（含 `crypto.randomUUID()`, `expectedVersion`，kind leave-match），断言 ack ok、canonical room 中该 player `eliminated:true` 且 private room 仍存在；最好同时断言另一玩家收到 snapshot。这验证授权/协议/领域接线和真人不 dissolve。
- 若 server 现有测试已有 command helper，补 invalid room kind/重复 actionId 断言应放在该 socket 集成或 room service command 测试；领域 `packages/domain/src/game/system.test.ts:324-349` 已覆盖立即淘汰，不需重写。

### 可选/不必改
- `packages/protocol` schema 无变更，不需协议测试，除非修改 wire payload。
- `apps/web/src/services/roomSocket.ts` 不必新增 socket event；复用 `gameCommand`。
- PVE 专用 `pve:leave` 及 server tests 不应替换为 leave-match，因为 PVE 产品语义是 dissolve 房间，不是普通多人淘汰。

## Findings / Severity

- **High** `apps/web/src/components/game/GameScene.tsx:492-570`：private/matchmade active games are rendered with PVE-only labels and semantics because no `room.kind` branching exists.
- **High** `apps/web/src/components/game/GameScene.tsx:683-692` + `apps/web/src/App.tsx:209-238`：真人退出被接到 PVE-only callback/`pve:leave`; this either fails `INVALID_PHASE` or risks wrong lifecycle if simply reused.
- **Medium** `apps/web/src/components/game/GameScene.tsx:718-751`：PVE tutorial is opened/read from storage for every room kind; should be PVE-only or generalized explicitly.
- **Medium** `apps/web/src/components/game/GameScene.tsx:556-570`：opponent and turn text hardcode robot assumptions; private/matchmade hidden-information/public projection must use player-neutral text.

## Residual Risks

- Clearing local `room` immediately after `game:leave-match` can be overwritten by the server's broadcast snapshot unless an in-flight/ignored-room guard is added; current ignored-room guard is explicitly used for PVE (`App.tsx:116-126,224-226`) and should be generalized carefully.
- `game:return-lobby` only accepts GAME_OVER and does not delete matchmade room; do not use it as active leave. Product rules say active leave is an ordinary loss; post-game room retention/cleanup remains a separate lifecycle concern.
- Existing `App.test.tsx` fixture `pveRoom('SELECTING_STARTER')` is normal and `pveRoom('PLAYING')` is quick, so new kind tests must ensure labels are testing kind rather than accidentally mode.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete file/line findings and severity are documented above, including GameScene kind branching gap, correct game:command leave-match event, and exact web/server tests to update."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "targeted grep/read/nl inspection of apps/web, apps/server, packages/protocol, packages/domain",
      "result": "passed",
      "summary": "Retrieved all relevant frontend, socket, protocol, domain, and test entry points."
    }
  ],
  "validationOutput": [
    "Read-only review; no files modified and no test suite run."
  ],
  "residualRisks": [
    "Late room snapshots may revive a locally cleared active room unless a generic ignored/in-flight room guard is implemented.",
    "Post-GAME_OVER matchmade room cleanup is not part of the active leave event and needs separate product/lifecycle treatment."
  ],
  "noStagedFiles": true,
  "diffSummary": "No diff; scouting only.",
  "reviewFindings": [
    "high: GameScene hardcodes PVE UI and callbacks for all room kinds.",
    "high: active真人退出 must not use pve:leave or room:leave; use game:command with game:leave-match.",
    "medium: PVE tutorial and robot-specific accessibility/text must be kind-gated."
  ],
  "manualNotes": "最小修复不需要新增 socket/server event 或 protocol schema；复用现有 gameCommand/game:leave-match，并保留 PVE pve:leave dissolve 语义。"
}
```