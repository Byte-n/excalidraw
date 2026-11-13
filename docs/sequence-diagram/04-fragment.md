# P4：fragment 行结构

- **状态**：已实现（P4a 行数据 + P4b 表格化行交互 + 行背景文本）
- **依赖**：P1
- **目标**：把 `sc-fragment` 做成「单列表格」——首行是 operator 标签，下面是可以增删、拖拽排序和缩放的条件行；条件行是单元格，拥有与表格一致的背景文本（双击创建/编辑、自动换行、撑高行）。交互与 UI 沿用表格的行轴，但没有列、外框不填背景（只有 operator 页签有底色），也不提供 quick-create。

## 1. 产品口径

fragment 不是「一个带页签的矩形」，而是**单列的行容器**：

| 特征 | 表格 | fragment |
| --- | --- | --- |
| 列 | 多列 | 单列 |
| 背景色 | 有填充 | **外框无填充**；operator 页签有底色（默认 `gray[0]` `#f4f4f4`，对应 PDF 的 `#f5f5f5`） |
| 首行 | 普通表头 | **operator 标签行**：左上页签显示 `Opt / Loop`，可修改；宽度优先增长，到上限后换行，首行高度随行数增长；**没有背景文本** |
| 条件行 | 单元格背景文本 | **相同**：每行最多一条背景文本，双击创建/编辑，换行撑高该行；首行不参与 |
| 行操作 | 行轨、插入点、分隔线缩放、拖拽排序、Select 选中、Delete 删除 | **相同**（仅行轴） |
| 方向手柄 / quick-create | 表格自身不适用 | **不提供**（避免与行轨、插入点抢空间） |

样本页签几何保持不变：`92 × 36.272`、右下 `12 × 12` 斜切；页签填充跟随元素背景色，默认 `gray[0]`（对应 PDF 页签实测 `#f5f5f5`），外框始终只描边。

### 1.1 图形抽屉的两个预设

`sc-fragment` 在抽屉里有两个条目，**持久化的 `shape.id` 相同**，只在创建时铺的初始行与默认行文本不同：

- **组合片段**：operator 行 + 1 个条件行，默认背景文本 `[Condition]`；
- **组合片段（含 Else）**：operator 行 + 条件行 + Else 行，两行之间是虚线分隔，默认背景文本 `[Condition]` / `[Else]`。

条件行默认文本是绑定到行的背景文本（`containerRef: fragmentRow`），与表格单元格背景文本同类：随行移动/排序/删除，换行会撑高行；双击即可编辑。字体、内边距与表格同源（13px、左右 12、上下 10），对齐固定为**左上角**（left/top）。

## 2. 数据模型

`packages/element/src/types.ts` 的 `SequenceShapeData`：

```ts
export type SequenceShapeData =
  | ...
  | Readonly<{
      id: "sc-fragment";
      schemaVersion: 1;
      fragment?: SequenceFragmentData;
    }>;

export type SequenceFragmentRow = Readonly<{
  id: string;
  height: number;
  /** 预留；行内容由画布上的普通元素承载，不写入行数据 */
  label?: string;
}>;

export type SequenceFragmentData = Readonly<{
  /** 预留的页签名；页签文字仍走绑定文本 */
  operator?: string;
  /** 渲染的页签宽度；文字优先撑宽页签，到上限后才换行 */
  operatorWidth?: number;
  rows: ReadonlyArray<SequenceFragmentRow>;
}>;
```

约定：

- `rows[0]` 永远是 operator 标签行（页签行），高度不小于 `SEQUENCE_FRAGMENT_TAB_HEIGHT`，**不允许背景文本**；
- `rows[1..]` 是条件行，每个条件行最多一条背景文本；
- 行高之和恒等于 `element.height`；
- 没有行数据的 fragment 在 restore / 插入场景时自动初始化为「页签行 + 一个条件行」（`createSequenceFragmentInitialRows`）；
- `textFitMode` 固定为 `fixed`：编辑页签文字不会改变 fragment 尺寸。

行背景文本的容器引用（`packages/element/src/types.ts`）：

```ts
export type FragmentRowContainerRef = Readonly<{
  kind: "fragmentRow";
  elementId: string; // fragment id
  rowId: string;     // body row id（禁止 rows[0]）
  role: "backgroundText";
}>;
```

