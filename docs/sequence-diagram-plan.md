# 时序图（sequence diagram）实施方案

## Context

平台要从 Lark 白板导入时序图，第一步是在 vendored 的 Excalidraw 编辑器里把时序图做成**原生能力**（与既有「基础图形」「流程图图形」并列）。

样例 `docs/lark-exmples/sequence/`（11 节点 JSON + 1 页矢量 PDF）已完整逆推：三种 Lark 节点（`life_line` ×8、`combined_fragment` ×2、`activation` ×1），全部几何（8 种生命线头部、生命线杆、页签、行边界）已从 PDF 内容流还原为**元素局部坐标**（x 右、y 下、单位 = JSON 单位）。同目录层已有 `composite-shape/lark-shape-mapping.md`、`flow-chart/flow-chart-mapper.md` 两份映射文档，时序图照此补第三份。

本机没有 poppler/mutool，`Read` 无法渲染该 PDF；但它是纯内联矢量（无 XObject），用 `python3 -I` 跑脚本 zlib 解压内容流 + 跟踪 `q/Q/cm` 即可取路径（脚本放 `/tmp`，不要放样例目录）。每条路径有自己的 `cm`，原点 = 元素左上角；生命线杆与 fragment 用全局 `cm (2,0,0,-2,-2010.53,35.99)` 画在绝对坐标里。

### 已定决策

| # | 决策 |
| --- | --- |
| 1 | 基础图形 / 流程图图形 / 时序图**各占一个顶层 `element.type`** |
| 2 | 基础图形沿用 `composite_shape` **不改名**；流程图 `flowchart_shape`；时序图 `sequence_shape` |
| 3 | 消息复用现有**箭头连接线**，不新建元素类型 |
| 4 | 只映射形状，**不映射样式** |
| 5 | activation 连接点**只出左/右** |
| 6 | fragment 做成 **`seq-fragment` 图形**，只借表格的绘制代码；单列、只能加行、不提供容器交互 |
| 7 | 连线落到空白 / frame / 其它形状 → **一律取消**，不生成任何元素 |
| 8 | 一期全做，含 fragment |

### 样例里没有的东西

样例 11 个节点的 `type` 只有 `life_line` / `combined_fragment` / `activation`，z_index 占满 0–10（完整），PDF 36 条路径里也没有箭镞——**消息节点完全没有证据**，因此消息一律按决策 3 复用箭头，不反推 Lark 的消息结构。

---

## 一、类型模型

### 1.1 三个顶层 element type

| 家族 | `type` | 说明 |
| --- | --- | --- |
| 基础图形 | `composite_shape` | 沿用，零迁移；平台 schema 已有 |
| 流程图图形 | `flowchart_shape` | 14 个 `fc-*` 从 `composite_shape` 迁入 |
| 时序图 | `sequence_shape` | `life_line` ×8、`activation`、`fragment`、`fragment-tab` |

### 1.2 shape 联合：拆三个，但几何分派保持单一入口

`BaseShapeData`（`packages/element/src/types.ts:198-272`，41 个变体 = 27 基础 + 14 `fc-*`）拆为 `BasicShapeData` / `FlowchartShapeData` / `SequenceShapeData`，再用别名合并，**几何与渲染的穷举 switch 仍集中在一处、仍由 `assertNever` 兜底**：

```ts
export type ShapeData = BasicShapeData | FlowchartShapeData | SequenceShapeData;
export type ShapeElement =
  | ExcalidrawCompositeShapeElement
  | ExcalidrawFlowchartShapeElement
  | ExcalidrawSequenceShapeElement;
```

`compositeShape.ts` 的 `baseShapeData:318` / `getCompositeShapePoints:542` / `getCompositeShapeTextBounds:831` / `isCompositeShapeOpen:1220`，加 `shape.ts:984`、`shapeScene.ts:110`，六处签名改收 `ShapeElement`，case 按家族分组（沿用 `compositeShape.ts:378-393` 已有的分组写法）。这样家族联合各自精确（`SequenceShapeData` 可带 `lifeline`/`fragment` 参数，基础图形带不了），而穷举 switch 数量不增、编译期兜底不丢。

