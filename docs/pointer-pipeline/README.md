# 指针交互管线与连接吸附：执行计划

> **状态**：计划稿，尚未开始实施。
> **基准**：`feat/sequence-diagram-p1-p2` @ `cbfe0fdc`（2026-11-13）。文中 `file:line` 均以此提交为准。
> **适用范围**：画布指针的 hover / 按下 / 拖拽目标解析、连接点与落点几何、预览绘制、hover 状态组织。
> **文档关系**：本文档是执行入口；[connection-snap-pipeline.md](../connection-snap-pipeline.md)、[pointer-affordance-unification.md](../pointer-affordance-unification.md)、[interaction-target-resolution.md](../interaction-target-resolution.md) 作为设计与现状参考。若执行细节与旧文档冲突，以本目录下的 PR 文档为准。

## 1. 目标

把「这一帧指针在响应谁」收敛为一条管线：

```text
raw pointer event
      │
      ▼
PointerFrame  ← 每帧唯一解析结果：point / phase / target / pointerType
      │
      ├──► applyPointerFrame   ← 唯一写入：cursor、hover 状态、手势 owner
      │
      └──► renderer            ← 只读同一份 frame 决定画什么
```

连接点与吸附不是独立子系统，而是：

- `PointerTarget` 的一个 kind（`connection` / `activationEdge` / `poleActivation`）；
- 一个纯几何求值器（Γ、三档、`ConnectionSpec`）；
- 预览与落点共用同一个 `ConnectionHit`。

### 1.1 交付结果

| # | 结果 | 验收 |
| --- | --- | --- |
| R1 | 同一坐标 hover 与 pointerdown 解析为同一 target | 一致性测试 |
| R2 | 连接预览点 = 松手后的真实落点 | 误差 < 0.01 |
| R3 | 每帧最多一个 affordance owner，cursor 只写一次 | cursor spy 测试 |
| R4 | 预览、hover、cursor 全部从 frame 派生，渲染器不再重算几何 | 代码审查 + grep 约束 |
| R5 | 删除 `suggestedBinding` 与各模块平行 hover 字段 | PR6 grep 验收 |

### 1.2 非目标

- 不新增产品功能；不改变元素 z-index、持久化结构、绑定数据结构。
- 不重写选择、框选、缩放、文本编辑本身的语义。
- 不新增历史数据兼容层（仓库当前没有历史数据）。
- 不把 Canvas 改成 DOM 节点树，也不复用浏览器冒泡决定优先级。
- 不在本计划内开放表格 / fragment 的绑定（沿用 `connection-snap-pipeline.md` §7）。

## 2. 为什么必须按层推进

现状是「同一条指针被多套状态机依次认领」：

