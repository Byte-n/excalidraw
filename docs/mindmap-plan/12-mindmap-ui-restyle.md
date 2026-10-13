# 第 12 期：思维导图 UI 重设计（层级形态 + 分支色）

- 期次：P12。
- 状态：待实施。
- 设计依据：`docs/design-ui/excalidraw-canvas-mindmap.html`（`#mindmap` 节）。

## Context

设计稿给出思维导图新视觉语言：「用层级区分形态，用分支区分颜色」。当前实现所有层级同款矩形（根 `#d0bfff`/子 `#e5dbff` 淡紫）、连线统一 `#1b1b1f` 2px 直角折线。本任务按设计稿更新渲染与交互。

## 零历史包袱原则（严格执行）

1. **不判断**：没有任何"这是不是旧数据"的检测分支（无值匹配、无签名比对、无形状回退兜底；不认识的数据断言直接报错，按现有严格断言原样即可）
2. **不处理**：没有加载时的迁移逻辑、没有 restore/clipboard 的特殊处理代码
3. **不兼容**：不为旧数据结构留任何旁路
4. **不说明**：代码注释里连"旧文件/历史/兼容"这类字样都不出现
5. **一条路**：所有代码（加载、编辑、协作、agent-tool）只走同一条新管线，数据进来是什么样就按新规则怎么处理

## 差异分析（设计稿 ↔ 当前实现）

### A. 设计稿引入的新交互（当前没有）
1. **选中节点的「添加同级 +」按钮**（当前悬浮按钮只有添加子节点；同级只能靠 Enter/右键/大纲）
2. **折叠计数徽标**：常驻 18px 圆形数字徽标（=隐藏子孙数），点击展开；当前只有 hover 才出现的 ▸ 按钮且无计数
3. **悬停展开节点的「−」折叠按钮**（14px 圆，子侧边缘）；取代现有 HTML ▸/▾ 浮动按钮
4. **画布内拖拽插入线**：sibling 前/后插入区显示 2px 主色插入线（当前画布只有完整 ghost 预览）
5. **编辑态快捷键提示**：节点下方「Enter 完成 · Tab 新建子节点」
6. **去掉单节点旋转手柄**（当前单个 mindmap-node 有旋转手柄，对布局驱动的节点无意义）

### B. 设计稿重定义的视觉（当前有但形态不同）
1. 层级形态：根实心墨色/反色 16px 600 文字 · L1 分支色胶囊 · L2+ 无边框文字+分支色下划线
2. 分支五色循环（teal/amber/violet/rose/denim，palette 与 colors.ts:242-261 现有 picks 一致）+ 子孙继承 + **手动颜色优先**
3. 默认连线路由：正交 → **曲线**；根→一级 2px、其余 1.5px
4. 正交连线拐角 10px 圆角（与普通折线箭头一致）
5. 悬浮 + 按钮视觉：16px 白底主色（#1677ff）描边圆，hover 实心
6. 编辑态：虚线框 → 1.5px 实心主色环（rx 跟随节点）

### C. 设计稿未覆盖的旧场景（保持现状）
> 现状设计已集中存档：设计稿 `excalidraw-canvas-mindmap-legacy.html`（`excalidraw-canvas-elements-style.html` 的 `#mindmap-legacy` 节），实施与验收时对照。

大纲侧栏与搜索集成、移动端 MobileMindmapActions、右键菜单/命令面板动作、HelpDialog 快捷键文档（Tab/Enter/Space/Shift+Tab/方向键语义不变）、布局方向四选一与图级边样式面板、节点形状切换（矩形/椭圆/菱形，设计明确保留）、提升/删除保留子节点/convertToShape/markdown 与 OPML 导入导出/协作 reconcile/表格内冻结/Alt 拖拽复制、间距常量（80/24 设计明确沿用）。

