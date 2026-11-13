# PR1：连接几何与基线冻结

> **状态**：未开始。
> **依赖**：无。可与 PR2 并行开发。
> **交付后的结果**：仓库里出现一个**无调用方**的纯几何模块 `packages/element/src/connection/`，以及一份覆盖现状落点的基线测试。生产行为零变化。
> **设计来源**：[connection-snap-pipeline.md](../connection-snap-pipeline.md) §2–§4。

## 1. 目标

| # | 目标 | 验收 |
| --- | --- | --- |
| G1 | 冻结 HEAD 的连接落点行为 | 基线测试在当前代码上通过，快照入库 |
| G2 | 实现 Γ、三档判定、`ConnectionSpec`、`resolveConnectionHit` | 单测覆盖每个图形家族 × 三档 |
| G3 | 实现 `pickConnectionTarget`（候选选择 + 求点） | 候选顺序与 `getHoveredElementForBinding` 一致 |
| G4 | 证明幂等性 | 沿网格扫描 `p`，`resolve(resolve(p).point).point ≈ resolve(p).point` |
| G5 | 证明 Γ 一致性 | ②③ 档落点到元素的距离 = gap（含圆角、尖角） |

## 2. 非目标

- 不接入任何调用方。`connection/` 模块不得被 `binding.ts`、`pointerCanvas.ts`、`App.quickCreate.ts` 引用。
- 不删除旧函数（`snapToMid`、`getSnapOutlineMidPoint`、`projectAttachPointOntoDiagonal`、`getActivationBindingPoint`）。
- 不改变 `binding.attachPoint` 数据结构与跟随逻辑。
- 不开放表格 / fragment 绑定。
- 不改渲染。

## 3. 现状：四条链与六个预览入口

> 行号以 `cbfe0fdc` 为准。PR1 只读这些路径，不改它们。

### 3.1 非折线箭头

