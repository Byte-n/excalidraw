# P1：几何底座与命中几何

- **状态**：已实现（自动化验收通过；浏览器手工验收待做）
- **依赖**：无
- **后续**：P2、P3、P4、P5
- **目标**：先把生命线的几何不变量和命中区域定稳，为后续选择 UI 与消息交互提供可靠底座。

## 1. 当前问题

### 1.1 杆长写死 360

`packages/element/src/compositeShape/sequenceOutline.ts`：

- `SEQUENCE_POLE_LENGTH = 360`；
- `getSequencePolePath(width, headHeight)` 只接收两个参数；
- `drawSequenceLifeline` 调用它时完全不看 `element.height`。

后果：

- 把生命线拉高，杆不会变长，元素盒里留下空白；
- 把生命线拉矮，杆会伸出元素盒；
- 离屏位图默认只有 20px padding（`renderElement.ts` 的 `getCanvasPadding`），超出的杆会被裁掉；
- 导出 viewBox 与可见内容不一致。

### 1.2 无尺寸创建回落到 100×100

`packages/element/src/transform.ts` 对形状的尺寸回落到 `DEFAULT_DIMENSION = 100`：

```ts
const width =
  element?.label?.text && element.width === undefined
    ? 0
    : element?.width || DEFAULT_DIMENSION;
```

抽屉路径给了预设尺寸所以正常；但 `convertToExcalidrawElements([{ type: "sc-lifeline-entity" }])`、文件恢复、外部 API 等路径会造出「头部 68 + 杆 360 塞进 100 高」的元素。

### 1.3 命中区域是整条包围盒

- 生命线的 `outline` 是整个元素盒（`registry.ts` 的 `sequenceLifelineShape`）；
- `shouldTestInside` 对 `sequence` 返回 true；
- `isPointInElement` 对形状用 outline 多边形判断。

后果：64×428 的整块空白区域都能选中、拖动生命线，盖住下层元素。

### 1.4 文本反向求解可能撑大杆

`getCompositeShapeDimensionsForText` 会同时求解 `width` 和 `height`，假设「加大 `height` 就能加大文本区」。但生命线的文本区只依赖 `width` 和 `headHeight`，不依赖 `element.height`。标签变长或字号变大时，求解器可能把 `element.height` 推到异常大的值。

## 2. 方案

### 2.1 杆长改为派生值

```ts
poleLength = Math.max(MIN_POLE, element.height - headHeight);
```

- `getSequencePolePath(width, headHeight, height)` 接收 `height`；
- `drawSequenceLifeline` 传入 `element.height`；
- 删除或收窄 `SEQUENCE_POLE_LENGTH` 的运行时用途，只保留为「默认创建长度」。

建议常量：

```ts
export const SEQUENCE_DEFAULT_POLE_LENGTH = 360;
export const SEQUENCE_MIN_POLE_LENGTH = 40;
```

### 2.2 生命周期不变量

在以下边界统一归一化：

- 创建（抽屉、`newElement`、`convertToExcalidrawElements`、Agent 工具）；
- 恢复（`restore.ts`）；
- 剪贴板；
- 缩放结束后；
- 文本变化后。

不变量：

```ts
headHeight > 0;
height >= headHeight + SEQUENCE_MIN_POLE_LENGTH;
```

建议提供：

```ts
export const normalizeSequenceLifelineGeometry = <T>(element: T): T => { ... };
```

只改 `height` / `shape.lifeline.headHeight`，不动 `x`、`width`、`angle`。

### 2.3 命中几何

在 `ShapeRegistration` 增加可选字段：

```ts
/** 命中/距离/相交使用的几何；缺省时退回 outline。 */
hitPaths?: (input: ShapeInput<K>) => CompositeShapePath[];
```

生命线的 `hitPaths` 返回两个闭合矩形：

