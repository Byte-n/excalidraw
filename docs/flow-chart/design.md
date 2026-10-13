# 流程图图形设计方案

## 背景与依据

Lark 画板的流程图包含 14 种图形，样本见本目录 [lark-examples-data.json](lark-examples-data.json)（数据结构与样式）与 [whiteboard_exported_image.pdf](whiteboard_exported_image.pdf)（矢量图例）。本文档的几何比例全部从 PDF 矢量流中提取（归一化路径，含预定义流程的双竖线、两个圆柱的口沿弧等细节笔画），以 Lark 样本为唯一依据。

承载方式遵循 [复合图形数据结构总纲](../composite-shape/design.md) 的职责划分：顶层 `type` 表示元素的交互和数据归属，`shape.id` 表示外观种类。流程图图形与第一期普通图形（[lark-shape-mapping.md](../lark-shape-mapping.md)）在 Lark 数据模型中同属 `composite_shape.type`，因此全部映射为 `composite_shape` 的新 `shape.id`，不新建元素类别。

## 决策约束

- **id 前缀**：14 个内部 id 统一 `fc-` 前缀，多词以连字符分隔
- **无控制点**：固定几何，比例从 PDF 烘焙；不提供任何形状控制点
- **不复用、不改造**：现有相同/类似图形（`round-rect`/`pill`/`diamond`/`hexagon` 等）一行不动；fc 版本各自独立实现几何，互不影响
- **连接线**：沿用现有 arrow/binding 体系，不引入新连接线语义
- **入口**：顶部工具栏新增"流程图"选择入口（独立 popover，桌面与移动）
- **一版落地**：14 个图形 + 入口一次完成，不分期

## 命名映射

| Lark `composite_shape.type` | 样本文字 | 内部 `shape.id` | 样本尺寸 |
| --- | --- | --- | --- |
| `flow_chart_round_rect` | 流程 | `fc-round-rect` | 120×80 |
| `flow_chart_round_rect2` | 开始/结束 | `fc-terminator` | 120×80 |
| `flow_chart_diamond` | 判定 | `fc-diamond` | 120×80 |
| `document_shape` | 文档 | `fc-document` | 120×80 |
| `flow_chart_parallelogram` | 数据 | `fc-parallelogram` | 120×80 |
| `flow_chart_cylinder` | 数据库 | `fc-cylinder` | 80×100 |
| `horiz_cylinder` | 数据流 | `fc-horiz-cylinder` | 120×80 |
| `predefined_process` | 预定义流程 | `fc-predefined-process` | 120×80 |
| `manual_input` | 手动输入 | `fc-manual-input` | 120×80 |
| `flow_chart_trapezoid` | 手动操作 | `fc-trapezoid` | 120×80 |
| `delay_shape` | 延迟 | `fc-delay` | 120×80 |
| `flow_chart_hexagon` | 准备 | `fc-hexagon` | 130×80 |
| `off_page_connector` | 跨页引用 | `fc-off-page-connector` | 120×100 |
| `flow_chart_mq` | 队列 | `fc-circle` | 80×80 |

持久化均为 `Readonly<{ id: "fc-…"; schemaVersion: 1 }>`，无专属参数。

## 几何规格

归一化到元素盒（w/h = 元素宽高）。Lark 样本中约 2px 的拐角圆滑属渲染 cosmetic，一律不烘焙；多边形按尖角实现（与现有 `trapezoid`/`parallelogram` 一致）；圆角族使用固定比例半径（与现有 `round-rect` 固定 0.18 同一套路，fc 取 Lark 样本的 0.0875）。

| `shape.id` | 几何 |
| --- | --- |
| `fc-round-rect` | 圆角矩形，r = 0.0875·min(w,h) |
| `fc-terminator` | 胶囊，r = min(w,h)/2 |
| `fc-diamond` | 菱形 (w/2,0)(w,h/2)(w/2,h)(0,h/2) |
| `fc-document` | 顶角 r=0.0875·min；侧边下至 y≈0.856h；波浪底两段 cubic。PDF 中波底外溢元素盒约 4.6%h，实现时 y 按 1/1.0458 压缩，保证轮廓不外溢 |
| `fc-parallelogram` | (0.2333w,0)(w,0)(0.7667w,h)(0,h) |
| `fc-cylinder` | 竖圆柱：顶/底弧 ry=min(0.2w, h/4)，筒身 y∈[ry, h−ry]；detail：顶口前缘弧（y=ry，左右内缩 0.0125w，弧深 ry） |
| `fc-horiz-cylinder` | 横圆柱：端部 rx=min(0.2h, w/4)，两端外凸；detail：右端筒身/圆面交线弧（弧心 x=w−0.9375·rx，贯全高） |
| `fc-predefined-process` | 圆角矩形（同 fc-round-rect 比例）+ detail 双竖线 x=0.1083w、x=0.8917w，y∈[0.025h, 0.975h] |
| `fc-manual-input` | 斜顶四边形 (0,0.2h)(w,0)(w,h)(0,h) |
| `fc-trapezoid` | 倒梯形 (0,0)(w,0)(0.825w,h)(0.175w,h) |
| `fc-delay` | D 形：左边上下圆角 r=0.0375·min，顶/底边至 x=w−h/2，右端半圆（圆心 (w−h/2, h/2)，r=h/2） |
| `fc-hexagon` | 六边形 (0,h/2)(0.255w,0)(0.745w,0)(w,h/2)(0.745w,h)(0.255w,h) |
| `fc-off-page-connector` | 下尖五边形 (0,0)(w,0)(w,0.69h)(0.5w,h)(0,0.69h) |
| `fc-circle` | 椭圆 rx=w/2, ry=h/2 |

