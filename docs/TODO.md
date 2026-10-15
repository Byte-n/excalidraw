## 后续计划

- [ ] mindmap node 可以夸 mindmap 移动，不再限制必须是同一个 `graphId`
- [ ] mindmap node 可拖动放入另外一个 mindmap tree 中
- [ ] 剪贴板中只有 mindmap 时，若用户选择已有的 mindmap node（或 mindmap root node）再执行粘贴，就展示弹窗，选择“插入到选中的节点下” 还是 “粘贴为独立的 mindmap”
  - [ ] 前提如何支持 “圈选部分 mindmap node” ? 是否与当前的选区 mindmap 扩张有冲突？
- [ ] 统计图表（雷达图等）缺少功能入口：目前只能粘贴表格触发 `PasteChartDialog` 才能创建（普通 Cmd+V，不能用“粘贴为纯文本”，见 `components/app/clipboard.ts`），工具栏里没有任何图表工具
  - [ ] 入口形态：新增一个「图表」工具，还是并入已有的某个面板？
  - [ ] 雷达图还要求数据点 ≥ 3（`charts/charts.helpers.ts` 的 `isSpreadsheetValidForChartType`），入口里得能引导用户补足数据
- [ ] 选中装饰（选择指示框、变换手柄、方向手柄）在缩放下的「相对位置」不恒定：装饰尺寸一律按屏幕常量绘制（`常数 / zoom`，见 `packages/excalidraw/renderer/interactiveScene.ts:1175-1181`、`packages/element/src/transformHandles.ts:144-151`），缩放时它们相对**元素尺寸**的比例会随之漂移，并在两处阈值上发生阶跃。装饰彼此之间的比例（框线 1px / 手柄 9px / 旋转柄 15.75px）本来就不变，问题只在「装饰 ↔ 元素」这一层。
  - [ ] 先定目标参考系：元素比例 `k · min(w, h)`（相对位置逐像素相似，代价是低缩放时退化到看不见、点不中）、屏幕常量（现状，相对光标/手指恒定）、还是夹逼 + 连续化 `clamp(k · S_screen, lo, hi)`（比例精确保持到下限，之后才转为固定屏幕 px）。三者选一之前不宜动代码。
  - [ ] 现有偏差量化，作为是否值得改的依据：选择框 padding 恒 4 屏幕 px，100 单位元素在 zoom 1 / 0.1 时分别占边长 4% / 40%；方向手柄的比值随缩小走 22% → 44% → 55%，跨 `QUICK_CREATE_COMPACT_THRESHOLD`（40 屏幕 px）后瞬间回落约 10 个百分点；变换手柄在 45 屏幕 px 处从 8 个掉到 4 个。最刺眼的是这两处**跳变**而非渐变。
  - [ ] 若选连续化：把 `getQuickCreateHandles` 的布尔 `compact`（`packages/element/src/quickCreate.ts:216-235`）换成连续因子，`getQuickCreateHandleSpec`（`interactiveScene.ts:1463-1507`）按因子插值，端点为已手调好的 22/8 与 18/6，消除 40px 断崖；命中热区（20 / 触屏 32 屏幕 px）保持屏幕下限、不参与插值，否则手柄会先失去可点性。注意该设计已有先例可循：常态 ⌀8 与悬停 ⌀20 共用圆心（`quickCreate.ts:24-28`），即「锚点相似、字形可变」，跨缩放同理。
  - [ ] 框与元素的间隙是否一并纳入；非正方元素按 `min` / `max` / 逐轴取（现有紧凑档取 `min`，而 padding 两轴等值，400×40 的元素两轴比例差 10 倍，需要先定义「相似」看哪个轴）。
  - [ ] 变换手柄的 45px 阈值位于 `packages/element`，渲染与拖拽命中同源共用，改动会连带改交互阈值与既有快照，风险高于方向手柄，需单独评估后再排期。
  - [ ] 顺带对齐：变换状态标签的字体 `context.font = "11px sans-serif"` 未除 zoom（`interactiveScene.ts:1223`），同处的内边距 `12/zoom`、高度 `20/zoom` 都换算了，导致缩放时字形变、标签框不变——上述「屏幕常量」一致性策略里唯一的漏网点。
