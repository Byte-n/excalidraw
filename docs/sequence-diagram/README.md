# 时序图（Sequence Diagram）分期实施计划

> 适用范围：`packages/element` 的 `sc-*` 复合图形、`packages/excalidraw` 的选择/缩放交互、`packages/board-import` 的飞书导入。
>
> 相关材料：
>
> - [验收样例文件](./acceptance.excalidraw)：导入画板后按 P1–P4 各期「验收」清单操作
> - [Lark 样例 JSON](../lark-exmples/sequence/lark-sequence.json)
> - [Lark → sc-\* 映射说明](../lark-exmples/sequence/sequence-mapper.md)
> - 原始实施方案（未入库）：`git show 6c990444:docs/sequence-diagram-plan.md`

## 1. 背景

当前仓库已经落地了「时序图图形本体」：

- 顶层 `element.type: "sequence"`，10 个 `sc-*` 图形；
- 8 个生命线（图标型 4 + 盒型 4）、`sc-activation`、`sc-fragment`；
- 图形抽屉、默认尺寸/填充、缩略图、标签文本、Agent 工具可创建；
- 单测覆盖静态几何 70 例。

但距离「可编辑的时序图」还差三层：

1. **生命线的「头部 + 杆」仍被当成普通矩形**：包围盒、命中区域、选择框、缩放框四者合一，点空白会选中图形，杆长写死 360，垂直缩放不同步。
2. **没有时序语义**：消息连线、激活条连接点、拖拽建激活条都没有实现；`isBindableElement` 刻意排除了 `sequence`。
3. **fragment 只有外壳**：没有行/分区/operator；Lark 导入也没有映射 `life_line` / `activation` / `combined_fragment`。

本计划把剩余工作拆成 5 期，每期可独立合并、独立验收。

## 2. 核心设计：单元素 + 子几何

生命线仍然是一个 `sequence` 元素，**不拆成「头部 + 尾巴」两个元素再组合**。原因：

- Excalidraw 的 group 只是逻辑分组（`groupIds`），选择框仍是子元素并集，解决不了「整条框」的问题；
- group 缩放会把头尾一起拉伸，要做「只伸长杆」必须自定义 group resize，代价更大；
- 一条生命线变成多个元素后，移动/复制/删除/导入/回写都要维护同步不变量。

正确做法是把一个元素的几何拆成四套语义：

| 概念 | 用途 | 生命线上的取值 |
| --- | --- | --- |
| **包围盒** | 离屏位图、导出 viewBox、frame 裁剪、吸附 | 整个元素盒：`width × height` |
| **可见几何** | 实际绘制 | 头部 glyph + 标签 + 虚线杆 |
| **命中区域** | 点选、距离、套索、擦除 | 头部矩形 + 杆的细长走廊 |
| **选择框 / 缩放手柄** | 单选 UI | 头部盒：`width × headHeight` |

四条硬原则：

1. **包围盒必须包含杆**，否则离屏位图（默认 20px padding）会裁掉杆。
2. **命中区域可以小于包围盒**，点击头部或杆才选中，点空白穿透到下层。
3. **选择框只包头部**，杆底另给一个控制点；单选时隐藏整条外框。
4. **所有派生几何只有一个来源**：`shape.lifeline.headHeight` 与 `element.height`。`selectionFrame`、`hitPaths`、`controlPoints`、杆长都从这两个值派生，不另存第三份状态。

## 3. 术语

| 术语 | 含义 |
| --- | --- |
| **头部盒** | 元素本地坐标 `0 … headHeight` 的区域，包含图标/盒体与标签 |
| **标签带** | `getSequenceLifelineTextBounds` 返回的文本安全矩形；图标型的底边正好等于 `headHeight` |
| **杆** | 从 `headHeight` 到 `element.height` 的虚线，水平居中于 `width / 2` |
| **杆长** | `element.height - headHeight` |
| **选择框** | 单选生命线时画在头部盒上的框，8 个缩放手柄附在它上面 |
| **杆底控制点** | 杆末端 `(width / 2, element.height)` 的圆点，拖动只改杆长 |
| **命中走廊** | 杆中心线左右各若干像素的窄矩形，用于点选、套索、擦除 |

## 4. 分期总览

| 期 | 文档 | 主题 | 交付后的结果 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| **P1** | [01-geometry-and-hit.md](./01-geometry-and-hit.md) | 几何底座 + 命中几何 | 杆长与高度绑定；点空白不选中；API 创建不再裁切 | 无 | 已实现（浏览器验收待做） |
| **P2** | [02-selection-and-resize.md](./02-selection-and-resize.md) | 选择框 + 缩放 + 杆底控制点 | 差异化选择 UI 与完整缩放语义 | P1 | 已实现（浏览器手势验收待做） |
| **P3** | [03-messages-and-activation.md](./03-messages-and-activation.md) | 消息与激活条 | 生命线之间能画消息；激活条绑定杆并跟随；拖入杆吸附；悬停杆单击建激活条；激活条只改高度 | P1（P2 可选） | 已实现（浏览器验收待做） |
| **P4** | [04-fragment.md](./04-fragment.md) | fragment 行结构 | 单列表格：operator 标签行 + 可增删/排序/缩放的条件行 + 行背景文本 | P1 | 已实现（浏览器验收待做） |
| **P5** | [05-lark-import.md](./05-lark-import.md) | Lark 导入与工具链 | 飞书样例可导入；Agent 可按语义操作 | P1、P3 | 未开始 |

依赖关系：

```
P1 ──> P2
 │
 ├──> P3 ──> P5
 │
 └──> P4
```

P4 可与 P2/P3 并行；P5 最后做。

## 5. 全局不做什么

- 不把生命线拆成 group / 容器 / 子元素；
- 不做语义化 DSL 或自动布局引擎；
- 不做 Lark 回写（可作为 P6 另立）；
- 不改变 `composite` / `flow` 两个既有家族的行为；
- 不在本期引入序列图专用消息元素（P3 复用现有箭头）。

## 6. 每期的统一验收口径

- `yarn test:typecheck` 全绿；
- `yarn test:update` 无新增失败；
- 改动涉及的既有用例不回归；
- 新行为在浏览器里按各期「验收」清单手工过一遍；
- 每期一个独立 PR，PR 描述链接到本目录对应文档。
