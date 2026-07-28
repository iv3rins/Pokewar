# Code Context

## Files Retrieved

1. `apps/web/src/styles.css` (lines 36-42, 1738-1783, 1890-2038, 2096-2320, 2389-2423, 2471-2529) - 全局视口、战斗网格、手牌托盘、BattleEffects 尺寸与移动端规则。
2. `apps/web/src/components/game/GameScene.tsx` (lines 420-529, 530-672, 699-756) - 战斗场景 DOM 顺序、条件救援条、底部手牌及 GameScene 入口。
3. `apps/web/src/features/effects/BattleEffects.tsx` (lines 73-195, 198-264, 266-309) - 战斗卡、中央出牌组与历史抽屉的结构。
4. `apps/web/src/App.tsx` (lines 240-269, 431-443) - `home-shell game-active` 外壳以及对局中仍始终渲染的 42px footer。
5. `design.md` (lines 104-123, 193-218, 392-404, 460-481) - 手牌固定、桌面战斗构图、手牌上移空间和 1920×1080 验收约束。

## Key Code

### 当前高度链路

- `App.tsx:245` 在对局中使用 `home-shell game-active`，但 `styles.css` 没有任何 `.game-active` 覆盖。
- `.home-shell` 在 `styles.css:57-62` 固定三行：`68px minmax(680px, 1fr) 42px`。
- `App.tsx:431-443` 的 footer 在对局中仍渲染，占第三行 42px。
- `.game-shell` 在 `styles.css:1738-1745` 又设 `min-height: calc(100vh - 110px)`，1920×1080 时为 970px，并有 `clamp(20px, 3vw, 46px)`；1920px 宽时四边 padding 为 46px。
- `.table-scene` 在 `styles.css:1890-1894` 是四行 `auto auto minmax(220px, 1fr) auto`，但只有最小高度，没有明确 `height` 或 `min-height: 0`，所以内容可以把主行和父行一起撑高。

### 当前战斗区固有高度

`GameScene.tsx:568-575` 在 `.battle-stage` 内依次放置图标、标题、说明、`CombatPresentation` 和事件条。与此同时：

```css
/* styles.css:2099-2107 */
.combat-presentation {
  min-height: 330px;
  margin: 18px auto 0;
  grid-template-columns: 220px minmax(260px, 1fr) 220px;
}

/* styles.css:2117-2129 */
.combatant-card,
.shield-result-card {
  width: 220px;
  min-height: 308px;
}

/* styles.css:2394-2405 */
.event-ribbon {
  min-height: 44px;
  margin-top: 20px;
}
```

因此中央行并不只是 330px：加上标题/说明、18px Combat margin 和 64px event ribbon 后，实际固有高度约 510-540px。顶部对手条至少约 124px（112px 卡片 + 12px strip padding），底部托盘至少约 128px（112px hand tray + 14px top padding + border）。在 92px 页面 padding、76px header 和三段 18px gap 下，总高度接近或超过 970px；字体行高、滚动条或救援条即可触发页面纵向滚动。

### 当前底部托盘

`GameScene.tsx:604-657` 的 `.self-tray` 是普通文档流最后一行，而非 fixed/sticky。`styles.css:1959-1966` 设置三列，`styles.css:2003-2010` 给手牌区 `min-height:112px; padding-top:16px; overflow-x:auto`。卡牌在 `styles.css:2012-2032` 为 70×98px（5/7），选中上移 12px；16px 顶部空间满足 `design.md` 的至少 16px 要求，不应缩掉。

### BattleEffects 结构结论

`BattleEffects.tsx:219-264` 的三列结构本身适合 1920px：220px 攻击者 + 至少 260px 中心 + 220px 目标，CSS 最大宽 920px。主要问题是高度预算，不是横向结构。`PlayedGroup`（`BattleEffects.tsx:170-195`）最多展示 5 张牌并以 -25px 重叠；在 1920px 无需改 DOM。不要用 `transform: scale()` 整体缩放 BattleEffects：会留下原布局占位高度，不能解决页面滚动，还会缩小可读文本。

## Review Findings