| 环节 | 位置 | 关键行为 |
| --- | --- | --- |
| 拖拽策略 | [binding.ts:387](../../packages/element/src/binding.ts#L387) | `getHoveredElementForBinding` 选候选；时序消息分支 :493；`projectAttachPointOntoDiagonal` :524 |
| 非折线落点 | [binding.ts:1927](../../packages/element/src/binding.ts#L1927) | `resolveAttachPointForNonElbowBinding` → `projectPointOntoBoundElementOutline` :1777 |
| 投影 | [binding.ts:1777](../../packages/element/src/binding.ts#L1777) | 激活条分支 :1812、曲线法线外移 :1835、「焦点 → 另一端」射线 ∩ 外扩轮廓 :1876 |
| 纯换算 | [binding.ts:2062](../../packages/element/src/binding.ts#L2062) | `calculateAttachPointForNonElbowArrowBinding`：全局点 → 比例，**必须保持纯换算** |

纯换算的直接调用方（PR1 不改）：

- 方向键微调：[keyboard.ts:210](../../packages/excalidraw/components/app/keyboard.ts#L210)、`:225`；
- yjs 建连：[element-factory.ts:63](../../packages/yjs/src/element-factory.ts#L63)；
- 类型转换重锚：[binding.ts:785](../../packages/element/src/binding.ts#L785)；
- 曲线判边：[binding.ts:1837](../../packages/element/src/binding.ts#L1837)。

### 3.2 折线箭头

| 环节 | 位置 | 关键行为 |
| --- | --- | --- |
| 吸附主函数 | [binding.ts:1086](../../packages/element/src/binding.ts#L1086) | `avoidRectangularCorner`、`snapToMid`（:1135）、轴向射线 :1130–:1186、非折线分支 :1189 |
| 拖拽每帧 | [elbowArrow.ts:2229](../../packages/element/src/elbowArrow.ts#L2229) | `getGlobalPoint` 调用 `bindPointToSnapToElementOutline` |
| 落定 | [binding.ts:1998](../../packages/element/src/binding.ts#L1998) | `calculateAttachPointForElbowArrowBinding` |

`calculateAttachPointForElbowArrowBinding` 的调用方还包括 `bindBindingElement`、`reanchorBindingsToOutline`、`actionProperties.tsx`（切换箭头类型）、yjs。PR1 只记录，不改。

### 3.3 时序消息

| 函数 | 位置 | 行为 |
| --- | --- | --- |
| `SEQUENCE_MESSAGE_SNAP_DISTANCE = 12` | [sequenceMessage.ts:62](../../packages/element/src/sequenceMessage.ts#L62) | 屏幕 px |
| `getSequenceMessageAxis` | [sequenceMessage.ts:117](../../packages/element/src/sequenceMessage.ts#L117) | 另一端绑在激活条上时给出水平轴 |
| `constrainSequenceMessagePoint` | [sequenceMessage.ts:160](../../packages/element/src/sequenceMessage.ts#L160) | 投到轴、夹在朝外半轴 |
| `findSequenceMessageTarget` | [sequenceMessage.ts:187](../../packages/element/src/sequenceMessage.ts#L187) | 唯一目标规则：排除源、朝前、y 落在竖向范围、指针在 snap 内 |
| `getActivationBindingPoint` | [sequenceOutline.ts:439](../../packages/element/src/compositeShape/sequenceOutline.ts#L439) | 激活条贴边点：朝向参考点的竖边 + 指针 y + gap |

`App.quickCreate` 另有一套 `SEQUENCE_CONNECTION_SNAP_DISTANCE` / `INSIDE_TOLERANCE`（见 [App.quickCreate.ts:1195](../../packages/excalidraw/components/App.quickCreate.ts#L1195)）。PR1 不合并，PR3 / PR4 处理。

### 3.4 预览入口（PR3 的改造对象）

| 入口 | 位置 | 当前求点 |
| --- | --- | --- |
| 绑定类工具悬停 | [pointerCanvas.ts:945](../../packages/excalidraw/components/app/pointerCanvas.ts#L945) | `getSnapOutlineMidPoint` |
| 箭头工具悬停 | [pointerCanvas.ts:1093](../../packages/excalidraw/components/app/pointerCanvas.ts#L1093) | `getSnapOutlineMidPoint` |
| 新建箭头 pointerdown | [pointerSelection.ts:1531](../../packages/excalidraw/components/app/pointerSelection.ts#L1531) | `getSnapOutlineMidPoint` |
| 折线端点拖拽 | [linearElementEditor.ts:2450](../../packages/element/src/linearElementEditor.ts#L2450) | `snapToMid` |
| 非折线起点 / 终点拖拽 | [linearElementEditor.ts:2560](../../packages/element/src/linearElementEditor.ts#L2560)、`:2599` | `getSnapOutlineMidPoint`，带另一端 |
| 渲染器 | [interactiveScene.ts:3726](../../packages/excalidraw/renderer/interactiveScene.ts#L3726) | 激活条特例 + 自行再算中点 / 阈值 |

## 4. 模块设计

```text
packages/element/src/connection/
  thresholds.ts   阈值常量与派生函数
  types.ts        ConnectionQuery / ConnectionHit / OutlinePath
  spec.ts         ConnectionSpec 类型 + getConnectionSpec
  specs.ts        §5 注册表
  outline.ts      getInflatedOutlinePaths / nearestPointOnOutline
  resolve.ts      resolveConnectionHit / pickConnectionTarget
  index.ts        公共导出
```

约束：

- `connection/` 只能依赖 `@excalidraw/math`、`@excalidraw/common` 与 `packages/element` 内部几何函数；
- 不得 import `binding.ts`、`cursor`、`appState`、`App`；
- `resolve.ts` 不得出现 `is*Element` 图形分支（`isElbowArrow` 例外）。

### 4.0 先拆依赖：`bindingGap.ts`

`getBindingGap`（[binding.ts:123](../../packages/element/src/binding.ts#L123)）、`getProjectionBindingGap`（`:171`）、`maxBindingDistance_simple`（`:183`）目前都在 `binding.ts`。PR3 之后 `binding.ts` 会 import `connection/`，如果 `connection/` 反过来 import `binding.ts` 就形成循环。

PR1 先把这三个函数与它们用到的常量（`BASE_BINDING_GAP` / `BASE_BINDING_GAP_ELBOW` 等）迁到：

```text
packages/element/src/bindingGap.ts
```

`binding.ts` 改为 `export { ... } from "./bindingGap"`（保持现有 import 路径可用），`connection/` 只从 `bindingGap.ts` 读取 gap / 绑定距离。

这一步是纯搬迁：函数体、数值、默认值不变；PR1 的基线会锁住结果。

### 4.1 `thresholds.ts`

```ts
export const ANCHOR_RADIUS_PX = 14;       // 屏幕 px
export const OUTLINE_INSIDE_BAND_PX = 10; // 屏幕 px

export const getOutsideBand = (zoom: number, gap: number): number =>
  // 至少覆盖 gap：Γ 上的点距轮廓正好一个 gap，否则幂等性会被
  // 「② 档判定不到 Γ 上的点」破坏（粗描边 / 大 gap 时会出现）。
  Math.max(maxBindingDistance_simple({ value: zoom }), gap);

export const getInsideBand = (
  element: { width: number; height: number },
  zoom: number,
): number =>
  Math.min(
    OUTLINE_INSIDE_BAND_PX / zoom,
    0.25 * Math.min(element.width, element.height),
  );

export const getAnchorRadius = (
  element: { width: number; height: number },
  zoom: number,
  gap: number,
): number =>
  Math.min(
    ANCHOR_RADIUS_PX / zoom,
    getOutsideBand(zoom, gap),
    0.25 * Math.min(element.width, element.height),
  );
```

`zoom` 取 `AppState["zoom"].value`；`zoom <= 0` 时按 1 处理。阈值函数是纯函数，PR1 单测覆盖 0.25 / 1 / 4。

> 与 [connection-snap-pipeline.md §2.3](../connection-snap-pipeline.md) 的差异：`outsideBand` 至少取 `gap`。
> 正常 gap 下数值完全一致；只有粗描边 / 大 gap 时才会放大，用于保证「Γ 上的点再求一次仍落回 Γ」（幂等性）。

### 4.2 `types.ts`

```ts
import type { GlobalPoint } from "@excalidraw/math";
import type { CompositeShapePath } from "../compositeShape/outline";

export type ConnectionCtx = {
  /** 箭头另一端；悬停新建时无 */
  reference?: GlobalPoint;
  elementsMap: ElementsMap;
};

export type ConnectionQuery = {
  element: ExcalidrawBindableElement;
  /** 端点位置（已做网格 / Shift / 时序水平约束） */
  point: GlobalPoint;
  reference?: GlobalPoint;
  /** 用于 gap、折线 / 曲线分支；悬停新建时给 `{ elbowed }` 即可 */
  arrow?: ExcalidrawLinearElement | { elbowed: boolean };
  zoom: number;
  anchorsEnabled: boolean;
  angleLocked: boolean;
  elementsMap: ElementsMap;
  /** 求的是箭头哪一端；只影响 rayProject 的 binding key，悬停新建默认 start */
  startOrEnd?: "start" | "end";
};

export type ConnectionHit = {
  tier: "anchor" | "outline" | "interior";
  /** Γ 上的最终端点 */
  point: GlobalPoint;
  anchorIndex?: number;
  /** 轮廓上的推荐点，供渲染空心环 */
  anchors: GlobalPoint[];
};

export type OutlinePath = CompositeShapePath;
```

`ConnectionQuery` 在 PR1 只作为 `resolveConnectionHit` 的入参；`buildConnectionQuery` 的 App 侧构造放在 PR3。

gap 的计算统一为：

```ts
const gap = getProjectionBindingGap(
  element,
  query.arrow ?? ({ elbowed: false } as const),
);
```

文本目标由 `getProjectionBindingGap` 返回 0；不要在 `connection/` 里另写文本分支。

### 4.3 `spec.ts` / `specs.ts`

```ts
export interface ConnectionSpec {
  /** 推荐点：轮廓上的点（不含 gap），全局坐标 */
  anchors(
    element: ExcalidrawBindableElement,
    ctx: ConnectionCtx,
  ): GlobalPoint[];
  /** 可连边：从元素现有轮廓分解里筛出允许连接的部分 */
  connectableOutline(
    element: ExcalidrawBindableElement,
    ctx: ConnectionCtx,
  ): OutlinePath[];
  /** 指针在内部深处：ray = 方向求交；nearest = 最近点；none = 不是候选 */
  interior: "ray" | "nearest" | "none";
}

export const getConnectionSpec = (
  element: ExcalidrawBindableElement,
): ConnectionSpec;
```

注册表沿用 [connection-snap-pipeline.md §3](../connection-snap-pipeline.md)：

| 家族 | 推荐点 | 可连边 | interior |
| --- | --- | --- | --- |
| 矩形 | 4 个边中点 | 全轮廓（含圆角） | `ray` |
| 菱形 / 椭圆 | `getCompositeShapeAnchors`（路径上的 4 个 cardinal 点） | 全轮廓 | `ray` |
| 复合图形 / 流程图形 | `getCompositeShapeAnchors` | 全轮廓；开路径只取路径本身 | `ray` |
| 文本（非容器内） | 4 个边中点 | 包围盒（gap 0） | `ray` |
| 便签 / mindmap 节点 / 图片 / iframe / embeddable | 4 个边中点 | 包围盒（含圆角） | `ray` |
| frame / magicframe | 4 个边中点 | 边框 | `none` |
| 激活条 | 无 | 有参考点：朝向参考点的竖边；无参考点：左右两条竖边 | `nearest` |
| 生命线 | 不可绑定 | — | — |

**frame 的 `interior = "none"` 是 `bindingBorderTest` 里「frame 不测内部」判据的唯一来源**（[collision.ts:331](../../packages/element/src/collision.ts#L331)）。PR1 只在新模块里表达，PR3 再把 `bindingBorderTest` 改为读 spec。

激活条的竖边在本地 y 上裁掉 1px（`[1, height - 1]`），与 `getActivationBindingPoint` 的 clamp 一致（[sequenceOutline.ts:451](../../packages/element/src/compositeShape/sequenceOutline.ts#L451)）；`nearest` 档因此落在裁后的边上，不会吸到条的端点。无参考点时左右两条边按距离取近；距离相等时取指针 x 所在侧，与 `getActivationEdgeSide` 一致。

### 4.4 `outline.ts`

```ts
export type ConnectionOutline = {
  /** 可连轮廓 O（元素轮廓上允许连接的部分） */
  outline: OutlinePath[];
  /** Γ：O 向外扩 gap 后的轮廓 */
  inflated: OutlinePath[];
};

export const buildConnectionOutline = (
  element: ExcalidrawBindableElement,
  gap: number,
  spec: ConnectionSpec,
  ctx: ConnectionCtx,
): ConnectionOutline;

export const nearestPointOnOutline = (
  paths: OutlinePath[],
  point: GlobalPoint,
  opts: { zoom: number },
): { point: GlobalPoint; distance: number };
```

`resolve.ts` 用 `outline` 量 ② 档距离，用 `inflated` 求落点；两者来自同一次构建，避免 spec 被调用两次。

性能：

- `pickConnectionTarget` 先用 `distanceToElement` 做廉价拒绝，再 `buildConnectionOutline`；
- Γ 可按 `(element.id, element.version, gap)` 缓存（`ShapeCache` 同款 WeakMap 思路），pointermove 只做最近点投影。

构建方式必须与 `intersectElementWithLineSegment` 的 offset 几何同源：

| 家族 | 构建方式 |
| --- | --- |
| 矩形类 / 文本 / 便签 / frame / 图片 / iframe / embeddable / 激活条 | `deconstructRectanguloidElement(element, gap)`（[utils.ts:250](../../packages/element/src/utils.ts#L250)）得到 **未旋转** 的 sides / corners；按元素中心旋转后组成路径 |
| 椭圆 | `getCompositeShapeGeometry(element).primitive` 取半径，半径 + gap；用 4 段三次贝塞尔近似（kappa ≈ 0.5523），误差 < 0.5 屏幕 px |
| 复合图形 / 流程图形 | `getCompositeShapeOffsetPaths(element, gap)`（[geometry.ts:183](../../packages/element/src/compositeShape/geometry.ts#L183)），返回 **已旋转的全局折线**；用 `pathFromPoints(points, closed)` 转成 `OutlinePath` |
| 开路径（大括号） | 只取路径本身；`interior` 不扩张 |

注意「矩形 / 菱形 / 椭圆」按元素实际类型分流：矩形走 rectanguloid；菱形 / 椭圆是 `composite` 的 `shape.id`，分别走 composite 与 ellipse 分支。注册表按语义分组，构建器按实际类型分派。

`mindmap-node` 同理按 `getMindmapNodeGeometry`（pill / 非 pill）的实际几何构建，不要一律用包围盒；表格与生命线不在注册表。

`nearestPointOnOutline`：

- 线段：精确投影到线段；
- 三次贝塞尔：先在参数域按 `max(16, ceil(chordLength * zoom / 4))` 采样，再对最优小区间做 ternary search，保证屏幕误差 ≤ 0.5 px；
- 返回最近点、距离与所在路径；调用方只取点与距离。

> **注意**：`flattenCompositeShapePath` 的步长是场景单位 4px，高缩放下不够。PR1 不得直接拿它当最终精度，必须按上面做屏幕空间细化。

### 4.5 `resolve.ts`

```ts
export type RayProjector = (
  args: {
    element: ExcalidrawBindableElement;
    point: GlobalPoint;
    reference?: GlobalPoint;
    arrow?: ExcalidrawLinearElement | { elbowed: boolean };
    elementsMap: ElementsMap;
    startOrEnd: "start" | "end";
  },
) => GlobalPoint | null;

export const resolveConnectionHit = (
  query: ConnectionQuery,
  rayProject: RayProjector,
): ConnectionHit | null;

export const pickConnectionTarget = (
  point: GlobalPoint,
  elements: readonly Ordered<NonDeletedExcalidrawElement>[],
  query: Omit<ConnectionQuery, "element" | "point">,
  rayProject: RayProjector,
): { element: ExcalidrawBindableElement; hit: ConnectionHit } | null;
```

判定顺序（先命中者胜）：

| 档 | 条件 | 落点 |
| --- | --- | --- |
| ① `anchor` | `anchorsEnabled` 且 `p` 到某推荐点（轮廓上的点）距离 ≤ `getAnchorRadius` | 该推荐点在 Γ 上的最近点 |
| ② `outline` | `p` 到**可连轮廓 O** 的距离 ≤ 外侧带；或 `p` 在元素内且到 O 的距离 ≤ 内侧带 | Γ 上离 `p` 最近的点 |
| ③ `interior` | `p` 在元素内部更深处 | `spec.interior = "nearest"` → 同 ②；`"ray"` → `rayProject`；`"none"` → `null` |

注意：② 档的距离量的是 **O = `spec.connectableOutline(...)`**，不是元素全轮廓。激活条只开放朝向参考点的一条竖边时，指针在另一条竖边附近不会命中；落点仍取 Γ 上最近点。

对应到 `buildConnectionOutline` 的返回值：

```text
② 距离   = nearestPointOnOutline(outline.outline, p).distance
② 落点   = nearestPointOnOutline(outline.inflated, p).point
① 落点   = nearestPointOnOutline(outline.inflated, anchor).point
```

细节：

- `angleLocked`：跳过 ①②，直接 `rayProject`；
- 网格模式：`anchorsEnabled = false`，跳过 ①；point 已由 `buildConnectionQuery` 网格吸附，②③ 正常；
- `anchorsEnabled = false`（其他原因）：跳过 ①；
- `rayProject` 收到 `query.startOrEnd ?? "start"`；返回 `null` 时，`interior === "ray"` 退回 ② 的最近点，仍无 → `null`；
- `hit.anchors` 始终返回全部推荐点（供渲染空心环），即使当前命中 ②③；
- 落点必须落在 Γ 上（① 是 Γ 上的最近点；②③ 同）。

`pickConnectionTarget`：

```ts
const candidates = getAllHoveredElementAtPoint(point, elements, elementsMap)
  // 与 getHoveredElementForBinding 的「偏好小图形」一致：面积小的先试
  .sort((a, b) => a.width ** 2 + a.height ** 2 - (b.width ** 2 + b.height ** 2));

for (const element of candidates) {
  const hit = resolveConnectionHit({ ...query, element, point }, rayProject);
  if (hit) return { element, hit };
}
return null;
```

候选来源与排序沿用 [collision.ts:376](../../packages/element/src/collision.ts#L376) / [collision.ts:409](../../packages/element/src/collision.ts#L409) 的「偏好小图形」口径；`interior = "none"` 的元素在内部深处返回 `null`，自然让给下一个候选（这是与现状的唯一预期差异：frame 内部深处会让给下层元素）。

### 4.6 幂等与 Γ 一致性

必须满足：

```text
resolve(resolve(p).point).point ≈ resolve(p).point   // 误差 ≤ 1e-6
distanceToElement(hit.point, element) ≈ gap          // 误差 ≤ 0.01
```

PR1 用性质测试扫描每个家族 × 三种箭头 × zoom 0.25 / 1 / 4。若性质不成立，PR3 的「从箭头读端点再求一次」会漂移，禁止进入 PR3。

## 5. 基线冻结

### 5.1 新增 `packages/element/_tests_/connectionBaseline.test.tsx`

使用真实 App 与指针（`API.setElements` + `mouse.downAt/moveTo/up`，参考 [bindingOutlineProjection.test.tsx:241](../../packages/element/_tests_/bindingOutlineProjection.test.tsx#L241)）。

矩阵：

| 维度 | 取值 |
| --- | --- |
| 图形 | 矩形、菱形、椭圆、复合图形（flow）、文本、便签、frame、激活条 |
| 位置 | 中心、四边中点内外、四角、边上任意点、内部浅处 / 深处、外侧带内 / 带外 |
| 箭头 | 直线、曲线、折线 |
| 模式 | 默认、Shift、网格、`isMidpointSnappingEnabled = false` |
| 操作 | ① 从空白新建箭头 → 目标 → 松手；② 选中已有箭头后拖起点 / 终点 → 目标 → 松手。记录 `binding.elementId`、`attachPoint`、全局端点 |

快照写法：

```ts
expect(record).toMatchSnapshot("rect/line/edge-right/default");
```

基线文件入库后逐条审阅，确认是 HEAD 的真实行为。之后任何 PR 修改落点，都必须先解释差异属于 `connection-snap-pipeline.md` §2.6 的哪一类。

### 5.2 非用户路径守卫

这些路径不走指针拖拽，但共享落点函数，必须单独锁住：

| 路径 | 测试位置 | 断言 |
| --- | --- | --- |
| 方向键微调 | `packages/excalidraw/_tests_/` 现有箭头测试 | 端点只按方向键移动，不重新吸附 |
| yjs 非折线建连 | `packages/yjs` 测试 | `createSceneConnectionEndpoint` 的 attachPoint 不变 |
| 切换箭头类型 | `packages/excalidraw/_tests_/` actionProperties 测试 | 转换后 attachPoint 与基线一致 |
| 类型转换重锚 | `packages/element/_tests_/` transform 测试 | 重锚结果与基线一致 |

### 5.3 基线为什么必须在 PR1

PR3 会改变落点（任意点、推荐点半径、内部档位）。没有 PR1 的基线，PR3 的回归差异无法区分「预期变化」与「破坏」。PR1 不允许有任何生产行为变更。

## 6. 实施步骤

- [ ] 拆出 `packages/element/src/bindingGap.ts`：迁移 `getBindingGap` / `getProjectionBindingGap` / `maxBindingDistance_simple` 与相关常量；`binding.ts` 改为 re-export。
- [ ] 创建 `packages/element/src/connection/` 目录与 `thresholds.ts` / `types.ts` / `spec.ts` / `specs.ts` / `index.ts` 骨架。
- [ ] 实现 `outline.ts` 的 O / Γ 构建与最近点（矩形类、椭圆、复合图形、开路径）。
- [ ] 实现 `resolve.ts` 三档与 `pickConnectionTarget`，`rayProject` 以参数注入。
- [ ] 用 `binding.ts` / `sequenceOutline.ts` 的现有函数在**测试里**作为 `rayProject`，不改生产 import。
- [ ] 写 `specs.ts` 注册表；先覆盖矩形 / 菱形 / 椭圆 / 复合图形 / 文本 / 便签 / frame / 激活条。
- [ ] 写单测：三档、`anchorsEnabled`、`angleLocked`、旋转、gap（文本 0）、zoom 0.25/1/4、小图形。
- [ ] 写性质测试：幂等、Γ 一致性。
- [ ] 写 grep 约束测试：`resolve.ts` 不出现 `is*Element`（`isElbowArrow` 允许）。
- [ ] 从 `packages/element/src/index.ts` 导出 `ConnectionHit` / `ConnectionQuery` / `resolveConnectionHit` / `pickConnectionTarget`，供 PR2 / PR3 使用。
- [ ] 写 `connectionBaseline.test.tsx` 并生成快照；逐条审阅后提交。
- [ ] 补非用户路径守卫（§5.2）。
- [ ] 运行 `yarn workspace element test` / `typecheck`。

## 7. 验收

- [ ] `connection/` 未被生产代码引用：`grep -R "from .*connection" packages/element/src --include=*.ts` 只出现在测试或自身。
- [ ] 基线快照在 HEAD 生成并通过。
- [ ] 三档单测与性质测试全绿。
- [ ] `resolve.ts` 无图形类型分支。
- [ ] 生产代码行为零变化；现有测试无新增失败。
- [ ] `yarn workspace element test`、`yarn workspace element typecheck` 通过。

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| 基线快照依赖 id / seed 顺序 | 测试前 `reseed(7)`；确定性元素构造；不使用随机坐标 |
| 椭圆最近点精度不足 | 贝塞尔近似 + 屏幕空间细化；单测断言到 Γ 距离误差 ≤ 0.01 |
| 复合图形 offset 与射线交点几何不一致 | Γ 直接使用 `getCompositeShapeOffsetPaths`，与 `intersectElementWithLineSegment` 同源；加 Γ 一致性测试 |
| 新增模块被提前接入 | PR1 不修改任何生产调用方；review 检查 import |

## 9. 不做

- 不实现 `buildConnectionQuery`（PR3）。
- 不修改 `binding.ts` / `utils.ts` / `interactiveScene.ts`。
- 不合并时序阈值。
- 不处理表格 / fragment。