背景文本仍是普通 text 元素（`containerId: null`、`autoResize: false`），只通过 `containerRef` 绑定到行；与表格单元格背景文本一样属于 chrome：不参与命中/框选/拖拽，只能通过双击行或行选中的 Enter 进入编辑。场景校验要求父元素是 `sc-fragment`、`rowId` 存在且不是首行、每个 body 行最多一条。

## 3. 几何与绘制

- 页签：`getSequenceFragmentTabPath`，几何不变；
- 行分隔：`getSequenceFragmentRowPaths`，从 `(0, y)` 到 `(width, y)`，只进 `details`、不进 `hitPaths`；页签行与第一个条件行之间的分隔线透明（由页签轮廓闭合该行），其余行分隔线为虚线（`SEQUENCE_FRAGMENT_ROW_DIVIDER_DASH = [4, 4]`）；
- 页签文字：`getSequenceFragmentTextBounds` 按页签的实际宽高减去内边距与斜切返回文本带（水平 8、垂直 9.386）。固定 fit 保证编辑不会自行改尺寸，尺寸由 `fitSequenceFragmentOperator` 统一计算；
- 页签文字固定使用容器绑定文本的 auto-width 模式（`autoResize: true`）：宽度由页签决定，文本元素右侧不出现「切换自动宽度」的重置手柄；换行与输入始终只有一种行为；
- 页签宽度：`operatorWidth` 持久化在 fragment 数据里。文字先按单行测宽，页签宽度 = 文字宽 + 内边距 + 斜切，最小 92、最大 `元素宽度 - 24`；到达最大宽度后才换行，首行高度 = 行数 × 行高 + 上下内边距（不小于 36.272），元素高度随首行增量同步；
- 行布局：`getSequenceFragmentRowLayout` 把持久化行高归一化到元素高度，并保证首行不低于页签高度；
- 行 bounds：`getSequenceFragmentRowBounds` 返回单列单元格（`x=0`、行 `y`、元素宽度、行高）；
- 行背景文本布局：`getSequenceFragmentRowBackgroundTextLayout` 复用表格的 `TABLE_CELL_TEXT_PADDING_X/Y`（12/10）、`wrapText` 与 `measureText`；对齐固定为左上角（left/top，忽略文本元素上的对齐字段）；fragment 可旋转，文本中心绕 fragment 中心旋转并携带 `fragment.angle`；
- 行背景文本重排：`refitSequenceFragmentRowBackgroundTexts` 在换行需要更高行时只增高不放矮（与表格一致），同步 `element.height`，随后按当前行 bounds 重排全部行文本；旋转态增高会补偿 x/y，保持视觉左上角不动。行插入/排序/分隔线缩放/Esc 回滚/删除/宽度变化/多选缩放/旋转后都会调用；
- 背景色默认 `gray[0]`（`SHAPE_PRESET_DEFAULTS["sc-fragment"]`），`drawShadedFaces` 只把它涂在页签 fillFace 上，外框不填色；用户改填充色时只影响页签。

## 4. 交互

### 4.1 左侧行轨（选择 / 排序）

- 悬停 fragment 时，每行左侧出现 6px 圆角轨（表格同款 idle/hover/selected 三态）；
- 单击行轨选中该行（`fragmentRowSelection`，独立于元素选择），行带显示 12% 强调色 + 描边；
- 拖动行轨可以调整行序；页签行固定在首位，不参与排序；
- 拖动过程中显示强调色落点线，松开时提交；Esc 恢复按下时的行数据。

### 4.2 插入点（新增条件行）

- 每个行边界（页签行下沿、各条件行下沿）左侧有 2px 插入点；
- 悬停插入点：整行边界高亮 + 显示 16px 圆形「+」和 `插入条件` tooltip；
- 单击插入：在该边界插入一行高度 `SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT`（56）的条件行，元素高度同步增长；
- 页签行上方没有插入点——首行永远是 operator 行。

### 4.3 分隔线缩放

