# 数据流图命名映射

| Lark `composite_shape.type` | 样本文字 | 内部 `shape.id` | 样本尺寸 | 默认填充（映射后） | 默认尺寸 |
| --- | --- | --- | --- | --- | --- |
| `data_flow_round_rect` | 外部实体 | `df-external-entity` | 120×80 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 120×80 |
| `data_process` | 数据处理 | `df-process` | 151.6275×136.5359 | `COLOR_PALETTE.green[0]` `#ebfbee` | 152×137 |
| `data_flow_round_rect3` | 1.0 数据处理 | `df-process-round` | 120×120 | `COLOR_PALETTE.green[0]` `#ebfbee` | 120×120 |
| `data_flow_ellipse` | 1.0 数据处理 | `df-process-circle` | 80×80 | `COLOR_PALETTE.green[0]` `#ebfbee` | 80×80 |
| `data_store` | 数据存储 | `df-store-open` | 120×80 | `transparent` | 120×80 |
| `data_store2` | 数据存储 | `df-store-left-label` | 156×50 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 156×50 |
| `data_store3` | 数据存储 | `df-store-plain` | 156×50 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 156×50 |

「默认填充（映射后）」是样本 `fill_color` 按**保色相、族内取最近档**映射到的项目色板色；「默认尺寸」是样本尺寸取整后的创建预设。两者都落在 `packages/excalidraw/components/shapePresetDefaults.ts` 的 `SHAPE_PRESET_DEFAULTS`。

## 样式说明

- 样本描边统一为 `#000000`，映射到 `COLOR_PALETTE.black`（`#1e1e1e`）；7 个数据流预设均覆盖 `strokeColor`。
- 样本填充映射：`#f0f4fc → blue[0]`、`#dff5e5 → green[0]`、`#eae2fe → violet[0]`、无填充 → `transparent`。
- 线宽 `narrow` → `STROKE_WIDTH.thin`（1）；描边/填充均为 solid，不透明度 100。
- 样本文字不固化为预设内容：预设创建为空图形，文字仍通过双击绑定到正文安全区。

## 几何参数

- 圆角矩形统一固定圆角 `7`，按 `min(7, width / 2, height / 2)` 收敛。
- `df-process`：标题栏分隔线 `y = 28`，左右内缩 `2`；正文文本安全区在标题栏下方。
- `df-store-open`：顶部横线 `y = 1`、底部横线 `y = height - 1`，无填充；命中区域仍为完整矩形。
- `df-store-left-label`：左栏竖线 `x = 36`，上下内缩 `2`；正文文本安全区在竖线右侧。
- 其余图形无内部线条；圆角/椭圆按各自轮廓生成。
