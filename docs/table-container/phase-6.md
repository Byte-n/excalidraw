# 第六期：表格 UI/UX 重设计（平台文档表格风格）

- 期次：P06。
- 状态：已完成实施与自动化验收（全量测试 + 逐项核对）；人工界面验收按文末清单执行。
- 设计依据：`docs/design-ui/excalidraw-canvas-table.html`（含亮/暗双主题令牌与交互状态图）。
- 前置：[P05 协作、移动端与大表可用性](phase-5.md)；总体门槛见 [全功能分期总览](00-overview.md)。

## Context

设计稿把表格从「一组网格线」重定义为平台文档表格：白底、圆角外框、浅色网格、首行表头，全部选择/编辑反馈统一走主色（`--color-selection` `#1677ff` / 暗色 `#4096ff`），并补齐编辑态位置提示、列宽数值标签、移动行/列浮层等反馈细节。当前实现（P01–P05）功能面已与设计稿大体重合（创建、缩放、合并、剪贴板、行列结构手势均已交付），本期不改交互模型，只做**视觉语言替换 + 反馈细节补强 + 首行表头**。

零历史包袱原则沿用 [总览跨期不变量 9](00-overview.md)：不迁移、不兼容旧外观；新默认值直接生效，不写"旧表检测"分支。

## 差异分析（设计稿 ↔ 当前实现）

### A. 设计稿重定义的视觉（当前有，形态/数值不同）

1. **表体**：当前透明底 + `#B3B3B3` 直角外框 + `#D6D6D6` 网格（`constants.ts:223-233` `TABLE_STYLE`，`tableRender.ts:265-275` `strokeRect`）→ 白底 + `1px #D0D3D9` 圆角 6px 外框 + `#E5E6EB` 网格。
2. **单元格默认排版**：当前 center/middle、padding 0、字号取 `currentItemFontSize`（`tableScene.ts:262-263`、`components/app/table.ts:978-980`、`tableSceneGeometry.ts:146-148`）→ 13px、左对齐垂直居中、内边距水平 12 / 垂直 10（`TABLE_CELL_TEXT_PADDING_X/Y`）。
3. **悬停单元格**：当前 `rgba(0,118,255,0.12)`（`interactiveScene.ts:1374-1401`）→ 主色 10% 填充（拖入图形落点预览沿用同一通道，已复用，仅随动改色）。
4. **区域选择**：当前 2px 描边无填充（`interactiveScene.ts:1403-1440`）→ 主色 8% 填充 + 1px 主色外框，起始格保留 2px 内描边。
5. **整行/整列选中**：当前 `rgba(0,118,255,0.14)` 填充（`interactiveScene.ts:1667-1734`）→ 主色 12% 填充 + 1.5px 主色描边；把手选中态变主色（已有）。
6. **行列把手**：当前 9px 厚条（`interactiveScene.ts:1498-1543` `drawStructureRail`）→ 6px 圆角条（rx 3）+ 居中 2×3 点阵；三态：默认 `#E5E6EB` / 悬停主色 45% 混合 / 选中主色，悬停与选中时点阵转白。距表格 6px（`TABLE_STRUCTURE_RAIL_OFFSET`，`constants.ts:287-288`，已一致）。
7. **标题**：当前 gap 默认 2、文本取 `currentItemFontFamily` 默认字号（`tableTitle.ts:24,77-79`）→ gap 8、12px/500（与 Frame 标题同风格），距表格 8px。
8. **插入点**：当前悬停画蓝线 + 加号 mark（`interactiveScene.ts:1465-1496`、`:1824-1868`）→ 静止态补 r2 边界圆点（`#8F959E`，距表格 18px，offset 常量 `constants.ts:289-290` 已一致）；悬停态 16px 主色实心圆 + 白色 1.5px「+」+ 2px 插入线。

### B. 设计稿引入的新能力（当前没有）

