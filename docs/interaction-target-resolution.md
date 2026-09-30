# 统一画布交互目标解析方案

## 背景

画布中的普通图形和容器图形目前分别处理命中、hover、鼠标样式和 pointer-down。表格轨道、插入点、画框边界等容器控件可能在普通图形命中之后继续覆盖 hover 状态或 cursor，导致以下状态不一致：

- 鼠标显示的是容器操作，但 pointer-down 实际命中了已选图形；
- 已选图形覆盖容器控件时，容器仍显示 hover 高亮；
- pointer-move 和 pointer-down 使用不同的交互优先级；
- 新增容器需要在多个模块中重复加入特殊判断。

本方案将交互处理收敛为统一的目标解析流程。容器只提供候选控制区，公共解析器决定最终目标，hover、cursor 和 pointer-down 共用解析结果。

## 目标

1. 统一普通图形、容器图形和容器控制区的交互优先级。
2. 保证 hover 显示的目标与 pointer-down 响应的目标一致。
3. 让已选图形在容器控制区上保持稳定的交互优先级。
4. 支持表格、画框、Magic Frame 及未来新增容器，而不在公共逻辑中追加类型特判。
5. 保留旋转、嵌套容器、锁定元素、绑定文本和变换手柄的既有语义。

## 非目标

- 不改变元素的场景 z-index 和持久化顺序。
- 不把 Canvas 改造成真实 DOM 节点树。
- 不复用浏览器的冒泡机制来决定编辑器交互优先级。

## 交互目标

统一解析器返回一个目标：

```ts
type InteractionTarget =
  | { kind: "textHandle"; elementId: string }
  | { kind: "linearHandle"; elementId: string }
  | {
      kind: "transformHandle";
      elementId: string;
      handle: TransformHandleType;
    }
  | { kind: "selectedElement"; elementId: string }
  | {
      kind: "containerControl";
      containerId: string;
      control: ContainerControl;
    }
  | { kind: "element"; elementId: string }
  | { kind: "containerBody"; containerId: string }
  | { kind: "canvas" };
```

解析入口：

```ts
resolveInteractionTarget(
  app: App,
  point: GlobalPoint,
  event?: PointerEvent,
): InteractionTarget;
```

解析器必须返回一个最终目标。调用方不得在解析完成后再次根据某个具体容器类型覆盖目标或提前返回。

## 优先级

从高到低：

```text
文本编辑控制点
> 线段/箭头控制点
> 已选元素变换手柄
> 已选普通元素主体
> 已选容器控制区
> 未选容器控制区
> 未选普通元素
> 容器主体
> 画布
```

规则说明：

- 已选普通图形主体可以覆盖表格轨道、插入点、画框边框等容器控制区。
- 选中的容器自身仍保留缩放手柄、轨道、插入点和其他结构控制。
- 未选普通图形不能覆盖容器专用控制区。
- 控制点优先于所属元素主体。
- 嵌套容器按最深层可见候选参与解析；最终目标仍由统一优先级决定。
- 锁定元素不应成为普通编辑目标，但可按现有规则参与锁定反馈和上下文菜单。

## 命中普通元素

普通元素命中应复用现有命中 API：

```ts
const hit = app.getElementAtPosition(x, y, {
  preferSelected: true,
  includeLockedElements: true,
});
```

`preferSelected` 只表示命中排序偏向已选元素，调用方仍必须显式确认：

```ts
const isSelected = Boolean(hit && app.state.selectedElementIds[hit.id]);
```

不要用 `isTableElement()`、`isFrameLikeElement()` 等类型判断代替选择状态。已选容器需要进一步区分容器主体和容器自身控制区：

- 命中容器主体时，目标可以是 `selectedElement`；
- 命中容器控制点时，目标是 `containerControl` 或 `transformHandle`；
- 命中容器内的已选普通图形时，目标是 `selectedElement`。

## 容器候选接口

容器实现统一 provider 接口，只负责报告候选区域：

```ts
interface ContainerInteractionProvider {
  getInteractionCandidate(
    app: App,
    point: GlobalPoint,
  ): ContainerInteractionCandidate | null;

  getCursor(candidate: ContainerInteractionCandidate): string;

  renderHover(candidate: ContainerInteractionCandidate): void;
}

type ContainerInteractionCandidate = {
  containerId: string;
  control: "resize" | "insert" | "reorder" | "select" | "border" | "body";
  priority: number;
  gesture?: string;
};
```

provider 的职责边界：

- 计算本容器局部坐标和候选控制区；
- 返回候选控制类型和必要的手势信息；
- 提供候选目标的 cursor 和渲染数据。

provider 不得：