1. **high — `apps/web/src/styles.css:57-62, 1738-1745` / `apps/web/src/App.tsx:245,431-443`**：对局继续占用 68px header + 42px footer，`.game-shell` 同时使用 970px 最小高度而非填满可压缩网格行；缺少 `.game-active` 专用视口约束，是 1080p 页面滚动的首要来源。
2. **high — `apps/web/src/styles.css:1890-1894, 2099-2129, 2394-2405`**：主战斗网格所有关键内容均为 intrinsic minimum，中央展示约 510-540px，父链路又没有 `min-height:0/overflow` 收缩边界；一旦内容略增就把底部手牌推到首屏之外。
3. **medium — `apps/web/src/components/game/GameScene.tsx:577-603`**：`.rescue-ribbon` 是 `.table-scene` 的条件直属子元素。出现时网格由四个子项变成五个，救援条生成隐式行；任何仅按四行写死的 CSS 都会在 Joker 救援窗口回归滚动。
4. **medium — `apps/web/src/styles.css:2003-2032`**：手牌可见性依赖整个页面流，不是真正固定到对局视口底部。不过现有 16px 顶部预留正好保护选中牌上移，修复时不可为了省高度改成小于 16px，也不建议对 `.hand-tray` 使用 `position:fixed`（会脱离三列布局并遮挡 HUD/按钮）。
5. **low — `apps/web/src/components/game/GameScene.tsx:568-575`**：中央舞台同时显示图标、回合大标题、notice 文案、完整 CombatPresentation、selection ribbon，信息有重复。当前不必改结构即可在 1080p 容纳，但它是高度预算最脆弱处。

## 最小修改建议（不在本次只读任务中实施）

### 方案 A：首选，CSS 为主 + 仅一处条件渲染调整

1. 对局中不渲染 footer（比 `display:none` 更清楚）：在 `App.tsx:431-443` 改为仅 `!activeGame` 时渲染。若追求零 JSX 变化，可暂用 `.game-active > .home-footer { display:none; }`。
2. 给 active game 建立严格视口高度链路：

```css
.home-shell.game-active {
  height: 100dvh;
  min-height: 0;
  grid-template-rows: 68px minmax(0, 1fr);
  overflow: hidden;
}

.game-active > .home-footer {
  display: none;
}

.game-active .game-shell {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 16px 32px;
  overflow: hidden;
}
```

`100dvh` 桌面等于 1080px，并避免移动浏览器 `100vh` 地址栏问题。1920×1080 下内容区为 1012px，高度扣除上下 16px 后为 980px。

3. 对 1080p 桌面给四行明确预算：

```css
@media (min-width: 761px) and (min-height: 800px) {
  .game-active .table-scene {
    grid-template-rows: 76px 124px minmax(0, 1fr) 128px;
    gap: 10px;
  }

  .game-active .battle-stage {
    min-height: 0;
    overflow: hidden;
  }

  .game-active .combat-presentation {
    margin-top: 4px;
  }
}
```

预算为 `76 + 124 + 128 + 3×10 = 358px`，中央战斗区剩约 622px，足够当前约 510-540px 内容；托盘最后一行稳定贴近视口底部（底部仅保留 16px shell padding），无需 `position:fixed`。

4. 救援态不能依赖隐式行。最小、可读的结构调整是在 `GameScene.tsx` 给 main 添加状态类：

```tsx
<main className={`game-shell table-scene${pendingForSelf ? ' has-rescue' : ''}`}>
```

并补充：

```css
.game-active .table-scene.has-rescue {
  grid-template-rows: 76px 124px minmax(0, 1fr) auto 128px;
}
```

在上述 980px 内部高度中，约 60-70px 的 rescue 行会把中央区压到约 542-552px，仍接近但可容纳当前展示。若实际字体/系统缩放下不足，只在救援态将 `.combat-presentation` 降为 `min-height:300px`、战斗卡降为 `min-height:280px`，不要全局缩放。

### 方案 B：完全不改 JSX 的救援态处理

现代目标浏览器可使用：

```css
.game-active .table-scene:has(> .rescue-ribbon) {
  grid-template-rows: 76px 124px minmax(0, 1fr) auto 128px;
}
```

风险是测试环境或旧浏览器对 `:has()` 支持；显式 `has-rescue` class 更稳，也更容易组件测试。

### 不建议的修改

- 不建议单独给 `body { overflow-y:hidden; }`：只会裁掉已经溢出的手牌，掩盖而非修复布局。
- 不建议 `.self-tray { position:fixed }`：固定元素将覆盖 1920px 三列内容，手牌横向滚动、HUD 和操作按钮的可用宽度也更难计算。
- 不建议减小 `.hand-tray` 的 16px 顶部 padding：会违反 `design.md`，选中牌上移 12px 加 2px outline 后容易被滚动容器裁剪。
- 不建议隐藏 CombatPresentation 或将战斗状态仅留给动画；它包含可访问 DOM 状态。

## Architecture

`App.tsx` 的根 CSS grid 决定 header/game/footer 三层高度；`GameScene` 在中间 grid row 内渲染 `game-shell table-scene`；`table-scene` 再按 header、opponents、battle、可选 rescue、self tray 排列。`BattleEffects.CombatPresentation` 是 battle 行的主要固有高度来源。要保证底牌稳定可见，必须从外到内形成 `100dvh -> minmax(0,1fr) -> height:100%; min-height:0 -> 明确 table rows` 的连续高度约束，而不是仅修改手牌本身。

