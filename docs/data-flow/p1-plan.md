# 数据流图 P1 计划

## 1. 目标

把数据流图提升为独立顶层元素类型 `"dataflow"`，提供 7 个 Lark 样式预设，并完整接入通用图形能力。P1 不实现数据流专属交互；未来的双文本槽、自动编号、专用布局/连接规则等在此基础上扩展。

验收标准：

- 图形抽屉出现「数据流图」分组，7 个预设样式、尺寸、内部线条与 Lark 样本一致。
- dataflow 元素可创建、选中、缩放、旋转、绑定文本、绑定箭头、复制粘贴、撤销重做、保存重开、导出 SVG/PNG。
- dataflow 不被 flowchart 专属逻辑接管：`isFlowchartNodeElement(dataflow) === false`。
- 数据流图形不出现在流程图 popover 中。
- Lark `data_flow*` 类型可导入为 `df-*`。
- 受影响包的 `test` 与 `typecheck` 全绿。

## 2. 范围

| 纳入 P1 | 不纳入 P1 |
| --- | --- |
| 顶层类型、family、7 个 `df-*` 图形 | 数据流专属双文本槽、自动编号 |
| 通用渲染、文本、连线、命中、复制、恢复 | 数据流专属自动布局/连接规则 |
| 图形抽屉分组、图例、默认样式、i18n | 顶部工具栏新增 dataflow popover |
| quick-create 分组路由 | 数据流专属控制点/手势 |
| Lark 导入映射 | 旧数据兼容/迁移（项目无历史数据） |
| 切换形状种类 | 新设计文档/改 `docs/lark-exmples` 样本 |

命名统一为：

- 元素类型：`"dataflow"`
- family：`"dataflow"`
- shape id：`df-*`（例如 `df-process`）
- 类型名：`DataflowShapeData`、`DataflowShapeId`、`ExcalidrawDataflowElement`

采用 `"dataflow"` 而不是 `"data-flow"`，避免与现有 `"flow"`（流程图）混淆。若最终改名，需在 P1-1 开始前定稿。

## 3. 类型模型

```ts
export type DataflowShapeData =
  | Readonly<{ id: "df-external-entity"; schemaVersion: 1 }>
  | Readonly<{ id: "df-process"; schemaVersion: 1 }>
  | Readonly<{ id: "df-process-round"; schemaVersion: 1 }>
  | Readonly<{ id: "df-process-circle"; schemaVersion: 1 }>
  | Readonly<{ id: "df-store-open"; schemaVersion: 1 }>
  | Readonly<{ id: "df-store-left-label"; schemaVersion: 1 }>
  | Readonly<{ id: "df-store-plain"; schemaVersion: 1 }>;

export type DataflowShapeId = DataflowShapeData["id"];

export type ShapeData =
  | BasicShapeData
  | FlowchartShapeData
  | SequenceShapeData
  | DataflowShapeData;

export type ShapeElementType =
  | "composite"
  | "flow"
  | "sequence"
  | "dataflow";

export type ExcalidrawDataflowElement = _ExcalidrawElementBase &
  Readonly<{
    type: "dataflow";
    shape: DataflowShapeData;
  }> &
  ShapeTextFit;

export type ExcalidrawShapeElement =
  | ExcalidrawCompositeElement
  | ExcalidrawFlowElement
  | ExcalidrawSequenceElement
  | ExcalidrawDataflowElement;
```

family 与元素类型 1:1：

```ts
export const ELEMENT_TYPE_BY_FAMILY = {
  basic: "composite",
  flow: "flow",
  sequence: "sequence",
  dataflow: "dataflow",
} as const;
```

`ExcalidrawFlowchartNodeElement` 需要收窄，避免 dataflow 进入流程图专属行为：

```ts
export type ExcalidrawFlowchartNodeElement =
  | Exclude<ExcalidrawShapeElement, ExcalidrawDataflowElement>
  | ExcalidrawStickyNoteElement;
```

## 4. 样式与几何

完整映射见 [`docs/lark-exmples/data-flow/data-flow-mapper.md`](../lark-exmples/data-flow/data-flow-mapper.md)。

关键常量：

- 圆角：固定 `7`，按 `min(7, width / 2, height / 2)` 收敛。
- `df-process` 标题栏：分隔线 `y = 28`，左右内缩 `2`。
- `df-store-open`：顶部横线 `y = 1`、底部横线 `y = height - 1`，无填充；命中区域为完整矩形。
- `df-store-left-label`：竖线 `x = 36`，上下内缩 `2`。
- 描边：样本 `#000000` → `COLOR_PALETTE.black`（`#1e1e1e`）。
- 填充：`#f0f4fc → blue[0]`、`#dff5e5 → green[0]`、`#eae2fe → violet[0]`、无填充 → `transparent`。
- 默认尺寸：120×80、152×137、120×120、80×80、120×80、156×50、156×50。