### D. 产品判断点（本计划的取舍，可推翻）
1. **样式即数据 +「与默认一致即未修改」比较门**（用户决策，推翻原「不判断」方案；无持久化标记字段）。派生只发生在结构命令（增/删/重挂/提升）落定时，写入具体属性；文字编辑、折叠、样式动作、加载、粘贴、纯重排均不重派生。结构命令对触及子树重派生前**逐节点比较**：节点当前样式属性与其**移动前位置**的派生默认值完全一致 → 视为未修改，按新位置重派生；任一受管属性不同 → 视为用户已修改，该节点全部样式原样保留。**比较集 = 派生写入集**：节点 shape/backgroundColor/strokeColor/strokeWidth/roundness、绑定文本的 fontSize/fontWeight/颜色、父边 strokeColor/strokeWidth；派生不写的属性（opacity 等）不参与判定、也永不被覆盖。子树内各节点独立判定。「未修改节点恒携带当前位置的派生值」由机制归纳保持，无需标记字段。已知边界：用户手改值恰与派生值相同则无法区分，按未修改处理（接受）。此门适用于 mindmap 全部会写派生样式的操作（新建无基线，直接派生）。分支色在创建/落位时按位次循环分配，此后即为节点自身数据
2. **连线路由**：新建图默认曲线（`DEFAULT_MINDMAP_EDGE_ROUTING` 改 `"curved"`）；边的 routing 按其持久化属性渲染
3. **暗色主题**：分支色写入元素属性，暗色变体走全 app 统一的 `applyDarkModeFilter`（色族一致，不逐像素复刻设计稿的暗色 hex）；画布覆盖层（徽标等）同样套该滤镜保持一致
4. **徽标/按钮按场景坐标缩放**（设计稿以场景 SVG 绘制；缩放画布时与节点同比例变化）
5. **+ 按钮仅在选中时出现**（hover 只显示「−」；设计稿的按钮挂在选中态上）；形状选择器增加「自动」项（回到层级默认形态）——设计未画，但否则用户无法回到层级默认
6. **根节点 600 字重需要给文本元素新增 `fontWeight?: number`**（现有 `fontWeight` 只在表格单元格样式上，types.ts:116）

## 实施方案

### Phase 0 — 基础
- `packages/element/src/mindmap.ts`：新增 `MINDMAP_BRANCH_PALETTE`（5 组 stroke/fill 常量，独立于 colors.ts picker 数组）
- `fontWeight` 支持：`ExcalidrawTextElement` 加 `fontWeight?: number`（types.ts ~:492）；`getFontString`（common/src/utils.ts:139）输出 `600 16px …` shorthand；renderElement.ts:709 与 staticSvgScene.ts:973（`font-weight` 属性）透传

### Phase 1 — 层级/分支样式派生（核心）
> 机制说明（样式即数据 + 比较门）：**派生函数**按节点的层级与分支位次算出设计稿规定的样式（填充/描边/形状/字号字重/边色边宽），作为具体元素属性写入。**只在结构命令落定时调用**（`applyMindmapTreeCommand` mindmap.ts:954 / `applyMindmapOperation` mindmapScene.ts:205 是唯一收口）；文字编辑、折叠、样式动作、加载、粘贴一律不触发。结构命令写入前按 D.1 比较门逐节点判定（基线 = 用命令前的 index 算出的旧位置派生值），已修改节点不重派生——手动改色在全部操作下都保留，无需任何标记字段。
- `packages/element/src/mindmap.ts` 新增 `applyMindmapBranchTheme(index, …)`：
  - depth 来自 `index.depthById`；分支 = depth-1 祖先在根子节点中的位次 mod 5
  - 根：bg/stroke `#1f2329`、`roundness: PROPORTIONAL_RADIUS`（0.25×h≈12）、文字 `#fff`/16px/600
  - L1：shape `pill`、bg 分支浅色、stroke 分支色 1.5px、文字 14px 墨色
  - L2+：shape `"text"`、bg transparent、stroke 分支色（供下划线）、文字 14px 墨色
  - 边：strokeColor=子节点分支色、strokeWidth=子深度 1 ? 2 : 1.5
  - 经 `withUpdates`（mindmap.ts:230，值相同返回同引用）写入，幂等
- 派生范围：仅结构命令直接触及的子树——重挂/提升/删除保留子的被移动部分（新分支色 = 新一级祖先的存储色；落为新一级分支时按落位位次取色）与形态随深度变化的部分；触及子树内逐节点过 D.1 比较门，未修改才重派生，已修改节点全部样式原样保留。纯重排不动样式；未被触及的节点一律保持既有属性
- 字号测量无需特殊时序：派生发生在结构命令内部，随后的重布局/测量自然使用最终字号
- 出厂默认更新（newElement.ts:307-347）：根 bg `#1f2329`；`DEFAULT_MINDMAP_EDGE_ROUTING` → `"curved"`（mindmap.ts:32）

