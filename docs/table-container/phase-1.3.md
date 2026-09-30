# P01.3：结构手势 in-flight 视觉通道（containerGestureVisual）

- 状态：设计评审中（未实施）。
- 问题：行列线拖拽调整宽高的过程中高亮中断，只有 hover 时有 accent 高亮线。
- 实现落点（规划）：`packages/excalidraw/types.ts`、`packages/excalidraw/components/app/interactionTarget.ts`、`packages/excalidraw/components/app/table.ts`、`packages/excalidraw/components/app/pointerSession.ts`、`packages/excalidraw/renderer/interactiveScene.ts`。
- 前置：[P01 表格容器](phase-1.md) 的结构手势（grip/insert/resize）与 hover 通道；[统一交互目标解析](../interaction-target-resolution.md) 的 provider 分发。
- 定位：补齐 resize 手势的 in-flight 视觉，并把 "hover 阶段 / 手势阶段" 的视觉生命周期做成对所有容器（表格、画框、mindmap 及后续复合图形）可复用的 provider 契约。

## 问题陈述

行列线的 accent 高亮线只有一处渲染入口：`renderTableStructureHover`（interactiveScene.ts:1368-1426），由 `appState.tableStructureHover` 门控（interactiveScene.ts:2387-2394）——没有 hover 状态就不画线。当前三个手势阶段的能力对比如下：

| 阶段 | reorder（moveRow/moveColumn） | insert | resize |
| --- | --- | --- | --- |
| hover | `tableStructureHover` | 同左 | 同左 |
| 手势 in-flight | `tableStructurePreview`（逐帧写） | 无需（点击提交） | **缺失** |
| 提交判定共享 | 预览 = 落点 | 同左 | — |

resize 高亮中断的根因链（三段叠加，属通道模型缺口而非单点漏写）：

1. **按下瞬间 hover 被两处主动清空**。命中 `rowResize`/`columnResize` 分区时，`armTableStructureGestureOnPointerDown`（table.ts:1551-1595）在 table.ts:1594 执行 `app.setState({ tableStructureHover: null, tableStructurePreview: null })`；随后 `handleCanvasPointerDown`（pointerSession.ts:650-661）调用 `suspendHoverForTableGesture`（pointerSession.ts:307-327），再次清空 hover 并置 `interactionState.isTableGestureActive = true`。用户按住的那条线正是刚才 hover 高亮的那条线，但状态立即归零。
2. **拖动期间两条 move 流都不会重写该状态**。画布常规 move 流在 pointerCanvas.ts:734-736 因 `isTableGestureActive` 短路；手势自身的 move 处理 `handleTableGestureMove`（table.ts:1630-1772，session 侧入口 pointerSession.ts:1085）的 resize 分支（:1665-1761）只做几何 mutate——行高/列宽、成员位置、背景文本 refit——全程不写任何渲染可见状态。
3. **resize 没有对等的 in-flight 通道**。`tableStructureHover` 被定义为 "Hover-only"（types.ts:559-564），`tableStructurePreview` 被定义为 "while a row/column reorder drag is in flight"（types.ts:565-571）——排序拖动有专门的 in-flight 预览通道，resize 没有，渲染层也没有 gesture-active 回退，于是高亮只能依赖 hover，按下即消失，直到释放。

## 用户可见目标

- 按下行列线开始拖动的瞬间，accent 高亮线保持不灭，整条拖动过程持续可见并实时贴合移动中的边界（含最小值钳停位置）。
- 松开或 Esc 后高亮消失：松开时几何已提交（边界成为普通网格线），Esc 时几何从快照恢复，两者都不留视觉残留。
- 拖动过程中的视觉反馈与 hover 一致（本期不做样式区分），指针移出表格边界时线仍画在真实边界上。
- 该机制以容器无关的契约落地：后续画框边框拖拽、mindmap 拖放高亮等按同一契约接入，公共交互代码不出现容器类型特判。

## 行为规格

| 输入 | 行为 |
| --- | --- |
| 在 resize 分区按下（含选中表格 body 上的内侧边条路径） | arm 手势的同时写入 `containerGestureVisual`（表格 resize 线身份），hover/单元格高亮照旧清空 |
| 拖动中（任意指针位置，含移出表格） | 视觉身份不变；高亮线位置每帧由渲染层从 live 表格几何派生，自动跟随边界；状态层零写入 |
| 指针释放且尺寸变化 | 提交几何、清除手势视觉，形成一条历史记录 |
| 指针释放且无尺寸变化 | 清除手势视觉，无历史记录 |
| Esc | 从 arm 快照恢复几何，清除手势视觉，无历史、无残留 |
| 选中表格的框手柄（scale 手势） | 不产 gesture visual——变换手柄有自己的渲染 |
| 手势期间 hover 扫描 | 保持暂停（既有行为不变，`suspendHoverForTableGesture` 语义收窄但暂停判定不变） |

