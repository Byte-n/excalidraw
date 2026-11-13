# PR2：指针帧契约薄层

> **状态**：未开始。
> **依赖**：无；可与 PR1 并行。PR3 / PR4 / PR5 依赖本 PR。
> **交付后的结果**：每帧指针解析结果落到唯一的 `PointerFrame`；容器 target 的 hover / cursor 已由 `applyPointerFrame` 分派；新 target kind 的 provider 注册口就位，但尚未接管行为。
> **设计来源**：[pointer-affordance-unification.md](../pointer-affordance-unification.md) §3、[interaction-target-resolution.md](../interaction-target-resolution.md)。

## 1. 目标

| # | 目标 | 验收 |
| --- | --- | --- |
| G1 | 定义 `PointerTarget` / `PointerFrame` / `AppPointerState` | 类型通过 typecheck；单测覆盖状态变更 |
| G2 | 每个 pointermove / pointerdown 只解析一次 | 代码中只有一个 `resolvePointerFrame` 入口 |
| G3 | `applyPointerFrame` 成为 cursor / hover 的唯一写者 | 容器 target 的 cursor 只在这里设置 |
| G4 | 固定 target 优先级表，新增 kind 通过 provider 接入 | provider 顺序表 + 矩阵测试 |
| G5 | 影子模式可逐帧比对 frame 与 legacy 状态 | dev 开关打开时输出差异，不影响行为 |

## 2. 非目标

- 不迁移 `quickCreate` / `poleActivation` / `activationEdge` / `connection` 的实际行为（PR3 / PR4）。
- 不改渲染（PR3 / PR4 才让渲染器读 frame）。
- 不删除 `suggestedBinding` 与任何旧 hover 字段。
- 不改选择、框选、文本编辑语义。
- 不改变 pointerdown 的既有分派结果；PR2 只把「解析」与「容器分派」收口。

## 3. 现状

### 3.1 已有 target 解析