### Phase 2 — 新增 `"text"` 节点形态
- types.ts:283 `MindmapNodeShape` 增加 `"text"`；`isMindmapNodeShape`（mindmap.ts:58）同步；`assertMindmapShapeData` 保持严格、原样不动
- `getMindmapNodeGeometry`（mindmap.ts:164）：`"text"` → rectangle（命中测试/文字度量走完整节点包围盒）
- shape.ts:860 `case "mindmap-node"` 增加 `"text"` 分支：只画底部下划线 path（`M 0 h-1 L w h-1`，stroke=元素 strokeColor=分支色，1.5px）；SVG 导出经共享 ShapeCache 管线自动一致
- mindmapScene.ts:137 形状映射补 `"text" → "rectangle"`；`renderPreview`（App.mindmap.ts:603-642）同步画下划线

### Phase 3 — 连线
- 曲线默认：见 Phase 1（仅改出厂默认；边上已持久化的 routing 是真实设置，原样保留）
- 正交 10px 圆角：重写 `getMindmapEdgePath`（mindmap.ts:175-190）正交分支，内角发 `Q` 弧，`r = min(10, |seg1|/2, |seg2|/2)`；新增共享 `traceMindmapEdgePath(context, edge)` helper，`renderMindmapEdgeSelection`（interactiveScene.ts:1204）与拖拽预览改走它，保证选中高亮/预览/导出三线一致
- 宽度分级：Phase 1 派生写入

### Phase 4 — 选中
- `getTransformHandles`（transformHandles.ts:288）：`mindmap-node` 走 table 同款分支（:311-324 模式），`omitSides` 加 `rotation: true`（保留 resize 手柄，不进 :298 的全空早退）

### Phase 5 — 选中节点的添加按钮（复用现有悬浮按钮机制改造）
> 背景：当前项目已有 HTML 悬浮按钮机制 `ElementCanvasButtons`（render.tsx:258-311）——悬停或选中思维导图节点时，节点旁浮出「+ 添加子节点」和「▾/▸ 折叠」两个按钮，位置随布局方向锚定。本阶段在**这套现有机制**上按设计稿改造，不新造交互通道。
- render.tsx:99-107：`mindmapNodeForControls` 拆为「选中才给按钮」（hover 状态留给画布「−」）
- render.tsx:258-311：移除 ▾/▸ 折叠按钮（折叠改由 Phase 6 的画布徽标/「−」承担）；保留子侧「+」；新增垂向「+ 添加同级」（root 隐藏）调 `app.mindmap.createSibling(nodeId)`（在 App.mindmap.ts 加公共薄封装，内部走现有 `createNode(node, "sibling")` :2288）
- ElementCanvasButtons.tsx：锚点扩展 `child-side`/`sibling-side`（子侧=布局方向远边中点，垂向=垂直方向远边中点），相对选中框外偏 14px
- ElementCanvasButtons.scss：加 `--mindmap` 修饰类：16×16 白底圆、`var(--color-selection)` 1.25px 描边、hover 实心；不影响 magic-frame 等现有按钮

### Phase 6 — 折叠 affordance（画布绘制，不进导出）
- 几何 helper（mindmap.ts）：`getMindmapCollapseAffordance(node, direction)` → 子侧边中点 + 外法线偏移（徽标 r=9、stub 3px；「−」r=7）
- 计数缓存（element/src/Scene.ts:162 附近）：把 `hiddenMindmapElementIds` 缓存扩展为 `{ hiddenIds, collapsedCounts }`（`computeMindmapVisibility` 一次 O(N) 遍历；失效点沿用 :374/:417）
- 渲染：interactiveScene.ts 新增 `renderMindmapCollapseAffordances`（参考 `renderMindmapEdgeSelection` :1204），选中块之后调用：collapsed 且有隐藏子孙 → stub + 白圆 + 分支色描边/数字（11px/600，数字经 `applyDarkModeFilter` 与节点同滤镜）；hover 或单选中的已展开有子节点 → 「−」圆。viewMode 下只画徽标不画「−」
- 命中：`AppMindmap.hitTestCollapseAffordance(sceneX, sceneY)`（半径 +2/zoom 余量），在 `handlePointerDown`（:212）与 `preparePointerDown`（:715）顶部拦截 → `executeTreeCommand({type:"toggleCollapse"})` 并吞掉本次手势（复用 `cancelledPointerDown` 模式）；`handlePointerMove`（:176）里做 hover 检测与 pointer 光标（注意 pointerCanvas.ts:766 的光标覆盖风险，必要时直接写 `canvas.style.cursor`）