## 技术方案

### 设计原则

1. **hover 与手势是两个生命周期，不得混用一条通道**。`tableStructureHover` 保持 "Hover-only" 语义不变；手势视觉走独立通道。
2. **通道存"身份"，几何走派生**。resize 线在 arm 时刻身份唯一确定（哪张表、哪条行列线、哪条边），拖动期间只有几何在变——身份写一次，位置由渲染层逐帧从 live 元素派生。`renderTableStructureHover` 本就每帧从 `table.table.rows/columns` 重算 offset（`edge: "start"` 时外框边跟随 live 的 `table.x/y`），**绘制函数零改动即可自动跟随拖动**。
3. **公共流程容器无关**。手势视觉的写入/清除通过 provider 契约收口，与 interaction-target-resolution.md 的 provider 方向一致。

### 1. 状态层：一条判别联合通道

`types.ts` 新增：

```ts
/**
 * 手势进行中（in-flight）的结构视觉身份。arm 时刻写入一次，teardown 清除一次；
 * 手势期间身份不变，几何位置一律由渲染层从 live 元素逐帧派生。
 */
export type ContainerGestureVisual =
  | { container: "table"; hover: TableRowColStructureHover } // resize 线身份
  | { container: "frame"; edge: "n" | "s" | "e" | "w" }      // P3 示例：画框边拖拽
  ;
```

AppState 新增 `containerGestureVisual: ContainerGestureVisual | null`，同步加入 `InteractiveCanvasAppState`（types.ts:242-254 区域的字段透传清单）。

采用**判别联合而非 `payload: unknown`**：新增容器 = 新增一个联合成员 + 一个绘制分支，渲染层保持类型安全，并天然对接 interaction-target-resolution.md §状态迁移（:240-257）的长期收敛形态（手势侧对应物）。

`tableStructurePreview`（move 落点线）本期不动：它的语义是 "commit 落点、preview 与 commit 共享计算"，与"视觉身份"职责不同；P2 再反向收编（见"与后续演进的关系"）。

### 2. 契约层：provider 生命周期扩展

`ContainerInteractionProvider`（interactionTarget.ts:42-58）增加两个方法：

```ts
interface ContainerInteractionProvider {
  // …现有 hover 契约不变…

  /**
   * arm 时刻调用一次：把手势 in-flight 视觉写入本容器的通道。
   * 身份必须静态（不得逐帧重写）；几何派生交给渲染层。
   */
  armGestureVisual?(app: PointerApp, gesture: ArmedContainerGesture): void;

  /** teardown 收口：提交 / Esc / 孤儿清理统一调用，幂等。 */
  clearGestureVisual(app: PointerApp): void;
}

type ArmedContainerGesture = {
  containerId: string;
  control: ContainerControl;
  /** containerControl 路径携带 pointer-down 的解析结果；body 路径缺省 */
  candidate?: ContainerInteractionCandidate;
  /** body 路径提供的手势原点，供容器自行再解析 */
  scenePoint?: { x: number; y: number };
};
```

配套公共入口（镜像 `dispatchContainerInteraction` / `clearContainerInteractionHover` 的既有形态，interactionTarget.ts:315-339）：

```ts
export const dispatchContainerGestureVisual = (
  app: PointerApp,
  gesture: ArmedContainerGesture,
): void => { /* 路由到对应 provider 的 armGestureVisual */ };

export const clearContainerGestureVisuals = (app: PointerApp): void => {
  /* 遍历 providers 调 clearGestureVisual，幂等 */
};
```

### 3. 交互层：写入点与收口点

resize 手势有两条 arm 路径：

- **路径 A — `containerControl`**（pointerSession.ts:650-661）：pointer-down 已解析出 candidate（:630-634），arm 成功后调用 `dispatchContainerGestureVisual`，零额外命中计算。
- **路径 B — 选中表格 body**（`targetIsSelectedTableBody`）：此时 `interactionTarget.kind === "selectedElement"` 无 candidate，但 `armTableStructureGestureOnPointerDown` 内部已解析出 `hover` 并据此 arm（table.ts:1448-1456）——由 table 手势控制器在该函数内直接写入，它是唯一知道"arm 出了什么手势"的角色。将 table.ts:1594 的裸清空改为：