### 1.3 时序图 shape 数据

```ts
export type SequenceShapeData =
  | { id: SeqLifelineShapeId;  schemaVersion: 1; lifeline: { headHeight: number } }  // 8 个 id
  | { id: "seq-activation";    schemaVersion: 1 }
  | { id: "seq-fragment";      schemaVersion: 1; fragment: { rows: { id: string; height: number }[] } }
  | { id: "seq-fragment-tab";  schemaVersion: 1 };
```

- **`headHeight`**：头部区（图元 + 标签带）高度；元素总高 = `headHeight + 杆长`，杆长由 `height` 派生。存它是为了 Lark 回写能精确拆回「头部高 + `lifeline.size`」——样例头部高是**逐节点**的（68.272 / 74.272 / 118.272，带 .272），非按类型固定。
- 页面常量表提供每个 id 的默认 `headHeight`（见 §二）。

### 1.4 手写联合的取舍

| 联合 | 位置 | 时序图 | 理由 |
| --- | --- | --- | --- |
| `ExcalidrawElement` | `types.ts:484-498` | 加两个新 type | 必须 |
| `ExcalidrawRectanguloidElement` | `types.ts:465-477` | **纳入** | 需要矩形包围盒/缩放/吸附 |
| `ExcalidrawBindableElement` + `isBindableElement` | `types.ts:562-571` / `typeChecks.ts:421-438` | **只有 `seq-activation`** | 消息只连 activation，生命线不可直连 |
| `ExcalidrawTextContainer` | `types.ts:573-577` | **纳入**（lifeline 标签、fragment 页签） | 标签是绑定文本 |
| `ExcalidrawFlowchartNodeElement` / `FrameLikeElement` | `types.ts:461-463` / `450-452` | 不改 | 语义不同 |
| `ConvertibleTypes` | `types.ts:757-759` | 不改（本期） | 转换弹窗不暴露时序图 |

`flowchart_shape` 的取舍与 `composite_shape` **完全一致**（纳入 Rectanguloid / Bindable / TextContainer），即把现有 41-id 分支里 `fc-*` 那组原样搬到新 type，行为不变。

---

## 二、11 个 shape.id 与几何（元素局部坐标，可直接喂 `getCompositeShapePoints`）

### 生命线头部（8）

| `shape.id` | Lark `lifeline.type` | 默认宽×头部高 | 几何 |
| --- | --- | --- | --- |
| `seq-lifeline-entity` | `entity` | 64×68.272 | 圆 d=38，水平居中，y=1 |
| `seq-lifeline-control` | `control` | 64×74.272 | 圆 d=38 at (13,7) + 顶端短竖线（y 1→7，x=中） |
| `seq-lifeline-boundary` | `boundary` | 76×68.272 | 圆 d=38 at (25,1) + 左侧竖线 x=13, y 1→39 |
| `seq-lifeline-actor` | `actor_lifeline` | 84×118.272 | 头圆 d≈32 at (26,1)；躯干 (42,33.2)→(42,67.5)；双臂 y=42.1 跨 x 13→71；双腿 →(18.8,89)/(65.2,89) |
| `seq-lifeline-queue` | `queue` | 100×60 | 四角切角桶形（切角 8.84×13.43）+ 右侧内折线 x=70..85 |
| `seq-lifeline-data-base` | `data_base` | 68×90 | 圆角矩形 r≈15 + 顶部椭圆弧 66×15.5（y 15.5→31） |
| `seq-lifeline-object` | `object_lifeline` | 120×60 | 圆角矩形 r=7，铺满 |
| `seq-lifeline-collection` | `collection` | 118×68 | 两张圆角矩形 r=4，各 110×60，偏移 (8,0) 与 (0,8) |

**缩放规则（实测）**：图标型（entity/control/boundary/actor）图元**固定尺寸、左右各留 13 边距**居中，宽度变化只挪位置；盒型（queue/data-base/object/collection）图元**铺满元素**，随宽高缩放。

