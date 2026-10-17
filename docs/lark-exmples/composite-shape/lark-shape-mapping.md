# 普通图形：Lark 到当前平台的映射

所有目标图形仍是 `type: "composite"`；表中的目标列表示 `shape.id`，不是元素顶层 `type`。目标 ID 的多词名称统一以连字符 `-` 分隔；Lark 类型与样本文字保留原拼写。`rectangle`、`diamond`、`ellipse` 已在第一期实现，需用本期样本验收。

| Lark `composite_shape.type` | 样本文字 | Excalidraw `shape.id` | 转换与实现要点 | 默认填充（映射后） | 默认尺寸 |
| --- | --- | --- | --- | --- | --- |
| `cube` | `cube` | `cube` | 多面填充和轮廓；转换 `cube.control_point` | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 148×106 |
| `cross` | `cross` | `cross` | 闭合十字轮廓 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 120×120 |
| `brace_reverse` | `brace_reverse` | `brace-reverse` | 独立的开放描边；不填充 | `transparent` | 164×120 |
| `brace` | `brace` | `brace` | 与反向括号镜像，但保留独立 ID | `transparent` | 164×120 |
| `cloud` | `cloud` | `cloud` | 闭合曲线路径 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 120×100 |
| `double_arrow` | `double_arrow` | `double-arrow` | 双向实心块箭头，不是连接线 `arrow` | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 208×96 |
| `forward_arrow` | `forward_arrow` | `forward-arrow` | 右向实心块箭头 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 168×96 |
| `backward_arrow` | `backward_arrow` | `backward-arrow` | 左向实心块箭头，保留独立 ID | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 168×96 |
| `octagon` | `octagon` | `octagon` | 八边形 | `COLOR_PALETTE.blue[1]` `#c5d7e9` | 120×120 |
| `pentagon` | `pentagon` | `pentagon` | 五边形；与梯形分开 | `COLOR_PALETTE.blue[1]` `#c5d7e9` | 88×86 |
| `hexagon` | `hexagon` | `hexagon` | 六边形 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 98×88 |
| `star` | `star` | `star` | 五角星内外顶点 | `COLOR_PALETTE.blue[1]` `#c5d7e9` | 104×100 |
| `triangle` | `triangle` | `triangle` | `triangle.apexX = 0.5` | `COLOR_PALETTE.gray[0]` `#f4f4f4` | 108×76 |
| `right_triangle` | `right_triangle` | `triangle` | `triangle.apexX = 0`；目标预设名 `right-triangle` | `COLOR_PALETTE.gray[0]` `#f4f4f4` | 120×80 |
| `round_rect` | `round_rect` | `round-rect` | 独立的圆角矩形预设；不要由普通矩形当前的圆角开关暗中决定 ID | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 120×80 |
| `rect_bubble` | `rect_bubble` | `rectangle-bubble` | 矩形对话框及底部尾巴；目标名称与 `rectangle` 一致 | `COLOR_PALETTE.blue[1]` `#c5d7e9` | 120×72 |
| `round_rect2` | `pill` | `pill` | 普通复合图形；复用思维导图药丸形的几何，不复用节点语义 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 120×80 |
| `bubble` | `bubble` | `bubble` | 椭圆对话框及尾巴 | `COLOR_PALETTE.blue[1]` `#c5d7e9` | 120×80 |
| `diamond` | `diamond` | `diamond` | 复用第一期菱形 | `COLOR_PALETTE.yellow[0]` `#fff3dc` | 120×120 |
| `trapezoid` | `trapezoid` | `trapezoid` | 转换 `top_length` 和 `v_flip`，样本为上窄下宽 | `COLOR_PALETTE.gray[0]` `#f4f4f4` | 120×80 |
| `rect` | `rect` | `rectangle` | 复用第一期矩形；`rect` 不另建同义 ID | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 120×120 |
| `parallelogram` | `parallelogram` | `parallelogram` | 平行四边形；与云形分开 | `COLOR_PALETTE.green[0]` `#ebfbee` | 120×80 |
| `ellipse` | `ellipse` | `ellipse` | 复用第一期椭圆 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 80×80 |
| `step2` | `rightPentagon` | `right-pentagon` | 右尖五边形，与 `step` 分别实现 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 160×80 |
| `cylinder` | `cylinder` | `cylinder` | 顶部椭圆、侧面和可见背边的多段路径 | `COLOR_PALETTE.green[0]` `#ebfbee` | 80×67 |
| `step` | `step` | `step` | 左凹口和右尖端均为自身轮廓，不由 `right-pentagon` 的单点移动派生 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 160×80 |
| `circular_ring` | `circular_ring` | `circular-ring` | 圆环扇区；保存起始角、圆心角、半径和内外半径比 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 110×110 |
| `pie` | `pie` | `pie` | 实心扇区；保存起始角、圆心角和半径 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 110×110 |

「默认填充（映射后）」是样本 `fill_color` 按**保色相、族内取最近档**映射到的项目色板色，「默认尺寸」是样本尺寸取整后的创建预设；`brace` / `brace-reverse` 样本本身无 `fill_color`，故为 `transparent`。两者都落在 `packages/excalidraw/components/shapePresetDefaults.ts` 的 `SHAPE_PRESET_DEFAULTS`（`right_triangle` 行的值即 `right-triangle` 预设）。

目标内部共有 27 个不同的 `shape.id`：3 个现有 ID、24 个新增 ID。28 个 Lark 图形仍各有可识别的创建预设；Lark 的 `triangle` 和 `right_triangle` 共用持久化 ID。额外提供本地 `left-triangle` 预设，其 `shape.id` 仍为 `triangle`，`apexX = 1`；样本中没有与它对应的 Lark 类型，因此上表无对应行，其默认填充/默认尺寸沿用 `right-triangle`（`COLOR_PALETTE.gray[0]` `#f4f4f4`、120×80）。块箭头、括号和 `right-pentagon`/`step` 即使能共享绘图辅助函数，也不能因此合并持久化 ID。

## 其他

- Lark `section` 映射为 Excalidraw `frame`；[分区样本](lark-section-exmple.json)记录其尺寸、标题、边框与填充字段。