### Phase 7 — 拖拽重排预览
- `MindmapDropTarget`（App.mindmap.ts:59）加 `kind: "child" | "sibling"`（:1584/:1611 两个赋值点）——区分 sibling 末尾追加与 child-attach
- 源分支降透明 24 → **35**（components/app/scene.ts:255）
- `renderPreview`（:555-675）：ghost 节点/文字 `globalAlpha=0.55`；child-attach 边 → 主色 2px 虚线 `[4,3]`（替换 `#4f83e7` 实线）；sibling 插入 → 新增 2px 主色插入线（跨兄弟节点横轴范围 +8px），此时不画虚线边

### Phase 8 — 编辑态
- `renderTextBox`（interactiveScene.ts:2463）：文本挂在 mindmap 节点时改为实心 1.5px 主色环（rx 跟随节点形态；`"text"` 形态画下划线下方的主色线）
- 快捷键提示（HTML）：render.tsx 中 `editingTextElement` 属于 mindmap 节点时，节点下方渲染 `.mindmap-edit-hint`（定位复用 ElementCanvasButtons 的 `sceneCoordsToViewportCoords` 数学）；新增 i18n key `labels.mindmapEditHint`（zh-CN「Enter 完成 · Tab 新建子节点」/ en「Enter to finish · Tab for child node」，其余语言回落 en）

## 关键文件
- `packages/element/src/mindmap.ts`（palette、派生函数、"text" 形态、边角圆角、affordance 几何、可见性/计数）
- `packages/element/src/mindmapScene.ts`（结构命令收口）、`newElement.ts`（出厂默认）、`shape.ts`（下划线渲染）、`types.ts`（shape 联合 + fontWeight）
- `packages/excalidraw/components/App.mindmap.ts`（dropTarget kind、拖拽预览、affordance 命中/hover）
- `packages/excalidraw/renderer/interactiveScene.ts`（affordance 渲染、编辑环、边选中路径）
- `packages/excalidraw/components/app/render.tsx` + `ElementCanvasButtons.tsx/.scss`（按钮）
- `packages/common/src/utils.ts`（getFontString）

## 测试
- **更新**：`element/_tests_/mindmap.test.ts`（出厂默认色/路由/宽度断言、布局坐标断言）、`mindmapScene.test.ts`（结构命令后的派生结果）、`excalidraw/_tests_/mindmap.test.ts` + `mindmapTreeOperations.test.tsx`（HTML 折叠按钮移除 → 改走徽标命中或 Space）、`clipboard.test.ts`（"text" 形状往返）
- **新增**：派生函数单测（位次取色循环/层级形态/只触及受影响子树、纯重排不动样式/幂等）；D.1 比较门单测（未修改节点重挂/提升/删除保留子后按新位置重派生；改过任一受管属性的节点同样操作后全部样式保留；子树内逐节点独立判定；手改值恰等于派生值按未修改处理——文档化行为）；`computeMindmapVisibility` 计数（含嵌套折叠）；affordance 命中与两种工具下的点击切换；单节点无旋转手柄；dropTarget kind 判别；小图 SVG 导出快照（导出一致性）；暗色滤镜冒烟
- **命令**：`yarn test:typecheck`、`yarn test:update`（CLAUDE.md 要求提交前必跑）
- **手工验证**：`yarn start` 起 app，建思维导图 → 检查层级形态/分支色/曲线连线；Tab/Enter/Space；选中节点两个 + 按钮；折叠徽标计数与点击展开；拖拽到 sibling 区看插入线；双击编辑看实心环与提示；切暗色主题看反色根节点与分支色变体
