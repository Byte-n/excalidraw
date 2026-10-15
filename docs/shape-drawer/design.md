# 图形抽屉（更多功能）设计方案

## 背景与依据

顶部工具栏原有两个并列的形状入口：「普通图形」popover（基础复合图形）与「流程图」popover（14 个 `fc-*`，见 [流程图图形设计方案](../flow-chart/design.md)）。两者各自维护一份选项清单，且都走「武装工具 → 在画布上拖画」的创建链路。本期把这套并列入口收敛成一条路径：

- **移除**顶部的「流程图」分组入口；
- 在普通图形 popover 底部加一整行「更多功能」；
- 点开「更多功能」在画板左侧弹出「图形」抽屉，抽屉内按分区列出六组素材：**基础图形、流程图、便签、画框、表格、脑图**。

除流程图外，其余分组在顶部工具栏的入口保持不变。抽屉是**取用面板**而非工具面板：它不改变当前工具，也不改写「当前图形」。

抽屉内六个分区的素材来源：基础图形与流程图沿用既有 `shape.id`（[普通图形：Lark 到当前平台的映射](../lark-exmples/composite-shape/lark-shape-mapping.md)）；便签沿用内置纸色预设；表格沿用 `TablePresetId`（见「表格泳道预设」既有实现）；画框本期补 1 项、脑图本期补 4 个方向项。六组选项数据集中在 `components/presetCatalog.tsx`，顶部 popover 与抽屉同源。

## 决策约束

以下为不会随后续实现漂移的硬约束。任何实现若与本节冲突，以实现为准改实现，而不是改本节。

- **取用只有两种模式**：抽屉内不支持「武装工具」，也不支持在画布上拖画。
  - **单击** → 当前「可见区域中心」放下一份预设；
  - **按住拖入** → 在松手处放下（沿用工具栏拖拽的预览套路）。
  - 两者互斥：拖拽超过阈值后，`pointerup` 不会触发 `click`，与便签触发器同一机制。
- **放下后不写 `preferredGenericShape`**：抽屉的放置链路独立于顶部工具栏的「当前图形」。单击/拖入后顶部工具栏显示的当前图形保持不变。
- **放置点是「可见区域中心」**，不是原始视口中心。桌面让出左侧抽屉宽度；手机竖屏让出底部面板高度的一半。抽屉宽度与面板高度以**导出的常量**同时喂给 CSS 与该算式，杜绝两处漂移。
- **放下后按类型进入编辑**：便签、脑图根节点直接进入文字编辑；其余类型（基础图形、流程图、画框、表格、非根脑图）只选中，不进入编辑。
- **分区可折叠**，默认只展开「基础图形」；展开状态在会话内保留（抽屉常挂载，仅以 `data-open` 控制显隐）。
- **本期不做搜索框**（记为后续项，抽屉内不预留搜索入口）。
- **抽屉与素材库侧边栏互不干扰、可并存**：抽屉是纯浮层，不挤压布局；`z-index` 取 `var(--zIndex-ui-styles-popup)`（100），低于素材库的 `var(--zIndex-ui-library)`（120）。
- **响应式形态**：手机竖屏用底部弹出面板（复用既有 `BottomSheet`）；平板、手机横屏、桌面用左侧抽屉。两种形态渲染同一份目录数据与同一种取用语义。
- **脑图四方向共用 `mindmapIcon`**，以 CSS 旋转（0° / 180° / 90° / -90°）区分，不新增四个方向图标。
- **目录单一来源**：六组选项数据集中在 `components/presetCatalog.tsx`，顶部 popover 与抽屉都从它取数。禁止各渲染点自维护清单。

## 命名映射

### 分组

| 组 `id` | 分区名称 `t()` 键 | 顶部工具栏入口 | 本期新增 |
| --- | --- | --- | --- |
| `basic` | `shapeDrawer.basic` | 保留（普通图形 popover） | 无 |
| `flowchart` | `shapeDrawer.flowchart` | **移除** | 无 |
| `sticky` | `shapeDrawer.sticky` | 保留（便签触发器） | 无 |
| `frame` | `shapeDrawer.frame` | 保留 | 画框预设 ×1 |
| `table` | `shapeDrawer.table` | 保留（表格触发器） | 无 |
| `mindmap` | `shapeDrawer.mindmap` | 保留 | 方向预设 ×4 |

