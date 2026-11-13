# PR3：连接作为第一个消费者接入

> **状态**：未开始。
> **依赖**：PR1（几何模块 + 基线）、PR2（帧契约）。
> **交付后的结果**：连接预览与落点共用 `resolveConnectionHit`；`suggestedBinding` 变为 frame 的派生镜像；6 个预览入口与 4 处激活条落点特例收口。
> **拆分**：3a 非折线（直线 / 曲线 / 时序消息）、3b 折线（路由风险高）。**3a / 3b 各自独立 PR**，不得合并。
> **设计来源**：[connection-snap-pipeline.md](../connection-snap-pipeline.md) §2–§5。

## 1. 目标

| # | 目标 | 验收 |
| --- | --- | --- |
| G1 | 所有「用户指定落点」入口共用 `resolveConnectionHit` | 6 个预览入口 + 落点函数全部走同一函数 |
| G2 | 预览 = 落点 | 预览 `hit.point` 与松手后端点误差 < 0.01 |
| G3 | 推荐点高优先级 | 半径内即使轮廓最近点更近也取推荐点 |
| G4 | 任意连接点 | 轮廓上任意点都能成为落点 |
| G5 | 时序消息走统一落点 | 消息预览与最终绑定点一致 |
| G6 | `suggestedBinding` 只由 dispatch / gesture owner 写 | 业务模块不再各自写 |

> **与旧文档的映射**：`connection-snap-pipeline.md` 中的 `getConnectionPreview` 在本计划中不单独存在——预览由 frame 的 `connection` target 携带 `hit` 直接驱动；`buildConnectionQuery` 是它留下的唯一查询构造。

## 2. 非目标

- 不迁移 pole activation / quick-create 手柄（PR4）。
- 不删除 `suggestedBinding` 字段（PR6）。
- 不迁移普通 hover / transform / container（PR5）。
- 不改 `binding.attachPoint` 数据结构与刚性跟随。
- 不处理表格 / fragment 绑定。
- 不合并 `findSequenceActivationSnap`（激活条吸附到杆）。

## 3. 现状与改造点

### 3.1 预览入口

