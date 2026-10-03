# P01.2：选区整体缩放（表格进入通用选区缩放通道）

- 状态：已实现（交互层、纯函数层与单元测试均已落地）；实施顺序第 5 步（退役单选 `tableGesture` 特权分支）仍为可选后续。
- 实现落点：
  - `resizeMultipleElements` 的 table 分支（子树排除、倍率钳制回流、compute 调用、更新包应用与善后、`keepAspectRatio` 四角强制等比、入口禁翻转）：`packages/element/src/resizeElements.ts`；
  - 选中归并 `normalizeTableSelection` 与释放时文字模式持久化 `persistTableTextModesAfterResize`、Esc 取消 `cancelTableResize`：`packages/excalidraw/components/app/table.ts`；接入框选提交（pointerSession.ts）、lasso 提交（lasso/index.ts）与点击选中出口（pointerSelection.ts）；
  - `maybeHandleResize` 的多选禁令已删除（单选表格仍由 `maybeArmTableScaleGesture` 专属手势接管）；
  - 单元测试：`packages/element/tests/tableSelectionResize.test.ts`。
- 前置：[P01 表格容器](phase-1.md) 的整体缩放手势、语义子树遍历与文字模式规则；`tableScale.ts` 纯函数层。
- 定位：让表格作为普通成员参与选区（多选）缩放——四角等比、四边单轴；并统一"点击单元格选中表格"与"选区工具框选表格"两条选中路径的缩放行为。
- 后续衔接：[P02 合并单元格](phase-2.md) 的结构命令不感知本通道；P03 只复用本通道已有的几何与文字模式提交规则。

## 问题陈述

现状下两种选中方式的缩放能力不一致：

| 选中方式 | 选择集形态 | 缩放行为 |
| --- | --- | --- |
| 点击单元格空白/外框命中表格（collision.ts:111-119） | `[table]` 单元素 | 走 `maybeArmTableScaleGesture` 专属手势（pointerSelection.ts:536-550）：四角等比、四边单轴 |
| 选区工具框选含表格 | `[table, ...cell 成员]` 多元素 | 渲染层显示四角/四边手柄（interactiveScene.ts:2650-2667 仅追加 `rotation: true`），但 `maybeHandleResize` 在 pointerSelection.ts:280-281 硬拦截：`(transformHandleType !== "rotation" && selectedElements.some(isTableElement))` → 直接返回，四角与四边均无响应 |

拦截的根因（pointerSelection.ts:275-279 注释）：通用多选缩放 `resizeMultipleElements`（resizeElements.ts:1219）对每个元素只 mutate `{x, y, width, height}`（resizeElements.ts:1426-1453），不感知表格的结构不变量 `width = Σ列宽`、`height = Σ行高`（tableStruct.ts:81-85），也不同步语义子树（cell 成员、嵌套表格、绑定文字、mindmap 边）与文字固定模式切换（phase-1.md:105）。放行会破坏数据一致性，因此 P1 选择整体禁用。

## 用户可见目标

选区包含表格时，拖选区四角按统一倍率等比缩放整棵表格子树，拖四边按单轴拉伸（该轴字号不动），表格与选区内其他元素同步移动、同步停止。行为与单选表格的专属手势一致：

- 点击单元格选中表格、框选表格、框选表格与其他图形，三种入口的缩放表现完全相同。
- 框选"表格 + 其内部成员"时，成员不再作为独立对象出现在选择集里——选中表格即代表子树（与 mindmap 的归并语义一致）。
- 旋转仍然不可用（跨期不变量 10）；翻转（镜像）与两轴不同倍率不在本期范围。
- 拖动预览每帧从操作开始快照重算；释放时一次性持久化文字模式并形成一条历史记录；Esc 恢复场景且无历史、无模式残留。

## 行为规格

| 输入 | 行为 |
| --- | --- |
| 选区四角（nw/ne/sw/se） | 整个选区按统一倍率 `s` 等比缩放；表格子树由 `computeTableUniformScale` 生成更新，字号随 `s` 缩放 |
| 选区四边（n/s/e/w） | 选区按该轴倍率单轴拉伸；表格子树由 `computeTableAxisScale` 生成更新，全部字号不变（行列调整同款规则） |
| Shift | 选区含表格时四角本就强制等比，Shift 语义与普通选区一致；四边仍为单轴 |
| 指针拖过锚点（翻转区） | 不翻转：倍率钳制在正的最小值，表现为"停在最小尺寸" |
| 倍率触及表格下限 | 以子树内最大下限（`minScale`/`minScaleX`/`minScaleY`，tableScale.ts:51-61、298-362）作为整个选区倍率的下限，选区与表格同时停住，保持贴齐 |
| 取消（Esc） | 恢复 `originalElements` 全场景快照；文字模式未提交，无残留 |

## 技术方案

### 1. 选中归并：`normalizeTableSelection`

框选提交与点击选中的公共出口（pointerSession.ts:1869，与 `mindmap.normalizeMindmapSelection` 并列）增加归并：选择集含 `table` 时，将其子树成员 id（递归含嵌套表格）从 `selectedElementIds` 移除——"选中表格即代表子树"。

- 归并后 `selectedElements` 形态为 `[table, ...非子树元素]`，消除"表格与成员同选"的双重变换与双重描边。
- 溢出单元格的成员不再干扰 `getCommonBounds` 与选区框。
- 点击单元格命中表格后 `selectedElementIds = {tableId}`，天然合规，无需单选特权判断。

### 2. `resizeMultipleElements` 增加 table 分支（核心）