1. **首行表头**：新增表级属性「首行为表头」，默认开启；首行 `#F5F6F7` 底 + 13px 600 文字，顶部随外框圆角。当前无任何 header 概念。
2. **编辑单元格位置提示**：2px 主色内描边 + 所在行/列把手变主色。当前编辑时所有表格 overlay 被抑制（`interactiveScene.ts:2820`、`:2870-3108` 各调用点），无任何位置指示。
3. **调整列宽/行高数值标签**：拖动分隔线时显示尺寸标签（样式同旋转/缩放的数值气泡 `renderTransformStatusLabel`，`interactiveScene.ts:1171-1207`：11px、高 20、rx 5、墨色底白字）。当前只有 2px 分隔线（`:1778-1822`）。
4. **移动行/列浮层**：原位置内容淡化 35% + 白底浮层（1px 外框 + 阴影）跟随指针；落点 2px 主色线（已有，`interactiveScene.ts:1918-1950`）、Esc 取消（已有）、合并块整体移动（已有）。当前只有落点线，无淡化与浮层。
5. **标题对齐 UI**：`TableStyle.title.align` 数据层已有（`types.ts:136`），缺属性面板入口。

### C. 设计稿与现状一致（不改动，验收时回归）

- 创建：工具快捷键 `J`；点击插入 3×3、单元格 160×56；拖拽按 3×3 均分虚线预览、单元格低于 24px 回弹默认（`tableStruct.ts:14-18`、`table.ts:113-265`）。
- 缩放：角手柄等比（字号同步）、边手柄单轴（字号不变）、表格不可旋转、多选含表格 Esc 整体回滚（`table.ts:1615-1682`、`tableScale.ts`、`transformHandles.ts:311-324`）。
- 合并/拆分：≥2 格矩形选区、合并区内部网格线隐藏（`tableRender.ts:115-161`）、选中合并格可拆分。
- 行高自适应：文字换行撑高所在行、只增不减（`tableSceneGeometry.ts:243-267`）；行高/列宽最小 24。
- 内嵌图形：任意图形入格、嵌套表格、「居中单元格内容」命令（`tableContainer.ts`、`actionTableStructure.ts:214-223`）。
- 边框/网格样式：实线/虚线 6·4/点线 1·3、宽度可调（`tableRender.ts:240-275`）。
- 剪贴板：选区复制 TSV、粘贴自焦点格展开、不足自动扩行扩列（`tableClipboard.ts`）。
- 快捷键：`Ctrl/Cmd+Shift+R/C` 插入行/列、`Ctrl/Cmd+Shift+方向键` 移动、选中行/列时 `Delete` 删除该行/列（`actionTableStructure.ts`、`actionDeleteSelected.tsx:196-202`）。
- 命中区：结构命中桌面 24 / 触屏 44（实施时核对插入点命中区一并达标）。

### D. 产品判断点（本期的取舍，可推翻）

1. **暗色主题走全 app 统一的 `applyDarkModeFilter`**（与 P12 思维导图 D.3 一致），不逐像素复刻设计稿的暗色 hex；唯一例外是表体背景沿用已有 `token:surface` 解析（白/`#262626`，`tableRender.ts:74-85`），与单元格 `token:surface` 行为一致。
2. **默认行高维持 56**：设计稿规格表写「默认行高 36」但创建规格写「单元格 160 × 56」，两者矛盾；取与现状一致的 160×56 创建默认，行高/列宽最小 24 不变。
3. **单元格默认排版直接改出厂默认**（左对齐垂直居中、padding 水平 12 / 垂直 10、13px）：`pasteTSVIntoCell` 的 4px 硬编码偏移（`tableClipboard.ts:606-609`）统一改走默认 padding。字体沿用当前默认字体族，不随本期切换「系统字体」——字体族切换影响文字测量与全部既有测试基线，留待单独决策。
4. **编辑中行列把手仅作位置提示**：渲染保留（所在行列主色），不新增编辑态手势；点击把手/表外按现状先退出编辑。
5. **表头为纯渲染派生，不落数据**：`header !== false` 时首行背景与 600 字重作为**最低优先级默认**参与解析（显式行/列/格背景、显式字重一律覆盖它），开关切换零副作用、无历史写入。

