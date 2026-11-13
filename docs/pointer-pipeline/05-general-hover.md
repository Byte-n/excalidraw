# PR5：通用 hover / cursor / transform / container 收口

> **状态**：未开始。
> **依赖**：PR2（帧契约）。PR3 / PR4 可并行，但本 PR 的优先级矩阵要等它们注册完 provider 后才能全量断言。
> **交付后的结果**：pointermove 不再有十余个独立 hover / cursor 入口；每帧只解析一次、只写一次 cursor；`hoveredElementIds`、`frameToHighlight`、`highlightedTableCell`、`tableStructureHover`、`fragmentStructureHover`、`transformStatus` 都从 frame 派生。
> **拆分为**：5a 画布核心（文本 / 线段 / 变换 / 复合控制 / 容器 / 链接）、5b 思维导图。

## 1. 目标

| # | 目标 | 验收 |
| --- | --- | --- |
| G1 | pointermove 只有一个解析入口、一个 cursor 写者 | cursor spy 每帧 ≤ 1 次 |
| G2 | 所有现有 target kind 都由 frame 分派 | 无 legacy hover 分支残留 |
| G3 | hover 状态字段只由 dispatch 写 | grep 写入口 |
| G4 | pointerdown 按 target kind 分派 | 不再靠多模块依次尝试 |
| G5 | 非 target 的指针跟随效果（预设预览、对齐线）与 target 解耦 | 仍每帧一次，不抢 cursor |

## 2. 非目标

- 不改选择、框选、拖拽、文本编辑的业务逻辑。
- 不改命中测试的 z-index 语义。
- 不删除 `suggestedBinding`（PR6）。
- 不把 `createPreview` / `snapLines` 变成 target。
- 不改表格 / fragment 的结构手势算法，只改入口。

## 3. 现状清单

### 3.1 pointermove 的独立入口

