# P01.3：表格 resize 手势 in-flight 视觉

- 状态：已实施，自动化测试与真实浏览器验收通过（2026-09-30）。
- 目标：修复行列线 resize 拖动期间 accent 高亮消失的问题。
- 本期范围：只实现表格 `rowResize` / `columnResize` 的 in-flight 视觉；不在本期扩展画框、mindmap 或其它容器的 provider 生命周期。
- 后续方向：保留 `containerGestureVisual` 作为渲染通道，但等第二个真实容器消费者出现后再抽象 provider 写入/清理契约。

## 一、设计结论

采用“**表格手势控制器产出视觉身份，AppState 保存渲染投影，渲染层派生几何**”的方案：

1. `PointerDownState.tableGesture.active` 仍是手势行为的唯一事实来源。
2. resize arm 成功时，从已 arm 的 table gesture 生成一个严格类型的 `containerGestureVisual`。
3. `containerGestureVisual` 只保存表格、行列、边界方向等稳定身份，不保存拖动位置。
4. 拖动过程中只 mutate live scene；渲染层每帧从当前表格几何重新计算高亮线。
5. 提交、Esc、pointercancel、missing pointer-up 都通过同一 table teardown 清除视觉。
6. hover 继续保持 hover-only；手势视觉优先于 hover，避免残留 hover 覆盖活动手势。

本设计暂不新增 `ContainerInteractionProvider.armGestureVisual()` 或
`clearGestureVisual()`。当前只有表格一个消费者，提前把生命周期抽到 provider 会引入重复 dispatch、全局清理和多路径 arm 不一致的问题。

## 二、当前问题与代码事实

resize 的执行链已经具备正确的 live scene 预览：

- arm 逻辑位于 `packages/excalidraw/components/app/table.ts:1403-1585`；
- resize move 位于 `packages/excalidraw/components/app/table.ts:1655-1750`；
- 提交和取消位于 `packages/excalidraw/components/app/table.ts:1862-1965`；
- pointer session 在 `packages/excalidraw/components/app/pointerSession.ts:1061-1087` 把 move 交给 table gesture；
- 普通 hover 在 `packages/excalidraw/components/app/pointerCanvas.ts:734-736` 因 `isTableGestureActive` 暂停。

当前缺口是：

1. `armTableStructureGestureOnPointerDown()` 清空 `tableStructureHover`；
2. resize move 不写新的可渲染 AppState；
3. `renderTableStructureHover()` 只由 `tableStructureHover` 门控；
4. 因此按下后高亮消失，拖动期间无法恢复。

当前渲染入口位于 `packages/excalidraw/renderer/interactiveScene.ts:2351-2394`，当前状态投影位于 `packages/excalidraw/components/canvases/InteractiveCanvas.tsx:244-289`。

## 三、状态模型

### 3.1 严格的视觉身份类型

在 `packages/excalidraw/types.ts` 增加专用于 resize 的类型，不复用包含 grip、insert 和普通 table hover 的完整 hover 联合：

```ts
export type TableResizeGestureVisual = {
  container: "table";
  tableId: ExcalidrawTableElement["id"];
  axis: "row" | "column";
  id: string;
  edge: "start" | "end";
};

export type ContainerGestureVisual = TableResizeGestureVisual;
```

后续新增容器时再扩展 `ContainerGestureVisual`，例如：

```ts
type ContainerGestureVisual =
  | TableResizeGestureVisual
  | FrameGestureVisual;
```

本期不要把 `TableRowColStructureHover` 直接放入 AppState。hover 描述是交互命中模型，resize visual 是手势生命周期模型，两者应在渲染边界转换。

### 3.2 AppState 接线

在 `AppState` 增加：

```ts
containerGestureVisual: ContainerGestureVisual | null;
```

必须同步修改以下位置：

- `packages/excalidraw/appState.ts`：初始值和变更可见性配置；
- `packages/excalidraw/types.ts`：`InteractiveCanvasAppState`；
- `packages/excalidraw/components/canvases/InteractiveCanvas.tsx`：相关 AppState 投影；
- `packages/excalidraw/actions/actionDeselect.ts`：取消选择时清理；
- `packages/excalidraw/actions/actionFinalize.tsx`：通用 finalize 清理；
- 受影响的状态快照和测试 mock。