- 悬停行分隔线显示强调色线，光标为纵向缩放；
- 拖动只改**分隔线上方那一行**的高度，元素高度随 delta 变化，下方各行保持自身高度并整体下移/上移；
- 页签行最小高度为页签高度；条件行最小高度 `SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT`（24）；
- 底边（`s` / `se` / `sw`）缩放仍由 `getSequenceFragmentResize` 处理：只改最后一行并同样受最小高度约束。

### 4.4 删除

- 选中行后按 Delete/Backspace：删除该条件行，元素高度减去该行高度；
- 该行的背景文本在同一操作里一并删除（否则 rowId 悬空会触发场景校验失败）；
- 页签行是结构行，删除命令对它会落空（不会删除整个 fragment）。

### 4.5 背景文本（与表格单元格一致）

- **双击条件行**（含其已有的背景文本区域）：无文本则创建一条绑定到该行的背景文本并直接进入编辑，有文本则先按当前行重排再编辑；
- **首行不参与**：双击 operator 页签仍走原有标签编辑（`containerId` 绑定文本）；
- 输入过程中按 `wrapText` 实时重排，换行超过行高时立即撑高该行与 fragment 总高，下方行及其背景文本随之下移；行只会增高，不会因文本变短而回缩（表格口径）；
- 文本样式与表格同源：13px、padding 12/10，但**对齐固定为左上角**（left/top，不提供其他对齐）；背景文本不进入 scene 的命中/框选/拖拽（编辑器打开时除外）；
- hover 条件行时以表格同款浅蓝填充整行；编辑时该行显示 2px 强调色内描边 + 行轨选中态，其余行控件暂时隐藏；
- 选中 fragment 后点击 body 行可在 pointer up 选中该行（不选中元素本体，Delete 直达行命令）；行选中时 Enter 编辑背景文本、Escape 退回元素选择、ArrowUp/ArrowDown 在条件行间移动；
- 背景文本跟随行结构操作：插入/删除行、拖拽排序、分隔线缩放、宽度变化换行、多选缩放/旋转都会重排；复制/粘贴/克隆会带上行文本并重映射到新 fragment。

### 4.6 与元素选择/缩放的关系

- 行轨、插入点、分隔线属于统一的容器交互通道（`interactionTarget` 的 fragment provider），优先级与表格一致：插入点 > 行轨 > 分隔线 > 元素本体；
- 选中 fragment 时变换手柄仍优先于行控件；
- 行选择不选中 fragment 元素，因此 Delete 先到达行命令；
- fragment **不再出现 quick-create 方向手柄**（`isQuickCreateTargetElement` 明确排除）。

## 5. 移动 / 复制 / 删除

- 行数据随 shape 持久化，复制/粘贴/恢复自动带上；
- 标签文本是普通绑定文本（`containerId`），随 fragment 移动、缩放和删除；
- 条件行的背景文本通过 `fragmentRow` ref 绑定到行：随 fragment / 所在 frame / 表格单元格一起移动、复制、删除；复制时 ref 指向复制后的 fragment，rowId 不变；
- 条件行里的其他普通画布元素（消息箭头等）仍不写入行、不随行重排。

## 6. 实现清单

- [x] `types.ts`
  - [x] `SequenceFragmentData` / `SequenceFragmentRow`；
  - [x] `FragmentRowContainerRef`（`fragmentRow` / `backgroundText`）。
- [x] `sequenceOutline.ts`
  - [x] 行初始化、插入、删除、排序、分隔线缩放；
  - [x] 行边界 / 插入边界 / 最小行高 / 行 bounds 辅助函数；
  - [x] operator 页签自适应：先扩宽、到上限后换行并长高首行（`fitSequenceFragmentOperator`）；
  - [x] 底边缩放收紧到首行/条件行各自的最小高度。
- [x] `sequenceFragmentScene.ts`
  - [x] 行背景文本布局（表格 padding / 换行 / 对齐 / 旋转）；
  - [x] 行背景文本重排与撑高（`refitSequenceFragmentRowBackgroundTexts`）。
- [x] `transform.ts` / `restore.ts`
  - [x] restore / `convertToExcalidrawElements` 自动补行、固定文本 fit；
  - [x] 行引用缺失/指向首行时解除 ref。
