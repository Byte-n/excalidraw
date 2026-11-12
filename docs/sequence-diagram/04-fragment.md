# P4：fragment 行结构

- **状态**：未开始
- **依赖**：P1
- **目标**：把 `sc-fragment` 从「一个带页签的矩形」升级为可表达 alt / opt / loop 等分区的组合片段。

## 1. 当前状态

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
- 页签高度与首行高度取 `max(FRAGMENT_TAB_HEIGHT, rows[0].height)` 或固定页签高度，二选一并写入测试。

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

- 入口二选一：悬停 fragment 底边出「+」，或选中后在属性面板/工具栏提供「添加行」；
- 新行插入到末尾，默认高度取 `DEFAULT_ROW_HEIGHT`；
- 加行后 `element.height` 增加对应高度；
- 页签 / 既有行位置不变。

### 5.2 缩放

- 拖 fragment 底边：只改最后一行高度或按比例分配，需明确；
- 建议：底边缩放优先改最后一行，且不小于 `MIN_ROW_HEIGHT`；
- 顶边 / 左右边沿用普通矩形缩放；
- 行高总和与 `element.height` 始终一致。

### 5.3 移动 / 复制 / 删除

- 行数据随 shape 持久化，复制/粘贴/恢复自动带上；
- 删除 fragment 时，如果 P4b 使用子文本元素，按容器规则清理子元素。

## 6. 实现清单

- [ ] `types.ts`
  - [ ] `SequenceShapeData` 的 fragment 参数。
- [ ] `registry.ts`
  - [ ] fragment `param` 校验；
  - [ ] `getSequenceFragmentRowPaths`；
  - [ ] `details` / `draw` 增加行分隔；
  - [ ] 行高归一化辅助函数。
- [ ] `sequenceOutline.ts`
  - [ ] `getSequenceFragmentRowLayout`；
  - [ ] 行分隔路径；
  - [ ] 最小行高常量。
- [ ] `transform.ts` / `restore.ts`
  - [ ] fragment 参数校验与归一化。
- [ ] `excalidraw` 交互层
  - [ ] 加行入口；
  - [ ] fragment 底边缩放分支；
  - [ ] P4b 的 containerRef（如采用）。
- [ ] 文档
  - [ ] 更新 `sequence-mapper.md` 的 fragment 行说明。

## 7. 测试

- [ ] fragment 缺省参数 = 当前几何；
- [ ] 两行 / N 行分隔线位置正确；
- [ ] 行高之和等于元素高度；
- [ ] 加行后高度正确、页签不遮挡；
- [ ] 底边缩放不产生小于 `MIN_ROW_HEIGHT` 的行；
- [ ] 复制 / 粘贴 / 恢复保留行数据；
- [ ] P4b：行标签文本编辑、换行、字号、主题色正确。

## 8. 验收

- [ ] 能表达 alt / opt / loop 至少三种 operator；
- [ ] 行分隔清晰，不越界；
- [ ] 加行后 fragment 仍可整体移动、缩放、导出；
- [ ] 行数据在保存/恢复/复制后不丢；
- [ ] 不影响生命线与消息的命中/层级。

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
