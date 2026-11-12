# P4：fragment 行结构

- **状态**：P4a 已实现（P4b 未开始）
- **依赖**：P1
- **目标**：把 `sc-fragment` 从「一个带页签的矩形」升级为可表达 alt / opt / loop 等分区的组合片段。

## 1. 实现前状态（P3 结束时）

- `sc-fragment` 只有外框 + 左上页签；
- `SequenceShapeData` 对 fragment 没有参数；
- 页签文字走现有绑定文本；
- 没有行数据、行分隔、operator、加行入口；
- 样本 PDF 里没有虚线行边界，当前实现也没有画（`sequence-mapper.md` 有说明）。

## 2. 范围拆分

P4 内部再分两个里程碑，避免一次改动过大：

### P4a：行数据 + 行分隔 + 加行

- fragment 持久化行数据；
- 画行分隔线；
- 支持新增行；
- 行高与总高度归一化；
- 页签 / operator 文本沿用现有绑定文本。

### P4b：行标签

- 每行可编辑标签；
- 需要决定是「数据驱动绘制」还是「子文本元素 + containerRef」；
- 若走子元素路线，新增 `DirectContainerRef` kind、子元素索引、移动/删除/复制清理。

建议先把 P4a 单独交付，P4b 视产品需求再启动。

## 3. 数据模型

`packages/element/src/types.ts` 的 `SequenceShapeData` 为 fragment 增加可选参数：

```ts
export type SequenceShapeData =
  | ...
  | Readonly<{
      id: "sc-fragment";
      schemaVersion: 1;
      fragment?: Readonly<{
        operator?: string;
        rows: ReadonlyArray<
          Readonly<{
            id: string;
            height: number;
            label?: string;
          }>
        >;
      }>;
    }>;
```

约定：

- `fragment` 缺省 = 当前行为（单区、无行线）；
- 至少一行；`height > 0`；
- 行高之和 = 元素高度（页签行包含页签高度）；
- `operator` 是页签名（alt / opt / loop / par / …），缺省用现有绑定文本；
- 校验在 `assertShapeData` 的 `param` 机制里扩展；`schemaVersion` 仍为 1。

> 如果担心 `fragment` 与现有 `param` 校验互斥，可把 fragment 的校验函数拆成独立 `param: { key: "fragment", validate }`。

## 4. 几何与绘制

### 4.1 行分隔

- 第 `i` 行底边 y = `sum(rows[0..i].height)`；
- 从 `(0, y)` 到 `(width, y)` 画一条细线；
- 是否虚线：按产品定义。样本没有证据，建议先跟随 `strokeStyle`，或固定细实线；
- 分隔线不进入 `hitPaths`，避免影响命中。

### 4.2 页签与 operator

- 页签几何沿用 `getSequenceFragmentTabPath`；
- operator 文本写入页签的绑定文本；
- **采用口径**：首行高度 = `max(SEQUENCE_FRAGMENT_TAB_HEIGHT, rows[0].height)`，由 `getSequenceFragmentRowLayout` 派生（测试见 `sequenceShape.test.ts` 的「keeps the tab row at least as tall as the tab」）。这样页签不会与第一条行分隔线相交，同时保留 `rows[0].height` 作为权重的语义。

### 4.3 行标签

P4a 不画行标签，只保留字段；P4b 再实现。

若 P4b 选择数据驱动绘制：

- 在 `draw` 里用 canvas 文本绘制，需要新增文本测量与主题色处理；
- 优点：不需要容器模型；
- 缺点：文本编辑、换行、字号继承都要自己实现。

若 P4b 选择子文本元素：

- 新增 `DirectContainerRef` kind（如 `fragmentRow`）；
- 同步 `validateContainerRef`、`assertAcyclicContainerRefs`、子元素索引、z-order、删除清理；
- 可以复用表格的 `autoResize: false` 背景文本模式。

建议 P4b 走子文本元素路线，和表格的既有实现保持一致。

## 5. 交互

### 5.1 加行

- **入口（已实现）**：单选 fragment 时，浮动工具栏 / 手机底条出现「添加片段行」按钮（`data-testid="fragment-add-row"`，图标 `row-insert-bottom`）。未采用悬停「+」，避免与 quick-create 手柄体系耦合。
- 新行插入到末尾，默认高度取 `SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT`（56）；
- 加行后 `element.height` 增加对应高度；
- 页签 / 既有行位置不变；
- 首次加行时，没有 `fragment` 参数的元素会把原盒高作为第一行，因此第一次加行等价于把整盒切成两行。

