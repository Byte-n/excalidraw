# 指针 affordance 统一：手势事件与渲染状态组织

> **优先级：高**。本文是重构目标与迁移计划；阶段 0（止血）已按文中三条不变量落地，见「阶段 0」一节。

## 1. 背景

`docs/interaction-target-resolution.md` 已经为**容器控件**（表格轨道、插入点、画框边框）建立了统一目标解析。但那套解析**没有覆盖**后来新增的几类画布 affordance：

- quick-create 方向手柄（`App.quickCreate.ts`）
- 生命线杆上的激活条预演 / 单击创建（`App.quickCreate.ts`）
- 复合图形控制点（`components/app/compositeShapeControls.ts`）
- mindmap 折叠 / 「+」按钮（`App.mindmap.ts`）
- 文本 / 线段 / 变换手柄（部分在 `resolveInteractionTarget`，部分散落在 `pointerCanvas.ts`、`pointerSelection.ts`）

这些模块各自做命中、各自维护 hover 字段、各自写 `cursor`，互斥靠调用顺序和注释。结果是同一根指针可能被多套状态机同时认领，产生「悬停目标 ≠ 按下目标」「两套交互同帧出现」「预演压在已有元素上」等问题。

最近的一个具体案例：生命线杆上已有激活条时，指针落在激活条底边的缩放热区，会同时

- 显示激活条的选中框 / 变换手柄读数；
- 显示「杆上单击创建激活条」的半透明预演，且预演叠在已有条上。

根因是三条不变量缺失，详见 §2。

## 2. 三条不变量

| # | 不变量 | 说明 |
| --- | --- | --- |
| I1 | **可见即命中** | 同一坐标 hover 展示的目标 = pointer-down 响应的目标；同一帧最多一个 affordance owner |
| I2 | **可见即可创建** | 预演可见 ⇔ 该落点通过几何合法性校验（例如不与已有激活条相交），不允许「先画出来再藏」 |
| I3 | **严格最上层** | affordance 解析不能使用 `getElementAtPosition` 的「选中包围盒 + 穿透下层」回退；它面向选择交互，不是 affordance 命中 |

### I3 的具体陷阱

`components/app/hitTest.ts`：

- `hitElement` 对选中元素先用完整容差做包围盒命中（`hitTest.ts:75-82`）；
- `getElementAtPosition` 对最上层用**一半容差**重测，失败则返回 `allHitElements[last - 1]`（`hitTest.ts:198-217`）。

因此指针落在选中元素边缘外的一圈时，函数会返回**压在它下面的元素**。杆、激活条恰好上下叠放，于是「点在缩放手柄上」被解析成「点在杆上」。正确做法是用 `getElementsAtPosition()` 的最后一个元素，或新增专门的 strict hit API。

## 3. 目标架构

### 3.1 单向数据流

```text
raw pointer event
      │
      ▼
resolvePointerTarget(app, point, phase)   ← 纯读：命中 + 优先级 + 几何合法性
      │
      ▼
applyPointerTarget(target, phase)         ← 唯一写：hover 状态 / cursor
      │
      ├──► PointerState（单一 owner / 阶段）
      │
      └──► renderer（只读同一份 target 决定画什么）
```

### 3.2 目标模型

在现有 `InteractionTarget`（`components/app/interactionTarget.ts`）上扩展：

```ts
type PointerTarget =
  | {
      kind: "compositeControl";
      elementId: string;
      point: CompositeControlPoint;
    }
  | {
      kind: "quickCreateHandle";
      elementId: string;
      direction: QuickCreateDirection;
    }
  | { kind: "transformHandle"; elementId: string; handle: TransformHandleType }
  | { kind: "selectedElement"; elementId: string }
  | { kind: "containerControl"; containerId: string; control: ContainerControl }
  | { kind: "activationBody"; elementId: string }
  | {
      kind: "poleActivation";
      lifelineId: string;
      placement: ActivationPlacement;
    }
  | { kind: "lifelineBody"; elementId: string }
  | { kind: "element"; elementId: string }
  | { kind: "canvas" };
```

解析器职责：

1. 按优先级表依次检查，命中即返回唯一目标；
2. 几何合法性在解析阶段完成（`poleActivation` 只有在 `resolveSequenceActivationPlacement` 返回 `free` 时才存在）；
3. 目标里直接携带渲染所需数据（预演中心、手柄方向、cursor），渲染层不再二次计算。

### 3.3 优先级表

与 `interaction-target-resolution.md` §优先级合并，扩展为：

```text
进行中的手势
> 文本编辑控制点
> 线段 / 箭头控制点
> 复合图形控制点（含 P2 杆底控制点）
> quick-create 方向手柄（同区域按圆心距离决胜）
> 已选元素变换手柄
> 已选元素主体
> 已选容器控制区
> 未选容器控制区
> 杆上创建预演
> 未选元素（激活条 / 生命线 / 普通图形）
> 容器主体
> 画布
```

新增 affordance = 在表里插一行 + 注册 provider，不在 `pointerCanvas.ts` 里追加提前 `return`。

### 3.4 手势状态机

```ts
type PointerState =
  | { phase: "idle" }
  | { phase: "hover"; target: PointerTarget }
  | { phase: "armed"; target: PointerTarget; origin: Point } // down，未过阈值
  | { phase: "gesture"; owner: GestureOwner; target: PointerTarget }
  | { phase: "pending" /* 插入面板等异步待决 */ };
```

规则：