## 实施方案

### Phase 0 — 表体视觉令牌

- `constants.ts:223-233` `TABLE_STYLE`：`strokeColor` → `#D0D3D9`、`gridColor` → `#E5E6EB`、`backgroundColor` → `"token:surface"`；新增 `headerFill: "token:header"`。
- `tableRender.ts:74-85` `resolveTableColor`：补 `token:header`（亮 `#F5F6F7` / 暗 `#2A2B30`）。
- `drawTableGridOnCanvas`（`tableRender.ts:194`）：白底圆角填充（`roundRect` rx 6，降级 `rect`，参考 `interactiveScene.ts:1196-1200`）；外框 `strokeRect` → 圆角描边路径；网格线不变（外框描边覆盖端点）。注意保留 zoom 补偿线宽与可见区域裁剪。
- 确认 SVG 导出与静态渲染共用同一入口（`renderElement.ts:1217`），导出自动一致；若有分支则同步。

### Phase 1 — 首行表头

- `types.ts:126-137` `TableStyle` 加 `header?: boolean`（默认 true）。
- 渲染（`tableRender.ts`）：首行背景在 `getTableCellFillColor` 解析链最末（table 之后、默认之前）插入 headerFill，仅首行、仅 `header !== false`；顶部两角随外框 6px 圆角（填充路径裁圆角，设计稿脚本中 header path 同形）。
- 字重：首行 backgroundText 无显式 `fontWeight` 时按 600 排版（`BackgroundTextStyle.fontWeight` 已存在，`types.ts:116`；排版入口 `tableSceneGeometry.ts` 背景文本布局处）。
- 属性面板：选中表格（无单元格选区）时加「首行表头」开关（`Actions.tsx` 表格区，写 `table.style.header`）。
- 创建入口（点击/拖拽）默认开，无需额外写入（默认派生）。

### Phase 2 — 单元格排版默认

- backgroundText 出厂：`textAlign` center → left（`tableScene.ts:262-263`、`table.ts:978-980`）、`verticalAlign` 维持 middle、fontSize 13。
- padding 默认 0 → 12（`tableSceneGeometry.ts:146-148`）；`tableClipboard.ts:606-609` 的 4px 硬编码偏移改读默认 padding。
- 九宫格对齐、行高自适应逻辑不变；对齐面板现状回归。

### Phase 3 — 交互反馈色统一

- `interactiveScene.ts`：hover 单元格 → 主色 10%（`:1374-1401`）；区域选择 → 主色 8% 填充 + 1px 主色外框 + anchor 格 2px 内描边（`:1403-1440`，anchor 来自 `tableCellSelection.anchorId`）；行/列选中 → 主色 12% 填充 + 1.5px 描边（`:1667-1734`）。
- 三处色值统一从 selection 色派生（`color-mix` 或预计算常量），替换 `rgba(0,118,255,…)` 字面值；暗色经统一滤镜。

### Phase 4 — 编辑态位置提示

- 编辑单元格（`editingTextElement` 为某格 backgroundText）时：该格画 2px 主色内描边（内缩 1px 避免压网格线），所在行/列 rail 主色（复用 Phase 5 把手选中态）。
- 放开 `interactiveScene.ts:2820`、`:2870-3108` 对这两件的编辑态抑制，其余 overlay（hover/选区/预览线）编辑中仍抑制；不新增编辑态命中（D.4）。

### Phase 5 — 结构把手与插入点视觉对齐

- `drawStructureRail`（`:1498-1543`）：9px 条 → 6px 圆角条（rx 3），2×3 点阵居中（r 0.75、距 3.2）；三态色按 A.6；把手长度随行高/列宽（现状已如此）。
- 插入点：静止态每条行列边界补 r2 圆点（`#8F959E` 走滤镜）；hover 态 16px 主色实心圆 + 白色 1.5px「+」+ 2px 插入线（`:1465-1496`、`:1824-1868` 对齐）；核对插入点命中区桌面 24 / 触屏 44，不足补齐。

### Phase 6 — 列宽/行高数值标签