### 其余三个

| `shape.id` | 默认尺寸 | 几何 |
| --- | --- | --- |
| `seq-activation` | 30×100 | 圆角矩形 r=5，铺满 |
| `seq-fragment` | 400×（行高之和） | 外框矩形 + 首行以下每条行边界**全宽虚线**（宽 2，4/4） |
| `seq-fragment-tab` | 92×36.27（随文字） | 五点多边形：左上直角，**右下角 12×12 斜切**；填充；内嵌标题文字 |

**生命线杆**：宽 2，虚线 **4/4**，从头部底边竖直向下，长度 = `height - headHeight`，水平居中于头部中心。样例声明 `lifeline.size: 360`、实测 356（45 段 4/4 恰好截断），实现按 `size` 取值。

### 文本区域（挂 `getCompositeShapeTextBounds`）

实测 baseline（元素局部），作为实现与测试的验收基准：

- 图标型标签在**图元下方**，规律 = 头部图元盒底（绘制路径外扩 1）+ 24.24，四条全中：
  entity (18,64.23)、control (18,70.23)、boundary (24,64.23)、actor (28,114.23)
- 盒型标签在**盒内**、底部锚定约 24，无统一公式，按 id 固化：
  collection (41,44.10)、queue (15,36.10)、object (46,36.10)、data_base (13,62.10)
- fragment 各行标签 baseline = **行顶 + 24.24**（三行全部吻合）

---

## 三、生命线虚线杆的渲染

一个元素要同时画「实线头部」和「永远虚线的杆」，而 `generateRoughOptions`（`shape.ts:210-280`）是**每元素一套**描边。

**照抄箭镞的既有先例**：`getArrowheadLineOptions`（`shape.ts:368-381`）克隆基础 `Options` 后 `delete strokeLineDash`，让箭镞恒为实线（`:452-462`、`:490-499` 同型）。我们镜像操作：克隆后**强制设上** dash 数组（`[6, 4 + strokeWidth]` 来自 `getDashArrayDashed`，`shape.ts:205`；样例实测为 4/4，按样例取），作为杆那个 `Drawable` 的样式。

`_generateElementShape`（`shape.ts:923-1342`）返回 `Drawable | Drawable[]`（`packages/excalidraw/scene/types.ts:178`），canvas（`renderElement.ts:609-615`）与 SVG 导出（`staticSvgScene.ts:317-327`）都逐项渲染。杆的颜色跟随 `strokeColor`，样式**不受**元素 `strokeStyle` 影响。

**包围盒必须覆盖杆 —— 硬约束**：离屏位图按 `width/height` + `getCanvasPadding(element) * 2` 定尺寸（`renderElement.ts:263-316`），而 `getCanvasPadding` 对非 freedraw/text/arrow 一律 **20**（`renderElement.ts:110-124`）——**画到框外 20px 以外的内容根本不会被绘制**。所以 360 长的杆必须在框内：`height = headHeight + 杆长`。

例外只有三种：arrow 是 40（箭镞越界）、text 是 fontSize/2、freedraw 是 12·strokeWidth；真要越界只能加 padding 特例，或像 table/stickynote/frame 那样走自绘分支（`renderElement.ts:1240-1310`）——都不如让高度含杆干净。

**命中路径必须同步**：`composite_shape` 的点选**不走** `getElementShape`，而是走 `getCompositeShapeGeometry(element).outline`（`compositeShape.ts:2939-3160`）→ `getCompositeShapeGlobalPoints`/`GlobalPath`（`:3374-3380`、`:3218-3246`）→ `isPointInElement` / `distanceToCompositeShape`（`collision.ts:983-986`、`distance.ts:84-91`）/ `getElementLineSegments`。所以**杆要作为 `details` 路径加进 `getCompositeShapeGeometry`**（`details` 在 `shape.ts:1137-1145` 以 `fill: undefined` 绘制），才会同时进包围盒、点选、套索与擦除；只加进 roughjs 的 drawable 是不够的。