## 5. 实施步骤

### P1-1 类型与几何基础

目标：让类型系统先红起来，用编译器暴露所有漏接的分支。

文件：

- `packages/element/src/types.ts`
  - `DataflowShapeData`、`DataflowShapeId`
  - `ShapeData` 联合
  - `ShapeElementType` 增加 `"dataflow"`
  - `ExcalidrawDataflowElement`
  - `ExcalidrawShapeElement` 联合
- `packages/element/src/compositeShape/family.ts`
  - `SHAPE_FAMILIES`、`DATAFLOW_SHAPE_IDS`
  - `ELEMENT_TYPE_BY_FAMILY.dataflow = "dataflow"`
  - `SHAPE_IDS` 扩到 60
  - `isDataflowShapeId`
  - 类型级互斥断言
- `packages/element/src/compositeShape/dataFlowOutline.ts`（新增）
  - 7 个图形的 outline/details/textBounds 纯几何函数
  - 统一几何常量
- `packages/element/src/compositeShape/registry.ts`
  - 注册 7 个图形
  - `isShapeElement` 增加 `"dataflow"`
- `packages/element/src/newElement.ts`
  - `isDataflowShapeData` 守卫
  - 返回 `type: "dataflow"` 的分支
- `packages/element/src/typeChecks.ts`
  - `isExcalidrawElement` 的 `assertShapeElementType` 分支加 `"dataflow"`

验收：

- `SHAPE_IDS` 为 60，`SHAPES` 表无缺项。
- `shapeElementType("df-process") === "dataflow"`。
- `newElement({ type: "df-process" })` 返回 `type: "dataflow"`。

### P1-2 通用能力接线

目标：让 dataflow 具备与 composite/flow 相同的通用图形行为。

| 文件 | 改动 |
| --- | --- |
| `packages/element/src/shape.ts` | 3 处 switch 加 `"dataflow"` |
| `packages/element/src/renderElement.ts` | 2 处 switch 加 `"dataflow"` |
| `packages/excalidraw/renderer/staticSvgScene.ts` | 1 处 switch 加 `"dataflow"` |
| `packages/excalidraw/scene/types.ts` | `ElementShapes` 加 `dataflow` |
| `packages/element/src/typeChecks.ts` | `isBindableElement`、`isTextBindableContainer`、`isEligibleFrameChildType` 加 dataflow；`isFlowchartNodeElement` 保持排除 |
| `packages/element/src/comparisons.ts` | `supportsFill`、`hasStrokeColor`、`hasStrokeWidth`、`hasStrokeStyle` 加 dataflow |
| `packages/element/src/collision.ts` | `shouldTestInside`、相交 switch 加 dataflow |
| `packages/element/src/distance.ts` | 距离 switch 加 dataflow |
| `packages/element/src/bucketFill.ts` | `FILL_BOUNDARY_TYPES` 加 dataflow |
| `packages/element/src/textElement.ts` | `VALID_CONTAINER_TYPES` 加 dataflow |
| `packages/element/src/duplicate.ts` | `_deepCopyElement` 的 shape 白名单加 dataflow |
| `packages/element/src/transform.ts` | 2 处长 switch 加 `"dataflow"` 和 7 个 `df-*`；2 处 shapeId/newElement 收窄加 dataflow |
| `packages/excalidraw/data/restore.ts` | `restoreElement` switch、批量校验分支加 dataflow |
| `packages/excalidraw/clipboard.ts` | shape 数据校验分支加 dataflow |

建议顺带收敛重复判断。优先把：

```ts
type === "composite" || type === "flow" || type === "sequence"
```

改为 `isShapeElementType(type)`，并在 `family.ts` 导出统一的 `SHAPE_ELEMENT_TYPES`。需要 `assertNever` 的 switch 保留显式 case。

验收：

- element 包 `typecheck` 通过。
- dataflow 可绑定文本、绑定箭头、填充/描边、命中、复制。
- dataflow 不出现在 flowchart 自动建节点与提示中。
- quick-create 方向手柄可用（该谓词只排除 sequence）。

### P1-3 预设目录与 UI

文件：

- `packages/excalidraw/components/shapePresetDefaults.ts`
  - 7 行默认值，全部 `strokeColor: COLOR_PALETTE.black`
  - 填色、尺寸按映射表
- `packages/excalidraw/components/presetCatalog.tsx`
  - `PresetCatalogGroupId` 加 `"dataflow"`
  - `DATAFLOW_ITEMS`
  - 分组顺序：基础 → 流程图 → 数据流图 → 时序图 → 便签 → 画框 → 表格 → 脑图
  - 所有条目 `tool: "rectangle"`，由 `shapeId` 决定几何