### 选项 id 与字面量

| 组 | 选项 `id` 规则 | 取值 | 预设尺寸来源 |
| --- | --- | --- | --- |
| `basic` | 沿用既有 `shape.id` | 基础复合图形的全部 `shape.id`（含 `right-triangle` / `left-triangle` 两个伪形状，`shape.id` 仍为 `triangle`，以 `apexX` 区分） | 120×80（`DEFAULT_SHAPE_PRESET_SIZE`） |
| `flowchart` | 沿用既有 `shape.id` | 14 个 `fc-*` | 120×80（流程图组一律走 `rectangle` 工具的 `DEFAULT_SHAPE_PRESET_SIZE`） |
| `sticky` | 纸色预设 `id` | `yellow` / `green` / `blue` / `pink` / `violet` / `gray` | 160×160（`DEFAULT_STICKY_NOTE_PRESET_SIZE`） |
| `frame` | `frame` | `frame` | 400×300（`DEFAULT_FRAME_PRESET_SIZE`） |
| `table` | 表格预设 `id` | `plain` / `swimlane-horizontal` / `swimlane-vertical` | 沿用元素默认尺寸（表格默认 3×3 即其预设） |
| `mindmap` | `mindmap-<方向>` | `mindmap-right` / `mindmap-left` / `mindmap-down` / `mindmap-up` | 文本树「中心主题 → 3 分支 → 每支 2 子主题」，共 10 节点 / 9 连线 |

### 脑图方向映射

`mindmap-<方向>` 只是抽屉内的选项 `id`；落到元素上写的是根节点的 `layoutDirection` 字段（`MindmapLayoutDirection` 四个既有字面量）：

| 抽屉选项 `id`   | 落地 `layoutDirection` | `mindmapIcon` 旋转 |
| --------------- | ---------------------- | ------------------ |
| `mindmap-right` | `left-to-right`        | 0°                 |
| `mindmap-left`  | `right-to-left`        | 180°               |
| `mindmap-down`  | `top-to-bottom`        | 90°                |
| `mindmap-up`    | `bottom-to-top`        | -90°               |

### 测试与可寻址约定

| 约定 | 字面量 |
| --- | --- |
| 抽屉格子 `data-testid` | `shape-drawer-item-<id>`（`<id>` 为对应组的选项 `id`） |
| 「更多功能」入口 `data-testid` | `tool-popover-more`（**不占用** `toolbar-*` 前缀，既有 `[data-testid^="toolbar-"]` 计数断言不受影响） |
| 抽屉容器 | `role="dialog"` + `aria-label="图形"`；展开/折叠按钮带 `aria-expanded` |

## i18n 键清单

新增/补齐的键在 `packages/excalidraw/locales/en.json` 与 `zh-CN.json` **同步**落地。

| 键 | 用途 |
| --- | --- |
| `shapeDrawer.title` | 抽屉标题「图形」 |
| `shapeDrawer.more` | 「更多功能」行/按钮文案 |
| `shapeDrawer.basic` / `.flowchart` / `.sticky` / `.frame` / `.table` / `.mindmap` | 六个分区标题 |
| `mindmapPreset.directionRight` / `.directionLeft` / `.directionDown` / `.directionUp` | 脑图四个方向项的标题/`aria-label` |
| `toolBar.right-triangle` / `.left-triangle` / `.pie` / `.circular-ring` | **补齐**基础图形中缺的标题：`pie` / `circular-ring` 此前只在 `element.*` 有；`right-triangle` / `left-triangle` 是两个伪形状，此前根本没有 `titleKey`（标题由 id 派生字面量给出） |

约束：`locales/en.json` 是 `t()` 的**类型来源**（`TranslationKeys` 由它派生）。缺键会让 `yarn test:typecheck` 直接失败，因此 i18n 键是本期实现的门禁之一，必须在渲染点引用之前落盘。

副作用（有意为之）：基础图形标题由英文派生字面量改为 `t()`，个别英文名会变正（例如 `brace-reverse` 由 "Brace reverse" 规范为 "Reverse brace"）。

## 注册点清单

### 状态与挂载