两处连带：

- `CompositeShapeGeometryInput` 是 `Pick<…, "width"|"height"|"shape"|"roundness">`（`compositeShape.ts:1271-1275`），所以杆长由 `height` 派生（或放宽该输入带上杆长）。
- 缓存失效由 `mutateElement.ts:156-171` 负责：`height`/`width`/`shape`/`points`/binding 任一变化即 `ShapeCache.delete`（`shape.ts:136-139` 同时清位图缓存）。杆长由 `height` 派生 → 不会留旧形状。**这是把 `headHeight` 放进 `shape` 而非旁挂字段的理由之一。**

---

## 四、activation 连接线交互

需求：悬停 activation 出左/右连接点 → 拖到另一个 activation 成线；拖到**虚线杆**则在落点处自动建 activation 并连线；落到空白 / frame / 其它形状一律取消。

### 复用既有「方向手柄」三层结构

「边缘出连接点 → 拖拽连线」在本 fork 叫方向手柄 / quick-create handles（commit `757ba743`、`f5dcbcb0`）：

| 层 | 文件 |
| --- | --- |
| 几何/命中（纯函数） | `packages/element/src/quickCreate.ts`：`getQuickCreateHandles:266-305`、`hitTestQuickCreateHandle:307-335`、`getHandleCenters:232-260` |
| 手势状态机 | `packages/excalidraw/components/App.quickCreate.ts`（`App.tsx:308` 实例化）：preparePointerDown `:343-440` / handlePointerMove `:447-466` / handlePointerUp `:477-516` / Esc `:519-533` |
| 渲染 + 埋点 | `renderer/interactiveScene.ts:1378-1489`（canvas 直绘，无 DOM）、`components/app/pointerSession.ts:717,1079,1158-1166,2308-2312` |
| 绑定写入 | `packages/element/src/binding.ts:564-605` `bindBindingElement` → `applyBinding:544-562` |

**关键红利**：预演与落地**共用** `resolveDragEndTarget`（`App.quickCreate.ts:1179-1195`；`:497-499` 注释说明是刻意的），新增落点类型只改这一个函数，预演自动一致。「落点命中另一个已有元素 → 直接连线」已现成：`handlePointerUp:500-505` → `createConnectorOnly:1213-1258`。

### 必须做的适配（activation 是 `sequence_shape`）

1. **目标谓词**：`isQuickCreateTargetElement`（`quickCreate.ts:130-137`）硬性要求 `isCompositeShapeElement` + `isBaseShapeId`；`getQuickCreateTargetElement`（`:213-225`）还要求**恰好单选 1 个** → 新增时序分支。
2. **触发语义要变**：现有手柄「选中才出现、悬停变加号」；需求是 activation **悬停即出点**。需新增 hover 触发的目标解析（悬停入口 `app/pointerCanvas.ts:779`，判定 `App.quickCreate.handlePointerMove:272-337`）。
3. **渲染守卫**：`interactiveScene.ts:3856-3860` 硬判 `selected.type === "composite_shape"` → 加 hovered activation 分支；绘制复用 `renderQuickCreateHandles` / `getQuickCreateHandleSpec:1262-1308`。
4. **只出左/右两个点** → 新增时序专用手柄生成函数（现有 `getHandleCenters` 是四边中点）。
5. **`isBindableElement`**（`typeChecks.ts:421-438`）必须加 `seq-activation`，否则 `resolveDragEndTarget` 恒返回 null，拖上去只会弹插入面板。
6. **落点分支**（`handlePointerUp:493-509`）：activation → 现成 `createConnectorOnly`；**生命线杆** → 新分支「在落点 y 建 activation + 建消息」；空白/frame/其它 → 直接取消（不调 `openInsertMenu:1368-1404`）。
7. **缝隙常量**：`QUICK_CREATE_GAP` 用固定 `DEFAULT_SHAPE_PRESET_SIZE`（`quickCreate.ts:72-75`）算偏移，对窄高的 activation 不合适 → 时序专用 gap。
8. **命中优先级**：手柄是**旁路**实现，没接 `app/interactionTarget.ts` 的统一解析器（`resolveInteractionTarget:177` 无 quick-create 分支）。activation 的 hover 判定要与既有命中明确先后，避免争优先级。