- 拖拽分隔线手势中显示尺寸标签：列宽拖显示 `宽`（如 `84`），行高拖显示 `高`；样式复用 `renderTransformStatusLabel`（`interactiveScene.ts:1171-1207`，11px/高 20/rx 5/墨色底白字），位置贴分隔线外侧（列→线上方、行→线左方），zoom 补偿与之一致。
- 数据来源：resize 手势当前尺寸（`table.ts:1972-2067`），经 `tableStructureHover`/`containerGestureVisual` 传入渲染层。

### Phase 7 — 移动行/列浮层

- grip 拖拽移动行/列（`table.ts:2244-2290`）期间：
  - 源位置内容淡化 35%（背景文本与 content 子树 `globalAlpha`；网格不动）；
  - 白底浮层跟随指针：白底 + 1px 外框 + 阴影，内画源行/列的单元格填充与背景文本（设计稿示意即此粒度）；content 图形不进浮层、留在原位淡化；
  - 落点 2px 主色线（已有）、Esc 取消（已有）、合并块整体移动（已有）保持。
- 状态经 `tableStructurePreview`（`types.ts:598-606`）扩展携带源范围与指针偏移，渲染于 `renderTableStructurePreview`（`:1918-1950`）。

### Phase 8 — 标题对齐设计稿

- gap 默认 2 → 8（`tableTitle.ts:24`）；标题文本出厂 12px/500（`startTableTitleEditing` 创建处 `:77-79` 显式给 fontSize/fontWeight）。
- 属性面板加标题对齐三段（start/center/end，写 `table.style.title.align`）。
- 编辑态输入框：白底 + 1px 主色描边（wysiwyg 对 `tableTitle` 容器文本的样式分支，`textWysiwyg.tsx`；标题不随表格缩放为现状，回归）。
- 悬停 40% 透明「Title」占位 + 六点把手已实现（`interactiveScene.ts:1553-1585`），回归。

## 关键文件

- `packages/common/src/constants.ts`（TABLE_STYLE 令牌）
- `packages/element/src/tableRender.ts`（白底/圆角/表头/token 解析）、`tableSceneGeometry.ts`（padding、字重派生）、`types.ts`（`TableStyle.header`）
- `packages/excalidraw/renderer/interactiveScene.ts`（hover/选区/行列选中/把手/插入点/编辑态提示/数值标签/移动浮层）
- `packages/excalidraw/components/app/table.ts`（手势尺寸数据源）、`tableTitle.ts`（标题）
- `packages/excalidraw/components/Actions.tsx`（表头开关、对齐三段）
- `packages/excalidraw/wysiwyg/textWysiwyg.tsx`（标题编辑框样式）

## 测试

- **更新**：`element/_tests_/tableRender.test.ts`（新令牌/白底/圆角/表头渲染与填充优先级）、`tableScene.test.ts` 与 `tableSceneGeometry` 相关断言（padding 水平 12 / 垂直 10、对齐与 13px 默认、首行 600 派生）、`excalidraw/_tests_/tableRendering.test.tsx` 快照、`tableInteraction.test.tsx`（编辑态 overlay 变化）、`tableClipboard.test.tsx`（padding 影响粘贴偏移）。
- **新增**：`header` 开关渲染与「显式覆盖优先」用例；编辑态内描边 + 所在行列把手主色；数值标签内容与位置；移动浮层预览状态生成。
- **命令**：`yarn test:typecheck`、`yarn test:update`（提交前必跑）；测试代码不留调试打印。
- **手工验证（由用户执行）**：`yarn start` 起 app —— ① 新建表格确认白底/圆角/浅网格/首行表头；② 单元格 hover、拖选区域、行列把手三态、插入点两态；③ 双击编辑看 2px 内描边与所在行列把手主色；④ 拖列宽看数值标签；⑤ 拖行把手看淡化 + 浮层 + 落点线、Esc 取消；⑥ 标题悬停占位/编辑/对齐切换；⑦ 切暗色主题整体过一遍；⑧ TSV 复制粘贴回归。
