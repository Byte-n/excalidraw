# 第一期：现有基础图形的数据结构迁移

本期执行 [复合图形数据结构总纲](design.md) 的第一步。只迁移当前已有的 `rectangle`、`diamond`、`ellipse` 三种普通图形，保持现有绘制和编辑能力。

## 范围与完成结果

本期结束后，Scene、公开元素数组和新保存的数据中，普通矩形、菱形、椭圆都使用 `type: "composite_shape"`。工具栏仍显示三种原工具，`ToolType` 可继续使用 `rectangle`、`diamond`、`ellipse` 作为创建命令；工具类型不等于持久化元素类型。

`mindmap-node` 及其 `shape: "rectangle" | "diamond" | "ellipse" | "pill"` 保持当前语义和存储结构；便签、箭头、线条、文字、图片、画框也不迁入复合图形。第一期不导入 `examples-data.json`，不增加第四种形状，不预声明未来形状 ID、专属参数、控制点或翻转字段。

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

旧数据的规范化映射为：

| 输入元素 `type` | 规范输出 `type` | `shape` |
| --- | --- | --- |
| `rectangle` | `composite_shape` | `{ id: "rectangle", schemaVersion: 1 }` |
| `diamond` | `composite_shape` | `{ id: "diamond", schemaVersion: 1 }` |
| `ellipse` | `composite_shape` | `{ id: "ellipse", schemaVersion: 1 }` |

除 `type` 和新增 `shape` 外，不因为迁移重建元素 ID、改动 `index` 或重新绑定文本与箭头。转换必须幂等：已是本期规范结构的元素再恢复一次，形状数据不变。文件导入时保留元素原有的 `version`、`versionNonce`、`updated` 和 `created`；格式规范化不是一次用户编辑，不生成独立历史记录。协作接收前必须完成同一规范化，并通过格式版本隔离旧客户端，避免同 ID、同修订号的两种元素表示参与同步。

## 数据入口与出口

1. 在文件、初始数据、库项目、粘贴内容和程序化元素输入进入 Scene 之前识别三种旧类型并转换；调用方仍可提供旧格式作为兼容输入。
2. 新建图形、复制、粘贴、类型转换、自动识别和元素骨架转换均生成规范元素。对外返回的 `ExcalidrawElement` 联合类型只包含新的复合图形分支，不把旧类型当作仍可持久化的普通元素。
3. 本期规范元素输入必须且只能带三种已支持的 `shape.id` 和 `schemaVersion: 1`。未知 ID、缺失版本和不匹配的数据不能静默降级为矩形或被无提示丢弃。
4. 新保存的 `.excalidraw` 文件只写规范元素。提议将文件顶层格式版本从 `2` 升到 `3`；库文件若写入规范元素，也同步升级库格式版本和读取器。剪贴板目前没有对应的文件版本字段，靠元素规范化与明确的兼容检查处理。
5. 新格式客户端读取旧文件；旧客户端不保证读取新文件。协作入口必须阻止旧客户端与新格式场景混用，或先在宿主层完成版本隔离。

文件格式版本的变更需要同步更新开发文档、加载校验和样本。`examples-data.json` 仍是独立的外部平台格式，不在本期导入或重写。

## 代码改动边界

| 模块 | 本期需要达到的状态 |
| --- | --- |
| `packages/element/src/types.ts`、`newElement.ts`、`transform.ts` | 正式元素联合和构造函数使用新结构；旧形状仅作为兼容输入类型存在 |
| `packages/excalidraw/data/restore.ts`、JSON/库/剪贴板入口 | 在场景接收前迁移旧数据，校验新形状，保证保存只输出规范结构 |
| 图形绘制、SVG 导出、命中、边界、碰撞、箭头绑定 | 按 `shape.id` 复用三种现有几何算法，不能把 `composite_shape` 一律当作矩形 |
| 圆角、填充、样式、文本容器、流程图、选中与转换 | 区分形状 ID，并保留三种图形原有的可用操作 |
| Toolbar、公开 API 和元素骨架 | 可继续接收原工具名或兼容输入，创建与输出的是规范元素 |
| 思维导图 | `mindmap-node` 保持语义类型；绘制临时几何可走适配层，但不能把旧图形类型写回 Scene |

实现中宜集中形状 ID 的判定与三种几何分派，避免把新的条件判断复制到更多模块。此阶段不要求建立未来 64 种形状的注册表或参数 API。

## 数据和行为不变量

- 同一个图形迁移前后，位置、尺寸、旋转、圆角、描边、填充、透明度、绑定文字和箭头连接点保持一致。
- `shape.id` 决定矩形、菱形或椭圆的几何；顶层 `type` 只表示复合图形类别。
- 现有矩形自适应圆角、菱形比例圆角和椭圆行为不因顶层 `type` 合并而改变。
- `mindmap-node` 的父子关系、折叠、布局和节点外观不变。
- 文本仍以独立 `text` 元素和 `containerId` 绑定；`boundElements` 保留既有关系。
- 无专属参数的三种形状不存同名空对象，不使用 `customData` 承载正式形状数据。
- 老文件加载、保存再加载、重复恢复的结果稳定；不会出现旧类型与新类型同时存在于规范 Scene。

## 验收清单

- [ ] 类型检查确认正式元素联合只声明三种已实现的 `shape.id`，没有未来图形或参数占位。
- [ ] 三种旧元素的文件、库、剪贴板及程序化输入均迁移；新建、复制、类型转换和保存只输出新结构。
- [ ] 包含绑定文字、箭头、分组、画框、旋转和圆角的旧文件加载后可编辑，保存重开后 ID、关系与画面不变。
- [ ] 三种工具在桌面和移动端仍可创建、选择、调整样式、撤销重做、导出 PNG/SVG。
- [ ] 思维导图节点和其他现有元素的行为回归通过。
- [ ] 未知 `shape.id` 或不支持的 `schemaVersion` 有明确错误，不会静默变成另一种图形。
- [ ] 文件与库格式版本、公开 JSON 文档及兼容策略一致；旧版客户端被阻止加入新格式协作场景。

本期验收不以出现新图形作为结果；结果是现有三种图形在新结构下保持完整可用，且旧数据有明确迁移路径。
