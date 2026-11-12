# P4：fragment 行结构

- **状态**：已实现（P4a 行数据 + P4b 表格化行交互）
- **依赖**：P1
- **目标**：把 `sc-fragment` 做成「单列表格」——首行是 operator 标签，下面是可以增删、拖拽排序和缩放的条件行；交互与 UI 沿用表格的行轴，但没有列、没有背景色，也不提供 quick-create。

## 1. 产品口径

fragment 不是「一个带页签的矩形」，而是**单列的行容器**：

| 特征 | 表格 | fragment |
| --- | --- | --- |
| 列 | 多列 | 单列 |
| 背景色 | 有填充 | **无背景色**（外框与页签都只描边） |
| 首行 | 普通表头 | **operator 标签行**：左上页签显示 `Opt / Loop`，可修改；宽度优先增长，到上限后换行，首行高度随行数增长 |
| 行操作 | 行轨、插入点、分隔线缩放、拖拽排序、Select 选中、Delete 删除 | **相同**（仅行轴） |
| 方向手柄 / quick-create | 表格自身不适用 | **不提供**（避免与行轨、插入点抢空间） |

样本页签几何保持不变：`92 × 36.272`、右下 `12 × 12` 斜切；页签填充跟随元素背景色，默认 `transparent` 时只有描边。

### 1.1 图形抽屉的两个预设

`sc-fragment` 在抽屉里有两个条目，**持久化的 `shape.id` 相同**，只在创建时铺的初始行与默认行文本不同：

- **组合片段**：operator 行 + 1 个条件行，默认文本 `[Condition]`；
- **组合片段（含 Else）**：operator 行 + 条件行 + Else 行，两行之间是虚线分隔，默认文本 `[Condition]` / `[Else]`。

默认行文本是普通画布文字元素（不绑定容器、不写入 `fragment.rows`），与用户在行里输入的文字同类，可以单独编辑、移动或删除；放置位置为行左上角内缩 8px、距行顶 6px。

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

- `rows[0]` 永远是 operator 标签行（页签行），高度不小于 `SEQUENCE_FRAGMENT_TAB_HEIGHT`；
- `rows[1..]` 是条件行；
- 行高之和恒等于 `element.height`；
- 没有行数据的 fragment 在 restore / 插入场景时自动初始化为「页签行 + 一个条件行」（`createSequenceFragmentInitialRows`）；
- `textFitMode` 固定为 `fixed`：编辑页签文字不会改变 fragment 尺寸。

## 3. 几何与绘制

- 页签：`getSequenceFragmentTabPath`，几何不变；
- 行分隔：`getSequenceFragmentRowPaths`，从 `(0, y)` 到 `(width, y)`，只进 `details`、不进 `hitPaths`；页签行与第一个条件行之间的分隔线透明（由页签轮廓闭合该行），其余行分隔线为虚线（`SEQUENCE_FRAGMENT_ROW_DIVIDER_DASH = [4, 4]`）；
- 页签文字：`getSequenceFragmentTextBounds` 按页签的实际宽高减去内边距与斜切返回文本带（水平 8、垂直 9.386）。固定 fit 保证编辑不会自行改尺寸，尺寸由 `fitSequenceFragmentOperator` 统一计算；
- 页签文字固定使用容器绑定文本的 auto-width 模式（`autoResize: true`）：宽度由页签决定，文本元素右侧不出现「切换自动宽度」的重置手柄；换行与输入始终只有一种行为；
- 页签宽度：`operatorWidth` 持久化在 fragment 数据里。文字先按单行测宽，页签宽度 = 文字宽 + 内边距 + 斜切，最小 92、最大 `元素宽度 - 24`；到达最大宽度后才换行，首行高度 = 行数 × 行高 + 上下内边距（不小于 36.272），元素高度随首行增量同步；
- 行布局：`getSequenceFragmentRowLayout` 把持久化行高归一化到元素高度，并保证首行不低于页签高度；
- 背景色默认 `transparent`（`SHAPE_PRESET_DEFAULTS["sc-fragment"]`），`drawShadedFaces` 因此不填页签；用户显式设置填充色时页签仍可着色。

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
- 页签行是结构行，删除命令对它会落空（不会删除整个 fragment）。

### 4.5 与元素选择/缩放的关系