1. `types.ts` + `appState.ts` — `AppState` 新增 `openShapeDrawer: boolean`，默认 `false`。仅由「更多功能」、抽屉收起按钮、Esc、画布 `pointerdown` 改变；**不联动** `openSidebar`。
2. `components/LayerUI.tsx` — 抽屉挂到 `LayerUI` 的 `layerUIJSX`（在 `.excalidraw-container` 内）。**不可用 `renderSidebars()` 槽**：那个槽只服务桌面非手机分支，手机端不渲染，会导致竖屏形态丢失。

### 目录与入口

3. 新增 `components/presetCatalog.tsx` — 六组预设的唯一目录（`SHAPE_CATALOG`，按 id 经 `getCatalogGroup` / `getCatalogItem` 取用）。条目形如：

   ```ts
   type CreationSpec =
     | {
         kind: "shape";
         tool: "rectangle" | "diamond" | "ellipse";
         shapeId: string;
       }
     | { kind: "sticky"; preset: StickyNotePreset }
     | { kind: "frame" }
     | { kind: "table"; preset: TablePresetId }
     | { kind: "mindmap"; direction: MindmapLayoutDirection };

   type PresetCatalogItem = {
     id: string;
     titleKey: TranslationKeys;
     fillable?: boolean;
     iconRotation?: number;
     getIcon: (theme: Theme) => ReactNode;
     creation: CreationSpec;
   };
   ```

   形状 id 类型与守卫都由目录派生：`BasicShapeId` / `FlowchartShapeId` 取自目录里的 `BASIC_SHAPE_IDS` / `FLOWCHART_SHAPE_IDS` 字面量数组，`GenericShapeId` 是两者并集；`isGenericShapeId` / `isFlowchartShapeId` 是同一份清单上的守卫。`Tools.tsx` 的两个 popover 直接从这里取数，杜绝两处漂移。

4. `components/ToolPopover.tsx` + `.scss` — 新增 `footer?: React.ReactNode` 插槽，在 `Popover.Content` 选项之后渲染 `.tool-popover-footer`（`flex: 0 0 100%` + 顶部分隔线，靠换行占满一整行）。只有普通图形 popover 传它；footer 按钮 `data-testid="tool-popover-more"`，点击后 `setAppState({ openShapeDrawer: true })`。
5. `components/Tools.tsx` — 改为从目录取数：删除本地 `SHAPE_TOOLS` 与 `FLOWCHART_SHAPE_IDS` / `FLOWCHART_SHAPE_TOOLS`，两个 popover 的选项与 `title: t(titleKey)` 都来自目录。`preferredGenericShape` 同步 effect、`lastShapeRef`、`activeOptionType`、`sharedToolType`、`onToolChange` 一律不动（这是两个 popover 不脱钩的关键）。
6. `components/Toolbar.tsx` 与 `components/MobileToolbar.tsx` — **删除**流程图入口的两处渲染点（含 import）；`MobileToolbar` 的 `MIN_TOOLS` / 宽度断点常量随之下调 1，并同步移动端测试。

### 放置与拖入

7. 新增 `components/app/presetPlacement.ts` —
   - `getVisibleCenterSceneCoords(app)`：视口中心按抽屉遮挡修正。算式口径：桌面/平板/横屏把中心**右移半个抽屉宽度**，手机竖屏**上移半个面板高度**（均按 CSS px ÷ zoom 换算成场景单位）。抽屉宽度与面板高度复用**导出的常量** `SHAPE_DRAWER_WIDTH_PX`（抽屉宽度）与 `SHAPE_SHEET_HEIGHT_RATIO`（手机底部面板占容器高度的比例）——CSS 与这条算式共用同一份常量，杜绝两处漂移；
   - `buildPresetElementsAt` / `buildPresetElementsCentered`：按 `CreationSpec` 装配（单元素走 `newCreationDraft`，表格走 `createTablePresetDrafts`，脑图走 `buildMindmapGraphFromTree`），用 `getCommonBounds` 把包围盒中心对到目标点（脑图连线是局部坐标，整体平移即可）；
   - `placePreset(app, spec, center)`：`insertNewElements` → 选中全部新元素 → `scheduleCapture()` → 按类型进入编辑 → **不调用 `setActiveTool`**。