- **排除子树成员**：构建 `targetElements` 后，识别 `orig.type === "table"` 的选中表，用 `prepareTableUniformScale`（tableScale.ts:620-636）取其 `subtree.ordered` 的 id 集合，凡属于任一选中表子树的元素不进通用循环——它们的几何由 table 的更新包负责，避免双重变换。嵌套表通过父表子树枚举一次。
- **倍率钳制回流**：先对每个选中表 `prepare`，取所有表 `minScale`（等比）或 `minScaleX/minScaleY`（单轴）的最大值，钳制选区倍率；再以同一倍率调用 compute，保证表格停住时选区同步停住。
- **生成更新**：
  - 四角/强制等比：`computeTableUniformScale(originalElements, tableId, s, { anchor: 选区锚点 }, prepared)`；
  - 四边：`computeTableAxisScale(originalElements, tableId, scaleX, scaleY, { anchor: 选区锚点 }, prepared)`；
  - 锚点必须传**选区的锚点**（对角/边中点/中心，与通用循环的 `anchorsMap` 一致），表格子树才能与选区内其他元素同步移动。
- **应用与善后**：逐元素 `scene.mutateElement` 应用更新包；对子树内可绑定元素执行 `updateBoundElements`；绑定文字按 `handleBindTextResize` 重排（tableScale.ts:38-42 声明的 caller 职责）。
- **等比强制**：`keepAspectRatio` 条件（resizeElements.ts:1380-1387）加入 `isTableElement`——表格无两轴不同倍率模式（跨期不变量 4），选区含表格时四角必等比。
- **禁用翻转**：选区含表格时 `flipByX/flipByY` 强制 `false`，`nextWidth/nextHeight` 取绝对值；compute 函数对 `scale <= 0` 直接抛错（tableScale.ts:547-554、589-591），必须在入口钳制。

快照无需额外构建：`pointerDownState.originalElements` 是全场景深拷贝（pointerSession.ts:959-964），未被选中的子树成员同样有快照，逐帧从快照重算不会漂移；Esc 恢复天然覆盖子树。

### 3. 交互层解除拦截与提交时机

- **解除拦截**：删除 pointerSelection.ts:280-281 的多选禁令（注释同步改写为"多选含表格走通用路径的 table 分支"）。rotation 禁令与 pointerSelection.ts:520-530 的旋转清空逻辑保持不变。
- **提交时机**：resize 期间 compute 一律 `persistTextModes: false`（预览不切模式）；pointer up 时若本次缩放实际改变了尺寸，对每个参与表再以 `persistTextModes: true` 应用一次文字模式持久化（text/composite/sticky/mindmap 的模式字段），与单选手势"释放时一次性持久化"对齐（pointerSelection.ts:539-541）。无实际尺寸变化不产生历史记录。

### 4. 不改动项

- 渲染层（interactiveScene.ts:2650-2667）：四角/四边手柄已显示、rotation 已禁，无需修改。
- `tableScale.ts`：现有纯函数完整复用，不新增命令。
- 单选表格的 `maybeArmTableScaleGesture` 手势（table.ts:1328-1404）第一阶段保留并行运行；其 preview/commit 与 Esc 语义验证迁移到位后再退役（见实施顺序第 5 步）。

## 边界与约束

- 表格不支持旋转与翻转；镜像意味着行列倒序与元素镜像，超出 P1 范围，交互上表现为停在最小尺寸。
- 两轴不同倍率不开放：表格只支持四角等比和四边单轴缩放；不增加四角双轴自由缩放入口。
- 选区级等比下，普通元素跟随表格倍率整体缩放，与既有 `angle/text/inGroup` 的选区级约束同规则。
- 框选"表格 + 成员"归并后，成员不再单独高亮或独立拖动；这是行为变化，需产品确认（拖入/拖出单元格仍通过拖动子图形发起，不受影响）。

## 与后续期次的边界

- P02 合并格不改变子树枚举与倍率钳制；结构命令与本通道互不感知。
- P03 沿用本通道：不改变已有等比、水平单轴和垂直单轴缩放；尺寸实际变化时按 phase-3 规则持久化内部支持文字图形的 `fixed` 模式。
- P05 协作沿用通用 resize 的提交边界：一次手势一次 capture，更新包逐元素提交，冲突重放后校验行列总和不变量。

## 实施顺序

1. `resizeMultipleElements` 的 table 分支：子树排除、倍率钳制回流、compute 调用、更新包应用与善后；`keepAspectRatio` 加表格条件、入口禁翻转。纯函数层先行，覆盖单元测试。
2. 交互层：解除 `maybeHandleResize` 拦截、含表格选区的等比参数传递、pointer up 的文字模式持久化。
3. 选中归并 `normalizeTableSelection`，接入框选提交与点击选中出口；回归拖动、删除、复制等既有选区操作。
4. 自动化与人工验收（含单选手势回归）；同步 00-overview 能力矩阵与不变量表述。
5. （可选后续）退役单选 `tableGesture`：将 preview/commit、Esc 恢复语义迁入通用路径后删除特权分支，两条路径收敛为一。

## 验收清单

- [ ] 点击单元格选中表格：四角等比、四边单轴缩放正常，行为与改造前单选手势一致；字号规则正确（等比缩放、单轴不变）。
- [ ] 框选"表格 + 内部成员"：成员不再单独选中；缩放整棵子树同步，外框与网格始终一致（`width/height = Σ列宽/Σ行高`）。
- [ ] 框选"表格 + 其他图形"：表格与其他元素同步缩放、同步停止；触及表格下限时选区整体停住并保持贴齐。
- [ ] 框选多张表格（含嵌套）：各子树恰好变换一次，无双重变换、无重复描边。
- [ ] 指针拖过锚点不翻转；Esc 恢复无历史、无文字模式残留；释放且尺寸变化时文字模式一次性切换并形成一条撤销记录。
- [ ] 旋转入口在含表格选区中不可用；无变化不产生历史；保存重开与 PNG/SVG 导出与画布一致。