```ts
app.setState({
  tableStructureHover: null,
  tableStructurePreview: null,
  // resize 手势：身份静态，整个拖动期不再写状态
  ...(isResizeGesture(hover)
    ? { containerGestureVisual: { container: "table", hover } }
    : {}),
});
```

路径 A 到达的也是同一函数，两条路径实际收敛于同一 setState；路径 A 的 dispatch 作为规范接入点保留，供无内部手势控制器的容器使用。

**teardown 三条收口**（全部调 `clearContainerGestureVisuals`，幂等）：

1. 提交：`finalizeTableGestureOnPointerUp`（table.ts:1908-1919，在既有 setState 批次中追加）；
2. Esc：`cancelTableGesture`（table.ts:1875-1890，几何从快照恢复，视觉同步消失）；
3. 孤儿防御：pointer-up 会话尾部复位 `isTableGestureActive` 处（pointerSession.ts:1969）兜底清一次。

**`suspendHoverForTableGesture`（pointerSession.ts:307-327）职责收窄**：只清 hover 类通道（`tableStructureHover`、`highlightedTableCell`、`hoveredElementIds`），**不得触碰手势视觉通道**——否则又回到"按下即灭"。既有测试 tableStructure.test.tsx:169-208（扫描暂停）不受影响。

### 4. 渲染层：一处合并，零新增绘制函数

interactiveScene.ts:2351-2394：

```ts
const tableVisual =
  appState.tableStructureHover ??
  (appState.containerGestureVisual?.container === "table"
    ? appState.containerGestureVisual.hover
    : null);
```

- `structureTables` 集合：追加 `tableVisual` 对应的表（gesture 表在未选中 + body 路径下也要渲染 affordances）；
- `renderTableStructureAffordances(..., tableVisual)`（:2377-2384）与 `renderTableStructureHover` 门控（:2387-2394）改用 `tableVisual`；
- **绘制函数本身零改动**：`rowResize/columnResize` 分支每帧从 live 表格重算 `offsetAfter` 与 `edge` 偏移，拖动中线自动贴合移动中的边界。

可选打磨（不在本期）：给绘制函数加 `phase: "hover" | "drag"` 参数做样式区分（如 2px → 2.5px），一次参数传递即可。

### 5. 性能设计

写放大分析（整个手势生命周期）：

| 事件 | React setState 次数 | 说明 |
| --- | --- | --- |
| arm | **1** | 与 arm 时的既有清空合并为同一批次 |
| 拖动每帧 | **0** | 身份不变；重绘由既有 `scene.mutateElement(..., { isDragging: true }) + scene.triggerUpdate()` 驱动（现 resize 预览已证明该通道无需 AppState 变更即可逐帧重绘） |
| 提交 / Esc | **1** | 并入 teardown 既有 setState 批次 |

对比"逐帧 setState"方案：拖动 10 秒约 600 次 React 状态写入 → 本方案 2 次。逐帧成本仅为交互画布多描一条 2px accent 线（画布本就在拖动期全量重绘，边际成本可忽略）；零逐帧命中检测（`resolveStructureHover` 一次都不跑）、零逐帧对象分配。

去重语义：resize 身份静态无需去重；P2 收编 move 落点线时沿用 `setTableStructureHover` 式字段级 no-op 检查（table.ts:1190-1206），只在 `boundaryIndex/offset` 变化时写。

## 拒绝的替代方案

| 方案 | 否决原因 |
| --- | --- |
| arm 时不清 hover，冻结至手势结束 | hover 语义被污染（"Hover-only" 注释失效）；需按手势 kind 写特例规则（grip/insert 仍要清）；渲染无法区分 hover/拖拽样式；规则对其它容器不可泛化 |
| 手势 move 分支逐帧写 hover | 逐帧 React 写入，身份明明不变；与"几何派生"原则冲突 |
| 渲染层直读 `pointerDownState.tableGesture` | 渲染层耦合 session 内部态，破坏 `tableStructurePreview` 建立的"in-flight 视觉走 AppState 通道"先例 |
| 给 `tableStructurePreview` 扩 `source: "resize"` | 该通道语义是"commit 落点"（预览 = 提交判定输入），resize 线不是落点；混入导致类型分叉（P2 应反向收编 move 而非混入 resize） |