| 层 | 现状 | 位置 |
| --- | --- | --- |
| 每帧 hover | 十余个独立入口依次写 hover / cursor | [pointerCanvas.ts:718](../../packages/excalidraw/components/app/pointerCanvas.ts#L718) 起 |
| pointerdown | 至少 8 个模块依次尝试并提前 return | [pointerSession.ts:628](../../packages/excalidraw/components/app/pointerSession.ts#L628) 起 |
| 连接预览 | 多处写 `suggestedBinding`，渲染器再算一遍 | [pointerCanvas.ts:945](../../packages/excalidraw/components/app/pointerCanvas.ts#L945)、[linearElementEditor.ts:2450](../../packages/element/src/linearElementEditor.ts#L2450)、[interactiveScene.ts:3726](../../packages/excalidraw/renderer/interactiveScene.ts#L3726) |
| 时序 affordance | `AppQuickCreate` 十余份平行字段 | [App.quickCreate.ts:320](../../packages/excalidraw/components/App.quickCreate.ts#L320) 起 |
| 渲染 | 每类状态各自读、各自判断 | [interactiveScene.ts:4304](../../packages/excalidraw/renderer/interactiveScene.ts#L4304)、`:4396`、`:4398` |

两个常见后果：

1. **hover 目标 ≠ 按下目标**：hover 由后运行的模块覆盖 cursor，按下却由先运行的模块接管；
2. **两套 affordance 同帧出现**：例如杆上建条预演叠在已有激活条上。

如果先做「连接接入」而不先立帧契约，连接会成为第 7 条并行通道；如果先做「完整指针管线」再碰连接，则长期没有真实消费者，target 分类与优先级容易抽象错。因此按 L0–L6 分层推进。

### 决策记录（2026-11-13）

- **顺序**：连接几何（PR1）→ 指针帧契约（PR2）→ 连接接入（PR3）→ 时序 affordance（PR4）→ 通用 hover（PR5）→ 清理（PR6）。
- **连接几何可以先写**：它是纯函数、零调用方、零行为变更。
- **连接接入不得先于帧契约**：预览、hover、cursor、状态正是帧契约的职责；先接入会新增第 7 条并行通道。
- **帧契约薄层先于完整管线**：只扩展 target 分类、单一状态与 dispatch，不一次性迁移所有 affordance。

## 3. 全局不变量

| # | 不变量 | 落地方式 |
| --- | --- | --- |
| I1 | **可见即命中**：同一坐标 hover 的 target = pointerdown 的 target | 同一个 `resolvePointerFrame`，phase 只改变 `phase` 字段 |
| I2 | **预览即可创建**：预演可见 ⇔ 几何合法（连接点、杆上建条、方向手柄同口径） | 合法性在解析阶段完成，target 携带 payload |
| I3 | **一帧一 target**：每帧最多一个 affordance owner | `applyPointerFrame` 先清理再写入 |
| I4 | **单一写者**：cursor、hover 状态只由 dispatch 写 | 迁移后的模块只提供纯函数与 provider |
| I5 | **解析纯读**：`resolve*` 不写 cursor、不写 app state、不发 repaint | 单测 + 代码审查 |
| I6 | **渲染派生**：渲染器只按 target / hit / phase 画，不重算中点、阈值、锚点 | 删除渲染器内几何计算 |
| I7 | **连接几何无图形分支**：`connection/resolve.ts` 不出现 `is*Element` | grep 测试 |
| I8 | **禁止新增平行 hover 字段**：迁移中的模块不得再加独立 hover / cursor 状态 | PR review 检查项 |

迁移期允许旧字段作为**派生镜像**存在（例如 `suggestedBinding`），但只能由 `applyPointerFrame` 写入，不能由业务模块各自写。PR6 删除镜像。

## 4. 分层与依赖

| 层 | 内容 | 依赖 | 可先行 | 对应 PR |
| --- | --- | --- | --- | --- |
| L0 连接几何 | Γ、三档、`ConnectionSpec`、`resolveConnectionHit`、`pickConnectionTarget` | 仅元素几何（`collision.ts` / `distance.ts` / `compositeShape`） | 是（零调用方） | PR1 |
| L1 连接基线 | 现状落点快照、非用户路径守卫 | 现有 App / 测试助手 | 是 | PR1 |
| L2 帧契约 | `PointerTarget` / `PointerFrame` / `AppPointerState` / `applyPointerFrame` | 扩展现有 `resolveInteractionTarget` | 必须先于接入 | PR2 |
| L3 连接接入 | 预览、落点、`suggestedBinding` 派生 | L0 + L2 | 等 PR1 / PR2 | PR3 |
| L4 时序 affordance | pole / activation edge / quick-create 手柄 | L2 | 等 PR2 | PR4 |
| L5 通用 hover | cursor、transform、container、mindmap 等 | L2 | 等 PR2 | PR5 |
| L6 清理 | 删旧字段、旧入口、旧几何函数 | L3 + L4 + L5 | 最后 | PR6 |

关键依赖只有一个方向：

```text
L0 连接几何 ──┐
              ├──► L3 连接接入 ◄── L2 帧契约
L1 基线 ──────┘                         ▲
                                        │
                     L4 时序 affordance ─┤
                     L5 通用 hover ──────┘
                                        │
                                   L6 清理
```

## 5. PR 序列

| PR | 文档 | 交付 | 依赖 | 可独立合入 | 风险 |
| --- | --- | --- | --- | --- | --- |
| PR1 | [01-connection-geometry.md](./01-connection-geometry.md) | 基线快照 + 纯几何模块（无调用方） | 无 | 是 | 低 |
| PR2 | [02-frame-contract.md](./02-frame-contract.md) | 帧契约薄层 + 影子模式 | 无（与 PR1 并行） | 是 | 中 |
| PR3 | [03-connection-integration.md](./03-connection-integration.md) | 连接作为第一个消费者接入；3a 非折线 / 3b 折线 | PR1 + PR2 | 3a / 3b 分开 | 高（3b） |
| PR4 | [04-sequence-affordances.md](./04-sequence-affordances.md) | 激活条连接点 / 杆预演 / 方向手柄迁移 | PR2（PR3 的 hit 可选） | 是 | 中高 |
| PR5 | [05-general-hover.md](./05-general-hover.md) | 通用 hover / cursor / transform / container 收口 | PR2 | 可分 5a/5b | 高 |
| PR6 | [06-cleanup.md](./06-cleanup.md) | 删除旧状态、旧入口、旧几何函数 | PR3–PR5 | 否 | 中 |

执行约定：

- **PR1 必须先合入**：基线快照是 PR3 的行为变更审阅依据。PR2 可与 PR1 并行开发，但 PR3 不得在 PR1 基线合入前开始。
- **PR3a 与 PR4 的交叉**：两者都会触及 `App.quickCreate` 的时序消息分支。若并行开发，PR3a 负责落点改写（03 §4.5），PR4 只改状态组织；合并顺序以 PR3a 优先。
- **每个 PR 内部「解析 + 预览 + 落点」同源**；不允许只改一半。
- **每个 PR 只迁移自己列出的 target kind**，其余继续走 legacy 路径；禁止顺手重构。
- 每个 PR 合入前执行：
  ```bash
  yarn workspace element test
  yarn workspace element typecheck
  yarn workspace excalidraw test
  yarn workspace excalidraw typecheck
  ```
  跨包改动逐个执行；提交前跑 `yarn test:code`。

## 6. 统一模型

### 6.1 Target

在现有 [`InteractionTarget`](../../packages/excalidraw/components/app/interactionTarget.ts#L68) 基础上扩展：

```ts
type PointerTarget =
  | InteractionTarget
  | {
      kind: "connection";
      elementId: string;
      hit: ConnectionHit; // packages/element/src/connection
    }
  | {
      kind: "activationEdge";
      elementId: string;
      side: "left" | "right";
      point: GlobalPoint;
    }
  | {
      kind: "poleActivation";
      lifelineId: string;
      placement: PoleActivationPlacement;
    }
  | {
      kind: "quickCreateHandle";
      elementId: string;
      direction: QuickCreateDirection;
    }
  | {
      kind: "compositeControl";
      elementId: string;
      control: CompositeControlPoint;
    };
```

原则：**target 携带渲染与执行所需的全部数据**。渲染器不得再回到场景里重算预演几何。

### 6.2 Frame 与 State

```ts
type PointerPhase =
  | "hover"
  | "armed"   // pointerdown，尚未超过拖拽阈值
  | "gesture"; // 手势 owner 已确定

type PointerFrame = {
  phase: PointerPhase;
  /** 场景坐标；网格 / Shift / 时序水平约束在解析前处理 */
  point: GlobalPoint;
  target: PointerTarget;
  pointerType: "mouse" | "touch" | "pen";
  /** phase = gesture 时的手势所有者 */
  owner?: GestureOwner;
};
```

`AppPointerState`：

- 持有 `frame: PointerFrame | null`；
- 提供 `getFrame()`、`setFrame()`、`clear()`；
- `setFrame` 做字段级比较，变化时 `repaint.request()`；
- 不放进 `appState`，避免每次 pointermove 触发 React 状态更新；沿用 `AppQuickCreate` 的「组件字段 + 显式 repaint」模式。

### 6.3 解析与分派

```ts
resolvePointerFrame(app, input): PointerFrame   // 纯读
applyPointerFrame(app, frame): void             // 唯一写
```

`applyPointerFrame` 顺序固定：

1. 清理上一帧的 hover 通道（container providers、mindmap、quickCreate、connection、pole）；
2. `switch (frame.target.kind)`：写入该 kind 的 hover / armed / gesture；
3. 最后设置 cursor（每个 target kind 只有一个 cursor 结果）。

不得在 `resolvePointerFrame` 里调用 `app.cursor.set`、`app.setState`、`app.repaint.request`。

### 6.4 优先级（迁移终态）

```text
进行中的手势（owner 固定，不再解析）
> textHandle
> linearHandle
> compositeControl
> transformHandle
> quickCreateHandle（指针下压着别的元素时由解析器返回 null）
> connection（仅箭头工具 / 端点拖拽 / 新建箭头时适用）
> activationEdge
> poleActivation（仅严格最上层是生命线杆时存在）
> selectedElement
> containerControl
> containerBody
> element
> canvas
```

说明：

- 这张表保持 HEAD 的实际让位关系：`quickCreateHandle`、`activationEdge`、`poleActivation` 都被变换手柄 / 复合控制点压制（[App.quickCreate.ts:1040](../../packages/excalidraw/components/App.quickCreate.ts#L1040)）；`activationEdge` 压制 `poleActivation`（[App.quickCreate.ts:926](../../packages/excalidraw/components/App.quickCreate.ts#L926)）。
- `connection` 只在箭头类工具或端点拖拽时参与，此时选择类手柄不参与，因此不与上位冲突。
- 「严格最上层」使用 `getElementsAtPosition()` 的最后一个元素，不用 `getElementAtPosition()` 的包围盒回退（见 [pointer-affordance-unification.md §I3](../pointer-affordance-unification.md)）。

### 6.5 状态归属

| 类别 | 例子 | 归属 | 迁移后 |
| --- | --- | --- | --- |
| 帧状态 | 当前 target / phase / owner | `AppPointerState` | 唯一 hover 真相 |
| 渲染缓存 | `ghost`、`poleActivationGhost`、`sequenceConnectionGhost` | 各模块 / 渲染层 | 保留；按 target key 缓存 |
| 异步待决 | `pendingInsert` | `AppQuickCreate` | 保留；frame phase 可加 `pending` |
| 输入状态 | `modifierHeld` | `AppQuickCreate` / 键盘 | 保留 |
| 旧镜像 | `suggestedBinding`、`hoveredElementIds`、`frameToHighlight`、`tableStructureHover`、`fragmentStructureHover`、`transformStatus.hoveredHandle` | appState / 模块 | 只由 dispatch 写；PR6 删除或改为派生 |
| 编辑辅助 | `snapLines`、`originSnapOffset` | appState | 不参与 target 竞争；由 frame 解析后的同一次 pointermove 维护 |

## 7. 验收矩阵

### 7.1 每个 PR 的共同验收

- [ ] `yarn workspace <pkg> test` 通过；
- [ ] `yarn workspace <pkg> typecheck` 通过；
- [ ] 不新增 cursor 写入点（grep `cursor.set` 审查）；
- [ ] 不新增平行 hover 字段；
- [ ] 迁移的 target kind 有「hover → pointerdown」一致性测试；
- [ ] 渲染器不再为已迁移的 kind 重算几何。

### 7.2 终态验收（PR6）

- [ ] 同一坐标先 hover 再 pointerdown，target 深度相等；
- [ ] 连接预览点与松手落点误差 < 0.01（所有家族 × 三种箭头 × 四种模式）；
- [ ] 每帧 `cursor.set` 调用 ≤ 1；
- [ ] `suggestedBinding` 从 `AppState` 删除，无残留引用；
- [ ] `resolve.ts` 无 `is*Element` 图形判断；
- [ ] 杆上预演可见 ⇒ 单击可创建且几何一致；预演可见 ⇒ 不同时存在其它 affordance；
- [ ] 现有 `sequenceShape.test.ts`、`quickCreateHandles.test.tsx`、`arrowBinding.test.tsx` 保持通过。

## 8. 风险与回滚

| 风险 | 触发点 | 缓解 |
| --- | --- | --- |
| 优先级顺序回归 | PR2 / PR5 | 先写矩阵测试；影子模式逐帧比对；不一致只告警并走旧路径 |
| 折线路由回归 | PR3b | 3b 单独 PR；基线逐条审阅；只允许 `connection-snap-pipeline.md` §2.6 列出的变化 |
| 预览与落点仍分叉 | PR3 | 预览与落点同 PR；`buildConnectionQuery` 唯一构造；幂等性测试 |
| 旧镜像字段被绕过 | PR3–PR5 | 镜像只允许 dispatch 写；grep + review 检查 |
| 大文件冲突 | 全程 | PR 按层切分；每层只动列出的入口；先加后删 |
| 影子模式性能 | PR2 | 只在 dev + 显式开关下运行；生产构建剔除 |

回滚策略：

- PR1 的几何模块在 PR3 前无调用方，可直接回滚；
- PR2 的 frame 只读不接管，回滚不影响行为；
- PR3 起每个 target kind 的迁移独立可回滚；旧路径保留到 PR6；
- PR6 删除前用 grep / typecheck 确认无消费者。

## 9. 文档关系

| 文档 | 角色 | 本计划如何使用 |
| --- | --- | --- |
| [connection-snap-pipeline.md](../connection-snap-pipeline.md) | 落点几何设计（Γ / 三档 / spec） | PR1 实现几何；PR3 接入 |
| [pointer-affordance-unification.md](../pointer-affordance-unification.md) | affordance 目标模型与阶段 0 | PR2 复用 target 思路；PR4 / PR5 执行阶段 1–3 |
| [interaction-target-resolution.md](../interaction-target-resolution.md) | 容器 target 现状 | PR2 把容器 dispatch 并入 `applyPointerFrame` |
| [sequence-diagram/03-messages-and-activation.md](../sequence-diagram/03-messages-and-activation.md) | 时序消息与激活条现状 | PR3 / PR4 的回归基线 |

## 10. 开放项

以下问题在执行中需要拍板，当前计划给的是默认值：

| # | 开放项 | 默认处理 | 何时拍板 |
| --- | --- | --- | --- |
| O1 | PR3 允许的行为变化是否全部接受 | 只接受 `connection-snap-pipeline.md` §2.6 三类 + 折线基线差异 | PR3 合入前 |
| O2 | 3b 折线路由回归超预期时是否分两次开 ①② | 先关 ①② 只跑 ③，再单独开 ①② | 3b 开发中 |
| O3 | `frameToHighlight` / `highlightedTableCell` / `hoveredElementIds` 删除还是保留为派生视图 | 能由 target + point 表达则删；否则保留为 dispatch 写的派生视图 | PR6 前 |
| O4 | 画框标题的 `hoveredElementId`（DOM 桥）是否纳入管线 | 保持现状，不纳入 canvas target | PR5 后评估 |
| O5 | 5b 思维导图是否可与 PR6 并行 | 否；mindmap 仍有平行 hover 字段时 PR6 不算完成 | PR5b 开始前 |

## 11. 执行记录模板

每个 PR 合入后在本目录对应文档末尾追加：

```md
## 实施记录（YYYY-MM-DD）

- 实际改动：
- 与计划的偏差：
- 基线变化：
- 新增/调整测试：
- 遗留问题：
```