## Residual Risks

- 浏览器缩放大于 100%、Windows 文本放大或中文 fallback 字体会提高标题/说明行高；建议 125% 缩放也做一次手测。
- 12 人局 opponent strip 只增加横向滚动，不应增加高度，但原生横向滚动条高度会因平台变化约 12-17px；124px 行预算需实测 Windows 浏览器。
- Joker rescue 的第五行是最容易漏测的状态；必须单独做截图/布局断言。
- `.battle-stage { overflow:hidden }` 可能裁掉 `combat-burst` 或震动动画边缘。当前 burst 位于中心列附近，1920px 横向空间充足，但仍应检查攻击、红桃、方块、梅花和 reduced-motion；必要时只设 `overflow-y:hidden; overflow-x:visible`，注意 CSS overflow 轴的计算规则可能把另一轴转为 `auto`。
- `100dvh` 需要保留移动端现有 `@media (max-width:760px)` 的纵向流；上述固定四行规则必须限制到桌面，不要覆盖移动端单列 CombatPresentation。

## 验证建议

增加/运行 Playwright 1920×1080 对局断言：

- `document.documentElement.scrollHeight <= window.innerHeight`；
- `.self-tray.getBoundingClientRect().bottom <= 1080` 且高度约 128px；
- 最后一张 `.hand-card` 可见、可横向滚到；
- 选中牌 top 未被 `.hand-tray` 裁剪；
- 普通态与 `pendingForSelf` 救援态各测一次；
- BattleEffects 至少覆盖 idle、普通攻击、五张牌、梅花防御与 reduced-motion。

## Start Here

先打开 `apps/web/src/styles.css:1738-2038`。这里同时定义 `.game-shell`、`.table-scene`、`.battle-stage`、`.self-tray` 和 `.hand-tray`，能以最小范围建立完整的 1080p 高度预算；随后只需处理 `App.tsx:431-443` footer 和 `GameScene.tsx:530` 的 rescue 状态类。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "review-findings 列出 5 项带 severity 的具体发现，并引用 apps/web/src/styles.css、GameScene.tsx、BattleEffects.tsx 与 App.tsx 的精确行范围；residual-risks 列出救援态、滚动条、动画裁切、缩放和移动端风险。"
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "只读 grep/read 与 git status 检查",
      "result": "passed",
      "summary": "已定位布局入口、CSS 尺寸、BattleEffects 结构和工作树状态；未编辑项目文件。"
    }
  ],
  "validationOutput": [
    "静态高度预算：1080px - 68px header = 1012px；建议 game-shell 上下 16px 后内部 980px；固定非战斗行及 3 个 10px gap 共 358px，中央区约 622px。",
    "确认当前 combat-presentation 最小 330px、combatant-card 最小 308px、self hand tray 最小 112px、选中牌上移 12px且顶部预留16px。"
  ],
  "residualRisks": [
    "Joker rescue 会增加第五网格行，必须用 has-rescue 类或 :has() 明确五行模板并单测。",
    "Windows 横向滚动条、125% 文本缩放可能侵蚀高度预算。",
    "battle-stage overflow 约束可能裁切 BattleEffects 动画边缘，需视觉验证。",
    "桌面固定视口规则不得覆盖现有 max-width:760px 单列移动布局。"
  ],
  "noStagedFiles": true,
  "diffSummary": "只读分析；未修改源码或测试。仅写入指定 scout artifact。",
  "reviewFindings": [
    "high: apps/web/src/styles.css:57-62,1738-1745 / apps/web/src/App.tsx:245,431-443 - active game 缺少专用视口约束且仍占 42px footer，game-shell 的 970px min-height 容易撑出 1080p 页面。",
    "high: apps/web/src/styles.css:1890-1894,2099-2129,2394-2405 - table-scene 与 battle 内容存在叠加 intrinsic minimum，缺少 min-height:0 和明确行预算。",
    "medium: apps/web/src/components/game/GameScene.tsx:577-604 - 条件 rescue-ribbon 形成第五个直属网格项，四行修复会在救援态失效。",
    "medium: apps/web/src/styles.css:2003-2032 - self tray 仅处于普通流；需固定为视口网格末行，同时保留手牌16px顶部空间。",
    "low: apps/web/src/components/game/GameScene.tsx:568-575 - battle 舞台重复显示回合/notice/selection 信息，令高度预算偏脆弱。"
  ],
  "manualNotes": "遵守只读要求，未编辑 apps/web 或其他项目源码；建议的具体 CSS/结构改动仅记录于 artifact。"
}
```