[pointerCanvas.ts:718](../../packages/excalidraw/components/app/pointerCanvas.ts#L718) 起：

| # | 入口 | 行 | 写入 | PR5 处置 |
| --- | --- | --- | --- | --- |
| 1 | 工具光标 | :776–:787 | cursor | 改为 `getToolCursor()`，由 dispatch 统一 set |
| 2 | mindmap | :790 | hover / cursor | 5b：target provider |
| 3 | quickCreate | :793 | frame（PR4） | PR4 已迁移 |
| 4 | createPreview | :797–:810 | 预设预览 | 保留为「非 target」派生 |
| 5 | frame highlight | :813 | `frameToHighlight` | 由 dispatch 派生 |
| 6 | table cell highlight | :821 | `highlightedTableCell` | 由 dispatch 派生 |
| 7 | resolveInteractionTarget | :844 | 容器 target | PR2 已迁移 |
| 8 | snap lines | :870 | `snapLines` | 保留为「非 target」派生 |
| 9 | binding hover | :945 | `suggestedBinding` | PR3 已迁移 |
| 10 | arrow hover | :1093 | `suggestedBinding` | PR3 已迁移 |
| 11 | 文本手柄 | :1136 | cursor | `textHandle` dispatch |
| 12 | 复合控制点 | :1155 | cursor | `compositeControl` provider + dispatch |
| 13 | 线段 hover | :1168 | cursor / hoverPointIndex | `linearHandle` dispatch |
| 14 | 变换手柄 | :1189 / :1218 | cursor / `transformStatus` | `transformHandle` dispatch |
| 15 | 橡皮擦 | :1252 | 提前 return | `mode = "other"` 保留 |
| 16 | 链接 / embed | :1280 起 | cursor / `hoveredElementIds` | `element` dispatch 内派生 |

### 3.2 pointerdown 的依次尝试

[pointerSession.ts:628](../../packages/excalidraw/components/app/pointerSession.ts#L628) 起：

| 分支 | 行 | PR5 处置 |
| --- | --- | --- |
| 表格标题 grip | :634 | 改为 `containerControl` target（`gesture === "titleGrip"`） |
| 移动端单元格 | :648 | 保留（移动端特例，不是 pointer target） |
| 文本手柄 | :653 | 改为 `textHandle` target |
| 滚动条 | :662 | 保留（不是场景 target） |
| 容器 target | :672 | PR2 已迁移 |
| 表格 / fragment 结构 | :691 / :721 | 保留算法，入口改为 target |
| 单元格选择 | :775 | 保留 |
| quickCreate | :785 | PR4 已迁移 |
| `handleSelectionOnPointerDown` | :790 | 删除内部 composite / transform 分支，改由 target dispatch |
| mindmap | :799 | 5b：target dispatch |
| 工具分派 | :817 起 | 保留（创建工具从 canvas target 进入） |

### 3.3 状态字段

| 字段 | 位置 | PR5 处置 |
| --- | --- | --- |
| `hoveredElementIds` | `AppState` | 由 `element` / `selectedElement` / mindmap dispatch 写 |
| `hoveredElementId` | `AppState` | 画框标题是 DOM，悬停由 `frames.tsx` 桥接；不是 canvas target，保持现状 |
| `frameToHighlight` | `AppState` | 由 target 派生（frame-like 元素） |
| `highlightedTableCell` | `AppState` | 由 target + point 派生 |
| `tableStructureHover` | `AppState` | 容器 provider `renderHover`（PR2） |
| `fragmentStructureHover` | `AppState` | 容器 provider `renderHover`（PR2） |
| `transformStatus.hoveredHandle` | `App.transformStatus` | `transformHandle` dispatch |
| `snapLines` / `originSnapOffset` | `AppState` | 非 target，保留独立计算 |

## 4. 设计

### 4.1 补齐 provider

| kind | provider | 适用条件 |
| --- | --- | --- |
| `compositeControl` | `hitCompositeControlPoint`（[compositeShapeControls.ts:40](../../packages/excalidraw/components/app/compositeShapeControls.ts#L40)）；**PR2 已注册** | 单选、形状元素、选择类工具、非只读、非编辑文本、无按键 |
| `mindmapAddButton` | `app.mindmap` 的加号命中 | 5b |
| `mindmapNode` | 可复用 `element`；仅在需要不同 cursor 时新增 | 5b |

`compositeControl` payload 使用 `getCompositeControlPointGlobal` 计算全局点（[compositeShapeControls.ts:11](../../packages/excalidraw/components/app/compositeShapeControls.ts#L11)），渲染与拖拽都不再重算。

### 4.2 `resolvePointerFrame` 终态

```ts
selection:
  textHandle
  > linearHandle
  > compositeControl
  > transformHandle
  > quickCreateHandle
  > activationEdge
  > poleActivation
  > selectedElement
  > containerControl
  > containerBody
  > element
  > canvas

arrow:
  connection
  > element（仅用于 hover cursor）
  > canvas

shape / other:
  canvas
```

规则：

- 每个 provider 先做轻量门控（工具、按键、只读、编辑文本），再做命中；
- 所有 provider 纯读；
- 任何 target 解析都先走 `resolveInteractionTarget` 得到 base，再按上表覆盖。

### 4.3 `applyPointerFrame` 终态

```ts
export const applyPointerFrame = (app, frame) => {
  // 1. 清旧 hover
  clearPointerHover(app);

  // 2. 分派 target
  switch (frame.target.kind) {
    case "textHandle":
      break;
    case "linearHandle":
      app.handleHoverSelectedLinearElement(/* 用 frame.point */);
      break;
    case "transformHandle":
      app.transformStatus.setHoveredHandle(frame.target.handle);
      break;
    case "compositeControl":
      break;
    case "selectedElement":
      app.setHoveredElementIds([frame.target.elementId]);
      break;
    case "containerControl":
    case "containerBody":
      renderContainerInteractionHover(app, frame.target.candidate);
      break;
    case "element":
      app.setHoveredElementIds([frame.target.elementId]);
      break;
    case "connection":
      // PR3：写 suggestedBinding 镜像
      break;
    case "quickCreateHandle":
    case "activationEdge":
    case "poleActivation":
      // PR4：写 ghost / drop point
      break;
    case "canvas":
      break;
  }

  // 3. 派生非 target 的 hover / 指针跟随
  updateDerivedPointerState(app, frame);

  // 4. 唯一 cursor 写入
  app.cursor.set(getCursorForPointerTarget(app, frame));

  // 5. 保存帧
  app.pointer.setFrame(frame);
};
```

被调用函数（`handleHoverSelectedLinearElement` 等）不再 `cursor.set`；它们只更新 hover 数据，cursor 由 `getCursorForPointerTarget` 统一给出。需要分支的 cursor（端点 / 线段 / 闭合）改为返回该函数计算的结果或在此复述同一判据。

`clearPointerHover`：

```ts
clearContainerInteractionHover(app);
app.mindmap.clearHover();
app.quickCreate.clearHoverFromFrame();
app.transformStatus.clearHovered();
app.setState((prev) => ({
  frameToHighlight: null,
  highlightedTableCell: null,
  hoveredElementIds: {},
  // tableStructureHover / fragmentStructureHover 由 provider clearHover 清
}));
```

注意：

- `clearPointerHover` 必须在任何 `return` 之前执行；`canDispatchInteraction` 不满足时也要清（拖拽 / 建图中除外，由 owner 维护）；
- `hoveredElementIds` 在链接选择器打开时保持现有特例，不被清空；
- `setState` 前做字段比较（沿用 `updateStable` / 浅比较），避免每帧 pointermove 触发 React 更新；
- 不再有模块在 dispatch 之后覆盖 cursor。

### 4.4 单一 cursor 计算

从 `AppCursor.applyForTool` 抽出纯函数：

```ts
export const getToolCursor = (app: PointerApp): string => { ... };

export const getCursorForPointerTarget = (
  app: PointerApp,
  frame: PointerFrame,
): string => {
  switch (frame.target.kind) {
    case "textHandle":
      return CURSOR_TYPE.POINTER;
    case "linearHandle":
      // 端点 / 控制点手柄：与 handleHoverSelectedLinearElement 的 point hover 一致
      return CURSOR_TYPE.POINTER;
    case "transformHandle":
      return getCursorForResizingElement(frame.target);
    case "compositeControl":
      return CURSOR_TYPE.MOVE;
    case "selectedElement":
      return CURSOR_TYPE.MOVE;
    case "element":
      return getElementHoverCursor(app, frame.target.elementId, frame.point);
    case "containerControl": {
      const cursor = getContainerProviderCursor(app, frame.target);
      return cursor || getToolCursor(app);
    }
    case "containerBody":
      return CURSOR_TYPE.MOVE;
    case "connection":
      // 现状：箭头 / 线工具悬停连接目标保持工具光标（十字）
      return getToolCursor(app);
    case "quickCreateHandle":
    case "activationEdge":
    case "poleActivation":
      return CURSOR_TYPE.POINTER;
    case "canvas":
    default:
      return getToolCursor(app);
  }
};
```

`getElementHoverCursor` 保留现有链接 / embed / 思维导图边 / view-mode / 文本等优先级：

- 文本元素 → `CURSOR_TYPE.TEXT`（现有）；
- 思维导图边 → `POINTER`；
- 链接 → `POINTER`（或 `CURSOR_TYPE.AUTO`，按现有）；
- view-mode + 可导航 → `GRAB`；
- 其它可拖拽元素 → `MOVE`；
- 画布 → 工具光标。

`AppCursor.applyForTool` 保留给非 frame 路径，内部改为 `this.set(getToolCursor(this.app))`；不得在 `applyPointerFrame` 之后再调用。

容器 provider 的 cursor 也要并进来：把 [interactionTarget.ts:365](../../packages/excalidraw/components/app/interactionTarget.ts#L365) 的 `dispatchContainerInteraction` 拆成

- `renderContainerInteractionHover(app, candidate)`：只调 `provider.renderHover`；
- `getContainerProviderCursor(app, candidate)`：调 `provider.getCursor`，返回字符串或 `""`。

`applyPointerFrame` 只调前者；cursor 由 `getCursorForPointerTarget` 统一取，最后 `app.cursor.set` 一次。PR2 的「容器 cursor 由 `dispatchContainerInteraction` 设置」在 PR5 完成时废止。

### 4.5 派生 hover

`updateDerivedPointerState(app, frame)` 每帧调用一次：

| 派生 | 来源 |
| --- | --- |
| `frameToHighlight` | `frame.target` 指向 frame-like 元素时设置；否则清空 |
| `highlightedTableCell` | `frame.point` + 表格命中；沿用 `maybeUpdateTableCellHighlightOnPointerMove` 的逻辑，但不再由 pointerCanvas 单独调用 |
| `hoveredElementIds` | `element` / `selectedElement` / mindmap target；链接选择器特例保留 |
| 箭头文字 hover | `element` target 为箭头时，`arrowText.updateHoveredAnchor` |
| 链接 hover 装饰 | `element` target 命中链接时 |

这些字段仍是旧镜像，PR6 再决定删除或改为直接读 frame。

### 4.6 非 target 的指针跟随

| 效果 | 处理 |
| --- | --- |
| `createPreview`（创建工具预设预览） | 保持独立；仅在 `mode = "shape"` 且无手势时调用一次 |
| `snapLines` / `originSnapOffset` | 保持独立；在 frame dispatch 之后调用一次；不设置 cursor |
| `multiElement` 预览点 | 由建图 owner 处理，不参与 hover |
| 橡皮擦预览 | `mode = "other"`，保留现有路径 |

它们不是「谁被点击」的候选，禁止注册成 target。

### 4.7 pointerdown 终态

```ts
const frame = resolvePointerFrame(app, { ..., phase: "armed" });
const target = frame.target;

switch (target.kind) {
  case "textHandle":
    if (app.handleTextAutoResizeHandlePointerDown(...)) return;
    break;
  case "containerControl":
    if (target.candidate.gesture === "titleGrip") {
      if (tableController.handleTableTitleGripPointerDown(...)) return;
    }
    if (app.armTableStructureGestureOnPointerDown(...)) return;
    if (app.armFragmentStructureGestureOnPointerDown(...)) return;
    break;
  case "compositeControl":
    // 现状：handleSelectionOnPointerDown 设好 pointerDownState 后返回 false，
    // 外层继续挂监听。迁移时保持「设置状态 + 跳过选择 + 继续收尾」，不能直接 return。
    beginCompositeControlGesture(target);
    skipSelectionDispatch = true;
    break;
  case "transformHandle":
    beginTransformGesture(target);
    return;
  case "linearHandle":
    beginLinearPointGesture(target);
    return;
  case "quickCreateHandle":
  case "activationEdge":
  case "poleActivation":
    // PR4 已处理
    break;
  case "selectedElement":
  case "element":
    // 继续走 handleSelectionOnPointerDown
    break;
  case "canvas":
    // 工具分派
    break;
}

app.handleSelectionOnPointerDown(event, pointerDownState);
```

`skipSelectionDispatch` 为 true 时跳过 `handleSelectionOnPointerDown`，但仍执行后续 mindmap / 工具分派 / `attachPointerSessionListeners`。

`handleSelectionOnPointerDown` 内部删除：

- composite control 分支（[pointerSelection.ts:448–:481](../../packages/excalidraw/components/app/pointerSelection.ts#L448)）；
- transform handle 分支（[:483–:546](../../packages/excalidraw/components/app/pointerSelection.ts#L483)）。

它们改由 target dispatch 进入，逻辑原样保留。

### 4.8 5b：思维导图

`App.mindmap` 当前有 `hoveredNodeId` / `hoveredAddButton`（[App.mindmap.ts:174](../../packages/excalidraw/components/App.mindmap.ts#L174)）与 `handlePointerMove`（[:414](../../packages/excalidraw/components/App.mindmap.ts#L414)）。5b：

- 注册 `mindmapAddButton` provider；
- `mindmapNode` 复用 `element` target；
- 删除 `hoveredNodeId` / `hoveredAddButton` 字段，渲染读 frame；
- `preparePointerDown` 改为 target dispatch；
- `handlePointerMoveFromPointerDown` 保留为 owner 手势。

如 5b 风险过高，可把 mindmap 留到 PR6 之前单独 PR，但 **PR6 不得在 mindmap 仍有平行 hover 字段时宣称完成**。

## 5. 测试

### 5.1 cursor 单写者

```ts
const spy = vi.spyOn(app.cursor, "set");
mouse.moveTo(rectCenter);
expect(spy).toHaveBeenCalledTimes(1);
```

覆盖：画布、普通元素、已选元素、文本元素、链接、view-mode、容器控制区、变换手柄、复合控制点。

### 5.2 优先级矩阵

在 PR2 矩阵上补：

| 场景 | 期望 |
| --- | --- |
| 已选图形变换手柄 + 复合控制点 | `compositeControl` |
| 已选文本自动缩放点 + 变换手柄 | `textHandle` |
| 已选线段端点 + 变换手柄 | `linearHandle` |
| 表格标题 grip | `containerControl`（titleGrip） |
| 已选普通元素覆盖表格轨道 | `selectedElement` |
| 未选普通元素覆盖表格轨道 | `containerControl` |
| 锁定元素 | 不成为 target（保持现有） |

### 5.3 hover = down

每个 kind 先 hover 再 pointerdown，断言 target 深度相等。容器 / 文本 / 线段 / 变换已有的不一致用例必须在此 PR 修掉。

### 5.4 回归

- `interaction-target.test.ts`、`tableStructure.test.tsx`、`mindmap.test.ts`、`contextmenu.test.tsx`、`regressionTests.test.tsx` 全部通过；
- 所有 snapshot 差异逐条审阅，只允许 cursor / hover 清理类修复；
- 触屏 / 触控笔用例保持通过。

## 6. 实施步骤

### 5a 画布核心

- [ ] `applyPointerFrame` 增加全部 target kind 分派（`compositeControl` provider 已在 PR2 注册）。
- [ ] `clearPointerHover` 全量清理。
- [ ] 抽出 `getToolCursor` / `getCursorForPointerTarget`；`applyPointerFrame` 唯一 set。
- [ ] `updateDerivedPointerState` 接管 frame / table cell / hoveredElementIds / arrow text / link hover。
- [ ] pointerCanvas 删除 #1 / #5 / #6 / #11 / #12 / #13 / #14 / #16 的独立入口。
- [ ] pointerSession 改为 target switch；删除 `handleSelectionOnPointerDown` 的 composite / transform 分支。
- [ ] 表格标题 grip 改为 `containerControl` target。
- [ ] 写 §5 测试。
- [ ] 跑全量回归。

### 5b 思维导图

- [ ] `mindmapAddButton` provider。
- [ ] 删除 `hoveredNodeId` / `hoveredAddButton`。
- [ ] `handlePointerMove` / `preparePointerDown` 改为 dispatch。
- [ ] 跑 `mindmap.test.ts`。

## 7. 验收

- [ ] pointermove 只有一个解析入口；无模块在 dispatch 后覆盖 cursor。
- [ ] 每帧 `cursor.set` ≤ 1。
- [ ] `hoveredElementIds` / `frameToHighlight` / `highlightedTableCell` / `transformStatus` 只由 dispatch 写。
- [ ] `handleSelectionOnPointerDown` 不再包含 composite / transform 解析。
- [ ] 所有 target kind 有 hover = down 测试。
- [ ] 全量测试与 typecheck 通过。

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| cursor 语义回归（链接 / embed / view-mode / 文本） | `getElementHoverCursor` 逐条对照现有分支；矩阵测试 |
| 表格标题 grip 迁移 | 先用 target 旁路（保留旧 handler），再删旧入口 |
| 容器 hover 在多选 / 拖拽中残留 | `clearPointerHover` 前置；拖拽 owner 自己维护 |
| mindmap 迁移风险高 | 5b 独立 PR；可延后到 PR6 前 |
| `snapLines` 与 frame 同帧竞争 | 明确它是编辑辅助，不设置 cursor、不参与优先级 |
| 大文件冲突 | 5a / 5b 分开；每类 target 独立 commit |

## 9. 不做

- 不改选择 / 拖拽 / 框选算法。
- 不改 `interaction-target-resolution.md` 的容器 provider 语义。
- 不删除旧镜像字段（PR6）。
- 不把预设预览 / 对齐线做成 target。
