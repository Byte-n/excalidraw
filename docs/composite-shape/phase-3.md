# 第三期：Lark 复合图形逐项实现计划

本期延续 [总纲](design.md) 和 [第二期](phase-2.md)，让当前 Excalidraw 创建、编辑和保存 [Lark 样本数据](phase-3-exmples-data.json) 中的 28 个图形。对应的 [PDF](lark-whiteboard-exported.pdf) 是静态轮廓与配色参考。样本恰有 28 条记录、28 种 Lark `composite_shape.type`，其 `text.text` 在这份样本中是目标图形名称；实际用户文字可以任意修改，未来导入器必须按 `composite_shape.type` 查下表，不能靠 `text.text` 猜图形。

本期实现 Excalidraw 图形，不实现 Lark 文件导入。下表只存于本文档，暂不在代码中声明 Lark 映射或兼容别名。每增加一种内部形状，都在同一交付增量中完成 ID、创建、编辑、几何、持久化和导出；不能一次性声明尚不可用的 24 个新 ID。

## 名称与导入映射

所有目标图形仍是 `type: "composite_shape"`；表中的目标列表示 `shape.id`，不是元素顶层 `type`。目标 ID 的多词名称统一以连字符 `-` 分隔；Lark 类型与样本文字保留原拼写。`rectangle`、`diamond`、`ellipse` 已在第一期实现，需用本期样本验收。

| Lark `composite_shape.type` | 样本文字 | Excalidraw `shape.id` | 转换与实现要点 |
| --- | --- | --- | --- |
| `cube` | `cube` | `cube` | 多面填充和轮廓；转换 `cube.control_point` |
| `cross` | `cross` | `cross` | 闭合十字轮廓 |
| `brace_reverse` | `brace_reverse` | `brace-reverse` | 独立的开放描边；不填充 |
| `brace` | `brace` | `brace` | 与反向括号镜像，但保留独立 ID |
| `cloud` | `cloud` | `cloud` | 闭合曲线路径 |
| `double_arrow` | `double_arrow` | `double-arrow` | 双向实心块箭头，不是连接线 `arrow` |
| `forward_arrow` | `forward_arrow` | `forward-arrow` | 右向实心块箭头 |
| `backward_arrow` | `backward_arrow` | `backward-arrow` | 左向实心块箭头，保留独立 ID |
| `octagon` | `octagon` | `octagon` | 八边形 |
| `pentagon` | `pentagon` | `pentagon` | 五边形；与梯形分开 |
| `hexagon` | `hexagon` | `hexagon` | 六边形 |
| `star` | `star` | `star` | 五角星内外顶点 |
| `triangle` | `triangle` | `triangle` | `triangle.apexX = 0.5` |
| `right_triangle` | `right_triangle` | `triangle` | `triangle.apexX = 0`；目标预设名 `right-triangle` |
| `round_rect` | `round_rect` | `round-rect` | 独立的圆角矩形预设；不要由普通矩形当前的圆角开关暗中决定 ID |
| `rect_bubble` | `rect_bubble` | `rectangle-bubble` | 矩形对话框及底部尾巴；目标名称与 `rectangle` 一致 |
| `round_rect2` | `pill` | `pill` | 普通复合图形；复用思维导图药丸形的几何，不复用节点语义 |
| `bubble` | `bubble` | `bubble` | 椭圆对话框及尾巴 |
| `diamond` | `diamond` | `diamond` | 复用第一期菱形 |
| `trapezoid` | `trapezoid` | `trapezoid` | 转换 `top_length` 和 `v_flip`，样本为上窄下宽 |
| `rect` | `rect` | `rectangle` | 复用第一期矩形；`rect` 不另建同义 ID |
| `parallelogram` | `parallelogram` | `parallelogram` | 平行四边形；与云形分开 |
| `ellipse` | `ellipse` | `ellipse` | 复用第一期椭圆 |
| `step2` | `rightPentagon` | `right-pentagon` | 右尖五边形，与 `step` 分别实现 |
| `cylinder` | `cylinder` | `cylinder` | 顶部椭圆、侧面和可见背边的多段路径 |
| `step` | `step` | `step` | 左凹口和右尖端均为自身轮廓，不由 `right-pentagon` 的单点移动派生 |
| `circular_ring` | `circular_ring` | `circular-ring` | 圆环扇区；保存起始角、圆心角、半径和内外半径比 |
| `pie` | `pie` | `pie` | 实心扇区；保存起始角、圆心角和半径 |