- `packages/excalidraw/components/App.quickCreate.ts`
  - 源图形是 `df-*` 时，插入面板打开 `"dataflow"` 分组
- `packages/excalidraw/components/ConvertElementTypePopup.tsx`
  - `GENERIC_TYPES` 增加 7 个 `df-*`
- `packages/excalidraw/locales/en.json`、`zh-CN.json`
  - `toolBar.df-*`
  - `element.df-*`
  - `shapeDrawer.dataflow`

预期 `presetIcons.tsx` 无需新增专用分支：通用几何生成会画出圆角框、标题分隔线、左栏竖线和开放存储双横线。

验收：

- 抽屉 8 个分组、顺序正确。
- 7 个图例图标渲染成功；开放存储为两条无填充线，处理图形带标题分隔线。
- `shapePresetDefaults` 60 行逐条对照通过。

### P1-4 持久化边界与 Lark 导入

文件：

- `packages/board-import/src/mapping.ts`
  - 新增 `DATA_FLOW_SHAPE_BY_LARK`
  - `resolveCompositeShape` 查表加入该表
- `packages/board-import/_tests_/render.test.ts`
  - 原先把 `data_store3` 当未知类型的夹具替换掉
  - 新增数据流映射用例
- `packages/excalidraw/data/restore.test.ts`
  - dataflow 往返恢复用例
  - `type` 与 shape 家族不匹配时抛错

验收：

- Lark 数据流样本导入后落为 `df-*`，元素 `type === "dataflow"`。
- 保存、重开、复制粘贴后 shape 数据不丢。

### P1-5 测试、视觉验收与收尾

测试补充：

- `packages/element/_tests_/compositeShape.test.ts`
  - `SHAPE_IDS` 60
  - `df-* → "dataflow"` 映射
  - 四族互斥
  - 几何断言：`[2,28] → [150,28]`（152 宽）、`[36,2] → [36,48]`、开放存储双横线、圆角 7
- `packages/element/_tests_/sequenceShape.test.ts`
  - `SHAPE_IDS` 长度、族互斥
- `packages/element/_tests_/typeChecks.test.ts`
  - dataflow 可绑定/可文本容器；`isFlowchartNodeElement` 为 false
- `packages/excalidraw/_tests_/shapePresetDefaults.test.ts`
  - 60 行、17 个黑色描边覆盖（10 个 `sc-*` + 7 个 `df-*`）
- `packages/excalidraw/_tests_/presetIcons.test.tsx`
  - 开放存储双线、处理图形分隔线
- `packages/excalidraw/_tests_/shapeDrawer.test.tsx`
  - 八分组顺序与标题
- `packages/excalidraw/_tests_/helpers/api.ts`
  - `case "dataflow"` 与 7 个 `df-*`
- `transform` 用例：`convertToExcalidrawElements([{ type: "df-process" }])` 返回 `dataflow`

视觉验收：

- 启动应用，在图形抽屉放置 7 个预设。
- 对照 `exported.pdf` 检查圆角、标题栏高度、分隔线内缩、左栏位置、开放存储线位置、填充色。
- 检查文本编辑、箭头绑定、复制粘贴、保存重开、SVG 导出。
- 检查流程图 popover 与流程图 Ctrl+方向键行为未受影响。

## 6. 测试命令

```bash
yarn workspace @excalidraw/element test
yarn workspace @excalidraw/element typecheck

yarn workspace @excalidraw/excalidraw test
yarn workspace @excalidraw/excalidraw typecheck

yarn workspace @excalidraw/board-import test
yarn workspace @excalidraw/board-import typecheck
```

## 7. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 非穷尽 boolean 链漏接 dataflow，TS 不报错 | 统一用 `isShapeElementType`；补 capability 测试 |
| `transform.ts` 两处长清单漏 `df-*` | 增加 skeleton 转换测试 |
| 收窄 `ExcalidrawFlowchartNodeElement` 引起连锁类型错误 | P1-2 单独跑 element/excalidraw typecheck |
| `ShapeCache`/SVG 导出漏 dataflow | `ElementShapes` 类型 map 强制；导出用例覆盖 |
| 图形几何与 PDF 有偏差 | 硬编码样本值的几何测试 + 浏览器对照 |
| 协作场景旧客户端不认识新类型 | 项目无历史数据；如有多端会话，同版本发布 |

## 8. 工作量估算

| 阶段 | 粗估 |
| --- | --- |
| P1-1 类型与几何 | 0.5 人日 |
| P1-2 通用能力接线 | 1.5 人日 |
| P1-3 目录与 UI | 1 人日 |
| P1-4 持久化与导入 | 0.5 人日 |
| P1-5 测试与视觉验收 | 1 人日 |
| 合计 | 约 4.5 人日 |
