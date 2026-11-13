# 连接点与吸附统一：一期实施方案

> 关联：[pointer-affordance-unification.md](pointer-affordance-unification.md)（指针归属，二期接入）、
> 根目录 `TODO.md`「统一规划所有图形/图元的连接点与吸附策略」。
> **执行入口**：[pointer-pipeline/README.md](pointer-pipeline/README.md)。本文档的几何设计由 PR1（`01-connection-geometry.md`）实现，
> 由 PR3（`03-connection-integration.md`）接入；指针消费的统一由 PR2 / PR4 / PR5 承接。

## 0. 一期目标

| # | 产品目标 | 一期交付 |
| --- | --- | --- |
| G1 | **任意连接点** | 所有可绑定图形的可连轮廓上任意一点都能作为箭头端点 |
| G2 | **连接位置落点提示** | 悬停 / 拖拽时画出「松手后端点会落在哪」的圆点，且与真实落点一致（误差 < 0.01） |
| G3 | **推荐连接点，高优先级吸附** | 每种图形声明自己的推荐点；指针进入推荐点半径时优先吸附推荐点，胜过轮廓任意点 |
| G4 | **一套逻辑** | 所有「用户指定落点」的入口共用同一个求点函数；删除 `snapToMid`、`getSnapOutlineMidPoint`、`projectAttachPointOntoDiagonal` 和渲染器里重复的中点计算 |

约束：

- **数据结构不变**。`binding.attachPoint` 继续存「端点在未旋转包围盒里的归一化位置」，跟随继续刚性映射。
  旧文件、board-import 不需要改动。
- **可绑定范围不变**。表格 / fragment 开放绑定移到二期（见 §7）。
- 指针归属（A 层，`AffordanceProvider`）**不在一期**。一期只把同一功能的重复入口合并，不改事件分发顺序。

## 1. 现状

落点目前由四条互相独立的链决定，每条链又分「预览」和「落定」两处。

### 1.1 非折线箭头（直线 / 曲线）

```text
getBindingStrategyForDraggingBindingElementEndpoints_simple   binding.ts:387
  ├─ 候选元素：getHoveredElementForBinding（偏好小图形）
  ├─ 时序消息抢先：getSequenceMessageAxis / findSequenceMessageTarget   binding.ts:493
  └─ focusPoint：指针在内部 → 原点；在外部 → projectAttachPointOntoDiagonal
                 （中点吸附 getSnapOutlineMidPoint + 对角线投影）        utils.ts:597
resolveAttachPointForNonElbowBinding                          binding.ts:1927
  └─ projectPointOntoBoundElementOutline                      binding.ts:1777
       激活条分支 / 曲线法线外移 / 「焦点→另一端」射线 ∩ 外扩轮廓
       退化 → projectFocusPointOntoInflatedOutline（就近吸附）
calculateAttachPointForNonElbowArrowBinding                   binding.ts:2062
  └─ 纯换算：全局点 → 比例。不吸附。
```

`calculateAttachPointForNonElbowArrowBinding` 还被这些「点已经求好」的调用方直接使用，**它必须保持纯换算**：
方向键微调（`keyboard.ts:210/225`）、yjs `createSceneConnectionEndpoint`（`element-factory.ts:63`）、
类型转换重锚（`binding.ts:785`）、曲线判边（`binding.ts:1837`）。

### 1.2 折线箭头

```text
bindPointToSnapToElementOutline                               binding.ts:1086
  avoidRectangularCorner + snapToMid（按尺寸比例的吸附带）+ 轴向射线 ∩ 外扩轮廓
  ├─ 拖拽中每帧：elbowArrow.ts getGlobalPoint                 elbowArrow.ts:2229
  └─ 落定：calculateAttachPointForElbowArrowBinding           binding.ts:1998
       调用方：bindBindingElement、reanchorBindingsToOutline（:725）、
              actionProperties.tsx:2280/2294（切换箭头类型）、yjs element-factory.ts:62
```

折线的落定从**箭头元素自身**读端点再求一次，因此依赖「对已是落点的点再求一次，结果不变」。

### 1.3 时序消息

