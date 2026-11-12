# 时序图：Lark 到当前平台的映射

目标图形是顶层 `type: "sequence"` 的元素，`shape.id` 一律以 `sc-` 开头。目标 ID 的多词名称统一以连字符 `-` 分隔；Lark 类型与样本文字保留原拼写。

样例：[lark-sequence.json](lark-sequence.json)（10 个节点）与 [lark-sequence.pdf](lark-sequence.pdf)（1 页纯内联矢量，本机无 poppler，几何由 zlib 解内容流 + 跟踪 `q/Q/cm` 反推）。

| Lark `type` | Lark `lifeline.type` | 样本文字 | Excalidraw `shape.id` | 转换与实现要点 | 默认填充（映射后） | 默认尺寸 |
| --- | --- | --- | --- | --- | --- | --- |
| `life_line` | `entity` | `实体` | `sc-lifeline-entity` | 头部图元固定尺寸、水平居中；圆 d=38（y 1…39）+ 下划线 y=40 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 64 × 428.272 |
| `life_line` | `control` | `控制` | `sc-lifeline-control` | 圆 d=38（y 7…45）+ 圆上方两条箭头短线 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 64 × 434.272 |
| `life_line` | `boundary` | `边界` | `sc-lifeline-boundary` | 圆 d=38（x 25…63）+ 左侧竖杆 x=13 + 连接横线 y=20 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 76 × 428.272 |
| `life_line` | `actor_lifeline` | `角色` | `sc-lifeline-actor` | 头椭圆 84 宽盒内居中 + 颈/双臂/躯干/双腿折线 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 84 × 478.272 |
| `life_line` | `queue` | `数据流` | `sc-lifeline-queue` | 胶囊（左右半圆端 r=30）+ 内侧竖弧；图元铺满头部盒 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 100 × 420 |
| `life_line` | `data_base` | `数据库` | `sc-lifeline-data-base` | 圆柱（顶/底半椭圆 rx=34 ry=16）+ 顶椭圆下半弧 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 68 × 450 |
| `life_line` | `object_lifeline` | `对象` | `sc-lifeline-object` | 圆角矩形 r=7 铺满头部盒 | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 120 × 420 |
| `life_line` | `collection` | `集合` | `sc-lifeline-collection` | 两个圆角矩形 r=4 错位 8（后排先画、前排后画） | `COLOR_PALETTE.blue[0]` `#e8f0f8` | 118 × 428 |
| `activation` | — | — | `sc-activation` | 圆角矩形 r=5 铺满 | `COLOR_PALETTE.blue[1]` `#c5d7e9` | 30 × 100 |
| `combined_fragment` | — | `Opt / Loop` | `sc-fragment` | 单列行容器：外框 (0,0)→(400,0)→(400,240)→(0,240) 只描边；页签 (0,0)→(0,36.272)→(80,36.272)→(92,24.272)→(92,0) 填充并描边；首行是 operator 标签，下面是条件行 | `COLOR_PALETTE.gray[0]` `#f4f4f4`（仅页签） | 400 × 240 |

「默认填充（映射后）」是样本 `fill_color`（fragment 以 PDF 实测的页签填充为准）按**保色相、族内取最近档**映射到的项目色板色；「默认尺寸」是创建预设的尺寸。两者都落在 `packages/excalidraw/components/shapePresetDefaults.ts` 的 `SHAPE_PRESET_DEFAULTS`。

描边色也按 PDF 实测取色板最近色：10 个 `sc-*` 的描边是纯黑 `#000000` → `COLOR_PALETTE.black`（`#1e1e1e`），由每个预设的 `strokeColor` 覆盖 `SHAPE_PRESET_STYLE`；线宽/线型/填充方式/不透明度仍沿用规范样式（thin 1、solid、100）。文本色保持规范墨色 `#1f2329`（与 PDF 的 `#1f2329` 一致）。

## 生命线杆

`lifeline.size` = 360：竖直线从**头部盒底边**起、水平居中、dash 4/4，颜色随元素 `strokeColor`，**不受元素 `strokeStyle` 影响**（与箭镞恒为实线同源：杆在自定义 `draw` 里强制 dash）。

元素高度 = 头部盒高 + 360，杆因此落在元素包围盒内 —— 这是硬约束：离屏位图按 `width/height` 定尺寸，画到盒外的内容不会被渲染。头部盒高作为持久化参数 `shape.lifeline.headHeight` 保存（样例逐节点为 68.272 / 74.272 / 68.272 / 118.272 / 60 / 90 / 60 / 68），缩放后据此区分「头部盒」与「杆」。

## 样本里没有证据的部分

- **消息（message）**：10 个节点里没有任何消息，PDF 里也没有箭头/连线路径。消息建模不从本样例反推。
- **fragment 的行数与行边界**：只有 1 个 fragment、2 行；**PDF 中没有任何虚线**，也没有全宽行分隔线（唯一的水平线是页签底边）。因此本样例导入的 `sc-fragment` 不带 `fragment.rows`，也就不画行分隔线（行结构是用户后续通过「添加片段行」创建的可选数据，见 [04-fragment.md](../../sequence-diagram/04-fragment.md)）。
- **页签宽度是否随文字变化**：只有一个页签（宽 92），无法判定。

## 样本自身的不一致（实现口径）

| # | 项 | PDF 实测 | JSON | 采用 |
| --- | --- | --- | --- | --- |
| 1 | `activation` 圆角 | 5 | `border_radius` 4 | PDF 的 5（绘制路径以 PDF 为准） |
| 2 | 描边宽 | 图标型/杆/页签 2、盒型 4 | 全部 `"narrow"` | 项目规范样式 thin(1)：`narrow` 的既有映射口径 |
| 3 | `object_lifeline` 填充 | `#f0f4fc` | `#f5f5f5` | 与其他生命线一致的 `#f0f4fc` → `blue[0]` |
| 4 | `control` 节点坐标 | 渲染原点比 JSON 偏 (−10, −14.234) | — | 几何按渲染实测取（图元与文本随之整体偏移已被吸收进局部坐标） |
| 5 | `collection` 圆角 | 4 与 6 混用 | — | 统一 r=4 |

## 交互（本期不做）

消息连线、连接点、Lark 回写留待后续。fragment 已按单列表格落地：行数据、行轨选择/排序、插入点加行、分隔线缩放与 Delete 删除；导入样例仍未携带行数据，首行文本沿用绑定文本（创建时默认 `Opt / Loop`）。