- **pointerdown 只解析一次**，按 target kind 分发给 owner，`return` 只属于 owner；
- pointermove / up 只由 owner 处理，其他模块在手势期间不再解析；
- `armed` 统一承载「点击 vs 拖拽」判定（现在的 `poleActivationClick` 属于这一阶段）；
- 每帧先清旧 hover 再写新 hover，禁止残留。

### 3.5 渲染状态：派生，不并行维护

`AppQuickCreate` 目前有 `hovered`、`hoveredHandleTargetId`、`poleActivation`、 `poleActivationGhost`、`activationGhost`、`drag`、`pendingInsert` 七份平行状态， `interactiveScene.ts` 分别读取、分别绘制：

- `renderQuickCreateHandles`（`interactiveScene.ts:1391`）
- `renderPoleActivationGhost`（`interactiveScene.ts:4003`）

目标形态：

```ts
interface PointerAffordanceState {
  target: PointerTarget | null;
  phase: "hover" | "armed" | "gesture";
}
```

渲染层只做 `switch (target?.kind)`；预演几何直接取 `target.placement`；选择框与 hover affordance 分离（选择框可常驻，hover affordance 每帧最多一个）。

### 3.6 几何约束前置

- 放在 `packages/element` 的纯函数里（例如 `packages/element/src/sequenceActivation.ts`）；
- 合法性是返回值的一部分（`blocked` 而不是 `null` + 注释），调用方无法绕过；
- 属性测试表达 I2：**对任意指针路径，预演可见 ⇒ 落点合法**。

## 4. 当前差距（排期用）

| 差距 | 位置 |
| --- | --- |
| 统一解析器只覆盖容器目标 | `pointerCanvas.ts:842` 之后仍走 legacy 流程 |
| 各 affordance 独立抢 cursor | `pointerCanvas.ts:791`（quickCreate）、`:815`（mindmap）、`:1153`（composite control）、`:1190`（transform handles） |
| pointerdown 由多个模块依次尝试 | `pointerSession.ts:651`（容器）→ `:719`（quickCreate）→ `pointerSelection.ts:459`（composite control） |
| hover 状态分散 | `App.quickCreate.ts` 的平行字段；`App.mindmap.ts` 的 `hoveredNodeId/hoveredAddButton`；`appState.tableStructureHover` 等 |
| 渲染不派生 | `interactiveScene.ts:1391` 与 `:4003` 独立判断 |
| 命中语义混用 | `getElementAtPosition` 被 affordance 代码当「最上层」用 |

## 5. 迁移计划

### 阶段 0：止血（已完成）

只修本次问题，不改变架构：

1. **严格最上层**：杆预演 / 单击 / 拖拽落点改用 `getElementsAtPosition()` 的最后一个元素，不再走 `getElementAtPosition` 的包围盒回退（I3）；
2. **合法落位**：候选激活条与同杆已有条按本地坐标区间比较，留 `SEQUENCE_MIN_ACTIVATION_OFFSET` 间隙，相交则不预演、不创建（I2）；
3. **互斥**：指针已被方向手柄、变换手柄或复合控制点占用时，不解析杆预演、不臂化杆点击（I1）；
4. hover / click / drag-drop 共用 `resolvePoleActivationTarget`。

回归测试见 `packages/excalidraw/_tests_/quickCreateHandles.test.tsx` （「selected activation's resize handle」/「would overlap」/「click on the resize handle」三例）。

### 阶段 1：时序图 / quick-create 范围统一（建议随 P3 一起做）

| 文件 | 改什么 | 规模 |
| --- | --- | --- |
| `components/app/interactionTarget.ts` | 增加 `quickCreateHandle`、`poleActivation`、`activationBody`、`compositeControl` 四类 target | +150–250 |
| `components/app/pointerCanvas.ts` | quick-create / 复合控制点 hover、cursor 改为 target dispatch | −100 / +150 |
| `components/app/pointerSession.ts` | pointerdown 按 target kind 分发，删除 `preparePointerDown` 的提前 return 语义 | +100–200 |
| `App.quickCreate.ts` | 拆分「解析」与「执行」；删除 hover / cursor 字段 | ~400–700 |
| `renderer/interactiveScene.ts` | 手柄 / 预演渲染从统一 target 派生 | ~100–200 |
| 测试 | 优先级矩阵 + hover/down 一致性 | +300–500 |

完成标准：同一坐标 hover 与 pointerdown 解析结果相同（与 `interaction-target-resolution.md` §验收标准一致）。

### 阶段 2：其余 affordance 收口

mindmap、文本 / 线段 / 变换手柄逐类改 provider；所有 cursor 只在 dispatch 阶段设置。

### 阶段 3：单一状态

删除 `App.quickCreate` / `App.mindmap` 的平行 hover 字段，渲染完全从 `PointerAffordanceState` 派生。

## 6. 测试策略

- **优先级矩阵测试**：构造「位置 × 场景状态 → 期望 target」表，先写测试再改实现；
- **一致性测试**：同一坐标先 hover 再 pointerdown，断言目标相同；
- **性质测试**：沿杆扫描，断言 `预演可见 ⇒ 单击成功且几何一致`、 `预演可见 ⇒ 不同时存在其他 affordance`、`新建条与已有条不重叠`；
- **几何单测**：占位解析的 gap / 旋转 / 杆太短 / 多段空位边界。

## 7. 风险控制

- **影子模式**：迁移某类 affordance 时新旧流程并行计算，开发环境断言 target 一致，不一致回退旧路径；稳定后切主路径。
- **分批交付**：阶段 1 只覆盖时序图相关 affordance，`App.mindmap` 等继续走旧路径。
- **回归重点**：cursor 语义、触屏 / 触控笔、表格级联、文本编辑中的门控、多选与组选、只读 / 锁定。
