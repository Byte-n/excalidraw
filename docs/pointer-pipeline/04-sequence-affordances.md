# PR4：时序 affordance 迁移（激活条 / 杆 / 方向手柄）

> **状态**：未开始。
> **依赖**：PR2（帧契约）。若 PR3 已合入，预览与落点可直接复用 `connection` hit。
> **交付后的结果**：激活条连接点、杆上建条预演、方向手柄的 hover / armed / gesture 全部由 `PointerFrame` 驱动；`AppQuickCreate` 只保留几何构造、渲染缓存、异步待决与执行逻辑。
> **设计来源**：[pointer-affordance-unification.md](../pointer-affordance-unification.md) 阶段 1–3、[sequence-diagram/03-messages-and-activation.md](../sequence-diagram/03-messages-and-activation.md)。

## 1. 目标

| # | 目标 | 验收 |
| --- | --- | --- |
| G1 | `quickCreateHandle` / `activationEdge` / `poleActivation` 由 frame 解析 | 三个 provider 注册，hover / down 同源 |
| G2 | 手势 owner 由 target kind 决定，不再靠 `preparePointerDown` 的尝试顺序 | pointerdown 只有一个 switch |
| G3 | 预演可见 ⇔ 操作合法 | 预演 / 点击 / 拖拽共用 target payload |
| G4 | 删除 `hovered` / `poleActivation` / `sequenceConnection` / `poleActivationClick` / `drag` / `sequenceConnectionDrag` 状态 | `AppQuickCreate` 字段表只剩缓存 / 待决 / 输入 |
| G5 | 渲染器只读 frame + 缓存 | 不再读 `getHovered()` 等 hover 字段 |

## 2. 非目标

- 不迁移普通元素 hover / transform / container（PR5）。
- 不删除 `suggestedBinding`（PR6）。
- 不改连接几何（PR3）。
- 不改杆上激活条的创建 / 消息创建算法，只改状态组织。
- 不合并 `findSequenceActivationSnap`（激活条拖动吸附到杆）。

## 3. 现状

### 3.1 平行字段

