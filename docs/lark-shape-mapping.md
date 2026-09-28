# 普通图形：Lark 到当前平台的映射

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

## 其他

- Lark `section` 映射为 Excalidraw `frame`；[分区样本](lark-section-exmple.json)记录其尺寸、标题、边框与填充字段。
