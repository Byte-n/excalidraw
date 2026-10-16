# 流程图命名映射

| Lark `composite_shape.type` | 样本文字 | 内部 `shape.id` | 样本尺寸 | 默认填充（映射后） | 默认尺寸 |
| --- | --- | --- | --- | --- | --- |
| `flow_chart_round_rect` | 流程 | `fc-round-rect` | 120×80 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 120×80 |
| `flow_chart_round_rect2` | 开始/结束 | `fc-terminator` | 120×80 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 120×80 |
| `flow_chart_diamond` | 判定 | `fc-diamond` | 120×80 | `COLOR_PALETTE.yellow[0]` `#fff3dc` | 120×80 |
| `document_shape` | 文档 | `fc-document` | 120×80 | `COLOR_PALETTE.blue[1]` `#c5d7e9` | 120×80 |
| `flow_chart_parallelogram` | 数据 | `fc-parallelogram` | 120×80 | `COLOR_PALETTE.green[0]` `#ebfbee` | 120×80 |
| `flow_chart_cylinder` | 数据库 | `fc-cylinder` | 80×100 | `COLOR_PALETTE.green[0]` `#ebfbee` | 80×100 |
| `horiz_cylinder` | 数据流 | `fc-horiz-cylinder` | 120×80 | `COLOR_PALETTE.green[0]` `#ebfbee` | 120×80 |
| `predefined_process` | 预定义流程 | `fc-predefined-process` | 120×80 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 120×80 |
| `manual_input` | 手动输入 | `fc-manual-input` | 120×80 | `COLOR_PALETTE.gray[0]` `#f4f4f4` | 120×80 |
| `flow_chart_trapezoid` | 手动操作 | `fc-trapezoid` | 120×80 | `COLOR_PALETTE.gray[0]` `#f4f4f4` | 120×80 |
| `delay_shape` | 延迟 | `fc-delay` | 120×80 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 120×80 |
| `flow_chart_hexagon` | 准备 | `fc-hexagon` | 130×80 | `COLOR_PALETTE.violet[0]` `#f0ebfc` | 130×80 |
| `off_page_connector` | 跨页引用 | `fc-off-page-connector` | 120×100 | `COLOR_PALETTE.blue[1]` `#c5d7e9` | 120×100 |
| `flow_chart_mq` | 队列 | `fc-circle` | 80×80 | `COLOR_PALETTE.green[0]` `#ebfbee` | 80×80 |

「默认填充（映射后）」是样本 `fill_color` 按**保色相、族内取最近档**映射到的项目色板色；「默认尺寸」是样本尺寸取整后的创建预设。两者都落在 `packages/excalidraw/components/shapePresetDefaults.ts` 的 `SHAPE_PRESET_DEFAULTS`。