8. `components/App.toolDrag.ts` 泛化 — `DraggableTool` 改为 `createElements(app, at, identity?) => NonDeleted<ExcalidrawNonSelectionElement>[]` + `onDrop(app, elements)`；`DRAGGABLE_TOOLS.stickynote` 包成单元素数组（行为不变）。新增 `handlePresetPointerDown(source, event)`；`handleButtonPointerDown(type, event)` 保留签名、内部转调同一套武装逻辑。预览改为数组（`previewElements`，保留 `preview = previewElements?.[0] ?? null` 兼容既有测试），`components/app/render.tsx` 相应改成数组渲染（泳道表格、脑图整图要一起画出来）。**跨过阈值后只构建一次草稿并记住包围盒中心**，之后 `pointermove` 只做平移 + 网格吸附——否则每次 move 都重建会推进共享 id/seed 序列。
9. 新增 `components/app/presetDragSources.ts` — `getPresetDragSource(item)` 把目录项包成 `DraggableTool`，供抽屉格子的 `onPointerDown` 使用。
10. `components/app/createPresets.ts` — `newCreationDraft` 新增可选 `overrides?: { preferredGenericShape?; stickyBackgroundColor?; stickyStrokeColor? }`，缺省仍读 `app.state`；现有调用点保持逐字节一致。
11. `packages/element/src/mindmapScene.ts` — `buildMindmapGraphFromTree` 新增可选第 5 参 `layoutDirection`，在 `layoutMindmapScene` **之前**写到根节点上（根配置必须早于布局）；缺省 `undefined`，行为不变。`AppMindmap.createRoot` 顺带支持方向参数。

### 抽屉本体

12. 新增 `components/ShapeDrawer.tsx` + `.scss` — 标题 + 收起按钮 + 可滚动内容区；六个 `<section>` 各自「可折叠标题 + `role="group"` 图标网格（每组带 `aria-label`）」。桌面/平板/横屏：`position:absolute; inset-block:0; inset-inline-start:0`，宽度取步骤 7 的常量，`z-index: var(--zIndex-ui-styles-popup)`，配色用 `--menu-bg/--menu-border/--menu-shadow/--page-ink*`，`:root[dir="rtl"]` 下从右侧滑入。手机竖屏：同样的内容放进既有 `BottomSheet` + `BottomSheetOverlay`。每个格子是真实 `<button>`：`aria-label`/`title` 取 `t(titleKey)`，`data-testid="shape-drawer-item-<id>"`。

### 文案与测试

13. `locales/en.json` + `zh-CN.json` — 落「i18n 键清单」全部键。
14. 新增 `_tests_/shapeDrawer.test.tsx` — 开合（更多功能/✕/Esc/画布点击）、六个分区标题与顺序、单击放置（落在可见中心、`activeTool` 未变、表格泳道带标签、画框 400×300、脑图根 `layoutDirection` 随方向项）、拖入（多元素预览、松手落点、undo 一步）、手机竖屏走 `BottomSheet` 分支。
15. `_tests_/compositeShapeUI.test.tsx` — 原点击 `toolbar-flowchart` 的用例改走「基础 popover → 更多功能 → 抽屉格子」；`MobileToolbar` 常量相关用例同步。

## 验收

### 自动化

1. `yarn test:typecheck` 通过（i18n 键与新签名是门禁）
2. `yarn test:update` 全绿（含快照更新）
3. `yarn test:all` 全绿
4. `grep -rn "toolbar-flowchart" packages/` 只剩组件自身与目录数据，无渲染点

### 人工浏览器清单

- **桌面路径**：普通图形 popover → 点「更多功能」→ 左侧滑出「图形」抽屉；六组展开/折叠与默认态（只展开「基础图形」）；单击基础图形/流程图/便签/画框/表格/脑图后元素落在可见区域中心，且顶部工具栏「当前图形」未被改变；按住格子拖到画布松手落在指针处；便签与脑图放下后可直接改字。
- **手机竖屏路径**：同入口弹出底部面板；格子单击/拖入语义与桌面一致。
- **交叉项**：抽屉与素材库同时打开互不影响；深色/浅色主题下样式正常；RTL 下抽屉从右侧滑入且布局正确。