- 行轨、插入点、分隔线属于统一的容器交互通道（`interactionTarget` 的 fragment provider），优先级与表格一致：插入点 > 行轨 > 分隔线 > 元素本体；
- 选中 fragment 时变换手柄仍优先于行控件；
- 行选择不选中 fragment 元素，因此 Delete 先到达行命令；
- fragment **不再出现 quick-create 方向手柄**（`isQuickCreateTargetElement` 明确排除）。

## 5. 移动 / 复制 / 删除

- 行数据随 shape 持久化，复制/粘贴/恢复自动带上；
- 标签文本是普通绑定文本（`containerId`），随 fragment 移动、缩放和删除；
- 条件行的内容由画布上的普通元素（文本、消息箭头等）承载，不写入行数据；行重排不会移动画布内容。

## 6. 实现清单

- [x] `types.ts`
  - [x] `SequenceFragmentData` / `SequenceFragmentRow`。
- [x] `sequenceOutline.ts`
  - [x] 行初始化、插入、删除、排序、分隔线缩放；
  - [x] 行边界 / 插入边界 / 最小行高辅助函数；
  - [x] operator 页签自适应：先扩宽、到上限后换行并长高首行（`fitSequenceFragmentOperator`）；
  - [x] 底边缩放收紧到首行/条件行各自的最小高度。
- [x] `transform.ts`
  - [x] restore / `convertToExcalidrawElements` 自动补行、固定文本 fit。
- [x] `excalidraw` 交互层
  - [x] `app/fragment.ts` 控制器（hover / 插入 / 排序 / 缩放 / 删除 / Esc 回滚）；
  - [x] `interactionTarget` fragment provider；
  - [x] 渲染层行轨、插入点、tooltip、hover/selection 高亮；
  - [x] 创建 fragment 时自动补 `Opt / Loop` 页签文字；
  - [x] 抽屉提供两个组合片段预设（同一 `sc-fragment`）：条件行 / 条件 + Else 行，并生成默认行文本；
  - [x] quick-create 排除 fragment；
  - [x] 编辑 operator 时自动重排页签宽度/首行高度，并同步元素高度；换行输入折叠为空格；
- [x] 文档
  - [x] 更新本文件与 README 状态。

## 7. 测试

- [x] 行初始化：`normalizeSequenceFragmentGeometry` 生成页签行 + 条件行，和恒等于元素高度；
- [x] 行插入 / 缩放 / 排序 / 删除的纯数据行为；
- [x] 首行不低于页签高度、条件行不低于最小行高；
- [x] 短 operator 只扩宽不换行；长 operator 先到最大宽度再换行，并撑高首行与元素；
- [x] fragment 不产生 quick-create 手柄；
- [x] 浏览器级：左侧行轨命中、插入点单击加行、行轨选择 + Delete 删除（`fragmentStructure.test.tsx`）。

单元测试位于 `packages/element/_tests_/sequenceShape.test.ts` 的 `sequence fragment rows` 分组。

## 8. 验收

- [x] 新建 fragment 默认显示 `Opt / Loop` 页签，双击可改；输入变长时优先扩宽页签，到上限后换行并长高首行；
- [x] fragment 无背景色，外框/页签只描边；
- [x] 悬停显示行轨与插入点，单击插入点新增条件行；
- [x] 拖动分隔线调整行高，拖动行轨排序；
- [x] 行选择 + Delete 删除条件行；
- [x] 行数据在保存/恢复/复制后不丢；
- [x] 不影响生命线与消息的命中/层级（分隔线只进 `details`，不进 `hitPaths`）。

浏览器手工验收（多行 fragment 的加行、拖拽排序、复制粘贴）仍需按上表走一遍。

## 9. 不做

- 多列 / 单元格合并；
- 行内自动布局或把消息箭头绑定到行；
- 行标签与消息的自动避让；
- Lark 回写。

## 10. 风险

- 行高与 `element.height` 必须保持单一来源，否则缩放后出现空白/溢出；
- 条件行内容不随行重排移动是当前口径；若产品要求「行内内容随行」，需要引入行成员索引（接近表格的 cell 子树）；
- fragment 的命中仍是整盒；如果后续要求「点内部穿透」，再单独引入 `hitPaths`。