[App.quickCreate.ts:320](../../packages/excalidraw/components/App.quickCreate.ts#L320) 起：

| 字段 | 行 | 用途 |
| --- | --- | --- |
| `hovered` | :320 | 方向手柄悬停 |
| `poleActivation` | :326 | 杆上建条悬停预演 |
| `poleActivationGhost` | :329 | 杆预演缓存 |
| `poleActivationClick` | :335 | 杆上按下的待决点击 |
| `sequenceConnection` | :338 | 激活条连接点悬停 |
| `sequenceConnectionDrag` | :341 | 连接点拖拽手势 |
| `sequenceConnectionGhost` | :344 | 连接线预演缓存 |
| `sequenceEndpointPreview` | :353 | 端点拖拽的杆上建条预演 |
| `drag` | :356 | 方向手柄拖拽手势 |
| `cancelledPointerDown` | :362 | Esc 取消 |
| `modifierHeld` | :371 | 修饰键 |
| `ghost` | :379 | 方向手柄预演缓存 |
| `pendingInsert` | :389 | 插入面板待决 |
| `pendingGhost` | :392 | 待决连线预演缓存 |

### 3.2 入口

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 悬停解析 | [App.quickCreate.ts:850](../../packages/excalidraw/components/App.quickCreate.ts#L850) | 手柄命中 → 杆预演 → 连接点；最后写 cursor |
| 按下解析 | [App.quickCreate.ts:1522](../../packages/excalidraw/components/App.quickCreate.ts#L1522) | `preparePointerDown` 依次尝试手柄 / 连接点 / 杆点击 |
| 拖拽移动 | [pointerSession.ts:1242](../../packages/excalidraw/components/app/pointerSession.ts#L1242) | `handlePointerMoveFromPointerDown` |
| 抬起 | [App.quickCreate.ts:1700](../../packages/excalidraw/components/App.quickCreate.ts#L1700) | 三分支：点击 / 连线 / 插入面板 |
| 渲染 | [interactiveScene.ts:4304](../../packages/excalidraw/renderer/interactiveScene.ts#L4304)、`:4396`、`:4398` | 手柄 / 杆预演 / 连接线 |

### 3.3 现有让位规则

- 变换手柄 / 复合控制点压制方向手柄、连接点、杆预演（[App.quickCreate.ts:1038](../../packages/excalidraw/components/App.quickCreate.ts#L1038)）；
- 方向手柄压制连接点 / 杆预演（`suppressed` 参数）；
- 连接点压制杆预演（[App.quickCreate.ts:926](../../packages/excalidraw/components/App.quickCreate.ts#L926)）；
- 杆预演要求严格最上层是生命线杆（[App.quickCreate.ts:1076](../../packages/excalidraw/components/App.quickCreate.ts#L1076)）；
- 连接点当前扫描所有激活条，**没有严格最上层检查**——PR4 补上，属于预期修复。

## 4. 设计

### 4.0 模块划分

```text
components/app/pointerQuickCreate.ts
  quickCreateHandle provider
  isBlockedByElementAt / getStrictTopmostElementAt（从 App.quickCreate 迁出）

components/app/pointerSequence.ts
  activationEdge provider
  poleActivation provider
  resolveSequenceConnection / resolvePoleActivationTarget / 落位几何

components/App.quickCreate.ts
  保留：ghost 缓存、pendingInsert、modifierHeld、cancelledPointerDown、
        createConnectedShape / createConnectorOnly / createSequenceMessage /
        createPoleActivation / openInsertMenu
  删除：所有 hover / armed / gesture 状态字段
```

`getStrictTopmostElementAt` / `isBlockedByElementAt` 目前是 `App.quickCreate` 的私有方法（[App.quickCreate.ts:957](../../packages/excalidraw/components/App.quickCreate.ts#L957)、`:1852`）。provider 不应反向依赖类实例，迁移时把它们改成模块级纯函数或 provider 私有 helper。

### 4.1 Provider

| kind | provider 输入 | payload | 适用条件 |
| --- | --- | --- | --- |
| `quickCreateHandle` | 单一选中图形 + 四向手柄命中 | `{ elementId, direction }` | 选择工具、非只读、非编辑文本、指针下没有别的元素 |
| `activationEdge` | 指针靠近激活条左 / 右竖边 | `{ elementId, side, point }` | 选择工具、非只读、非编辑文本、指针未被手柄 / 复合控制点占用、严格最上层是该激活条 |
| `poleActivation` | 严格最上层是生命线杆 | `{ lifelineId, placement }` | 选择工具、非只读、非编辑文本、指针未被手柄 / 复合控制点占用、候选不与已有激活条重叠 |

三个 provider 都是**纯读**：只做命中与几何合法性，不写 hover / cursor / repaint。

### 4.2 Frame 扩展

PR2 的 `PointerFrame` 增加 `origin`（armed / gesture 用）：

```ts
type PointerFrame = {
  phase: "hover" | "armed" | "gesture" | "pending";
  point: GlobalPoint;
  /** pointerdown 的起点；hover / pending 时为空 */
  origin?: GlobalPoint;
  target: PointerTarget;
  pointerType: "mouse" | "touch" | "pen";
  owner?: GestureOwner;
};
```

`owner` 扩展：

```ts
type GestureOwner =
  | "selection"
  | "container"
  | "transform"
  | "text"
  | "linear"
  | "quickCreate"
  | "sequenceMessage";
```

### 4.3 pointerdown 分派

把 [pointerSession.ts:785–:788](../../packages/excalidraw/components/app/pointerSession.ts#L785) 的 `app.quickCreate.preparePointerDown` 替换为按 target kind 分派。

分派前守卫（与原 `preparePointerDown` 一致，[App.quickCreate.ts:1522](../../packages/excalidraw/components/App.quickCreate.ts#L1522)）：

- `event.button !== 0`、带 Shift / Ctrl / Meta / Alt、只读、编辑文本、`pendingInsert` 存在时，不进入 `quickCreateHandle` / `activationEdge` / `poleActivation` 分支，按选择路径处理；
- frame 使用本次 pointerdown 在 [pointerSession.ts:672](../../packages/excalidraw/components/app/pointerSession.ts#L672) 解析出的 `phase = "armed"` 结果，不读上一次 hover 的 frame。

```ts
const frame = app.pointer.getFrame()!; // phase = "armed"，由 pointerdown 解析
switch (frame.target.kind) {
  case "quickCreateHandle":
    if (app.quickCreate.startHandleGesture(frame, pointerDownState, event)) {
      attachPointerSessionListeners(app, event, pointerDownState);
      return;
    }
    break;

  case "activationEdge":
    if (app.quickCreate.startMessageGesture(frame, pointerDownState, event)) {
      attachPointerSessionListeners(app, event, pointerDownState);
      return;
    }
    break;

  case "poleActivation":
    // 只臂化，不吞手势：拖拽仍归选择（拖生命线）
    app.quickCreate.armPoleClick(frame, pointerDownState);
    break;

  default:
    break;
}

// 继续走 handleSelectionOnPointerDown
```

规则：

- `quickCreateHandle` / `activationEdge`：owner 独占，设置 `phase = "gesture"`、`owner` 对应值，`pointerDownState.drag.blockDragging = true`；
- `poleActivation`：`phase = "armed"`、`owner = "selection"`；不吞手势；越过 `DRAGGING_THRESHOLD` 后丢弃这次臂化（与当前 pointerup 的距离判定等价）；
- 其余 target 继续原选择路径。

`ArmPoleClick` 不再需要独立字段：`frame.origin` 就是按下点，`frame.target.placement` 就是预演位置；指针抬起时比较 `frame.point` 与 `frame.origin` 的距离即可判定点击 / 拖拽。

### 4.4 手势移动

[pointerSession.ts:1242–:1250](../../packages/excalidraw/components/app/pointerSession.ts#L1242) 改为按 owner 分派：

```ts
const frame = app.pointer.getFrame();
if (frame?.owner && app.quickCreate.ownsGesture(frame)) {
  if (app.quickCreate.handleGestureMove(frame, pointerCoords)) {
    return;
  }
}
```

`handleGestureMove`：

| owner | 行为 |
| --- | --- |
| `quickCreate` | 更新 `frame.point`；`moved = distance(origin, point) * zoom >= DRAGGING_THRESHOLD`；更新 ghost |
| `sequenceMessage` | 更新 `frame.point`；重算消息落位 / ghost；更新 drop point |
| 其他 | 不处理 |

`owner = linear` 属于既有箭头端点拖拽，由 `LinearElementEditor` 处理（PR3 已接入 `constrainSequenceMessageEndpoint`）；它只更新 frame 的 `point / target`，不经过 `AppQuickCreate`。

`phase = armed` 且 `target.kind = "poleActivation"` 时：越过阈值 → 丢弃臂化（frame 回到 `hover` 或清空），owner 仍是 `selection`，不创建。

`DRAGGING_THRESHOLD` 从 `App.quickCreate` 移到 `pointerFrame.ts`（屏幕 px 常量），由 frame 计算 `moved`。

### 4.5 pointerup

调用点在 [pointerSession.ts:2415](../../packages/excalidraw/components/app/pointerSession.ts#L2415)，签名改为接收 frame。按 owner / phase 分派：

| 状态 | 行为 |
| --- | --- |
| `owner = quickCreate`，未过阈值 | `createConnectedShape`（现状） |
| `owner = quickCreate`，过阈值 + 指针下有可绑定图形 | `createConnectorOnly`（现状） |
| `owner = quickCreate`，过阈值 + 空白 | `openInsertMenu`（现状；frame 进入 `phase = "pending"`、`target = canvas`） |
| `owner = sequenceMessage`，过阈值 | `createSequenceMessage`（现状） |
| `owner = sequenceMessage`，未过阈值 | 不创建（现状） |
| `phase = armed`，target = `poleActivation`，未过阈值 | `createPoleActivation`（现状） |
| 其他 | 交回选择路径 |

创建完成后 `frame = null`，`repaint.request()`。

### 4.6 状态处置

| 字段 | 处置 |
| --- | --- |
| `hovered` | 删除；渲染读 `frame.target.kind === "quickCreateHandle"` |
| `poleActivation` | 删除；渲染读 `frame.target.kind === "poleActivation"` |
| `sequenceConnection` | 删除；渲染读 `frame.target.kind === "activationEdge"` |
| `poleActivationClick` | 删除；用 `phase = armed` + `origin` + distance |
| `drag` | 删除；方向 / origin / moved 来自 frame |
| `sequenceConnectionDrag` | 删除；side / source / origin / moved 来自 frame + target |
| `poleActivationGhost` | 保留为渲染缓存，key = `(lifelineId, localY, angle, version)` |
| `sequenceConnectionGhost` | 保留为渲染缓存，key = `(sourceId, side, pointer, placement)` |
| `sequenceEndpointPreview` | 保留为渲染缓存；target 为 `poleActivation`，owner = `linear`（既有箭头端点拖拽） |
| `ghost` | 保留为渲染缓存，key = `(elementId, direction, pointerStyle)` |
| `pendingGhost` | 保留 |
| `cancelledPointerDown` | 保留（Esc 取消） |
| `modifierHeld` | 保留（输入状态） |
| `pendingInsert` | 保留（异步待决）；panel 打开时 frame 为 `phase = "pending"`、`target = canvas`，不在画布上再解析 hover |

`AppQuickCreate` 的公开 getter 收敛：

- 删除 `getHovered()` / `getSequenceConnectionHover()`；
- ghost getter 改为接收 frame / target：`getPoleActivationGhostElements(frame)`、`getSequenceConnectionGhostElements(frame)`、`getGhostElements(frame)`（缓存 key 在 getter 内维护）；
- 保留 drop point / pending 相关 getter；
- 新增 `ownsGesture(frame)` / `handleGestureMove(frame, point)` / `handlePointerUp(frame, ...)`；
- 删除 `handlePointerMove`（悬停解析归 provider）与 `handlePointerMoveFromPointerDown`（改名/改签名为 `handleGestureMove`）。

### 4.7 渲染

| 位置 | 改动 |
| --- | --- |
| [interactiveScene.ts:4304](../../packages/excalidraw/renderer/interactiveScene.ts#L4304) | `renderQuickCreateHandles` 接收 frame；悬停档 / 按下档由 `frame.target.kind === "quickCreateHandle"` 与 `phase` 决定 |
| [interactiveScene.ts:4396](../../packages/excalidraw/renderer/interactiveScene.ts#L4396) | 杆预演读 `frame.target.kind === "poleActivation"`；元素来自 ghost 缓存 |
| [interactiveScene.ts:4398](../../packages/excalidraw/renderer/interactiveScene.ts#L4398) | 连接线读 `frame.target.kind === "activationEdge"` 或 `owner === "sequenceMessage"`；drop point 来自 target payload / hit |
| [interactiveScene.ts:1452](../../packages/excalidraw/renderer/interactiveScene.ts#L1452) | 手柄字形只读 frame，不再 `getHovered()` |

渲染器不得再调用 `resolveSequenceConnection` / `resolvePoleActivationTarget` 重算；这些只在 provider 里跑。

### 4.8 严格最上层

- `poleActivation`：沿用 `getStrictTopmostElementAt`（[App.quickCreate.ts:957](../../packages/excalidraw/components/App.quickCreate.ts#L957)）；
- `activationEdge`：新增严格最上层检查——指针下最上层必须是该激活条，或该激活条就是最上层的可交互元素；不得穿过压在上面的其它元素显示连接点；
- `quickCreateHandle`：沿用 `isBlockedByElementAt`（[App.quickCreate.ts:1852](../../packages/excalidraw/components/App.quickCreate.ts#L1852)）。

## 5. 测试

### 5.1 优先级矩阵

构造同一坐标同时命中多个候选：

| 场景 | 期望 |
| --- | --- |
| 选中图形的变换手柄 + 方向手柄热区 | `transformHandle` |
| 复合控制点 + 方向手柄热区 | `compositeControl` |
| 方向手柄 + 杆预演 | `quickCreateHandle` |
| 激活条连接点 + 杆预演 | `activationEdge` |
| 激活条被其它元素压住 | 不出现 `activationEdge` |
| 杆上有已有激活条 | `poleActivation` 为 null |
| 指针下有其它元素 | `quickCreateHandle` / `poleActivation` 为 null |

### 5.2 hover = down

- 悬停连接点 → pointerdown 进入 `sequenceMessage` owner；
- 悬停杆 → pointerdown 臂化 `poleActivation`；
- 悬停方向手柄 → pointerdown 进入 `quickCreate` owner；
- 三者与旧路径的创建结果一致。

### 5.3 预演 = 合法

- 杆预演可见 ⇒ 单击创建成功且几何一致；
- 杆预演可见 ⇒ 不同时出现连接点 / 方向手柄；
- 激活条连接点可见 ⇒ 拖拽创建的消息起点与圆点一致；
- 候选激活条与已有条重叠 ⇒ 不预演。

### 5.4 手势

- 方向手柄：未过阈值点击 = 旧行为；过阈值 + 可绑定目标 = 连线；空白 = 插入面板；
- 连接点：未过阈值不创建；过阈值创建消息；
- 杆：未过阈值点击创建；过阈值拖动生命线，不创建。

### 5.5 回归

`quickCreateHandles.test.tsx`、`sequenceShape.test.ts`、`history.test.tsx` 中相关用例保持通过；Esc 取消、触屏 / 触控笔、只读、多选门控不变。

## 6. 实施步骤

- [ ] 在 `pointerFrame.ts` 增加 `origin`、`owner` 扩展与 `DRAGGING_THRESHOLD`。
- [ ] 实现三个 provider：`pointerQuickCreate.ts` / `pointerSequence.ts`。
- [ ] `applyPointerFrame` 增加三个 kind 的 hover 分派（只写 frame / ghost，不写旧字段）。
- [ ] 改 `pointerSession.ts` 的 pointerdown 为 target switch。
- [ ] 改 `pointerSession.ts` 的 drag move 为 owner 分派。
- [ ] 改 `App.quickCreate`：删除 §4.6 的状态字段，保留 ghost / pending / modifier；公开 `startHandleGesture` / `startMessageGesture` / `armPoleClick` / `ownsGesture` / `handleGestureMove` / `handlePointerUp`。
- [ ] 改 `interactiveScene.ts` 三处渲染读 frame。
- [ ] 补严格最上层检查（activationEdge）。
- [ ] 写 §5 测试。
- [ ] 跑 `yarn workspace excalidraw test` / `typecheck`；更新 `quickCreateHandles.test.tsx` 的快照（如有）。

## 7. 验收

- [ ] `App.quickCreate` 不再有 `hovered` / `poleActivation` / `sequenceConnection` / `poleActivationClick` / `drag` / `sequenceConnectionDrag`。
- [ ] pointerdown 不再调用 `preparePointerDown` 做多路尝试。
- [ ] 渲染器不再读 hover 字段。
- [ ] 三个 kind 的 hover / down 一致性测试通过。
- [ ] 现有 quick-create / 时序测试通过。
- [ ] `cursor` 只在 `applyPointerFrame` 或 owner 手势中设置（PR5 收口为唯一写者）。

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| `poleActivation` 不独占手势，容易误判 owner | 明确 `phase = armed` + owner = selection；越过阈值丢弃臂化 |
| 连接点严格最上层引入行为变化 | 单独用例；如影响现有条上手柄交互，先保持「激活条自身优先」再评审 |
| ghost 缓存 key 漏字段导致预演不更新 | key 包含 element version / placement / pointer；单测覆盖 |
| `pendingInsert` 与 frame 冲突 | panel 打开时 frame 清空；提交 / 取消后重新解析 |
| 触屏 / 触控笔阈值差异 | 复用 `DRAGGING_THRESHOLD` 与 pointerType；补触摸用例（若现有测试支持） |

## 9. 不做

- 不迁移普通元素 hover / transform（PR5）。
- 不删除 `suggestedBinding`（PR6）。
- 不改消息线型、自消息折点、杆端夹取算法。
- 不改激活条拖动吸附到杆（`findSequenceActivationSnap`）。
