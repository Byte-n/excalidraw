# 第二期：形状职责收敛与思维导图结构统一

本期是第一期基础图形数据结构改造后的临时第二期设计。第一期已经将普通矩形、菱形和椭圆统一为 `type: "composite_shape"`，并使用 `shape.id` 表示实际图形。本期处理两个相关问题：思维导图节点的 `shape` 结构向同一数据外形对齐，以及清理生产代码中把元素类别和几何形状混用的判断。

本期仍不把所有元素都改造成复合图形。`type`、`shape`、路径和路由字段分别承担不同职责；本期的目标是让这些职责在类型、构造、恢复、几何和 UI 代码中保持一致。

## 范围与结果

思维导图节点改为使用独立的 `MindmapShapeData`：

```ts
type MindmapShapeData = Readonly<{
  id: "rectangle" | "diamond" | "ellipse" | "pill";
  schemaVersion: 1;
}>;

type ExcalidrawMindmapNodeElement = _ExcalidrawElementBase &
  Readonly<{
    type: "mindmap-node";
    shape: MindmapShapeData;
    // graphId、role、parentId、order、collapsed 等字段保持不变
  }>;
```

普通复合图形和思维导图形状共享 `{ id, schemaVersion }` 的数据外形，但不共享同一个联合类型：普通复合图形只支持 `rectangle`、`diamond`、`ellipse`，思维导图额外支持 `pill`。

本期结束后，生产代码遵循以下规则：

```ts
element.type       // 元素类别、数据协议和行为归属
element.shape.id   // 复合图形或思维导图节点的离散视觉形状
element.points     // 线条、自由笔迹或思维导图边的实际路径
element.routing    // 连接线或思维导图边的路径路由策略
```

`getElementShapeType()` 不再作为生产代码的统一入口。需要普通复合图形时使用严格的 `type` 判断和 `shape.id` 判断；需要思维导图节点时使用独立的 `MindmapShapeData` 工具函数。

## 结构校验与版本

新增以下独立的类型和辅助函数：

```ts
type MindmapNodeShape = "rectangle" | "diamond" | "ellipse" | "pill";
type MindmapShapeData = Readonly<{
  id: MindmapNodeShape;
  schemaVersion: 1;
}>;

mindmapShapeData(id)
assertMindmapShapeData(value)
getMindmapShapeId(node)
```

校验要求：

- `shape` 必须是对象，且只能包含 `id` 和 `schemaVersion`。
- `id` 必须是四种已实现的思维导图形状之一。
- `schemaVersion` 必须是 `1`。
- 未知 ID、缺失版本和额外字段必须明确报错或被入口拒绝，不能静默恢复为矩形。
- `pill` 只属于思维导图形状；它不能被传给普通 `BaseShapeData` 校验器。

本期文件和库格式版本保持为 `3`。文件、库、剪贴板和协作入口统一校验当前节点的 `shape` 结构。

## `type` 与几何职责

### 必须按 `element.type` 判断

以下代码只判断元素类别，不读取普通图形的 `shape.id`：

- 文件、库、剪贴板和协作恢复入口；
- `Scene`、渲染器和 SVG 导出的外层元素分派；
- 文本、图片、线性元素、画框、便签、思维导图节点和思维导图边的类型守卫；
- `newElement`、复制和元素转换的持久化输出；
- `mindmap-node` 的图谱关系、折叠、布局和边连接逻辑；
- `mindmap-edge` 的 `points`、`routing`、`parentId` 和 `childId` 逻辑；
- `line`、`arrow`、`freedraw` 的路径和绑定逻辑。

普通图形的创建工具仍然可以使用 `rectangle`、`diamond`、`ellipse` 作为命令，但写入 Scene 时必须生成 `type: "composite_shape"`。工具类型不是持久化元素类型。

### 必须按普通复合图形的 `shape.id` 判断

以下代码在已经确认 `element.type === "composite_shape"` 后，按 `element.shape.id` 选择几何行为：

- RoughJS 和 SVG 的矩形、菱形、椭圆路径；
- 旋转边界、命中测试、碰撞和距离计算；
- 箭头绑定到普通图形时的边界和连接扇区；
- 圆角策略、形状相关的文字区域和填充；
- 普通图形的吸附、转换和图形筛选。

应优先使用 `isCompositeShapeId(element, id)` 进行结构收窄。只在已经完成 `type` 收窄的局部范围内直接访问 `element.shape.id`。

### 必须按思维导图 `shape.id` 判断

思维导图节点先由 `element.type === "mindmap-node"` 收窄，再使用 `getMindmapShapeId(element)`：

- `pill` 的专用圆角路径；
- 节点几何适配到普通矩形、菱形或椭圆算法；
- 思维导图节点的命中、距离和边界计算；
- 节点文本最大宽高和节点形状工具栏。

思维导图的几何适配只能生成临时的 `composite_shape` 视图供现有几何函数使用，不能把该临时对象写回 Scene，也不能丢失原节点的 `graphId`、关系和折叠状态。

## 其他元素不添加通用 `shape`

本期不向所有元素添加无意义的 `shape` 字段：

