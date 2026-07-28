# Code Context

## Files Retrieved

1. `apps/web/src/components/game/GameScene.tsx` (lines 540-691) - `TableScene` 的实际 DOM 顺序：页头 → 对手带 → 中央舞台 → 手牌托盘；中央舞台同时渲染标题/说明、`CombatPresentation` 和事件条。
2. `apps/web/src/features/effects/BattleEffects.tsx` (lines 219-263) - `CombatPresentation` 空闲态仍渲染一张完整 `CombatantCard`，非空闲态渲染攻击者、出牌和目标三列。
3. `apps/web/src/styles.css` (lines 1-58) - 全局 `box-sizing`、`body` 与 `.home-shell`；`.home-shell` 固定为 `68px minmax(680px, 1fr) 42px` 三行。
4. `apps/web/src/styles.css` (lines 1738-1754) - `.game-shell` 具有 `min-height: calc(100vh - 110px)` 和桌面端最高 46px 的四周 padding。
5. `apps/web/src/styles.css` (lines 1890-1958) - `.table-scene` 行模板、18px 行间距、对手 HUD 与中央舞台标题尺寸。
6. `apps/web/src/styles.css` (lines 1959-2039) - `.self-tray`、`.hand-tray` 和手牌尺寸；手牌是正常文档流最后一行，并未固定/吸底。
7. `apps/web/src/styles.css` (lines 2096-2129) - 根因最集中的 CSS：`.combat-presentation` 固定 `min-height: 330px`、最高 52px gap；空闲态只改列模板，沿用该 gap；战斗角色卡 `min-height: 308px`。
8. `apps/web/src/styles.css` (lines 2389-2422) - 中央舞台底部事件条额外占 44px，并有 20px 上边距。
9. `apps/web/src/styles.css` (lines 2471-2528) - 仅有宽度型移动端规则，没有面向较矮桌面视口的对战压缩规则；移动端把战斗展示改为单列。
10. `apps/web/src/App.tsx` (lines 242-281, 430-445) - active game 仍包在 `.home-shell` 内，上方保留 `BrandHeader`、下方保留 42px footer。
11. `apps/web/src/App.test.tsx` (lines 322-381) - 已有对战渲染与交互单测，但只验证元素存在/命令提交，不验证几何布局或首屏可见性。
12. `tests/e2e/pve-tutorial.spec.ts` (lines 1-41) - 现有真实浏览器 PVE 主流程入口，适合追加 viewport/scroll 几何回归断言。
13. `playwright.config.ts` (lines 1-26) - E2E 当前仅覆盖 1920×1080 desktop Chromium，恰好可复现该缺陷。
14. `design.md` (lines 85-92, 213-231, 250-256, 412-445) - 规范要求手牌固定在拇指区、桌面对战顺序为对手带/中央舞台/底部手牌，并要求 360–1920px 无重叠。

## Key Code

### 1. 手牌位于中央舞台之后，完全依赖正常文档流

`apps/web/src/components/game/GameScene.tsx:587-691`：

```tsx
<section className="battle-stage" aria-label="中央战斗舞台">
  <Users ... />
  <h2>...</h2>
  <p>{noticeText(game)}</p>
  <CombatPresentation game={game} />
  <div className="event-ribbon">{selection.message}</div>
</section>
...
<section className="self-tray" aria-label="你的角色与手牌">
  ...
  <div className="hand-tray" aria-label={`你的手牌，共 ...`}>
```

因此中央舞台的任何最小高度/内容膨胀都会直接把手牌向视口下方推。

### 2. 中央区具有叠加的刚性高度

`apps/web/src/styles.css:1890-1894, 1946-1958, 2099-2129, 2394-2406`：

```css
.table-scene {
  display: grid;
  grid-template-rows: auto auto minmax(220px, 1fr) auto;
  gap: 18px;
}
.combat-presentation {
  min-height: 330px;
  margin: 18px auto 0;
  gap: clamp(22px, 4vw, 52px);
}
.combat-presentation.is-idle {
  grid-template-columns: 220px;
}
.combatant-card { min-height: 308px; }
.event-ribbon { min-height: 44px; margin-top: 20px; }
```

`minmax(220px, 1fr)` 并不能将中央行限制在 220px；Grid 项默认 `min-height: auto`，会服从内容的 intrinsic minimum。中央区还包含图标、55px 左右标题、说明、18px margin、完整角色卡展示和 44px 事件条。

空闲态尤其异常：它将展示改为单列，却继续沿用为三列横向布局设计的最高 52px `gap`。运行时空闲 `CombatPresentation` 实测高约 394px，而不是声明的 330px。

### 3. 外层也没有提供真正的视口高度预算

`apps/web/src/styles.css:53-58, 1738-1745`：

```css
.home-shell {
  min-height: 100vh;
  grid-template-rows: 68px minmax(680px, 1fr) 42px;
}
.game-shell {
  min-height: calc(100vh - 110px);
  padding: clamp(20px, 3vw, 46px);
}
```