`sequenceMessage.ts`（`getSequenceMessageAxis` / `constrainSequenceMessagePoint` / `findSequenceMessageTarget`，
阈值 `SEQUENCE_MESSAGE_SNAP_DISTANCE = 12`）在另一端绑在激活条上时接管目标选择并把端点约束到水平轴。
`App.quickCreate.resolveSequenceConnection` 另有一套（`SEQUENCE_CONNECTION_SNAP_DISTANCE = 12`、`INSIDE_TOLERANCE = 4`）。
激活条落点 `getActivationBindingPoint` 分散在 `binding.ts:1385`、`:1813`、`utils.ts:533`、`interactiveScene.ts:744` 四处。

### 1.4 预览入口（共 6 处）

| 入口 | 位置 | 求点方式 |
| --- | --- | --- |
| 绑定类工具悬停 | `pointerCanvas.ts:962` | `getSnapOutlineMidPoint`，无另一端 |
| 箭头工具悬停（重复） | `pointerCanvas.ts:1106` | 同上 |
| 新建箭头 pointerdown | `pointerSelection.ts:1535` | 同上 |
| 折线端点拖拽 | `linearElementEditor.ts:2463` | `snapToMid` |
| 非折线起点 / 终点拖拽 | `linearElementEditor.ts:2563`、`:2602` | `getSnapOutlineMidPoint`，带另一端 |
| 渲染器 | `interactiveScene.ts:737-890` | 激活条特例 + 自行再算一遍中点和高亮阈值 |

### 1.5 核心问题

- 外部落点是**射线**与轮廓的交点，不是指针附近的轮廓点，用户无法指定落在边上的哪一处（G1 缺失）；
- 预览只显示中点圆环，真实落点从未显示；预览与落定各算各的（G2 缺失）；
- 推荐点吸附有三种口径：`getSnapOutlineMidPoint`（距离阈值）、`snapToMid`（尺寸比例带）、渲染器（自己的阈值）（G3 / G4）；
- 激活条特例散在四个文件。

## 2. 落点规则

### 2.1 唯一的落点集合：外扩可连轮廓 Γ

对目标 `E` 和箭头，定义 **Γ = `E` 的可连轮廓向外扩一个 gap 后的曲线**（gap 取 `getProjectionBindingGap`，文本为 0）。

**所有档位的落点都在 Γ 上，档位只决定取 Γ 上的哪一点。**

Γ 与 `intersectElementWithLineSegment(E, …, gap)` 使用同一份外扩几何（`deconstructRectanguloidElement` 等现有分解
加 offset、复合图形的 `getCompositeShapeGlobalHitPaths`），不另写一套轮廓。这样 ①②③ 档在圆角、尖角处落在同一条曲线上。

由此得到**幂等性**：`resolve(resolve(p).point).point === resolve(p).point`。
Γ 上的点再求一次，要么仍在推荐点半径内（回到同一推荐点），要么走 ② 档取 Γ 上最近点（就是它自己）。
折线「从箭头读端点再求一次」、拖拽每帧写绑定后松手再求一次，都依赖这条性质。

### 2.2 三档

对目标 `E`、端点位置 `p`，按顺序判定，**先命中者胜**：

| 档 | 条件 | 落点 | 提示样式 |
| --- | --- | --- | --- |
| ① 推荐点 `anchor` | `p` 到某推荐点（**轮廓上的点**，不含 gap）距离 ≤ 推荐点半径 | 该推荐点在 Γ 上的对应点 | 实心大圆 |
| ② 轮廓 `outline` | `p` 到可连轮廓距离 ≤ 轮廓带（外侧、内侧各自的宽度见下） | Γ 上离 `p` **最近**的点 | 实心小圆 |
| ③ 内部 `interior` | `p` 在 `E` 内部更深处 | 由 `spec.interior` 决定：`ray` = 现有方向求交；`nearest` = 同 ② | 实心小圆 |

`spec.interior = "none"`（frame）时内部深处**不是绑定候选**：不高亮、不给落点、松手不绑，候选让给下一个元素（见 §2.4）。
不存在「高亮但没有落点」的状态。