`containerGestureVisual` 是临时交互状态，不进入场景文件、协作广播或持久化数据。

## 四、手势生命周期

### 4.1 arm：只在 table controller 生成视觉身份

resize 的真实手势类型已经保存在 `PointerDownState.tableGesture.active`：

- `resizeRow` 对应 `axis: "row"`；
- `resizeColumn` 对应 `axis: "column"`；
- `id` 和 `edge` 直接来自已 arm 的 gesture。

新增一个纯函数：

```ts
const getTableGestureVisual = (
  gesture: TablePointerGesture | null,
): TableResizeGestureVisual | null => {
  if (!gesture) {
    return null;
  }
  if (gesture.kind === "resizeRow") {
    return {
      container: "table",
      tableId: gesture.tableId,
      axis: "row",
      id: gesture.id,
      edge: gesture.edge,
    };
  }
  if (gesture.kind === "resizeColumn") {
    return {
      container: "table",
      tableId: gesture.tableId,
      axis: "column",
      id: gesture.id,
      edge: gesture.edge,
    };
  }
  return null;
};
```

`armTableStructureGestureOnPointerDown()` 在成功建立 `active` 后，统一写入一次：

```ts
app.setState({
  tableStructureHover: null,
  tableStructurePreview: null,
  containerGestureVisual: getTableGestureVisual(
    pointerDownState.tableGesture.active,
  ),
});
```

这样 resize、move、insert 都从同一个 arm 收口；只有 resize 会得到非空 visual。scale 手势也必须显式写入 `containerGestureVisual: null`，防止异常 session 留下上一手势的残留。

### 4.2 不再设计第二条 resize arm 路径

当前统一解析器对表格主体返回 `containerBody`，已有测试见
`packages/excalidraw/tests/interaction-target.test.ts:236-253`；内侧行列 resize 区通常返回 `containerControl`。

因此本期不再使用“路径 A / 路径 B”的描述，也不在 pointer session 中重复调用 provider dispatch：

- `containerControl`：由 `handleCanvasPointerDown()` 调用 table arm；
- `containerBody`：保持现有主体选择语义，不新增隐式 resize arm；
- scale handle：继续走 scale 手势，不产生 gesture visual。

如果未来某个容器需要从 body 内部 arm 结构手势，应先扩展统一目标分发，使其返回明确的 control/candidate，再复用同一 arm 结果模型；不在本期通过容器类型特判补分支。

### 4.3 拖动：只 mutate scene，不写 visual

`handleTableGestureMove()` 的 resize 分支保持现有计算：

- 从 arm-time snapshot 计算请求尺寸；
- 应用最小尺寸和相邻行列的双向钳制；
- mutate table 和受影响成员；
- `refitCellBackgroundTexts()`；
- `scene.triggerUpdate()`。

拖动期间禁止：

- 重写 `containerGestureVisual`；
- 重写 `tableStructureHover`；
- 逐帧调用结构命中解析；
- 通过 pointer 坐标保存高亮线位置。

手势视觉的位置完全由当前 table 的 `x/y/table.rows/table.columns/width/height` 派生。

### 4.4 teardown：只由 table gesture owner 清理

`cancelTableGesture()` 和 `finalizeTableGestureOnPointerUp()` 的已有清理批次都追加：

```ts
containerGestureVisual: null
```

不要新增遍历 provider 的 `clearContainerGestureVisuals()`。当前只有一个全局 visual，逐 provider 清理没有额外收益，反而会让清理责任和当前手势 owner 分离。

必须覆盖以下 teardown：

1. 正常 pointer-up；
2. Esc；
3. pointercancel；
4. missing pointer-up cleanup；
5. 工具切换或通用 finalize；
6. 表格被外部更新、删除或 gesture 失效后 pointer session 结束。

对于 `handleTableGestureMove()` 发现 table 已不存在的情况，应先将
`pointerDownState.tableGesture.active` 置空，并在后续 pointer-up 清理
`containerGestureVisual`。