Active game 同时保留 68px header 和 42px footer。`.game-shell` 的 `min-height` 只给出下限；当内部刚性内容更高时会自然增长，页面随之产生纵向滚动。没有 `.game-active` 专用的 `height/min-height: 0` 约束，也没有较矮桌面视口的压缩规则。

### 运行时复现证据（1920×1080）

通过现有 dev server 启动快速 PVE 后，用 Playwright API读取布局：

- `window.innerHeight = 1080`
- `document.documentElement.scrollHeight = 1210`
- `.battle-stage`: top 369, bottom 973, height **604px**
- `.combat-presentation.is-idle`: top 516, bottom 909, height **394px**
- `.self-tray`: top 991, bottom 1122
- `.hand-tray`: top 1006, bottom 1122

即手牌下沿超过视口 42px，必须滚动才能完整看到；页面总计多出 130px。

## Review Findings

### high — 中央战斗舞台的 intrinsic minimum 将手牌推出 1080px 首屏

位置：`apps/web/src/styles.css:1890-1894, 2099-2129, 2394-2406`；结构来源：`apps/web/src/components/game/GameScene.tsx:587-691`。

这是直接根因。中央行看似是 `minmax(220px, 1fr)`，但内部 `330px` 战斗展示、`308px` 角色卡、空闲态误用的最高 52px 垂直 gap、标题/说明和事件条共同把该行撑到实测 604px。手牌作为下一行被推到 991px 后，完整高度延伸至 1122px。

### medium — Active game 外壳没有严格消费可用视口高度

位置：`apps/web/src/styles.css:53-58, 1738-1745`；`apps/web/src/App.tsx:242-281, 430-445`。

外壳用 `min-height` 而不是受约束的 active-game 轨道，且保留 header/footer；内容溢出时页面自然增长。该问题放大中央区缺陷，也意味着仅缩小一个常量可能在其他字体、通知内容或真实三卡战斗态再次回归。

### medium — 缺少布局级自动化回归断言

位置：`apps/web/src/App.test.tsx:322-381`、`tests/e2e/pve-tutorial.spec.ts:1-41`。

JSDOM 单测只证明手牌存在，无法证明其位于视口内。现有 Playwright 已使用 1920×1080，却没有断言手牌/操作托盘的 `getBoundingClientRect().bottom <= innerHeight` 或页面无需为看到手牌而滚动。

## 最小修复建议（不改规则/组件数据流）

建议优先做一个小范围 CSS 修复，不重构 React：

1. **先修空闲态误用的垂直 gap**：在 `apps/web/src/styles.css` 给 `.combat-presentation.is-idle` 明确较小的行 gap（例如 8px），并取消不必要的空闲态固定最小高度或将其压到内容所需范围。这是最小、最精准的改动；当前实测约可回收 50–64px，使 1080px 下手牌本体回到首屏内。
2. **为 active game 建立明确高度预算**：给 `.home-shell.game-active` 使用 `height/min-height: 100dvh` 和中间轨道 `minmax(0, 1fr)`，给 `.game-active .game-shell`/`.table-scene` 设置 `min-height: 0`。不要靠扩大页面高度来容纳中央区。
3. **增加桌面低高度压缩规则**（推荐与第 2 点一起作为稳健最小修复）：在例如 `@media (min-width: 761px) and (max-height: 1080px)` 下只压缩 game scene 的 padding、18px row gaps、中央标题 margin/字号及 combat 展示垂直留白；不要改变手牌 `70px` 尺寸和 16px 顶部预留。
4. 如果产品要求“手牌固定在拇指区”是严格的始终可见语义，再考虑把 `.self-tray` 做成受 game scene 管理的底部 HUD。**不建议仅加 `position: fixed`**：它会覆盖中央内容、救援条和 footer，且需同步预留底部空间与处理 360px 布局，已经不是最小修复。

最小补丁应聚焦 `apps/web/src/styles.css`。`GameScene.tsx` 无需改变；若希望进一步减高，可删除中央舞台中与 `CombatPresentation` 重复的空闲提示/当前玩家展示，但这属于展示结构调整，范围更大。

## 相关测试位置

### 首选：Playwright 几何回归

在 `tests/e2e/pve-tutorial.spec.ts` 新增独立测试，或新建 `tests/e2e/game-layout.spec.ts`：

- 使用既有快速 PVE 入口；关闭/跳过教程以免 overlay 干扰。
- 在配置已有的 1920×1080 下断言 `.hand-tray` 与“确认出牌”按钮的 bounding box `top >= 0` 且 `bottom <= window.innerHeight`。
- 同时断言 `.battle-stage` 与 `.self-tray` 不重叠：`battle.bottom <= tray.top`。
- 建议补一组 1366×768（典型矮桌面）项目或 `page.setViewportSize`；它更容易暴露刚性中央高度。
- 若验收语义是“整页无需滚动”，再断言 `document.documentElement.scrollHeight <= window.innerHeight`；若 footer 允许滚动，则只断言手牌和主操作首屏可见，避免过度约束。