目标内部共有 27 个不同的 `shape.id`：3 个现有 ID、24 个新增 ID。28 个 Lark 图形仍各有可识别的创建预设；Lark 的 `triangle` 和 `right_triangle` 共用持久化 ID。额外提供本地 `left-triangle` 预设，其 `shape.id` 仍为 `triangle`，`apexX = 1`；样本中没有与它对应的 Lark 类型。块箭头、括号和 `right-pentagon`/`step` 即使能共享绘图辅助函数，也不能因此合并持久化 ID。

## 参数和控制点

新形状继续使用 `{ id, schemaVersion: 1 }` 判别结构。无可调参数的图形不存空的同名对象；有参数的图形在 `shape[shape.id]` 存放来源值，绘制路径与控制点位置均从来源值和元素尺寸计算，不保存导出的 PDF 路径。

| 目标形状 | 持久化参数 | 初始值及更新规则 |
| --- | --- | --- |
| `triangle` | `triangle.apexX`，宽度归一化的数值，范围 `[0, 1]` | 中置 `0.5`、右角预设 `0`、左角预设 `1`。顶部控制点只允许水平拖动；拖过三种位置时不换 ID，保留元素 ID、绑定文字和箭头，支持撤销重做。 |
| `cube` | `cube.controlPoint`，局部宽高归一化的 `{ x, y }` | 将样本的 `control_point` 分别除以元素宽高；缩放时保持比例，并按前面、顶部、侧面不翻折的几何范围约束。 |
| `trapezoid` | `trapezoid.narrowWidthRatio` 与 `narrowEdge: "top" \| "bottom"` | 样本宽 `120`、`top_length` 约 `80`、`v_flip: true`，可见轮廓为 `80/120` 且窄边在上；控制点改变窄边宽度，翻转改变窄边朝向。 |
| `pie` | `pie.centralAngle`、`radius`、`sectorRatio`、`startRadialLineAngle` | 角度使用度数，半径按元素短边归一化；实心扇区从起始角绘制圆心角。两个外半径端点控制起始角、圆心角和半径；不作为文字容器，但支持颜色填充。 |
| `circular-ring` | `circularRing.centralAngle`、`radius`、`sectorRatio`、`startRadialLineAngle` | `sectorRatio` 为内半径与外半径之比；两个外半径端点控制起始角、圆心角和半径，内半径控制点调整环宽；不作为文字容器，但支持颜色填充。 |

Lark `right_triangle` 的样本顶点在左上方、直角在左下方；本地 `left-triangle` 是其水平镜像，顶点在右上方。这里的“右/左”是预设名，几何由 `apexX` 唯一决定。`round-rect`、`pill` 和其他样本没有显式参数；其默认角半径、尾巴比例、箭头肩宽、星形内径等从 PDF 轮廓标定为确定性几何常量。静态样本不能证明 Lark 在任意尺寸下的控制规则，本期采用按宽高归一化的缩放规则，并在实现各形状时记录偏离样本的特例。

校验应拒绝未知 ID、缺失版本、非法数值、越界控制点和与 ID 不匹配的参数。文件、库、剪贴板、程序化元素和协作入口继续使用同一校验。当前文件格式版本仍为 `3`；老客户端遇到新增 ID 应明确拒绝，不能将其恢复成矩形。

## 几何和交互实现

在 `packages/element` 建立复合图形的局部几何定义：每种图形给出可填充轮廓、需单独描边的路径、用于命中与箭头连接的实际边界、文字安全区域，以及可编辑控制点。开放的 `brace` 不应得到虚假的填充区域；`cube` 和 `cylinder` 需要多个填充面及可见边。几何由尺寸、形状参数和现有样式派生，画布、SVG/PNG 导出、命中、距离、边界和绑定共用同一来源。对 PDF 的比对使用清晰描边模式，不能以 RoughJS 的随机扰动作为轮廓规格。