约束：箭头**水平**对齐源连接点 y；生命线**不可**直接作为箭头端点。测试基线 `packages/excalidraw/_tests_/quickCreateHandles.test.tsx`（已覆盖触屏/旋转/画框/预演/落点）。

---

## 五、fragment（`seq-fragment`）

结构：**单列表格式图形**——外框 + 行边界虚线 + 行数据；行标签走表格的**背景文本**机制；首行嵌入一个**页签图形**撑起该行高度。绘制照 `tableRender.ts:335-434`（canvas API 逐段 `setLineDash`，是仓库里「多子路径多样式」最清晰的先例）。

### 复用（照抄）

- 行标签 = 背景文本模式：`autoResize: false`、由容器几何反算折行与对齐（`components/app/tableCellText.ts:64-99`、`tableSceneGeometry.ts:145-196`）。
- 文字测量：`measureText`（`textMeasurements.ts:13-28`）+ `getTextWidth:161-169`（**逐行取最大值**）→「页签宽随文字 + 手动换行」天然成立；硬换行由 `getWrappedTextLines`（`textWrapping.ts:446-…`）按 `\n` 分硬行各自软折行。
- 页签宽度自适应：`seq-fragment-tab` 直接吃既有 `textFitMode: "auto"` 反向求解链（`getCompositeShapeDimensionsForText`，`compositeShape.ts:1180-1218`）。
- 编辑入口形态：参照 `tableTitle.ts:75-107` + `table.ts:1503-1516`；提交钩子 `components/app/text.ts:229-240`。
  **注意**：`tableTitle` 编辑分支把 `\r\n` 折成空格、Enter 直接提交（`textWysiwyg.tsx:636-638, 854-863`）——与「支持手动换行」冲突，新类型**不能继承**该分支。
- 表格结构参考：`TableDataV1`（`types.ts:181-187`）的 `rows: {id, height}[]`，以及行高随内容增长的 `refitCellBackgroundTexts`（`tableSceneGeometry.ts:198-310`，注意那里「行只增不减」）。

### 新写

1. **fragment 几何**：`getCompositeShapePoints` / `getCompositeShapeTextBounds` / `isCompositeShapeOpen` 加 `seq-fragment` 与 `seq-fragment-tab` 的 case；行边界虚线进 `getCompositeShapeGeometry` 的 `details`。
2. **新的 `DirectContainerRef` kind**（`types.ts:88-111` 现为封闭联合，只有 `frameLike`/`tableCell`/`tableTitle`）：fragment 的行与页签需要自己的 kind，并同步 `validateContainerRef`（`typeChecks.ts:188-248`）、`assertAcyclicContainerRefs:295-314`、子元素索引（仿 `tableChildrenIndex.ts`）、成员 z-order 与清理（仿 `tableContainer.ts:204-337`）。
3. **行高自适应**：行高被两类内容撑大——行标签文本（仿 `refitCellBackgroundTexts`）与**首行里的页签图形**（新逻辑，取页签高度 + 内边距）。
4. **加行入口**：单列、**不可加列**、可加行。加行的触发点（悬停底边出「+」手柄 vs 工具栏 action）属 UI 细节，实施时按最小改动定，并列入浏览器验收清单。

### 一处待确认的口径

「fragment 不是容器，只是一个简简单单的图形」——按上表实现，**行标签与页签仍会作为它的 `containerRef` 子元素存在**，否则移动 fragment 时标注不跟随。此处按「不提供容器交互」理解：**不接收拖入元素、不裁剪内容、不作为 frame 的嵌套层、不给表格那套结构手势（拖行高/单元格落点/表格工具栏）**，但内部标注子元素技术上照旧。若口径是连 `containerRef` 都不要（改由形状直接绘制自持字符串），那是另一条更贵的路，需另行确认。