### 5.2 缩放

- **已实现**：`getSequenceFragmentResize`
  - 底边（`s` / `se` / `sw`）：只改最后一行；最后一行触底 `SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT`（24）后，元素底边停止跟随；
  - 顶边（`n` / `ne` / `nw`）：所有行按比例缩放；左右边（`e` / `w`）只改宽度，行高不变；
  - 多选缩放：`resizeMultipleElements` 之后统一调用 `normalizeSequenceFragmentGeometry`，按新高度等比归一；
- 行高总和与 `element.height` 始终一致：持久化边界（restore / `convertToExcalidrawElements`）与每次缩放后都会归一化。

### 5.3 移动 / 复制 / 删除

- 行数据随 shape 持久化，复制/粘贴/恢复自动带上；
- 删除 fragment 时，如果 P4b 使用子文本元素，按容器规则清理子元素。

## 6. 实现清单

- [x] `types.ts`
  - [x] `SequenceShapeData` 的 fragment 参数（`SequenceFragmentData` / `SequenceFragmentRow`）。
- [x] `registry.ts`
  - [x] fragment `param` 校验（至少一行、唯一 id、`height > 0`、可选 `operator` / `label`）；
  - [x] `getSequenceFragmentRowPaths`；
  - [x] `details` 增加行分隔（`getSequenceFragmentRowPaths`），不进入 `hitPaths`；
  - [x] 行高归一化辅助函数（`normalizeSequenceFragmentRows` / `normalizeSequenceFragmentGeometry`）。
- [x] `sequenceOutline.ts`
  - [x] `getSequenceFragmentRowLayout`；
  - [x] 行分隔路径；
  - [x] 最小行高常量 `SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT`、默认行高 `SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT`。
- [x] `transform.ts` / `restore.ts`
  - [x] fragment 参数校验（`assertShapeData`）与归一化。
- [x] `excalidraw` 交互层
  - [x] 加行入口（浮动工具栏 / 手机底条按钮）；
  - [x] fragment 底边缩放分支；
  - [ ] P4b 的 containerRef（未开始）。
- [x] 文档
  - [x] 更新 `sequence-mapper.md` 的 fragment 行说明。

## 7. 测试

- [x] fragment 缺省参数 = 当前几何；
- [x] 两行 / N 行分隔线位置正确；
- [x] 行高之和等于元素高度；
- [x] 加行后高度正确、页签不遮挡；
- [x] 底边缩放不产生小于 `MIN_ROW_HEIGHT` 的行；
- [x] 复制 / 粘贴 / 恢复保留行数据；
- [ ] P4b：行标签文本编辑、换行、字号、主题色正确（未开始）。

单元测试位于 `packages/element/_tests_/sequenceShape.test.ts` 的 `sequence fragment rows` 分组。

## 8. 验收

- [x] 能表达 alt / opt / loop 至少三种 operator（页签绑定文本，`fragment.operator` 已持久化）；
- [x] 行分隔清晰，不越界（分隔线只出现在 `0 < y < height`）；
- [x] 加行后 fragment 仍可整体移动、缩放、导出（行数据随 shape 派生，不改变包围盒语义）；
- [x] 行数据在保存/恢复/复制后不丢；
- [x] 不影响生命线与消息的命中/层级（分隔线只进 `details`，不进 `hitPaths`）。

浏览器手工验收（多行 fragment 的加行、底边缩放、复制粘贴）仍需按上表走一遍。

## 9. 不做

- 拖拽调整单行高度；
- 嵌套 fragment；
- 行内自由布局 / 裁剪内容；
- 行标签与消息的自动避让；
- Lark 回写。

## 10. 风险

- 行标签若走子元素路线，会引入新的 containerRef 类型，影响范围接近表格；P4a 先不做标签可以显著降低风险。
- 行高与 `element.height` 必须保持单一来源，否则缩放后会出现空白/溢出。
- fragment 的命中仍是整盒；如果后续要求「点内部穿透」，再单独引入 `hitPaths`，不要在 P4 顺手改。