### 组件测试

`apps/web/src/App.test.tsx:322-381` 可继续保留结构/交互断言，但 JSDOM 没有真实布局，不能作为本缺陷的主要回归证据。可在此验证 CSS 修复没有破坏 `aria-label="你的手牌，共 N 张"`、选牌和确认出牌行为。

## Architecture

`App` 在 active room 时仍渲染全局 `BrandHeader`、`GameScene` 和 footer。`GameScene` 根据 phase 进入 `TableScene`；`TableScene` 从服务端 projection 生成对手带、中央 `CombatPresentation` 和本地手牌/操作 HUD。布局完全由单一全局 `apps/web/src/styles.css` 控制。此次问题不涉及 protocol、服务端 projection 或游戏规则，只是 web presentation 层的 CSS intrinsic sizing 与 viewport budget 冲突。

## Residual Risks

- 只修 `.is-idle` gap 能解决当前快速 PVE 空闲复现，但真实战斗态会显示两张 308px 角色卡和中间出牌区，仍需在 1366×768、通知长文本、7 张手牌下验证。
- 760px 以下规则把战斗三列改成单列，页面必然更高；若产品要求移动端手牌始终固定可见，需要单独设计底部 HUD，而不能沿用桌面“压缩中央区”方案。
- `100vh` 在移动浏览器动态地址栏下不稳定；新增严格视口约束时应优先 `100dvh` 并保留兼容 fallback。
- 教程为旁路 overlay；几何测试必须关闭它，否则“元素存在/可见”可能被 overlay 或自动滚动行为干扰。

## Start Here

先打开 `apps/web/src/styles.css` 的 **1890-2129 行**。这里同时定义 `.table-scene` 的 grid 行、`.battle-stage`、`.combat-presentation(.is-idle)` 和 308px 战斗角色卡，是根因与最小修复的集中位置；随后对照 `GameScene.tsx:587-691` 确认 DOM 顺序。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "已给出 3 条带 severity 的具体 review findings、精确文件/行范围、1920×1080 运行时几何数据、最小 CSS 修复建议及 residual risks。"
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node -e fetch('http://127.0.0.1:5173')",
      "result": "passed",
      "summary": "确认现有 web dev server 返回 HTTP 200。"
    },
    {
      "command": "pnpm exec playwright --version",
      "result": "passed",
      "summary": "确认 Playwright 1.62.0 可用于只读浏览器检查。"
    },
    {
      "command": "pnpm exec node --input-type=module -e <Playwright layout probe>",
      "result": "passed",
      "summary": "1920×1080 快速 PVE 实测 scrollHeight 1210、battle-stage 604px、hand-tray bottom 1122px。"
    },
    {
      "command": "node --input-type=module -e <direct playwright import probe>",
      "result": "failed",
      "summary": "直接导入 playwright 包失败；随后改用 pnpm exec 与 @playwright/test 成功完成同一只读检查。"
    },
    {
      "command": "git status --short && git diff --stat",
      "result": "passed",
      "summary": "仓库基线存在大量 untracked 文件；无 staged 文件，审查未修改产品源码。"
    }
  ],
  "validationOutput": [
    "1920×1080: innerHeight=1080, document scrollHeight=1210。",
    ".battle-stage: top=369, bottom=973, height=604。",
    ".combat-presentation.is-idle: top≈516, bottom≈909, height≈394。",
    ".hand-tray: top=1006, bottom=1122，因此未完整处于首屏。"
  ],
  "residualRisks": [
    "仅压缩空闲态不足以证明真实三列战斗态和 1366×768 均合格。",
    "移动端单列战斗展示若要求手牌始终可见，需要独立底部 HUD 方案。",
    "严格 active-game 高度约束需避免内容裁剪，并验证救援条、长文本及动态视口。"
  ],
  "noStagedFiles": true,
  "diffSummary": "只读审查；未修改仓库产品文件或测试。",
  "reviewFindings": [
    "high: apps/web/src/styles.css:1890-2129 - 中央区的 330px presentation、308px combatant card、空闲态最高 52px 垂直 gap 及附加标题/事件条将 battle-stage 撑至实测 604px，把手牌推出 1080px 首屏。",
    "medium: apps/web/src/styles.css:53-58,1738-1745 - active game 仅使用 min-height，外层仍保留 68px header/42px footer，缺乏严格视口高度预算。",
    "medium: tests/e2e/pve-tutorial.spec.ts:1-41 - 现有 1920×1080 E2E 没有手牌首屏可见性或布局几何断言。"
  ],
  "manualNotes": "审查只涉及前端 presentation；无需改 protocol、server 或 domain。"
}
```