## 边界与约束

- scale 手势（选中表格框手柄）不产 gesture visual：`maybeArmTableScaleGesture` 的提前返回路径（table.ts:1441-1446）不受影响，变换手柄已有自己的渲染。
- 拖动中指针移出表格：身份静态，线持续画在 live 边界（含最小值钳停位置），符合"边界跟随"预期。
- `editingTableBackgroundText` 门控保持：手势与文本编辑互斥（arm 已守卫），渲染层既有排除逻辑不变。
- 行列 ID 在 resize 手势期间稳定（数组顺序不变、条目不重建），arm 时刻捕获的身份全程有效；P02 合并格改变边界语义时需复核 `edge` 的绘制规则。
- 协作侧广播手势视觉为非目标（与现有多人预览策略一致）。
- 释放后线消失、几何已提交；指针仍在线上时下一次 mousemove 由统一分发恢复 hover，一帧延迟与既有行为一致。

## 与后续演进的关系

- **P2 收编**：`tableStructurePreview`（move 落点线）并入 `{ container: "table", source: "move", ... }` 变体，退役旧字段，表格三条通道（hover / gesture / selection）职责单一；move 的逐帧写保留但加去重。
- **P3 横向扩展**：画框边框拖拽（`frameProvider` 实现 `armGestureVisual` 写 `{ container: "frame", edge }`）、mindmap 拖放目标高亮、后续 composite shape 的结构拖拽按契约接入；公共代码（pointerSession / 渲染门控 / teardown 收口）零改动——这是 provider 契约的验收标准。
- **长期收敛**：与 interaction-target-resolution.md §状态迁移对齐——`interactionTarget` 收敛时，手势侧自然成为 `activeGesture: { target, visual }`，本通道是其直接前身。

## 测试计划

1. **状态生命周期**（tableStructure.test.tsx）：mouseDown 于分隔线 → `containerGestureVisual` 匹配 `{ container: "table", hover: { kind: "rowResize", rowId, edge } }`；两次 mouseMove 后断言对象引用不变（`toBe(before)`，防逐帧写回归）；mouseUp / Esc → `null`（Esc 另断言几何从快照恢复）。
2. **双 arm 路径**：未选中表 containerControl 路径 + 选中表 body 路径（复用 tableStructure.test.tsx:1159-1178 的 `armTableGesture` mock 手法）均写入。
3. **收口幂等**：`clearContainerGestureVisuals` 重复调用无副作用；scale 手势不写通道。
4. **渲染合并**：hover 与 gesture 互斥优先级、structureTables 包含 gesture 表。
5. **回归**：扫描暂停测试（tableStructure.test.tsx:169-208）、move 预览、insert 点击提交全部保持绿。

## 实施顺序

1. 状态层：`ContainerGestureVisual` 联合 + AppState / InteractiveCanvasAppState 字段。
2. 契约层：provider 两方法 + `dispatchContainerGestureVisual` / `clearContainerGestureVisuals`。
3. 交互层：arm 写入（table.ts:1594 改造）、finalize/cancel 接收口、`suspendHoverForTableGesture` 职责收窄、pointer-up 尾部兜底、路径 A dispatch。
4. 渲染层：`tableVisual` 合并 + structureTables 扩展 + 门控替换。
5. 自动化与人工验收；更新 types.ts 通道注释与 interaction-target-resolution.md（增补"手势阶段视觉"章节）；同步 00-overview 能力矩阵。

## 验收清单

- [ ] 未选中表格：hover 行列线高亮 → 按下拖动全程高亮不灭，线实时贴合移动中的边界；释放后线消失、几何提交为一条历史记录。
- [ ] 选中表格 body 内侧边条拖拽首行/首列：同上表现。
- [ ] 拖到最小值钳停：线停在钳停边界，无跳变。
- [ ] Esc：几何从快照恢复、高亮消失，无历史、无状态残留。
- [ ] 拖动期间 hover 扫描保持暂停（cell hover、元素 hover、mindmap hover 均不被触发）；表格以外的行为无变化。
- [ ] 整个手势周期 React setState 恰好 2 次（arm/teardown）；拖动帧无状态写入、无逐帧命中检测。
- [ ] scale 手势、move 预览、insert 提交行为与改造前一致；新增契约对其它容器可用（以一个 frame 或 mindmap 的最小接入用例佐证）。