现有 `getElementShape()` 对多数 `composite_shape` 返回矩形近似，`collision.ts`、`distance.ts` 和 `binding.ts` 也只分派三种基础形状。加入新 ID 时必须同步改造这些入口，特别是凹形 `step`、星形、对话框尾巴、开放括号和多面图形；不能只画出轮廓却保留矩形命中或矩形箭头锚点。文字仍使用独立的绑定 `text` 元素；尾巴、括号及立体面需要专属文字安全区域。

创建入口统一放在工具栏现有的“普通图形”分组中，桌面和移动端共用该分组的形状选择器；28 个 Lark 样本对应预设及额外的本地 `left-triangle` 预设都在这里选择，不另设顶层工具栏按钮或放入“更多工具”。保留现有矩形、菱形、椭圆预设及普通图形工具快捷键。选择器中的每个预设有图标与名称；选择后创建规范的 `composite_shape`。现有类型转换面板、样式面板和选中后的控制点应识别新增图形；图形转换保留 ID、绑定文字和箭头关系，并按目标形状重置或映射专属参数。填充、描边、旋转、缩放、复制、粘贴、编组、层级和撤销重做均作为每个图形的验收项。

## 交付顺序

按下列顺序逐项交付；一项完成前不预先声明下一项的 ID。每项的完成含类型与校验、构造与选择器、绘制与导出、命中与绑定、文字区域、保存恢复和针对该形状的测试。

1. **共用基础**：提取局部路径与轮廓接口，接通现有 `rectangle`、`diamond`、`ellipse`，用三种已知图形验证画布、SVG、命中和箭头绑定结果没有变化。
2. **三角形控制点**：实现 `triangle`，再分别验证 `triangle`、`right-triangle` 和本地 `left-triangle` 预设；控制点从 `0` 到 `1` 连续可拖动，`shape.id` 始终不变。
3. **简单闭合轮廓**：依次实现 `cross`、`pentagon`、`hexagon`、`octagon`、`star`、`parallelogram`、`trapezoid`、`right-pentagon`、`step`、`forward-arrow`、`backward-arrow`、`double-arrow`。对每种形状分别验证凹角、尖角和箭头连接点。
4. **圆角、曲线与开放轮廓**：依次实现 `round-rect`、`pill`、`cloud`、`rectangle-bubble`、`bubble`、`brace`、`brace-reverse`。确认曲线轮廓和文字区域，不给开放括号或尾巴外的空白区域错误填充。
5. **多面图形**：实现 `cylinder`、`cube`。验证多填充面、可见描边顺序、透明度和 `cube` 控制点。
6. **整体验收**：逐行检查映射表的 28 个 Lark 样本在当前 Excalidraw 中都有可创建、可编辑、可保存重开的对应图形，另检查本地 `left_triangle`。本步不开发 Lark 导入器。

## 验收与证据

- 每个样本以 JSON 中的宽高、颜色、翻转与参数构造目标元素，和 PDF 中对应轮廓逐项比对；文字因字体差异单独验收。至少覆盖原尺寸、非等比缩放、旋转与较小尺寸，不能只在示例尺寸成立。
- 对每个新 ID 测试有效构造、非法参数拒绝、保存恢复、库和剪贴板往返，以及 SVG/PNG 输出。逐形状 SVG 结构快照和路径测试覆盖轮廓、填充、描边及多面叠放顺序。
- 控制点测试覆盖 `triangle` 的三种预设和连续中间值、`trapezoid` 的窄边宽度与方向、`cube` 的控制点边界；拖动和缩放后检查撤销重做、箭头与绑定文字。
- 命中与绑定测试覆盖凹口、星形内凹处、对话框尾巴、括号开放区域及立体面的真实外轮廓，避免矩形近似误判。
- 桌面和移动端人工验收“普通图形”分组内 28 个 Lark 对应预设及本地 `left-triangle` 的创建、选中、编辑与导出，并补录第二期尚未完成的相关交互验收。直到 28 行都满足上述行为，本期才算完成。