## 五、渲染设计

### 5.1 渲染前转换

在 `interactiveScene.ts` 增加一个小型转换函数，把 visual identity 转换成现有绘制函数需要的 resize hover 结构：

```ts
const getTableStructureVisual = (
  appState: InteractiveCanvasAppState,
): TableRowColStructureHover | null => {
  const gesture = appState.containerGestureVisual;
  if (gesture?.container === "table") {
    return gesture.axis === "row"
      ? {
          tableId: gesture.tableId,
          kind: "rowResize",
          rowId: gesture.id,
          edge: gesture.edge,
        }
      : {
          tableId: gesture.tableId,
          kind: "columnResize",
          columnId: gesture.id,
          edge: gesture.edge,
        };
  }
  return appState.tableStructureHover;
};
```

手势视觉必须优先：

```ts
const tableVisual = getTableStructureVisual(appState);
```

不要使用 `tableStructureHover ?? gestureVisual`。活动手势是更高优先级的生命周期，即使外部流程意外留下 hover，也不能覆盖正在拖动的线。

### 5.2 structureTables 集合

`structureTables` 必须收录：

- 当前选中的表格；
- `tableRowColSelection` 所属表格；
- `tableStructureHover` 所属表格；
- `containerGestureVisual` 所属表格。

这样未选中的表格在 resize gesture 期间仍能绘制对应 affordances 和高亮线。

### 5.3 绘制函数保护

现有 `renderTableStructureHover()` 对 row/column id 默认假设一定存在。引入静态 visual 后，应增加索引保护：

- `rowIndex < 0` 时不绘制；
- `columnIndex < 0` 时不绘制；
- 表格被删除或不是 table 时不绘制。

这不是正常 resize 的路径，但可以防止外部场景更新或异常数据导致渲染崩溃。

## 六、交互优先级和清理原则

### 6.1 hover 与 gesture 的关系

- arm 前：显示 `tableStructureHover`；
- arm 后：清除 hover，显示 `containerGestureVisual`；
- move 期间：暂停 hover 扫描，保持 visual identity；
- pointer-up/Esc：清除 visual；
- 下一次 pointer-move：重新恢复普通 hover。

`suspendHoverForTableGesture()` 只负责清理 hover 类字段和设置
`isTableGestureActive`，不得清除 `containerGestureVisual`。

### 6.2 不引入 gesture token 的前提

本期沿用 Excalidraw 单一活动 pointer session 的约束，不新增 token。前提是：

- 新 pointer-down 不会覆盖仍活跃的 table session；
- pointercancel 和 missing-pointer-up 必须最终调用同一 teardown；
- future multi-pointer gesture 若允许并发编辑，必须先引入 session token，再扩展该通道。

## 七、性能模型

本方案只约束该字段的写入次数：

| 阶段 | `containerGestureVisual` 写入 | scene 更新 |
| --- | ---: | ---: |
| arm | 1 次 | 无额外更新 |
| resize move | 0 次 | 既有 mutate + triggerUpdate |
| 正常提交 | 1 次清空 | 既有 history capture |
| Esc/cancel | 1 次清空 | 快照恢复 |

不要把整个手势期间所有 React `setState` 宣称为恰好两次。pointer session 还会更新通用拖动、selection、cursor 和清理字段；本方案只保证 gesture visual 字段不逐帧写入。

## 八、与 provider 抽象的关系

本期保留 `ContainerGestureVisual` 这个名字，是为了让渲染通道未来可以扩展；但不提前增加 provider 生命周期 API。

当第二个容器确实需要 in-flight visual 时，再评估以下接口：

```ts
interface ContainerInteractionProvider {
  getInteractionCandidate(...): ContainerInteractionCandidate | null;
  renderHover(...): void;
  clearHover(...): void;
  deriveGestureVisual?(
    app: PointerApp,
    armedGesture: ArmedContainerGesture,
  ): ContainerGestureVisual | null;
}
```