| # | 入口 | 位置 | 当前求点 | PR3 改法 |
| --- | --- | --- | --- | --- |
| 1 | 绑定类工具悬停 | [pointerCanvas.ts:945](../../packages/excalidraw/components/app/pointerCanvas.ts#L945) | `getSnapOutlineMidPoint` | frame `connection` + `hit` |
| 2 | 箭头工具悬停 | [pointerCanvas.ts:1093](../../packages/excalidraw/components/app/pointerCanvas.ts#L1093) | `getSnapOutlineMidPoint` | frame `connection` + `hit` |
| 3 | 新建箭头 pointerdown | [pointerSelection.ts:1531](../../packages/excalidraw/components/app/pointerSelection.ts#L1531) | `getSnapOutlineMidPoint` | `resolveConnectionHit` 的 `hit` |
| 4 | 折线端点拖拽 | [linearElementEditor.ts:2450](../../packages/element/src/linearElementEditor.ts#L2450) | `snapToMid` | 3b：`resolveConnectionHit` |
| 5 | 非折线起点 / 终点拖拽 | [linearElementEditor.ts:2560](../../packages/element/src/linearElementEditor.ts#L2560)、`:2599` | `getSnapOutlineMidPoint` | 3a：`resolveConnectionHit` |
| 6 | 渲染器 | [interactiveScene.ts:3726](../../packages/excalidraw/renderer/interactiveScene.ts#L3726) | `suggestedBinding.midPoint` + 再算中点 | 只读 `suggestedBinding.hit` |

### 3.2 落点入口

| 入口 | 位置 | 当前 | PR3 改法 |
| --- | --- | --- | --- |
| 非折线策略 focusPoint | [binding.ts:518](../../packages/element/src/binding.ts#L518) | `projectAttachPointOntoDiagonal` | `hit.point` |
| 非折线落定 | [binding.ts:1927](../../packages/element/src/binding.ts#L1927) | `projectPointOntoBoundElementOutline` | `resolveConnectionHit(...).point` |
| 折线落定 | [binding.ts:1086](../../packages/element/src/binding.ts#L1086) | `snapToMid` + 射线 | 3b：①② 档先判，③ 档沿用轴射线 |
| 折线每帧 | [elbowArrow.ts:2229](../../packages/element/src/elbowArrow.ts#L2229) | `bindPointToSnapToElementOutline` | 随 3b 生效 |
| 新建箭头初始绑定 | [pointerSelection.ts:1472](../../packages/excalidraw/components/app/pointerSelection.ts#L1472) 起 | `bindOrUnbindBindingElement` | 策略层 focusPoint 改为 hit |
| 时序消息 | [sequenceMessage.ts:117](../../packages/element/src/sequenceMessage.ts#L117) 起 | `getActivationBindingPoint` | 目标选择后求 `resolveConnectionHit` |
| 激活条特例 | [binding.ts:1812](../../packages/element/src/binding.ts#L1812)、[utils.ts:532](../../packages/element/src/utils.ts#L532)、[interactiveScene.ts:737](../../packages/excalidraw/renderer/interactiveScene.ts#L737) | 各自算 `getActivationBindingPoint` | 统一走 activation spec |

### 3.3 必须保持纯换算的函数

`calculateAttachPointForNonElbowArrowBinding`（[binding.ts:2062](../../packages/element/src/binding.ts#L2062)）及其直接调用方**不得改动**：

- 方向键微调 [keyboard.ts:210](../../packages/excalidraw/components/app/keyboard.ts#L210) / `:225`；
- yjs 建连 [element-factory.ts:63](../../packages/yjs/src/element-factory.ts#L63)；
- 类型转换重锚 [binding.ts:785](../../packages/element/src/binding.ts#L785)；
- 曲线判边 [binding.ts:1837](../../packages/element/src/binding.ts#L1837)。

## 4. 设计

### 4.1 `buildConnectionQuery`

新增 `packages/element/src/connection/query.ts`：

```ts
export type BuildConnectionQueryArgs = {
  element: ExcalidrawBindableElement;
  point: GlobalPoint;
  reference?: GlobalPoint;
  arrow?: ExcalidrawLinearElement;
  zoom: number;
  isMidpointSnappingEnabled: boolean;
  gridSize?: NullableGridSize;
  angleLocked?: boolean;
  elementsMap: ElementsMap;
  /** 网格吸附用的另一端；缺省取 arrow 的固定端 */
  adjacentPoint?: GlobalPoint;
  /** 求的是箭头哪一端；悬停新建默认 start */
  startOrEnd?: "start" | "end";
};

export const buildConnectionQuery = (
  args: BuildConnectionQueryArgs,
): ConnectionQuery;
```

职责（只此一处）：

| 输入 | 处理 |
| --- | --- |
| 网格模式 | `point = snapBoundPointToGrid(...)`；`anchorsEnabled = false` |
| Shift 角度锁定 | `anchorsEnabled = false`；`angleLocked = true`（③ 档直接射线） |
| `isMidpointSnappingEnabled = false` | `anchorsEnabled = false` |
| 文本目标 | gap = 0（由 `getProjectionBindingGap` 决定） |
| 时序消息 | 调用方先用 `constrainSequenceMessagePoint` 约束 point，再构造 query |

`snapBoundPointToGrid` 目前是 [binding.ts:1549](../../packages/element/src/binding.ts#L1549) 的私有函数。PR3 将其移到 `connection/query.ts`（或 `connection/grid.ts` 并由 query re-export），`binding.ts` 改为 import；**不得让 `connection/` 反向 import `binding.ts`**。迁移时把 arrow 参数收窄为 `Pick<ExcalidrawLinearElement, "elbowed">`，与 `getBindingGap` 的入参一致。

### 4.2 帧 provider：`connection`

新增 `packages/excalidraw/components/app/pointerConnection.ts`：

```ts
registerPointerTargetProvider({
  kind: "connection",
  resolve(app, input) {
    if (!isConnectionHoverApplicable(app, input)) {
      return null;
    }
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const picked = pickConnectionTarget(
      input.point,
      app.scene.getNonDeletedElements(),
      buildConnectionQueryWithoutElement(app, input),
      rayProjectFor(app),
    );
    if (!picked) return null;
    return {
      kind: "connection",
      elementId: picked.element.id,
      hit: picked.hit,
    };
  },
});
```

适用范围：

- `mode = "arrow"`：当前工具是 `arrow` / `line`，且绑定开启、未在创建元素、未编辑文本、非只读；
- `mode = "selection"`：仅当正在拖拽箭头端点（此时 frame phase 为 `gesture`，由 owner 更新，不走 hover provider）；
- `phase = "armed"` 且工具是箭头：用于 pointerdown 建立初始绑定。

不适用时返回 `null`，不影响选择类 target。

悬停时还没有箭头元素，gap 取当前工具箭头类型：

```ts
const arrowLike = {
  elbowed: app.state.currentItemArrowType === ARROW_TYPE.elbow,
} as const;
```

它与随后 `newArrowElement` / `getCurrentItemArrowProps` 用的是同一份 `currentItemArrowType`，所以悬停圆点与新建箭头的 gap 不会分叉。悬停 / 新建箭头的 `startOrEnd = "start"`；端点拖拽按实际端传入。

`rayProjectFor(app)`：

| 箭头 | 注入适配器 |
| --- | --- |
| 非折线 | `({ point, element, arrow, elementsMap, startOrEnd }) => projectPointOntoBoundElementOutline(arrow, bindingKey(startOrEnd), element, point, elementsMap)`（PR3 删除激活条 / 曲线外移分支后的版本） |
| 折线 | 从 `bindPointToSnapToElementOutline` 抽出的 ③ 档轴射线函数（保留 `avoidRectangularCorner`），入参使用 `resolve` 给的 `point`，不读箭头当前端点 |

`bindingKey(startOrEnd)` 即 `startOrEnd === "start" ? "startBinding" : "endBinding"`。现有两个函数的签名都与 `RayProjector` 不同，必须包适配器；`resolve` 只认 `query.point`，不关心箭头当前端点。

悬停新建时 `arrow` 还不存在（只有 `{ elbowed }`），`rayProject` 返回 `null`：预览只显示 ①② 档的落点；真正拖拽建箭头时有箭头，③ 档正常。

### 4.3 非折线接入（3a）

#### 4.3.1 策略层

[binding.ts:518](../../packages/element/src/binding.ts#L518) 的 `current`：

```ts
// 旧
focusPoint:
  pointInElement || altKey
    ? globalPoint
    : projectAttachPointOntoDiagonal(...) || globalPoint

// 新
const otherEndPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
  arrow,
  startDragged ? 1 : -2,
  elementsMap,
);
const candidatePoint =
  opts?.angleLocked || appState.gridModeEnabled
    ? pointFrom<GlobalPoint>(scenePointerX, scenePointerY)
    : globalPoint;
const picked =
  opts?.altKey
    ? null
    : pickConnectionTarget(
        candidatePoint,
        elements,
        {
          reference: otherEndPoint,
          arrow,
          zoom: appState.zoom.value,
          isMidpointSnappingEnabled: appState.isMidpointSnappingEnabled,
          gridSize: appState.gridModeEnabled ? appState.gridSize : undefined,
          angleLocked: opts?.angleLocked,
          elementsMap,
          adjacentPoint: otherEndPoint,
          startOrEnd: startDragged ? "start" : "end",
        },
        projectPointOntoBoundElementOutline,
      );

const current: BindingStrategy = picked
  ? {
      element: picked.element,
      focusPoint: picked.hit.point,
    }
  : { element: null };
```

- 候选选择从 `getHoveredElementForBinding` 改为 `pickConnectionTarget`；`element` 与 `hit` 同一次解析，不再二次求点；
- `altKey` 仍然「不绑定」，直接 `{ element: null }`；
- `pointInElement` / `isPointInElement` 不再需要（内部档由 `resolveConnectionHit` 判定）；
- 删除 `projectAttachPointOntoDiagonal` 调用；函数本身留到 PR6 删除。

#### 4.3.2 落定

`resolveAttachPointForNonElbowBinding` 新签名：

```ts
export const resolveAttachPointForNonElbowBinding = (
  arrow: NonDeleted<ExcalidrawLinearElement>,
  hoveredElement: NonDeleted<ExcalidrawBindableElement>,
  startOrEnd: "start" | "end",
  elementsMap: ElementsMap,
  focusPoint?: GlobalPoint,
  shouldSnapToOutline = true,
  opts?: {
    zoom: number;
    isMidpointSnappingEnabled: boolean;
    angleLocked: boolean;
    reference?: GlobalPoint;
    gridSize?: NullableGridSize;
    adjacentPoint?: GlobalPoint;
  },
): { attachPoint: AttachPoint };
```

内部：

```ts
const endpoint = focusPoint ?? arrowEndpoint(arrow, startOrEnd, elementsMap);
const hit = shouldSnapToOutline
  ? resolveConnectionHit(
      buildConnectionQuery({
        element: hoveredElement,
        point: endpoint,
        reference: opts?.reference,
        arrow,
        zoom: opts?.zoom ?? 1,
        isMidpointSnappingEnabled:
          opts?.isMidpointSnappingEnabled ?? true,
        gridSize: opts?.gridSize,
        angleLocked: opts?.angleLocked ?? false,
        elementsMap,
        adjacentPoint: opts?.adjacentPoint,
        startOrEnd,
      }),
      projectPointOntoBoundElementOutline,
    )
  : null;

return calculateAttachPointForNonElbowArrowBinding(
  arrow,
  hoveredElement,
  startOrEnd,
  elementsMap,
  hit?.point ?? endpoint,
);
```

`opts` 缺省时保持旧行为（`zoom = 1`、`isMidpointSnappingEnabled = true`、`angleLocked = false`），由调用方逐步补齐。所有调用方必须在同一 PR 内补参：

- `bindBindingElement`：从 `scene` / `appState` 取 zoom、grid、midpoint flag；
- `linearElementEditor.ts:2550` / `:2589`：从 `app` 取；
- `App.quickCreate.ts:2511`：从 `this.app` 取。

没有 viewport 上下文的调用方（connectorScene / flowchart / transform 等）传 `zoom = 1`。这些路径不来自用户指针拖拽，不在 G2 的预览 = 落点验收范围内；基线允许差异，但必须在 PR 描述里列出。

#### 4.3.3 预览

- `pointerCanvas` 的两段 legacy hover 全部删除；由 `applyPointerFrame` 的 `connection` 分支唯一写入派生镜像：
  ```ts
  case "connection": {
    const element = app.scene.getNonDeletedElement(frame.target.elementId);
    if (element) {
      app.setState((prev) =>
        isSameSuggestedBinding(prev.suggestedBinding, {
          element,
          hit: frame.target.hit,
        })
          ? null
          : { suggestedBinding: { element, hit: frame.target.hit } },
      );
    }
    break;
  }
  ```
- `clearPointerHover` 负责清空 `suggestedBinding`，修掉箭头工具 hover 只设不清的旧行为。
- `isSameSuggestedBinding` 按 `element.id / tier / anchorIndex / point` 比较，避免每帧 setState。
- `pointerSelection.ts:1531` 改用 `pickConnectionTarget`：`boundElement = picked?.element`、`hit = picked?.hit`；不要保留 `getHoveredElementForBinding`。初始绑定与预览一致。该路径属于 gesture owner，可直接调用 `applyConnectionFrame(app, element, hit)`（内部写 frame + 镜像）。

#### 4.3.4 渲染器

`renderBindingHighlightForBindableElement_simple`（[interactiveScene.ts:599](../../packages/excalidraw/renderer/interactiveScene.ts#L599)）改为只读 `suggestedBinding.hit`：

- 空心环：`hit.anchors`；
- 实心大圆：`hit.tier === "anchor"` 时的 `hit.point`；
- 实心小圆：`hit.tier === "outline" | "interior"` 时的 `hit.point`；
- 删除 `getSnapOutlineMidPoint`、`getCompositeShapeAnchors` 的中段计算，以及 [interactiveScene.ts:737](../../packages/excalidraw/renderer/interactiveScene.ts#L737) 的激活条特例。

### 4.4 折线接入（3b）

#### 4.4.1 `bindPointToSnapToElementOutline`

在函数开头（`arrowElement.points.length >= 2` 之后）先判 ①②：

```ts
const query = buildConnectionQuery({
  element: bindableElement,
  point: LinearElementEditor.getPointAtIndexGlobalCoordinates(...),
  reference: otherEndpoint,
  arrow: arrowElement,
  zoom,
  isMidpointSnappingEnabled,
  elementsMap,
});
const hit = resolveConnectionHit(query, elbowRayProject);
if (hit) {
  return hit.point;
}
// ③ 档：沿用原有轴射线逻辑，但删除 snapToMid
```

- `avoidRectangularCorner` 只保留在 ③ 档；
- 删除 `snapToMid` 调用（[binding.ts:1135](../../packages/element/src/binding.ts#L1135)）；
- `calculateAttachPointForElbowArrowBinding` 增加 `opts`（zoom / isMidpointSnappingEnabled / angleLocked / gridSize），并透传；
- `headingForPointFromElement` 按落点所在边给方向；核对 `getHeadingForElbowArrowSnap` 在新落点下的路由。

**调用链补参**（3b 的主要工作量）：

| 调用方 | 现有上下文 | 处理 |
| --- | --- | --- |
| `bindOrUnbindBindingElement` / strategy | `appState.zoom` | 直接传入 |
| `bindBindingElement` | 签名无 zoom | 增加可选 `zoom` 参数；调用方有 appState 的传值，没有的传 1 |
| `calcAttachPointForElbowArrowBinding` | 签名无 zoom | 增加 `opts`，默认 `zoom = 1`、`isMidpointSnappingEnabled = true` |
| `reanchorBindingsToOutline` | 只有 scene | 传 1；接受基线差异（见 §5） |
| yjs `createSceneConnectionEndpoint` | 无 viewport | 传 1；接受基线差异 |
| `actionProperties.tsx` | 有 `app.state.zoom` | 传入 |
| `elbowArrow.getElbowArrowData` → `getGlobalPoint` | 已有 `options.zoom` / `isMidpointSnappingEnabled`（[elbowArrow.ts:1202](../../packages/element/src/elbowArrow.ts#L1202)） | 增加并透传 `zoom`；`gridSize` / `angleLocked` 保持缺省（折线拖拽现状不做网格 / Shift 吸附，不借机改变） |

`getGlobalPoint` 的调用点只有 [elbowArrow.ts:1248](../../packages/element/src/elbowArrow.ts#L1248) 与 `:1265`，由 `getElbowArrowData` 统一补参。

**候选层例外**：折线路由的 target 仍由 `elbowArrow.getHoveredElement`（内部 `getHoveredElementForBinding`）选出，3b 不改候选选择，只把选中的元素交给 `resolveConnectionHit` 求点。若基线出现「frame 内部深处」等候选差异，记录为已知限制，不阻塞 3b。

#### 4.4.2 预览

`linearElementEditor.ts:2450` 的 `suggestedBinding` 改为 `hit`；预览与落定同函数。`suggestedBinding` 比较改为字段比较（见 §4.6）。

### 4.5 时序消息接入

`sequenceMessage.ts` 保留目标选择职责，落点改为统一函数：

```ts
const axis = getSequenceMessageAxis(arrow, startOrEnd, elementsMap);
if (axis) {
  const constrained = constrainSequenceMessagePoint(axis, pointer);
  const target = findSequenceMessageTarget(
    axis, pointer, elements, elementsMap, zoom,
  );
  const hit = target
    ? resolveConnectionHit(
        buildConnectionQuery({
          element: target,
          point: constrained,
          reference: axis.anchor,
          arrow,
          zoom,
          isMidpointSnappingEnabled: true,
          elementsMap,
        }),
        // activation spec 的 interior = "nearest"，rayProject 不会被调用
        () => null,
      )
    : null;
  return hit
    ? { element: target, focusPoint: hit.point }
    : { element: null };
}
```

改造点：

- `getActivationBindingPoint` 的四处调用（[binding.ts:1385](../../packages/element/src/binding.ts#L1385)、`:1813`、[utils.ts:533](../../packages/element/src/utils.ts#L533)、[interactiveScene.ts:744](../../packages/excalidraw/renderer/interactiveScene.ts#L744)）全部移除；
- `snapToMid` 的 activation 分支删除；
- `getSnapOutlineMidPoint` 的 activation 分支删除（函数本身 PR6 删除）；
- `App.quickCreate.resolveSequenceMessagePlacement` 的「既有激活条」分支改用 `hit.point`；自消息 / 杆上建条逻辑保持到 PR4；
- `SEQUENCE_MESSAGE_SNAP_DISTANCE`、`SEQUENCE_CONNECTION_SNAP_DISTANCE`、`INSIDE_TOLERANCE` 并入 `connection/thresholds.ts`，原模块改为 import。

### 4.6 `suggestedBinding` 降为派生镜像

类型改为：

```ts
suggestedBinding: {
  element: ExcalidrawBindableElement;
  hit: ConnectionHit;
} | null;
```

写入者只允许：

- `applyPointerFrame`（hover / armed 的 `connection` target）；
- 端点拖拽的 gesture owner（`linearElementEditor` / `App.quickCreate` 的时序拖拽）。

其他模块只读。`linearElementEditor.ts:493` 的 `isShallowEqual` 改为：

```ts
const isSameSuggestedBinding = (
  a: AppState["suggestedBinding"],
  b: AppState["suggestedBinding"],
) =>
  a?.element.id === b?.element.id &&
  a?.hit.tier === b?.hit.tier &&
  a?.hit.anchorIndex === b?.hit.anchorIndex &&
  a?.hit.point[0] === b?.hit.point[0] &&
  a?.hit.point[1] === b?.hit.point[1];
```

避免每帧 `setState`。

所有预览入口的候选选择统一为 `pickConnectionTarget`；`getHoveredElementForBinding` 只保留在非落点路径（例如折线路由的 hovered element 选择、`findSequenceMessageTarget` 之外的一般命中）。

### 4.7 删除的重复入口

PR3 可删除（确认无其他调用方）：

- `projectAttachPointOntoDiagonal` 的调用（函数 PR6 删）；
- `getDiagonalsForBindableElement` 的调用（函数 PR6 删）；
- `projectPointOntoBoundElementOutline` 的激活条分支与曲线外移分支；
- `snapToMid` 的 activation 分支；
- 渲染器内中点 / 阈值 / 激活条圆点的重复计算；
- `pointerCanvas` 箭头 hover 只设不清的分支。

## 5. 允许的行为变化

只允许 [connection-snap-pipeline.md §2.6](../connection-snap-pipeline.md) 列出的三类：

1. 指针在图形内部靠近边中点时也吸推荐点；
2. 外侧带内落点从「朝另一端的射线交点」变为「最近点」；
3. 内部越过内侧带时落点切换，预览同步跳变。

另加两类由本计划引入、必须进基线对比：

- 折线箭头（3b）在 yjs 建连、切换箭头类型时，会随新落点得到不同 `attachPoint`；
- 时序消息在激活条上的落点可能从 `getActivationBindingPoint` 的近似结果变为 spec 的最近点（应一致；若不一致按 bug 处理）。

## 6. 测试

### 6.1 G2 预览 = 落点

对每个图形家族 × 三种箭头 × 四种模式：

```text
拖动端点 → 记录 frame.target.hit.point → 松手
→ 从 arrow 的 binding 解出全局端点
→ 断言误差 < 0.01
```

悬停新建单独一组：悬停圆点 = pointerdown 后的起点。

### 6.2 G3 推荐点

- 半径内即使轮廓最近点更近也取推荐点；
- 关闭中点吸附后不再取推荐点；
- 小图形（边长 < 4 × 推荐点半径）仍能落到边上任意点。

### 6.3 G1 任意点

- 边上随机采样 100 点，全部能成为落点；
- 落定后移动 / 缩放元素，端点保持原比例。

### 6.4 时序消息

- 现有 `sequenceShape.test.ts` 激活条落点用例保持通过；
- 新增「悬停预览贴边 = 松手贴边」「指针压在条中心不翻边」；
- `quickCreateHandles.test.tsx` 中消息拖拽用例保持通过。

### 6.5 回归

- PR1 基线逐条对比；差异必须落在 §5；
- 方向键微调、yjs 非折线、重锚、曲线判边不变；
- Shift / Alt / 网格 / 文本 gap 0 不变。

## 7. 实施步骤

### 3a 非折线

- [ ] 实现 `connection/query.ts`；迁移 `snapBoundPointToGrid`。
- [ ] 注册 `connection` provider；删除 `pointerCanvas` 两个 legacy hover 入口，由 `applyPointerFrame` 的 `connection` 分支写 `suggestedBinding` 镜像。
- [ ] 改 `getBindingStrategyForDraggingBindingElementEndpoints_simple` 的 focusPoint。
- [ ] 改 `resolveAttachPointForNonElbowBinding` 与所有调用方补参。
- [ ] 改 `pointerSelection.ts:1531` 初始绑定 / 预览。
- [ ] 改 `linearElementEditor.ts:2560` / `:2599` 预览。
- [ ] 改渲染器只读 `hit`；删除激活条圆点特例。
- [ ] 改 `suggestedBinding` 类型与比较函数。
- [ ] 时序消息接入（4.5）。
- [ ] 删除 §4.7 中 3a 可删的重复入口。
- [ ] 测试 + 基线对比。

### 3b 折线

- [ ] 抽出 ③ 档轴射线函数（保留 `avoidRectangularCorner`）。
- [ ] `bindPointToSnapToElementOutline` 先判 ①②；删除 `snapToMid`。
- [ ] `calculateAttachPointForElbowArrowBinding` 补 opts；调用方透传。
- [ ] `elbowArrow.ts:2229` 补参。
- [ ] `linearElementEditor.ts:2450` 预览改 `hit`。
- [ ] 核对 `headingForPointFromElement` / `getHeadingForElbowArrowSnap` 路由。
- [ ] 单独 PR；基线逐条审阅。

## 8. 验收

- [ ] 6 个预览入口全部经 `resolveConnectionHit`。
- [ ] 落点与预览同源；误差 < 0.01。
- [ ] `suggestedBinding` 只有 frame dispatch / gesture owner 写入。
- [ ] `getActivationBindingPoint` 无调用方（可留函数到 PR6）。
- [ ] `snapToMid` 无调用方（3b 后）。
- [ ] 基线差异全部落在 §5。
- [ ] `yarn workspace element test` / `typecheck`、`yarn workspace excalidraw test` / `typecheck` 通过。

## 9. 风险

| 风险 | 触发 | 缓解 |
| --- | --- | --- |
| 折线路由回归 | 3b | 单独 PR；基线逐条；先关 ①② 只跑 ③，再开 ①② |
| 预览与落点仍分叉 | 3a | 同 PR；`buildConnectionQuery` 唯一构造；G2 测试 |
| `suggestedBinding` 类型改动遗漏 | 全 PR | typecheck 会列出所有消费者；逐个改 |
| 时序消息与 pole 预览冲突 | 4.5 | 只改「既有激活条」分支；自消息 / pole 逻辑留 PR4 |
| `snapBoundPointToGrid` 迁移引入循环依赖 | query.ts | connection 不 import binding；binding import query |
| 网格模式落点漂移 | 3a | 基线网格档逐条对比；`snapBoundPointToGrid` 数值不变 |

## 10. 不做

- 不迁移 quick-create 手柄 / pole activation（PR4）。
- 不删除 `suggestedBinding`（PR6）。
- 不改 yjs / 方向键 / 重锚的纯换算路径。
- 不开放表格 / fragment 绑定。
- 不加 ②/③ 迟滞。

## 实施记录（2026-11-14）

- 实际改动：新增 `pointerConnection.ts` provider 与 `connection/query.ts`；非折线 /
  折线箭头端点统一走 `resolveConnectionHitForArrowEndpoint`；预览与落点共用
  `ConnectionHit`；`suggestedBinding` 改为镜像（PR6 已删除）。
- 与计划的偏差：`snapToMid` 在 3b 后无生产消费者（6b 删除）；折线保留
  `avoidRectangularCorner`；多点箭头 landing 使用相邻点（start→1 / end→-2）。
- 基线变化：非折线 286 条落点（①27 / ②184 / ③75），折线 155 条（①13 / ②123 / ③19），
  未分类 0。
- 测试：`connectionQuery`、`connectionPreview`、`elbowConnection`、落点基线。