只要 `E` 是当前绑定目标，就以空心小环显示**全部**推荐点。

### 2.3 阈值

集中在 `connection/thresholds.ts`：

```ts
export const ANCHOR_RADIUS_PX = 14;        // 屏幕 px
export const OUTLINE_INSIDE_BAND_PX = 10;  // 屏幕 px

// 外侧轮廓带 = 可绑定范围，沿用现有函数（场景单位，低缩放放大），一期不改
outsideBand = maxBindingDistance_simple(zoom)
insideBand  = min(OUTLINE_INSIDE_BAND_PX / zoom, 0.25 * min(E.width, E.height))
anchorRadius = min(ANCHOR_RADIUS_PX / zoom, outsideBand, 0.25 * min(E.width, E.height))
```

- 推荐点半径量的是「指针到轮廓上推荐点」的距离，高缩放下不会被 gap 吃掉；
- 两个 `0.25 * min(边长)` 上限保证低缩放和小图形上推荐点不会盖住整条边（否则 G1 失效），内部带不会吞掉整个内部。

### 2.4 候选选择与求点的分工

求点之前先选元素。一期把这两层的接口定清楚：

```text
pickConnectionTarget(point, elements, ctx) → { element, hit } | null
  getAllHoveredElementAtPoint 给出候选（顺序与现状一致：偏好小图形）
  逐个调用 resolveConnectionHit；第一个返回非 null 的胜出
```

`bindingBorderTest` 里「frame 不测内部」（`collision.ts:331`）改为读 `spec.interior === "none"`，判据只留一份。
一期可绑定范围不变，所以候选顺序和结果与现状一致；二期开放表格时只需注册 spec。

### 2.5 开关与修饰键（语义沿用，不新增）

| 情况 | 行为 |
| --- | --- |
| `isMidpointSnappingEnabled = false` | 跳过 ① |
| 网格模式 | 跳过 ①；`p` 取 `snapBoundPointToGrid` 的结果（现状） |
| Shift 角度锁定 | 方向已锁死，强制 `ray`，跳过 ①② |
| Alt | 不绑定（现状） |

### 2.6 明确接受的行为变化

- 指针在图形**内部**靠近边中点时也会吸到推荐点（现在 `getSnapOutlineMidPoint` 在内部不吸附）；
- 指针在外侧带内时，落点从「朝另一端的射线交点」变为「最近点」——这正是 G1；
- 指针向内越过内侧带时，落点从最近点切到射线交点，可能换边。预览圆点同步跳变，所见即所得。
  一期不加迟滞（迟滞需要状态，会破坏「同输入同结果」）；体验不佳再评估把 `interior` 默认改为 `nearest`。

## 3. 图形声明：`ConnectionSpec`

```ts
// packages/element/src/connection/spec.ts
type ConnectionCtx = { reference?: GlobalPoint; elementsMap: ElementsMap };

interface ConnectionSpec {
  /** 推荐点（轮廓上的点，全局坐标） */
  anchors(el, ctx: ConnectionCtx): GlobalPoint[];
  /**
   * 可连边：从元素现有轮廓分解里筛出允许连接的部分。
   * 可依赖参考点（箭头另一端）——激活条据此只返回朝向另一端的那条竖边。
   */
  connectableOutline(el, ctx: ConnectionCtx): OutlinePath;
  /** 指针在内部深处：ray = 方向求交；nearest = 最近点；none = 不是候选 */
  interior: "ray" | "nearest" | "none";
}

export const getConnectionSpec = (el: ExcalidrawBindableElement): ConnectionSpec;
```

`resolve.ts` **不得出现任何图形类型判断**（箭头类型 elbow / curve 的分支允许）。图形差异只出现在 `specs.ts`。

### 一期注册表