实现要点：

- 每个形状一个独立的 `getFc*Outline(w, h)` 函数，只用 `pathFromPoints`、cubic 等通用原语，不调用现有形状的实现函数
- 绑定锚点走默认：`getCompositeShapeAnchors` 对轮廓求中心轴交点，不自定义 `anchors`
- detail 笔画（双竖线、口沿弧）经 `CompositeShapeGeometry.details` 输出，与现有 cylinder 同机制
- 文字区域逐形状定义：凸多边形进 `getConvexTextBounds` 组；`fc-document` 避开波底（y 截止约 0.85h）、`fc-predefined-process` 左右内缩过双竖线、`fc-cylinder` 上下内缩过弧、`fc-horiz-cylinder` 两端内缩、`fc-delay` 右侧内缩

## 注册点清单

### 元素层（packages/element）

1. `src/types.ts`（`BaseShapeData` 联合）— 新增 14 个无参成员
2. `src/compositeShape.ts` —
   - `BASE_SHAPE_IDS` 追加 14 id
   - `baseShapeData` 无参组加分支
   - `getCompositeShapePoints` 逐形状加分支（曲线形状 flatten 其 outline；图标与凸文字区域都依赖它）
   - `getCompositeShapeGeometry` 为曲线/detail 形状加分支；纯多边形落到 `pathFromPoints` 兜底
   - `getCompositeShapeTextBounds` 按上节分组加分支
   - `isCompositeShapeOpen` 全部进 `false` 组
   - `assertBaseShapeData` 的无参校验已被 `hasOnlyKeys(id, schemaVersion)` 覆盖，无需改；控制点函数默认空，无需改
3. `src/binding.ts`（`getShapeSideAdaptive`）— 14 id 进 rectangle-sector 兜底组
4. `src/shape.ts`（`generateElementShape`）— 14 id 进通用 outline 组（fillFaces/details 自动处理）
5. `src/transform.ts` — 创建与绑定两个 switch 补分支，启用 `convertToExcalidrawElements` 的 `type: "fc-…"` 骨架简写
6. `packages/agent-tool` — `yarn workspace @excalidraw/agent-tool docs:generate` 重新生成 `api-documentation.generated.ts`（内嵌字面量 id 联合，只能重新生成）；`schemas.ts`/`collaboration.ts` 走 `z.enum(BASE_SHAPE_IDS)` 自动覆盖

### 工具栏入口（packages/excalidraw）

7. `components/Tools.tsx` — 新增 `FLOWCHART_SHAPE_TOOLS` 与 `FlowchartShapeToolPopover`：
   - 复用 `ToolPopover` 平铺网格；图标经 `getCompositeShapeIcon` 从几何自动派生；title 用 `t("toolBar.fc-*")`
   - 选中时 `setAppState({ preferredGenericShape: id })` + `setActiveTool({ type: "rectangle" })`；创建链路（`pointerSelection.ts` 对 tool `rectangle` 直接读 `preferredGenericShape`）零改动，两个 popover 共享"当前图形"状态
   - trigger 显示：当前选中为 fc 形状时显示其图标，否则显示默认 `fc-diamond` 图标
   - `isGenericShapeType` 列表同步加入 14 id
8. `components/Toolbar.tsx` 与 `MobileToolbar.tsx` — 在通用图形 popover 旁挂载 `FlowchartShapeToolPopover`
9. `components/ConvertElementTypePopup.tsx` — `GENERIC_TYPES` 追加 14 id（转换弹窗与 Tab 循环自动覆盖）；弹窗图标从写死的 RectangleIcon 改为 `getCompositeShapeIcon`
10. `locales/en.json` + `zh-CN.json` — 新增 `element.fc-*`（Stats 面板必需）与 `toolBar.fc-*`（popover title）；中文名：流程/开始结束/判定/文档/数据/数据库/数据流/预定义流程/手动输入/手动操作/延迟/准备/跨页引用/队列

### 测试

11. `packages/excalidraw/_tests_/helpers/api.ts` — `API.createElement` switch 加 14 id
12. 补 `it.each` 列表：`packages/element/_tests_/compositeShape.test.ts`（文字区域/持久化校验/绑定）、`compositeShapeCollision.test.ts`、`excalidraw/_tests_/scene/export.test.ts`、`convertElementType.binding.test.tsx`、`compositeShapeUI.test.tsx`（`presets`，覆盖"popover 选择 → 拖拽 → 断言 shape.id"）

## 验收

1. `yarn test:typecheck` 通过
2. `yarn workspace @excalidraw/agent-tool docs:check` 通过
3. `yarn test:update` 全绿（含快照更新）
4. 手工验收（excalidraw-app dev）：顶部工具栏出现流程图入口（桌面+移动）；逐一创建 14 个形状与 PDF 样本比对外观；每个形状可双击输入文字且文字落在合理区域；箭头可绑定吸附到轮廓；转换弹窗可互转；Stats 面板显示中文名