1. **头部矩形**：`[0, 0, width, headHeight]`；
2. **杆走廊**：`[width/2 - HIT_HALF, headHeight, width/2 + HIT_HALF, height]`。

建议 `HIT_HALF = 4 … 6`（总宽 8–12px），太窄难点，太宽又会挡住下层。

`fragment` / `activation` 不提供 `hitPaths`，行为不变。

需要同步修改的消费方：

| 文件 | 函数 | 改动 |
| --- | --- | --- |
| `collision.ts` | `isPointInElement` | 有 `hitPaths` 时用命中多边形 |
| `collision.ts` | `intersectCompositeShapeWithLineSegment` | 用 `hitPaths` |
| `distance.ts` | `distanceToCompositeShape` | 用 `hitPaths` |
| `bounds.ts` | `getElementLineSegments` | 用 `hitPaths`（套索/擦除/frame） |
| `bounds.ts` | `getElementRotatedBounds` | **保持 outline**（包围盒不能缩小） |
| `geometry.ts` | 新增 accessor | 例如 `getCompositeShapeHitPaths(element)` |

关键原则：**bounds / 导出 / 选择框继续用 `outline`，只有命中、距离、相交用 `hitPaths`。**

### 2.4 默认尺寸

从元素层导出一个默认尺寸函数：

```ts
export const getSequenceLifelineDefaultSize = (
  id: SequenceLifelineId,
): { width: number; height: number } => ({
  width: SEQUENCE_LIFELINE_DEFAULT_WIDTHS[id],
  height: SEQUENCE_LIFELINE_HEAD_HEIGHTS[id] + SEQUENCE_DEFAULT_POLE_LENGTH,
});
```

接入点：

- `transform.ts` 的 shape 分支：当 `sc-*` 的 width/height 缺失时使用它；
- `packages/excalidraw/components/shapePresetDefaults.ts`：高度改成 `SEQUENCE_LIFELINE_HEAD_HEIGHTS[id] + SEQUENCE_DEFAULT_POLE_LENGTH`，消除 428.272 等重复硬编码；
- 新增 `SEQUENCE_LIFELINE_DEFAULT_WIDTHS`，把 64/76/84/100/68/120/118 收敛到元素层。

### 2.5 文本策略

P1 先采用**固定适配**，避免文本反向求解把杆撑长：

- 生命线创建时默认 `textFitMode: "fixed"`；
- 标签超出头部框时按现有 `truncateTextToBounds` 规则截断；
- 不根据标签自动修改 `element.height`。

如果后续要求「标签自动撑高头部」，在 P2 或 P4 增加专用反向求解：

```ts
newHeadHeight = max(headHeight, requiredTextHeight);
newHeight = poleBottom - headY;
```

并同步文本布局。

## 3. 实现清单

- [x] `sequenceOutline.ts`
  - [x] 杆长接收 `element.height`（`getSequencePoleLength` / `getSequencePolePath`）；
  - [x] 新增 `SEQUENCE_DEFAULT_POLE_LENGTH` / `SEQUENCE_MIN_POLE_LENGTH`；
  - [x] 新增 `SEQUENCE_LIFELINE_DEFAULT_WIDTHS` / `getSequenceLifelineDefaultSize`；
  - [x] 新增 `getSequenceLifelineHitPaths` / `isSequenceLifelineElement` / `normalizeSequenceLifelineGeometry`。
- [x] `registry.ts`
  - [x] `ShapeRegistration` 增加 `hitPaths`；
  - [x] `sequenceLifelineShape` 提供 `hitPaths`；
  - [x] 生命线默认 `textFitMode`：由 `getCompositeShapeTextFitMode` 对生命线返回 `"fixed"`，无需写回元素字段。
- [x] `geometry.ts`
  - [x] `CompositeShapeGeometry` 增加 `hitPaths`；
  - [x] 新增 `getCompositeShapeGlobalHitPaths` / `getCompositeShapeGlobalHitPoints`，缺省回退 outline。