| 家族 | 推荐点 | 可连边 | interior |
| --- | --- | --- | --- |
| 基础图形（矩形 / 菱形 / 椭圆） | 4 个边中点 | 全轮廓 | ray |
| 其他复合图形 / 流程图形 | `getCompositeShapeAnchors` | 全轮廓；开路径（大括号）只取路径本身 | ray |
| 文本（非容器内） | 4 个边中点 | 包围盒（gap 0） | ray |
| 便签 / mindmap 节点 / 图片 / iframe / embeddable | 4 个边中点 | 包围盒（含圆角） | ray |
| frame / magicframe | 4 个边中点 | 边框 | **none** |
| 激活条 | **无**（落点本身就是动态的） | 有参考点：朝向参考点的那条竖边；无参考点：左右两条竖边 | **nearest** |
| 生命线 | 不可绑定（维持现状） | — | — |

激活条的全部特例由这一行表达，等价于现在的 `getActivationBindingPoint`：

- `nearest` + 只有竖边 → 落点 = 指针 y（夹在条内）对应的贴边点；
- 有参考点 → 只剩朝向侧的边，指针压在条中心也不会翻边；
- **无参考点（悬停新建、pointerdown 起点）→ 取指针所在一侧**。悬停预览与 pointerdown 用同一个无参考点的查询，
  所以悬停圆点与真实起点同侧。

### 时序消息与本模块的关系

`sequenceMessage.ts` 保留，职责收窄为**构造查询**，不再自己求落点：

```text
getSequenceMessageAxis          → 判定这一端是否受水平约束
constrainSequenceMessagePoint   → 把 query.point 约束到水平轴
findSequenceMessageTarget       → 选目标激活条（取代通用候选选择）
        ↓
resolveConnectionHit(target, constrainedPoint, reference = 另一端) → 落点
```

`SEQUENCE_MESSAGE_SNAP_DISTANCE`、`SEQUENCE_CONNECTION_SNAP_DISTANCE`、`INSIDE_TOLERANCE` 并入 `thresholds.ts`。

### 推荐点与刚性跟随

推荐点落定后同样存成 `attachPoint` 比例。边中点、随包围盒线性缩放的复合图形锚点在非等比缩放下仍落在推荐点上。
带固定尺寸特征的图形（固定半径圆角、固定箭头头部）缩放后有亚像素到数像素的漂移，与现状一致，一期不处理。

### 曲线箭头

端切线仍由 `normalFromAttachPoint` 按比例判边（`curveConnector.ts:92`），一期不改。

- 矩形类目标：② 档最近点所在边与比例判出的边一致，端点与切线自洽；现有「贴边时沿法线外移一个 gap」的曲线专用分支
  （`binding.ts:1835-1872`）被 ② 档覆盖，删除；
- 椭圆 / 菱形 / 复合图形：切线是轴对齐法线、落点在斜向轮廓上，二者有夹角。这在现有射线落点下已经存在，一期不扩大也不修。

## 4. 代码组织

```text
packages/element/src/connection/
  thresholds.ts   阈值常量与三个派生函数
  spec.ts         ConnectionSpec 类型 + getConnectionSpec
  specs.ts        §3 注册表
  outline.ts      inflatedOutline(el, gap, path) / nearestPointOnOutline(path, p)
                  复用现有外扩分解；线段直接投影，贝塞尔分段（误差 ≤ 0.5 屏幕 px）后投影
  resolve.ts      resolveConnectionHit / pickConnectionTarget
  query.ts        buildConnectionQuery：预览与落定共用的查询构造
  index.ts
```

```ts
type ConnectionQuery = {
  element: ExcalidrawBindableElement;
  point: GlobalPoint;              // 端点位置（已做过网格 / 时序水平约束）
  reference?: GlobalPoint;         // 箭头另一端；悬停新建时无
  arrow?: ExcalidrawLinearElement; // 用于 gap、折线 / 曲线分支；悬停新建时按当前工具的箭头类型给 gap
  zoom: AppState["zoom"];
  anchorsEnabled: boolean;         // isMidpointSnappingEnabled && !grid && !angleLocked
  angleLocked: boolean;
  elementsMap: ElementsMap;
};

type ConnectionHit = {
  tier: "anchor" | "outline" | "interior";
  point: GlobalPoint;     // Γ 上的最终端点
  anchorIndex?: number;   // tier = anchor 时
  anchors: GlobalPoint[]; // 供渲染空心环（轮廓上的点）
};
```

