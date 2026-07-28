# Progress

- 状态：完成只读前端对战布局审查。
- 已定位根因：`apps/web/src/styles.css` 中 `.combat-presentation` / `.combatant-card` 的刚性最小高度、空闲态垂直 gap、中央标题与事件条共同撑高 `.battle-stage`；手牌在其后正常流布局。
- 运行时验证：1920×1080 快速 PVE 下页面 scrollHeight=1210，`.hand-tray` bottom=1122 > innerHeight=1080。
- 已给出最小 CSS 修复方向、Playwright 几何回归位置、风险和精确路径/行范围。
- 输出：`.pi-subagents/artifacts/outputs/91f712e6-eafe-4e73-baa2-c469913b4149/parallel-0/0-scout/context.md`
- 未修改产品源码或测试。
