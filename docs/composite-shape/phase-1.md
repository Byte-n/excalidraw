# 第一期：现有基础图形的新数据结构

本期执行 [复合图形数据结构总纲](design.md) 的第一步。当前已有的矩形、菱形、椭圆改用新的持久化元素类型，保持现有绘制和编辑能力。这是破坏式大版本，不迁移或兼容旧文件、旧库、旧元素数组及旧客户端。

## 范围与完成结果

本期结束后，Scene、公开元素数组和新保存的数据中，普通矩形、菱形、椭圆都使用 `type: "composite_shape"`。工具栏仍显示三种原工具，`ToolType` 可继续使用 `rectangle`、`diamond`、`ellipse` 作为创建命令；工具类型不等于持久化元素类型。

`mindmap-node` 及其 `shape: "rectangle" | "diamond" | "ellipse" | "pill"` 保持当前语义和存储结构；便签、箭头、线条、文字、图片、画框也不迁入复合图形。第一期不导入 `lark-examples-data.json`，不增加第四种形状，不预声明未来形状 ID、专属参数、控制点或翻转字段。

## 唯一允许的新形状类型

```ts
type BaseShapeData =
  | Readonly<{ id: "rectangle"; schemaVersion: 1 }>
  | Readonly<{ id: "diamond"; schemaVersion: 1 }>
  | Readonly<{ id: "ellipse"; schemaVersion: 1 }>;

type ExcalidrawCompositeShapeElement = _ExcalidrawElementBase &
  Readonly<{
    type: "composite_shape";
    shape: BaseShapeData;
  }>;
```

三个分支都没有专属参数，因此不保存 `shape.rectangle`、`shape.diamond`、`shape.ellipse` 空对象。`shape.schemaVersion` 固定为 `1`；后续只有真实的参数结构迁移才增加版本。元素原有的几何、样式、链接、分组、框架、绑定、锁定、排序、创建时间和协作字段保持原值与原语义。

新建图形的工具与存储结构为：

| 创建工具    | 存储元素 `type`   | `shape`                                 |
| ----------- | ----------------- | --------------------------------------- |
| `rectangle` | `composite_shape` | `{ id: "rectangle", schemaVersion: 1 }` |
| `diamond`   | `composite_shape` | `{ id: "diamond", schemaVersion: 1 }`   |
| `ellipse`   | `composite_shape` | `{ id: "ellipse", schemaVersion: 1 }`   |

新建及转换为三种图形时，保留现有元素 ID、`index`、绑定文字和箭头关系。规范结构重复恢复后形状数据不变。导入仅接受新格式文件。协作双方需运行当前大版本。

## 数据入口与出口

1. 文件、初始数据、库项目、粘贴内容和程序化元素输入进入 Scene 前必须符合新结构；旧 `rectangle`、`diamond`、`ellipse` 元素不自动转换。
2. 新建图形、复制、粘贴、类型转换、自动识别和元素骨架转换均生成规范元素。对外返回的 `ExcalidrawElement` 联合类型只包含新的复合图形分支，不把旧类型当作仍可持久化的普通元素。
3. 本期规范元素输入必须且只能带三种已支持的 `shape.id` 和 `schemaVersion: 1`。未知 ID、缺失版本和不匹配的数据不能静默降级为矩形或被无提示丢弃。
4. 新保存的 `.excalidraw` 文件和 `.excalidrawlib` 库文件版本均为 `3`，读取器只接受版本 `3`。剪贴板目前没有对应的文件版本字段，须校验元素结构并拒绝旧格式。
5. 旧文件和旧客户端均不受支持；协作使用当前大版本的数据结构，不增加旧客户端兼容逻辑。

文件格式版本的变更需要同步更新开发文档、加载校验和样本。`lark-examples-data.json` 仍是独立的外部平台格式，不在本期导入或重写。

## 代码改动边界

| 模块 | 本期需要达到的状态 |
| --- | --- |
| `packages/element/src/types.ts`、`newElement.ts`、`transform.ts` | 正式元素联合和构造函数使用新结构；旧形状仅作为创建工具名存在 |
| `packages/excalidraw/data/restore.ts`、JSON/库/剪贴板入口 | 在场景接收前拒绝旧元素，校验新形状，保证保存只输出规范结构 |
| 图形绘制、SVG 导出、命中、边界、碰撞、箭头绑定 | 按 `shape.id` 复用三种现有几何算法，不能把 `composite_shape` 一律当作矩形 |
| 圆角、填充、样式、文本容器、流程图、选中与转换 | 区分形状 ID，并保留三种图形原有的可用操作 |
| Toolbar、公开 API 和元素骨架 | 可继续接收原工具名作为创建命令，创建与输出的是规范元素 |
| 思维导图 | `mindmap-node` 保持语义类型；绘制临时几何可走适配层，但不能把旧图形类型写回 Scene |

实现中宜集中形状 ID 的判定与三种几何分派，避免把新的条件判断复制到更多模块。此阶段不要求建立未来 64 种形状的注册表或参数 API。

## 数据和行为不变量

- 三种图形改用新结构后，位置、尺寸、旋转、圆角、描边、填充、透明度、绑定文字和箭头连接点保持一致。
- `shape.id` 决定矩形、菱形或椭圆的几何；顶层 `type` 只表示复合图形类别。
- 现有矩形自适应圆角、菱形比例圆角和椭圆行为不因顶层 `type` 合并而改变。
- `mindmap-node` 的父子关系、折叠、布局和节点外观不变。
- 文本仍以独立 `text` 元素和 `containerId` 绑定；`boundElements` 保留既有关系。
- 无专属参数的三种形状不存同名空对象，不使用 `customData` 承载正式形状数据。
- 新格式文件保存再加载、重复恢复的结果稳定；规范 Scene 中不会出现旧图形类型。

## 验收清单

- [ ] 类型检查确认正式元素联合只声明三种已实现的 `shape.id`，没有未来图形或参数占位。
- [ ] 旧版本文件、库及旧图形元素输入均被拒绝；新建、复制、类型转换和保存只输出新结构。
- [ ] 包含绑定文字、箭头、分组、画框、旋转和圆角的新格式文件加载后可编辑，保存重开后 ID、关系与画面不变。
- [ ] 三种工具在桌面和移动端仍可创建、选择、调整样式、撤销重做、导出 PNG/SVG。
- [ ] 思维导图节点和其他现有元素的行为回归通过。
- [ ] 未知 `shape.id` 或不支持的 `schemaVersion` 有明确错误，不会静默变成另一种图形。
- [ ] 文件与库格式版本、公开 JSON 文档及拒绝旧数据的策略一致。

本期验收不以出现新图形作为结果；结果是现有三种图形在新结构下保持完整可用，旧格式明确不受支持。