[interactionTarget.ts:68](../../packages/excalidraw/components/app/interactionTarget.ts#L68) 的 `InteractionTarget` 已有：

```text
textHandle / linearHandle / transformHandle / selectedElement /
containerControl / element / containerBody / canvas
```

[interactionTarget.ts:223](../../packages/excalidraw/components/app/interactionTarget.ts#L223) 的 `resolveInteractionTarget` 已按「文本手柄 → 线段手柄 → 变换手柄 → 元素 + 容器候选」解析，并在 [pointerSession.ts:672](../../packages/excalidraw/components/app/pointerSession.ts#L672) 与 [pointerCanvas.ts:844](../../packages/excalidraw/components/app/pointerCanvas.ts#L844) 使用。

**这是现成的契约骨架**，PR2 只扩展它，不另起一套。

### 3.2 pointermove 的独立入口

[pointerCanvas.ts:718](../../packages/excalidraw/components/app/pointerCanvas.ts#L718) 起，按执行顺序：

| # | 入口 | 行 | 写入 |
| --- | --- | --- | --- |
| 1 | 工具光标 | :776–:787 | cursor |
| 2 | `app.mindmap.handlePointerMove` | :790 | `hoveredElementIds` / add button / cursor |
| 3 | `app.quickCreate.handlePointerMove` | :793 | quickCreate hover / pole / connection / cursor |
| 4 | `createPreview.handlePointerMove` | :797–:810 | 预设预览 |
| 5 | `maybeUpdateFrameToHighlightOnPointerMove` | :813 | `frameToHighlight` |
| 6 | `maybeUpdateTableCellHighlightOnPointerMove` | :821 | `highlightedTableCell` |
| 7 | `resolveInteractionTarget` | :844 | 容器 hover / cursor |
| 8 | snap lines | :870 | `snapLines` / `originSnapOffset` |
| 9 | 绑定类工具 hover | :945 | `suggestedBinding` |
| 10 | 箭头工具 hover | :1093 | `suggestedBinding` |
| 11 | 文本手柄 | :1136 | cursor |
| 12 | 复合控制点 | :1155 | cursor |
| 13 | 线段 hover | :1168 | cursor / point hover |
| 14 | 变换手柄 | :1189 / :1218 | cursor / `transformStatus` |
| 15 | 橡皮擦 | :1252 | 提前 return |
| 16 | 链接 / embed hover | :1280 起 | cursor / `hoveredElementIds` |

PR2 只把 #7 的容器分派收口；其余保持原样，后续 PR 按 kind 迁移。

### 3.3 pointerdown 的依次尝试

[pointerSession.ts:628](../../packages/excalidraw/components/app/pointerSession.ts#L628) 起：

```text
表格标题 :634
> 移动端单元格 :648
> 文本手柄 :653
> 滚动条 :662
> resolveInteractionTarget :672
> 表格结构手势 :691
> fragment 结构手势 :721
> 单元格选择 :775
> quickCreate.preparePointerDown :785
> handleSelectionOnPointerDown :790
> mindmap.preparePointerDown :799
> 工具分派 :817 起
```

PR2 把 `resolveInteractionTarget` 换成 `resolvePointerFrame` 的 `phase = "down"` 结果；其余分支不动。

### 3.4 平行状态

| 状态 | 位置 | PR2 处理 |
| --- | --- | --- |
| `quickCreate.hovered` / `poleActivation` / `sequenceConnection` | [App.quickCreate.ts:320](../../packages/excalidraw/components/App.quickCreate.ts#L320) 起 | 保留；PR4 迁移 |
| `suggestedBinding` | `AppState` | 保留；PR3 降为派生镜像 |
| `frameToHighlight` / `highlightedTableCell` / `tableStructureHover` / `fragmentStructureHover` | `AppState` | 保留；PR5 迁移 |
| `hoveredElementIds` | `AppState` | 保留；PR5 迁移 |
| `transformStatus.hoveredHandle` | `App.transformStatus` | 保留；PR5 迁移 |
| `snapLines` | `AppState` | 保留；不参与 target 竞争 |

## 4. 设计

### 4.1 新增文件

```text
packages/excalidraw/components/app/
  pointerFrame.ts      PointerTarget / PointerFrame / provider 接口 / 优先级 / resolvePointerFrame
  pointerState.ts      AppPointerState（单帧状态）
  pointerDispatch.ts   applyPointerFrame / clearPointerHover
```

`interactionTarget.ts` 保留，`PointerTarget` 通过联合扩展它。

### 4.2 Target

```ts
export type PointerTarget =
  | InteractionTarget
  | {
      kind: "connection";
      elementId: string;
      hit: ConnectionHit;
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

PR2 只定义这些 kind 与 payload，不实现 provider。`ConnectionHit` / `PoleActivationPlacement` 的类型从 `@excalidraw/element` 导入；若元素包尚未导出，PR1 在 `connection/index.ts` 中导出。

### 4.3 Frame

```ts
export type PointerPhase = "hover" | "armed" | "gesture" | "pending";

export type GestureOwner =
  | "selection"
  | "container"
  | "transform"
  | "text"
  | "linear"
  | "quickCreate"
  | "sequenceMessage";

export type PointerMode =
  | "selection" // 选择 / 套索：手柄、容器、元素都参与
  | "arrow"     // 箭头 / 线工具：只解析连接目标，不解析选择手柄
  | "shape"     // 矩形等创建工具：只做预设预览，不解析 target
  | "other";    // 文本 / 橡皮 / 手型 / laser 等

export type PointerFrameInput = {
  point: GlobalPoint;
  phase: Extract<PointerPhase, "hover" | "armed">;
  mode: PointerMode;
  pointerType: "mouse" | "touch" | "pen";
  event?: { pointerType?: string };
};

export type PointerFrame = {
  phase: PointerPhase;
  point: GlobalPoint;
  target: PointerTarget;
  pointerType: PointerFrameInput["pointerType"];
  owner?: GestureOwner;
};
```

### 4.4 Provider

```ts
type ProviderFor<K extends PointerTarget["kind"]> = {
  kind: K;
  /**
   * 纯读：不得写 cursor / appState / repaint。
   * 返回 null 表示本 kind 不适用，继续下一个 provider。
   */
  resolve(
    app: PointerApp,
    input: PointerFrameInput,
  ): Extract<PointerTarget, { kind: K }> | null;
};

export const registerPointerTargetProvider = <
  K extends PointerTarget["kind"],
>(
  provider: ProviderFor<K>,
) => void;
```

优先级由 `pointerFrame.ts` 内的固定数组决定，**不由注册顺序决定**：

```ts
const PROVIDER_ORDER = [
  "compositeControl",
  "quickCreateHandle",
  "connection",
  "activationEdge",
  "poleActivation",
] as const;
```

### 4.5 `resolvePointerFrame`

```ts
export const resolvePointerFrame = (
  app: PointerApp,
  input: PointerFrameInput,
): PointerFrame => {
  const base =
    input.mode === "selection" || input.mode === "arrow"
      ? resolveInteractionTarget(app, input.point, input.event)
      : { kind: "canvas" as const };

  if (input.mode === "shape" || input.mode === "other") {
    return frame(base);
  }

  if (input.mode === "arrow") {
    // 箭头 / 线工具：选择手柄不参与；连接目标优先于普通元素。
    // base 里的 handle / selectedElement / container* 一律降级为 canvas。
    const arrowBase = isSelectionOnlyTarget(base)
      ? ({ kind: "canvas" } as const)
      : base;
    const connection = runProvider("connection", app, input);
    return frame(connection ?? arrowBase);
  }

  // —— 以下为 selection 模式 ——

  // 1. 文本 / 线段手柄永远最高
  if (base.kind === "textHandle" || base.kind === "linearHandle") {
    return frame(base);
  }

  // 2. 复合控制点先于变换手柄（与 pointerCanvas.ts:1155 的现状一致）
  const composite = runProvider("compositeControl", app, input);
  if (composite) return frame(composite);

  // 3. 变换手柄保持现状优先级
  if (base.kind === "transformHandle") return frame(base);

  // 4. 其余新 kind 按固定顺序，首次命中即返回
  for (const kind of [
    "quickCreateHandle",
    "activationEdge",
    "poleActivation",
  ]) {
    const target = runProvider(kind, app, input);
    if (target) return frame(target);
  }

  return frame(base);
};
```

`runProvider` 必须：

- 先查注册表；未注册 → `null`；
- 捕获不到异常？**不捕获**。解析器错误应当暴露，而不是静默走 legacy。
- 不缓存跨帧结果。

**PR2 只注册 `compositeControl` 一个 provider**：它复用现有 `hitCompositeControlPoint`（[compositeShapeControls.ts:40](../../packages/excalidraw/components/app/compositeShapeControls.ts#L40)），门控与 [pointerCanvas.ts:1141–:1162](../../packages/excalidraw/components/app/pointerCanvas.ts#L1141) 一致。这样「复合控制点先于变换手柄」的现有优先级从第一天就进入 frame；其余 provider 为空，实际行为仍由 legacy 分支执行。

PR3 / PR4 逐个注册其余 provider 后，行为才切换。

### 4.6 `AppPointerState`

```ts
export class AppPointerState {
  private frame: PointerFrame | null = null;

  constructor(private readonly app: App) {}

  getFrame = (): PointerFrame | null => this.frame;

  /** 返回是否发生变化；变化时请求重绘交互层 */
  setFrame = (frame: PointerFrame | null): boolean => {
    const previous = this.frame;
    if (previous === frame) return false;
    if (previous && frame && isSamePointerFrame(previous, frame)) {
      return false;
    }
    this.frame = frame;
    this.app.repaint.request();
    return true;
  };

  clear = () => this.setFrame(null);
}
```

`isSamePointerFrame` 比较：`phase`、`target.kind`、`target.elementId` / `target.containerId`（若有）、`point.x/y`（误差 1e-6）。不比较 `anchors` 数组引用；payload 内的 placement / direction 变化需要单独比较，或直接比较引用。

挂载：[App.tsx:319–:323](../../packages/excalidraw/components/App.tsx#L319) 已有 `mindmap` / `quickCreate` / `repaint` 字段，追加：

```ts
public pointer: AppPointerState = new AppPointerState(this);
```

### 4.7 `applyPointerFrame`

```ts
export const applyPointerFrame = (
  app: PointerApp,
  frame: PointerFrame,
): void => {
  // 1. 清理上一帧的容器 hover
  clearContainerInteractionHover(app);

  // 2. 按 kind 分派
  switch (frame.target.kind) {
    case "containerControl":
    case "containerBody":
      dispatchContainerInteraction(app, frame.target.candidate);
      break;

    // PR2 尚未迁移的 kind：保持 legacy 流程，不在这里做任何事
    default:
      break;
  }

  // 3. PR2 的 cursor 仍由 legacy 流程设置；容器 target 的 cursor
  //    已由 dispatchContainerInteraction 设置。
  app.pointer.setFrame(frame);
};
```

PR2 的 `clearPointerHover` 只清容器 provider；PR4 / PR5 扩展为全量清理。最终顺序见 README §6.3。

### 4.8 接入 pointermove

先按工具算 `mode`：

```ts
const mode: PointerMode = isSelectionLikeTool(app.state.activeTool.type)
  ? "selection"
  : app.state.activeTool.type === "arrow" ||
    app.state.activeTool.type === "line"
  ? "arrow"
  : isShapeLikeTool(app.state.activeTool.type)
  ? "shape"
  : "other";
```

把 [pointerCanvas.ts:844–:857](../../packages/excalidraw/components/app/pointerCanvas.ts#L844) 替换为：

```ts
const frame = resolvePointerFrame(app, {
  point: scenePointer,
  phase: "hover",
  mode,
  pointerType: resolvedPointerType(event),
  event,
});
applyPointerFrame(app, frame);

if (
  frame.target.kind === "containerControl" ||
  frame.target.kind === "containerBody"
) {
  return;
}
```

调用条件：

- **selection / arrow**：在「无按键、非拖拽、非建图、非滚动条」时调用；
- **shape**：只走 `createPreview`，不进入 frame 解析（预览不是 target）；
- **other**：保持 legacy 流程。

不在上述条件时（拖拽 / 建图中），仍走原 legacy 结构 hover 分支（:858–:868）。

**预期修复**：从容器控制区移开后，容器 hover 会被 `clearContainerInteractionHover` 清掉；这是 I1 的应有行为，允许出现在 PR2 的回归差异里。

### 4.9 接入 pointerdown

把 [pointerSession.ts:672–:676](../../packages/excalidraw/components/app/pointerSession.ts#L672) 替换为：

```ts
const frame = resolvePointerFrame(app, {
  point: pointerDownState.origin,
  phase: "armed",
  mode: currentPointerMode(app), // 与 pointermove 同一个函数
  pointerType: resolvedPointerType(event.nativeEvent),
  event: event.nativeEvent,
});
const interactionTarget = frame.target;
app.pointer.setFrame({ ...frame, phase: "armed" });
```

后续的分支继续读 `interactionTarget.kind`。PR2 不改变任何分支结果；新 kind 在 PR3 / PR4 才加入分派。

### 4.10 影子模式

没有现成 flag 模式；PR2 新增最小实现：

```ts
// pointerFrame.ts
export const isPointerPipelineShadowEnabled = () =>
  isDevEnv() &&
  typeof window !== "undefined" &&
  Boolean((window as any).__POINTER_PIPELINE_SHADOW__);
```

`compareFrameWithLegacy(app, frame)` 只在开关打开时运行：

| frame kind | legacy 对照 |
| --- | --- |
| `quickCreateHandle` | `app.quickCreate.getHovered()` |
| `activationEdge` | `app.quickCreate.getSequenceConnectionHover()` |
| `poleActivation` | `app.quickCreate.hasPoleActivation()`（PR4 新增 getter） |
| `connection` | `app.state.suggestedBinding` |

不一致时 `console.warn` 并附带 point / target / legacy 快照；**不改变执行路径**。生产构建不得包含该分支（`isDevEnv()` 常量折叠）。

> PR2 注册表为空，影子对照不会产生输出；它的价值是给 PR3 / PR4 即插即用。

## 5. 测试

### 5.1 新增 `packages/excalidraw/_tests_/pointer-frame.test.ts`

- `resolvePointerFrame` 优先级矩阵：用 stub provider 构造「同时命中」的场景，断言顺序与 README §6.4 一致；
- provider 未注册 → 返回 base；
- provider 抛错 → 向上传播（不吞）；
- `isSamePointerFrame`：point / phase / target 变化才返回 true。

### 5.2 扩展 `packages/excalidraw/_tests_/interaction-target.test.ts`

- 现有容器用例保持通过；
- 新增「容器 target 经 `applyPointerFrame` 设置 cursor」；
- 新增「从容器控制区移到普通元素，容器 hover 被清理」。

### 5.3 `AppPointerState`

- 相同 frame（按字段）不触发 repaint；
- 不同 target / point 触发一次 repaint；
- `clear()` 幂等。

### 5.4 回归

- `quickCreateHandles.test.tsx`、`sequenceShape.test.ts`、`arrowBinding.test.tsx`、所有 snapshot 保持通过；
- 允许的差异只有 §4.8 的容器 hover 清理。

## 6. 实施步骤

- [ ] 新建 `pointerFrame.ts`：类型、`PROVIDER_ORDER`、注册表、`resolvePointerFrame`、`isSamePointerFrame`。
- [ ] 新建 `pointerState.ts`：`AppPointerState`。
- [ ] 新建 `pointerDispatch.ts`：`applyPointerFrame`（先只处理容器 kind）。
- [ ] 注册 `compositeControl` provider（复用 `hitCompositeControlPoint`，门控与 pointerCanvas 现状一致）。
- [ ] `App.tsx` 挂载 `app.pointer`。
- [ ] `pointerCanvas.ts` 的容器分支改走 `resolvePointerFrame` + `applyPointerFrame`。
- [ ] `pointerSession.ts` 的 `resolveInteractionTarget` 调用改走 `resolvePointerFrame`。
- [ ] 加影子模式开关与 `compareFrameWithLegacy` 骨架。
- [ ] 写 §5 测试。
- [ ] 运行 `yarn workspace excalidraw test` / `typecheck`。

## 7. 验收

- [ ] `resolveInteractionTarget` 只被 `resolvePointerFrame` 内部调用（grep 生产代码）。
- [ ] pointermove / pointerdown 各只有一个解析入口。
- [ ] 容器 cursor 只由 `dispatchContainerInteraction` 设置（PR5 会把它拆成 `renderHover` + `getCursor`，最终由 `applyPointerFrame` 统一 set）。
- [ ] 所有现有测试通过；仅允许 §4.8 的容器 hover 清理差异。
- [ ] `PointerTarget` 新 kind 已定义；除 `compositeControl` 外注册表为空，实际行为与 HEAD 等价。
- [ ] 影子模式在 dev 可开启，关闭时零开销。

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| 优先级顺序与 HEAD 不一致 | 先写矩阵测试；PR2 注册表为空，行为等价；PR3 / PR4 逐 kind 开启 |
| 容器 hover 清理引入回归 | 跑 `interaction-target.test.ts` 与全量 snapshot；差异逐条审阅 |
| `AppPointerState` 每次 move 触发 repaint | 字段级比较；ghost 缓存仍按 key 复用 |
| provider 解析开销 | provider 先做轻量工具 / 手势门控，再做命中 |
| 影子模式进入生产 | `isDevEnv()` 常量折叠；构建后 grep `__POINTER_PIPELINE_SHADOW__` |

## 9. 不做

- 除 `compositeControl` 外不注册任何新 provider。
- 不改 `pointerSelection.ts`、`App.quickCreate.ts`、`App.mindmap.ts`。
- 不改渲染器。
- 不删除 `suggestedBinding`。