- [x] `excalidraw` 交互层
  - [x] `app/fragment.ts` 控制器（hover / 插入 / 排序 / 缩放 / 删除 / Esc 回滚 / 双击编辑背景文本 / Enter 编辑 / 行选中移动）；
  - [x] `fragmentRowText.ts` 背景文本装配；
  - [x] `interactionTarget` fragment provider（body 携带 rowId）；
  - [x] 渲染层行轨、插入点、tooltip、hover/selection 高亮、行编辑指示；
  - [x] 创建 fragment 时自动补 `Opt / Loop` 页签文字；
  - [x] 抽屉提供两个组合片段预设（同一 `sc-fragment`）：条件行 / 条件 + Else 行，并生成默认背景文本；
  - [x] quick-create 排除 fragment；
  - [x] 编辑 operator 时自动重排页签宽度/首行高度，并同步元素高度；换行输入折叠为空格；
- [x] 生命周期
  - [x] 拖动/复制/删除/克隆把 fragment 视为容器，行文本随子树移动、复制、级联删除；
  - [x] 表格单元格内嵌 fragment 的行文本随表格行列操作平移；
  - [x] yjs 投影校验与唯一性；
- [x] 文档
  - [x] 更新本文件与 README 状态。

## 7. 测试

- [x] 行初始化：`normalizeSequenceFragmentGeometry` 生成页签行 + 条件行，和恒等于元素高度；
- [x] 行插入 / 缩放 / 排序 / 删除的纯数据行为；
- [x] 首行不低于页签高度、条件行不低于最小行高；
- [x] 短 operator 只扩宽不换行；长 operator 先到最大宽度再换行，并撑高首行与元素；
- [x] fragment 不产生 quick-create 手柄；
- [x] 行背景文本：行 bounds、表格 padding/对齐、换行撑高行并把下方行文本下移、`grow:false` 只重排、旋转跟随；
- [x] 行背景文本校验：合法 ref、首行/缺失行/非 text/重复文本被拒绝；
- [x] 浏览器级：左侧行轨命中、插入点单击加行、行轨选择 + Delete 删除（`fragmentStructure.test.tsx`）；
- [x] 浏览器级：双击 body 行创建背景文本并实时撑高、双击首行仍编辑 operator、点击 body 行选中 + Enter 编辑、删行级联删文本；
- [x] 预设：两个 fragment 预设的条件行文本带 `fragmentRow` ref 且 rowId 正确；
- [x] yjs：合法行文本保留，非法/重复行引用被解除。

单元测试位于 `packages/element/_tests_/sequenceShape.test.ts` 的 `sequence fragment rows` / `sequence fragment row background texts` 分组与 `packages/element/_tests_/typeChecks.test.ts`。

## 8. 验收

- [x] 新建 fragment 默认显示 `Opt / Loop` 页签，双击可改；输入变长时优先扩宽页签，到上限后换行并长高首行；
- [x] fragment 外框无填充、只描边；operator 页签默认浅灰底（与 PDF 一致）；
- [x] 悬停显示行轨与插入点，单击插入点新增条件行；
- [x] 拖动分隔线调整行高，拖动行轨排序；
- [x] 行选择 + Delete 删除条件行；
- [x] 双击条件行输入背景文本，换行实时撑高该行与 fragment；下方行文本随之下移；
- [x] 双击首行仍只编辑 operator 标签，不会创建背景文本；
- [x] 选中 fragment 后点击 body 行选中该行，Enter 编辑、Escape 退回、方向键切换行；
- [x] 行数据与背景文本在保存/恢复/复制后不丢；
- [x] 不影响生命线与消息的命中/层级（分隔线只进 `details`，不进 `hitPaths`）。

浏览器手工验收（多行 fragment 的加行、拖拽排序、复制粘贴）仍需按上表走一遍。

## 9. 不做

- 多列 / 单元格合并；
- 条件行内普通画布元素（消息箭头等）随行重排或绑定到行；
- 行标签与消息的自动避让；
- Lark 回写。

## 10. 风险

- 行高与 `element.height` 必须保持单一来源，否则缩放后出现空白/溢出；
- 背景文本只能在行内重排；条件行里的其他普通元素仍不随行移动，若产品要求「行内内容随行」，需要把这些元素也纳入行成员索引；
- fragment 的命中仍是整盒；如果后续要求「点内部穿透」，再单独引入 `hitPaths`。