### ③ 档 `ray` 委托现有实现，不重写

| 箭头 | `ray` 的实现 |
| --- | --- |
| 非折线 | `projectPointOntoBoundElementOutline`（去掉激活条分支和曲线外移分支） |
| 折线 | `bindPointToSnapToElementOutline`（去掉 `snapToMid`）；`avoidRectangularCorner` 只在这一档使用 |

### 接入点（只动「用户指定落点」的入口）

| 层 | 改动 |
| --- | --- |
| 非折线策略 | `binding.ts:518` 的 `focusPoint` 不再走 `projectAttachPointOntoDiagonal`，直接给端点位置 |
| 非折线落点 | `resolveAttachPointForNonElbowBinding` 内部改为 `resolveConnectionHit(...).point` 再换算比例；新增 `anchorsEnabled / angleLocked / zoom` 入参 |
| 折线落点 | `bindPointToSnapToElementOutline` 开头先判 ①②，未命中再走原有函数体 |
| **不改** | `calculateAttachPointForNonElbowArrowBinding`（纯换算）及其直接调用方：方向键微调、yjs 非折线、重锚、曲线判边 |

注意：`calculateAttachPointForElbowArrowBinding` 今天就带吸附，yjs 折线建连（`element-factory.ts:62`）和
切换箭头类型（`actionProperties.tsx`）会随折线切换得到 ①② 档的新落点。这是预期变化，但要进基线对比（步骤 1）。

### 预览 = 落点

三条保证，缺一不可：

1. **同一个查询构造**：预览和落定都经 `buildConnectionQuery` 得到 `point / reference / anchorsEnabled / angleLocked`，
   网格、Shift、`pointerOffset`、时序水平约束只在这里处理一次；
2. **同一个求点函数**：`resolveConnectionHit`；
3. **幂等**（§2.1）：兜住折线从箭头读端点、每帧写绑定后松手重算这两种「拿落点再求一次」的路径。

`appState.suggestedBinding` 由 `{ element, midPoint? }` 改为 `{ element, hit: ConnectionHit }`（内部字段，不持久化）。
`hit` 每帧是新对象，`linearElementEditor.ts:494` 的 `isShallowEqual` 换成按 `element.id / tier / anchorIndex / point` 比较，
避免每次 pointermove 都 setState。

6 个预览入口（§1.4）统一调用 `getConnectionPreview(app, point, arrow?)`；渲染器只按 `hit` 绘制：
空心环 = `hit.anchors`，实心大圆 = 命中的推荐点，实心小圆 = ②③ 档落点。`renderSequenceActivationDot` 并入通用落点圆点。

## 5. 实施步骤

每步可独立合入。步骤 3、4 各自内部必须「落点 + 预览」同一 PR。

### 步骤 1：冻结现状

- 新增 `packages/element/_tests_/connection.baseline.test.ts`：对矩形 / 菱形 / 椭圆 / 复合图形 / 文本 / 便签 / frame / 激活条，
  在中心、四边中点附近、四角、边上任意点、内部浅处与深处、外部带内与带外采样；
  **直线 / 曲线 / 折线各一份**，另加 Shift、网格、关闭中点吸附三种模式，快照当前落点。
- 同时快照不该变的路径：方向键微调、yjs `createSceneConnectionEndpoint`（折线 / 非折线）、切换箭头类型。

### 步骤 2：connection 模块（纯函数，无调用方）

- 实现 §4 的文件与 §3 注册表；③ 档 `ray` 以注入方式委托现有函数。
- 单测：每个家族的三档判定；`anchorsEnabled` / `angleLocked`；旋转元素；gap（文本为 0）；
  zoom 0.25 / 1 / 4 下的阈值；小图形（边长 < 4 × 推荐点半径）仍能落到边上任意点。
- **幂等性质测试**：对每个家族 × 三种箭头沿网格扫描 `p`，断言 `resolve(resolve(p).point).point ≈ resolve(p).point`。
- **Γ 一致性**：②③ 档落点到 `E` 的距离都等于 gap（含圆角、尖角）。
- 静态约束：`resolve.ts` 不得 import 任何 `is*Element` 图形判断（grep 测试）。