| 元素 | 负责实际几何或变化的字段 | 本期处理 |
| --- | --- | --- |
| `line` | `points`、`polygon` | 保持现有线性语义，不改成普通形状 |
| `arrow` | `points`、箭头端点、绑定、`elbowed` | 保持箭头和连接语义 |
| 肘形箭头 | `fixedSegments`、`routing`、绑定 | 不放入 `shape.id` |
| `freedraw` | `points`、笔迹参数 | 不添加离散形状 ID |
| `mindmap-edge` | `points`、`routing`、父子关系 | 保持边语义 |
| `text` | 文本内容、字体和排版 | 不添加图形形状 |
| `image` | `crop`、`scale`、资源尺寸 | 不添加矩形形状 |
| `frame` / `magicframe` | 元素类别和画框功能 | 不以 `shape: "rectangle"` 重复表达 |
| `stickynote` | 便签样式、`baseHeight`、文本布局 | 没有多形状需求前不添加 |
| `iframe` / `embeddable` | 嵌入内容和生命周期 | 不添加矩形形状 |

如果未来需要统一描述路径、文字、图片和图形的计算结果，应另行设计 `geometry` 或渲染几何接口，不把它与持久化 `shape` 混为一谈。

## 代码改动边界

| 模块 | 第二期要求 |
| --- | --- |
| `packages/element/src/types.ts` | 增加 `MindmapShapeData`，保持 `type: "mindmap-node"` |
| `packages/element/src/mindmap.ts` | 提供思维导图形状构造、校验和 ID 读取工具 |
| `newElement.ts`、思维导图创建逻辑 | 新建节点写入对象形状；默认节点形状仍由字符串命令表示 |
| `restore.ts`、JSON/库/剪贴板 | 校验对象形状和结构版本 |
| `shape.ts`、`bounds.ts`、`collision.ts`、`distance.ts` | 分别按元素类别和形状 ID 做几何分派 |
| `binding.ts`、`textElement.ts`、`utils.ts` | 使用明确的复合图形或思维导图形状判断 |
| `transform.ts`、`convertToShape.ts` | 工具类型只作为输入命令，持久化输出始终使用规范元素类型 |
| `getElementShapeType` 调用点 | 生产代码迁移到严格判断；迁移完成后删除该混合语义 API |
| 测试、样本和快照 | 全部改为对象形状，并增加非法结构、`pill` 和重复恢复测试 |

## 任务进度

截至提交 `da42c227`，第二期的代码迁移已完成，当前状态为“代码完成，待人工验收”。

| 工作包 | 状态 | 依据 |
| --- | --- | --- |
| `MindmapShapeData` 类型、构造、校验和 ID 读取 | 已完成 | `packages/element/src/types.ts`、`packages/element/src/mindmap.ts` |
| 节点创建、恢复、保存、库和剪贴板入口 | 已完成 | `newElement.ts`、`data/restore.ts`、库与剪贴板测试 |
| 几何、文本、绑定、转换和 UI 判断迁移 | 已完成 | `shape.ts`、`bounds.ts`、`collision.ts`、`distance.ts` 等生产代码已按职责收窄 |
| 思维导图样本和非法结构回归 | 已完成 | `docs/mindmap-plan/samples/` 及 `mindmap.test.ts`、恢复/库/剪贴板测试 |
| 桌面/移动端完整交互及 PNG/SVG 导出人工验收 | 待验收 | 自动化创建、编辑、命中和导出路径已有覆盖，尚未完成界面验收记录 |

本次验证已通过 `yarn test:typecheck`；本期相关的 13 个测试文件共 252 项通过、1 项跳过。实时协作双端回归仍需在实际协作会话中补录结果。

## 数据和行为不变量

- 普通图形的 `type` 永远是 `composite_shape`，其 `shape.id` 决定几何。
- 思维导图节点的 `type` 永远是 `mindmap-node`，其 `shape.id` 决定节点外观，但不改变节点语义。
- 思维导图节点不能通过普通复合图形构造函数或校验器直接持久化。
- `pill` 不会出现在普通 `BaseShapeData` 中。
- 临时几何适配不能被保存、复制到 Scene 或通过协作发送。
- 保存、恢复、复制、粘贴、撤销重做和协作后的思维导图形状数据保持 `{ id, schemaVersion }` 不变。
- 未知形状和版本产生明确错误，不能降级为矩形。

## 验收清单

- [x] 思维导图节点、默认节点形状、工具栏、布局和样本全部使用对象形状结构。
- [x] 普通复合图形和思维导图分别有独立的形状类型与校验器。
- [x] 恢复、保存、库、剪贴板和协作只接受本期对象形状结构。
- [ ] `rectangle`、`diamond`、`ellipse`、`pill` 的创建、编辑、布局、文本、命中和导出行为保持不变；自动化回归已通过，桌面/移动端及 PNG/SVG 人工验收待补录。
- [x] `element.type` 判断不再被用于推断普通复合图形的具体几何。
- [x] 非复合元素没有被强行增加无意义的 `shape` 字段。
- [x] 生产代码不再依赖混合返回语义的 `getElementShapeType`。
- [x] 文件和库格式版本保持为 `3`，各入口使用当前结构校验。