未来 provider 应返回 visual identity，由公共层写入 AppState；provider 不直接调用 `setState`，也不负责无条件清理其它 provider 的 visual。是否需要 token、owner 或 visual-specific teardown，应在第二个消费者出现后结合真实需求决定。

## 九、测试计划

### 9.1 状态生命周期

在 `tableStructure.test.tsx` 覆盖：

1. 未选表格内侧 row resize：arm 后 visual 为 row + rowId + edge；
2. 未选表格内侧 column resize；
3. 首行/首列 `start` edge；
4. 中间行列 `end` edge；
5. 两次 move 后 visual 对象引用不变；
6. pointer-up 后 visual 为 null；
7. Esc 后 visual 为 null 且几何恢复；
8. 无尺寸变化释放不产生 history；
9. scale 手势不产生 visual；
10. move reorder 和 insert 不产生 resize visual。

### 9.2 渲染生命周期

覆盖：

- gesture visual 能使未选中的表格进入 `structureTables`；
- gesture visual 优先于残留 hover；
- live table geometry 改变后高亮线跟随边界；
- 最小尺寸钳制后高亮线停在钳停位置；
- 指针移出表格后高亮仍绘制在真实边界；
- 无效 row/column id 不导致渲染异常。

### 9.3 异常清理

覆盖：

- pointercancel；
- missing pointer-up；
- 工具切换；
- 通用 finalize/deselect；
- table 被删除或外部更新后释放。

测试应断言 `containerGestureVisual` 的字段生命周期，不断言整个手势期间 React `setState` 总次数。

## 十、实施顺序

1. 在 `types.ts` 增加 `TableResizeGestureVisual` 和 `ContainerGestureVisual`。
2. 在 `appState.ts`、`InteractiveCanvasAppState`、`InteractiveCanvas.tsx` 接通字段。
3. 在 table controller 增加 `getTableGestureVisual()`。
4. 修改 table arm：resize 写 visual，move/insert/scale 写 null。
5. 修改 table cancel/finalize 和全局清理路径。
6. 修改 interactiveScene：转换 visual、gesture 优先、补充结构表集合和索引保护。
7. 增加状态、渲染、异常清理测试。
8. 通过真实浏览器验收后，再决定是否在 P02/P03 抽象 provider。

## 十一、验收标准

- [x] resize 按下后 accent 线不消失，拖动期间持续可见。
- [x] 高亮线跟随 live table 边界，包含首行/首列外框和最小值钳停。
- [x] 指针移出表格后高亮仍位于真实边界。
- [x] 正常释放清除 visual，并按现有规则产生至多一条 resize history。
- [x] 无变化释放不产生 history。
- [x] Esc 恢复 arm-time 几何，清除 visual，无残留。
- [x] pointercancel 和 missing pointer-up 不留下 visual。
- [x] hover 扫描在 gesture 期间保持暂停。
- [x] move、insert、scale 行为不改变。
- [x] `containerGestureVisual` 不进入保存文件、协作广播或导出数据。
- [x] 拖动帧不写 AppState visual，不执行逐帧结构命中检测。
- [x] 第二个容器出现前，不增加 provider gesture 生命周期 API。

## 十二、实施与验证记录

- table controller 统一产生 resize visual，渲染优先于 hover，并从实时几何派生边界。
- resize 取消快照改为复用 pointer session 的元素副本；live 元素会原地 mutate，不能作为恢复快照。
- pointercancel、missing pointer-up 和工具切换通过 table cancel 恢复几何并清理 visual。
- 7 个相关测试文件共 134 项通过；history、contextmenu、regressionTests 共 133 项通过、1 项既有跳过，更新 128 个状态快照。
- 本次修改文件的 ESLint 和 `git diff --check` 通过。
- 真实 Chrome 完成桌面与移动视口截图和 canvas 像素检查，覆盖 row/column 按下、移出表格后的钳制边界、首行/首列外框、释放和 Esc 清理。
- 全量 `yarn test:typecheck` 仍有既存错误：`packages/element/tests/tableSelectionResize.test.ts` 第 250、423、478 行对 `ExcalidrawElement` 访问 `fontSize`；本期新增代码无类型错误。