- 直接设置全局 cursor；
- 直接清除其他容器的 hover 状态；
- 在公共 pointer-move 流程中抢先 `return`；
- 决定候选目标是否最终胜出。

新增容器只需要注册 provider，不需要修改公共优先级代码。

## pointer-move 流程

统一流程如下：

```ts
const target = resolveInteractionTarget(app, scenePoint, event);

clearAllHoverState(app);
app.cursor.reset();

switch (target.kind) {
  case "textHandle":
  case "linearHandle":
  case "transformHandle":
    updateHandleHover(target);
    setHandleCursor(target);
    break;

  case "selectedElement":
    updateElementHover(target);
    app.cursor.set(CURSOR_TYPE.MOVE);
    break;

  case "containerControl":
    updateContainerHover(target);
    app.cursor.set(getContainerCursor(target));
    break;

  case "element":
    updateElementHover(target);
    break;

  case "containerBody":
    updateContainerBodyHover(target);
    break;

  case "canvas":
    break;
}
```

表格、画框和其他容器不得在自身 hover 函数中直接调用 `app.cursor.set(...)`。cursor 只由统一 dispatch 阶段设置。

移除或改造以下形式的容器专用提前返回：

```ts
if (getContainerHoverAtSceneCoords(app, point)) {
  return;
}
```

应改为基于解析结果：

```ts
if (target.kind === "containerControl") {
  return;
}
```

这里的 `return` 只能结束后续普通 hover 处理，不能绕过统一目标解析和状态清理。

## pointer-down 流程

pointer-down 必须复用同一个解析结果：

```ts
const target = resolveInteractionTarget(app, scenePoint, event);
dispatchPointerDown(target, pointerDownState);
```

分发规则：

| 目标               | 行为                   |
| ------------------ | ---------------------- |
| `textHandle`       | 进入文本控制操作       |
| `linearHandle`     | 进入线段/箭头编辑      |
| `transformHandle`  | 缩放、旋转或裁剪       |
| `selectedElement`  | 普通拖动、编辑或组选择 |
| `containerControl` | 进入容器结构手势       |
| `element`          | 普通选择               |
| `containerBody`    | 选择容器主体           |
| `canvas`           | 框选或创建新元素       |

这样可以保证：

```text
hover 显示的目标 = pointer-down 实际响应的目标
```

## 状态迁移

现有状态字段可以在第一阶段保留：

- `tableStructureHover`
- `highlightedTableCell`
- `hoveredElementIds`
- `frameToHighlight`

但这些字段只能由统一解析流程产生。短期由目标 dispatch 派生旧状态，长期可以收敛为：

```ts
interactionTarget: InteractionTarget | null;
```

渲染层根据 `interactionTarget` 派生表格、画框和普通元素的 hover 样式。

每次 pointer-move 必须先清理旧 hover，再应用新目标，避免从容器控制区移动到已选图形后残留轨道或插入点高亮。

## 实施顺序

1. 抽出公共 `resolveInteractionTarget()` 和目标类型。
2. 接入现有文本控制点、线段控制点和变换手柄判断。
3. 接入 `getElementAtPosition(..., { preferSelected: true })`。
4. 将表格结构 hover 改造成 provider。
5. 将画框、Magic Frame 等容器改造成 provider。
6. 让 pointer-move 和 pointer-down 共用解析结果。
7. 删除容器内部直接设置 cursor 和类型专用提前返回。
8. 保留旧状态字段并由统一 dispatch 派生。
9. 所有容器迁移完成后，再评估是否收敛为单一 `interactionTarget` 状态。

## 测试要求

至少覆盖以下场景：

- 已选矩形覆盖表格轨道；
- 已选矩形覆盖表格插入点；
- 未选矩形覆盖表格轨道；
- 已选表格自身的缩放手柄、轨道和插入点；
- 已选画框子元素覆盖画框边框；
- 未选元素覆盖画框边框；
- 多选元素覆盖容器控制区；
- hover cursor 与 pointer-down 手势一致；
- 旋转容器后的命中结果；
- 嵌套容器中最深层目标优先；
- 锁定元素和绑定文本不错误抢占目标；
- 从容器控制区移动到已选元素时，旧容器 hover 状态被清除；
- 新增容器 provider 后无需修改公共优先级逻辑。

## 验收标准

- 同一指针位置在 hover 和 pointer-down 阶段解析为同一目标。
- 已选普通图形可以覆盖所有容器控制区的 hover 和 cursor。
- 选中的容器自身仍能使用容器控制区。
- 未选图形不能覆盖容器控制区。
- 表格、画框和未来容器不再通过独立代码直接抢占全局 cursor。
- 旋转、嵌套、锁定、绑定文本和多选行为保持现有语义。
- 新增容器只需实现 provider，不需要修改统一交互优先级。