### 步骤 3：非折线（直线 + 曲线）切换

- 按 §4「接入点」改策略层与 `resolveAttachPointForNonElbowBinding`；
- 预览：`pointerCanvas.ts` 两段合并，`pointerSelection.ts:1535`、`linearElementEditor.ts:2563 / :2602` 改写 `suggestedBinding.hit`；
- 渲染器按 `hit` 绘制，删除中点计算；
- 删除 `projectAttachPointOntoDiagonal` 及 `getDiagonalsForBindableElement`（确认无其他调用方后）、曲线外移分支。
- 此时折线预览仍走旧 `midPoint`：`suggestedBinding` 暂为联合类型，步骤 4 收掉。

### 步骤 4：折线切换

- `bindPointToSnapToElementOutline` 接入 ①②；`elbowArrow.ts:2229` 与 `calculateAttachPointForElbowArrowBinding` 随之生效；
- ①② 档落点确定后，`headingForPointFromElement` 按落点所在边给方向；核对 `getHeadingForElbowArrowSnap` 在新落点下的路由；
- `linearElementEditor.ts:2463` 预览改写 `hit`；
- 删除 `snapToMid`。
- 风险最高的一步（牵涉路由），单独 PR，基线逐条审阅。

### 步骤 5：时序图与 quick-create

- `sequenceMessage.ts` 收窄为查询构造（§3）；删除 `binding.ts`、`utils.ts`、渲染器里的 `isActivationElement` 落点分支；
- `App.quickCreate.resolveSequenceConnection`：候选筛选保留在调用方，求点改为 `resolveConnectionHit`；三个时序阈值并入 `thresholds.ts`；
- quick-create 出口：源图形在出发方向上的推荐点，取代 `getQuickCreateExitPoint` 的包围盒中点；入口：新图形朝向源的推荐点；
- 删除 `getSnapOutlineMidPoint`；
- `findSequenceActivationSnap`（激活条吸附到杆）不属于连接，不动。

### 步骤 6：类型转换重锚

`reanchorBindingsToOutline`：原端点若在旧图形某推荐点的容差内，则落到新图形最近的推荐点；否则维持现有射线重锚。
补「矩形边中点连线 → 转星形后仍在推荐点上」用例。

## 6. 测试与验收

- **G2**：对每个家族 × 三种箭头 × 四种模式沿网格扫描，走真实的拖拽 → 松手流程，
  断言 `预览 hit.point === 松手后 updateBoundPoint 解出的端点`（误差 < 0.01）。悬停新建单独一组：悬停圆点 === pointerdown 后的起点。
- **G3**：推荐点半径内即使轮廓最近点更近也取推荐点；关闭中点吸附后不再取推荐点；小图形上推荐点不覆盖整条边。
- **G1**：任意边上的随机点都能成为落点；落定后移动 / 缩放元素，端点仍在原比例位置。
- **回归**：基线差异只出现在 §2.6 列出的三类；Shift、Alt、网格、文本 gap 0、方向键微调、yjs 非折线、旧文件加载与现状一致。
- **时序图**：现有 `sequenceShape.test.ts`、`quickCreateHandles.test.tsx` 中激活条落点用例保持通过；
  新增「悬停预览贴边 = 松手贴边」「指针压在条中心不翻边」用例。

## 7. 一期不做

- **表格 / fragment 开放绑定**：依赖 §2.4 的候选层，另需核查行列增删、列宽拖动是否走 `updateBoundElements`、删除时清理
  `boundElements`、复制粘贴重映射。一期只留好 `interior = "none"` 的注册位。
- A 层指针归属统一（`AffordanceProvider`）：二期按 `pointer-affordance-unification.md` 推进，`getConnectionPreview` 届时改为 provider。
- 曲线箭头在非矩形图形上的端切线与落点夹角。
- ②/③ 档边界的迟滞。
- 跟随时 gap 随比例缩放、带固定尺寸特征图形的锚点漂移。
- `findSequenceActivationSnap` 并入统一阈值表；生命线可绑定。