- [x] `collision.ts` / `distance.ts` / `bounds.ts`
  - [x] 命中、距离、线段相交改用命中几何；
  - [x] `getElementBounds` / `getElementAbsoluteCoords` 仍用 outline。
- [x] `transform.ts`
  - [x] shape 分支对生命线使用默认尺寸；
  - [x] 创建后调用几何归一化。
- [x] `packages/excalidraw/components/shapePresetDefaults.ts`
  - [x] 生命线尺寸从元素层常量派生。
- [x] `packages/excalidraw/data/restore.ts`
  - [x] 恢复时调用 `normalizeSequenceLifelineGeometry`。
- [x] `packages/excalidraw/clipboard.ts` / `duplicate.ts`
  - [x] 无需单独改动：粘贴走 `restoreElements`（已归一化），复制/拖拽复制保留合法几何。

## 4. 测试

新增到 `packages/element/_tests_/sequenceShape.test.ts` 与 `packages/excalidraw/_tests_/data/restore.test.ts`：

- [x] 杆长等于 `element.height - headHeight`；
- [x] 拉高后杆终点等于 `element.height`；
- [x] 拉矮到低于 `headHeight + MIN_POLE` 时被夹住；
- [x] 点头部中心命中；
- [x] 点杆中心命中；
- [x] 点头部下方、杆两侧空白不命中；
- [x] 套索/擦除线段与杆走廊相交；
- [x] 包围盒仍包含整条杆（用 `getElementBounds` 验证）；
- [x] `convertToExcalidrawElements` 省略尺寸时使用默认高度；
- [x] 恢复一个 height 小于 `headHeight + MIN_POLE` 的元素后被修正；
- [x] 标签很长时 `element.height` 不被撑大（固定适配）。

## 5. 验收

- [x] 生命线拉高/拉矮，杆始终到元素底边（单测）；
- [x] 画布命中：点杆能选中，点杆两侧空白不选中（单测）；
- [x] 选择框仍包住整条（P1 不改选择 UI）；
- [ ] 导出 SVG/PNG 不再裁掉杆（待浏览器手工验收）；
- [x] 外部 API 创建的生命线尺寸正确（`convertToExcalidrawElements` 单测）；
- [ ] 既有 70 个时序图形用例与其余快照不回归。

## 6. 不做

- 差异化选择框、头部缩放、杆底控制点 → P2；
- 消息绑定 → P3；
- fragment 行结构 → P4；
- Lark 导入 → P5。

## 7. 风险

- `getElementLineSegments` 同时服务套索、橡皮擦、frame 裁剪；改成命中几何后要跑这三类回归。
- `getElementRotatedBounds` 必须保留 outline，否则导出/选择框会缩小。
- 文本固定适配会改变现有标签行为；如果产品不接受截断，需要提前做专用求解器。

## 8. 实施记录

自动化验证：

- `packages/element` 全量测试：51 个文件、1678 个用例通过（35 skipped，1 todo）；
- `sequenceShape.test.ts`：83 个用例通过；
- `restore.test.ts`：80 个用例通过（新增生命线恢复归一化用例）；
- `packages/element` / `packages/excalidraw` typecheck 通过；
- 变更文件 ESLint（`--max-warnings=0`）通过。

已知限制：

- 根目录 `yarn test:typecheck` 在 `@excalidraw/yjs` / `yjs-hocuspocus-*` 上失败，原因是这些 workspace 的 `dist` 未构建（环境问题，与本次改动无关）。
- 浏览器手工验收（导出 PNG/SVG、真实画布点选手感）尚未执行。
- `getSequencePoleLength` 的最小值在非法元素上会让杆略超出元素盒；持久化边界已做归一化，正常渲染不会出现。
- 生命线显式设置 `textFitMode: "auto"` 时仍可能触发表格外的反向求解；默认 `undefined` 已按 `"fixed"` 处理。