---

## 六、迁移与平台同步

1. **`restore.ts:443-718`**：仓库**没有 element 级 schemaVersion 迁移表**（版本号 `types.ts:59` 只服务协同），手写兼容——旧数据 `composite_shape` + `fc-*` → `flowchart_shape`（形状数据不变）。
2. **骨架路径**：`newElement.ts:213-247` 现为 `opts.type === "composite_shape" ? assertBaseShapeData(opts.shape) : baseShapeData(opts.type)`，即 `type:"hexagon"` / `type:"fc-diamond"` 曾是合法入参；拆 type 后按 id 所属家族解析到对应 type。`transform.ts:362,433` 的 `element.type === "composite_shape" ? element.shape.id : element.type` 同步扩展。
3. **平台侧**（`/Users/byte/Desktop/docs-platform`）`packages/shared/src/canvas-elements.ts`：type enum（`:239-253`）、`requiredFields`（`:341`）、strict `shape` 联合（`:206-235`）、`CanvasContainerRefSchema`（`:31`）四处同步。**顺带补上当前缺失的 `fc-*`**（`simpleShapeIds:174-197` 无 `fc-*`，平台侧 grep `fc-`/`flowchart` 零命中——流程图图形目前通不过平台校验，因为 `shape` 联合是 strict 的）。
4. **`yarn build:packages`**（element → yjs）：外部/dist 消费者按 `dist/types` 解析类型（`packages/element/package.json`、`packages/yjs/package.json`），不重建会按旧联合收窄。

---

## 七、分阶段与验证

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| A | 三家族 type 拆分 + `ShapeData`/`ShapeElement` 别名 + 六处穷举改造 | `yarn test:typecheck` 全绿；`yarn test:update` 无新增失败 |
| B | 迁移：旧 `composite_shape`+`fc-*` → `flowchart_shape`；骨架路径 | 新增 restore 用例；`_tests_/data/restore.test.ts` 快照更新 |
| C | 11 个 `seq-*` shape.id 几何 + 文本区域 | `compositeShape.test.ts` 按 id 加几何与 label baseline 断言（用 §二 实测值） |
| D | 生命线虚线杆：`details` 几何 + 双 `Drawable` + 高度含杆 | 单测 + 浏览器：杆恒为虚线；改 `strokeStyle` 不影响杆；点选/套索覆盖杆 |
| E | activation 连接线交互 | 单测（照 `quickCreateHandles.test.tsx`）+ 浏览器：悬停出左右点、拖到 activation 成线、拖到杆上自动建 activation、落空白取消 |
| F | fragment：几何 + 行容器 kind + 行高自适应 + 加行 | 单测 + 浏览器：页签宽随标题、手动换行、行边界虚线、加行撑高 |
| G | 平台 schema 四处同步 + `build:packages` | 平台侧 `pnpm test`；`CanvasElementSchema.parse` 能过新元素 |
| H | 补一份 `docs/lark-exmples/sequence/sequence-mapper.md` | 映射表覆盖 3 种 Lark 节点 → 11 个 shape.id |

自动化验证由实施方执行；浏览器验收输出人工清单。

## 八、风险与待定

- **面最宽的一处是 A**：拆 type 触动 `"composite_shape"` 字面量约 60 处分支，其中约 20 处**无 `assertNever` 兜底**（`restore.ts`、`staticSvgScene.ts:1013`、`renderElement.ts:564/1239`、`collision.ts:511-575`、`distance.ts:48-97`、`comparisons.ts:9-96` 等），编译期不报错但运行时静默走错分支。建议 A 阶段单独一次提交、单独跑全量，便于二分定位。
- **待定**：加行的触发点（§五-4）；行是否允许删除（口径为「只能添加行」，暂按只增处理）。
- **不在本期**：`ConvertibleTypes` 不暴露时序图；Lark 样式字段不映射（决策 4）。
- **口径待确认**：fragment 内部标注是否仍走 `containerRef`（§五末）。