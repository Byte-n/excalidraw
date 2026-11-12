# P2：差异化选择框与缩放交互

- **状态**：已实现（自动化验收通过；浏览器手势验收待做）
- **依赖**：P1
- **目标**：交付带杆生命线专属的选择、缩放与杆底控制点交互。
- **适用对象**：8 个 `sc-lifeline-*`；`sc-activation` / `sc-fragment` 保持标准矩形交互。

## 1. 交互定稿

```
        ┌──────────────────────┐   ← 选择框：width × headHeight
        │        ○ 图标         │      包含图标与文本区域
        │                      │
        │    [ 文本区域 ]       │
        └──────────────────────┘   ← s 手柄：改 headHeight
                   ┊
                   ┊               ← 杆：点击选中整体；拖动整体移动
                   ●               ← 杆底控制点：拖动只改杆长
```

| 操作                   | 结果                                  |
| ---------------------- | ------------------------------------- |
| 点头部任意位置         | 选中整个生命线                        |
| 点杆任意位置           | 选中整个生命线                        |
| 点头部下方、杆两侧空白 | 不命中，穿透到下层                    |
| 拖动头部 / 杆主体      | 移动整个元素                          |
| 拖动头部框手柄         | 缩放头部；横向变化时杆自动重新居中    |
| 拖动杆底控制点         | 只改变杆长，头部不动                  |
| 双击头部               | 编辑标签文本                          |
| 双击杆                 | 仅选中，不进入文本编辑                |
| 多选 / 组选中          | 回退到标准联合选择框，不启用差异化 UI |
| 单选旋转               | 不提供旋转手柄                        |

## 2. 选择框

### 2.1 几何

```ts
selectionFrame = {
  x: element.x,
  y: element.y,
  width: element.width,
  height: shape.lifeline.headHeight,
};
```

- 包含图标、文本区域以及两者之间的留白；
- 框底 = 杆起点；
- 旋转中心仍用整元素中心：`cx = x + width / 2`，`cy = y + height / 2`。

### 2.2 单一来源

在 `ShapeRegistration` 增加可选字段：

```ts
selectionFrame?: (input: ShapeInput<K>) => {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

缺省时退回整元素盒。以下五个消费者必须共用它：

| 文件 | 函数 | 用途 |
| --- | --- | --- |
| `renderer/interactiveScene.ts` | `renderSelectionBorder` 调用点 | 已提交选中态的画框 |
| `renderer/interactiveScene.ts` | `renderElementsBoxHighlight` | hover、按下未松开、frame 高亮的框 |
| `element/src/transformHandles.ts` | `getTransformHandles` | 手柄挂在头部框 |
| `element/src/resizeTest.ts` | `resizeTest` 的贴边热区 | 只让头部框周边触发缩放 |
| `element/src/transformStatus.ts` | `getTransformStatusReadout` | 读数显示头部尺寸 |

**不要**把 `canHaveSelectionFrame` 改成 `false`。它同时控制「有没有框」和「能不能抓手柄」，改为 false 会让 `pointerSelection` 跳过手柄检查，失去缩放能力。

## 3. 缩放语义

设：

```
headBottom = y + headHeight
poleBottom = y + height
poleLength = height - headHeight
```

| 手柄 | width | headHeight | x | y | height | 杆 |
| --- | --- | --- | --- | --- | --- | --- |
| `e` / `w` | 变 | 不变 | w 时变 | 不变 | 不变 | 自动居中 |
| `n` | 不变 | 变 | 不变 | 变 | 同幅变 | 长度不变（头底、杆底都不动） |
| `s` | 不变 | 变 | 不变 | 不变 | 不变 | 头底移动，杆底不动，长度变 |
| 角点 | 变 | 视 n/s | 视角点 | 视 n/s | 视 n/s | 同 n/s |
| 杆底控制点 | 不变 | 不变 | 不变 | 不变 | 直接改 | `height - headHeight` |

公式：

- **横向**：`newWidth` 变化，`height / headHeight / y` 不变；杆 x 始终 `x + width / 2`，因此自动对齐。
- **`n`**：固定 `headBottom` 与 `poleBottom`：
  ```ts
  y = headBottom - newHeadHeight;
  height = poleBottom - y; // 杆长不变
  ```
- **`s`**：固定 `y` 与 `poleBottom`：
  ```ts
  headHeight = pointerY - y; // height 不变
  ```
- **杆底控制点**：
  ```ts
  height = clamp(pointerY - y, headHeight + MIN_POLE, MAX_HEIGHT);
  ```

约束：

- `width >= MIN_HEAD_WIDTH`（建议 24，或文本最小宽度）；
- `headHeight >= MIN_HEAD_HEIGHT`（建议 24，且不小于文本安全区高度）；
- `poleLength >= MIN_POLE`（建议 40）；
- 不允许负宽高、不允许翻转；
- 文本区域随 `width / headHeight` 变化重新布局。

### 3.1 接入点

标准 `resizeSingleElement` 的数学锚定在整元素盒上，不能直接套用。在 `packages/element/src/resizeElements.ts` 的 `transformElements` 中增加分支：

```ts
if (isSequenceLifelineElement(element) && transformHandleType !== "rotation") {
  resizeSequenceLifeline(
    latestElement,
    origElement,
    transformHandleType,
    pointerX,
    pointerY,
    scene,
    { shouldResizeFromCenter, shouldMaintainAspectRatio },
  );
  return true;
}
```

`resizeSequenceLifeline`：

1. 用 `pointRotateRads` 把指针转到元素本地坐标；
2. 以头部框为基准计算 `newWidth / newHeadHeight / newX / newY / newHeight`；
3. 夹取最小尺寸；
4. `scene.mutateElement(element, { x, y, width, height, shape: { ...shape, lifeline: { headHeight } } })`；
5. 调 `handleBindTextResize` + `updateBoundElements`。

不要通过改 `element.height` 去「骗」标准 resize；绑定文本、history capture、读数都会跟着错。

## 4. 杆底控制点

复用现有复合图形控制点链路：

1. `CompositeShapeControlPoint["kind"]` 增加 `"lifeline-pole-end"`；
2. 生命线 `controlPoints` 返回：
   ```ts
   [{ kind: "lifeline-pole-end", x: width / 2, y: height }];
   ```
3. `renderer/interactiveScene.ts` 现有控制点循环会绘制圆点，无需新增绘制代码；
4. `components/app/pointerSelection.ts` 的 `hitCompositeControlPoint` 已经优先于缩放手柄检查；
5. `components/app/pointerSession.ts` 的控制点拖动分支加特判：

```ts
if (kind === "lifeline-pole-end" && isSequenceLifelineElement(element)) {
  const newHeight = clamp(local.y, headHeight + MIN_POLE, MAX_HEIGHT);
  if (newHeight !== element.height) {
    scene.mutateElement(element, { height: newHeight });
  }
  // hasChanged / scheduleCapture / triggerUpdate 照现有分支
} else {
  // 现有 shape 参数更新
}
```

`local.y` 已由 `getCompositeControlPointLocal` 做过逆旋转，元素有 angle 也能用。

## 5. 其他交互细节

### 5.1 文本编辑边界

- 双击头部命中区内 → 进入标签编辑；
- 双击杆 → 只选中，不进入编辑；
- 编辑文本时隐藏手柄与控制点（沿用现有 `editingTextElement` 判据）。

### 5.2 变换读数

`getTransformStatusReadout` 对生命线改为：

- 头部缩放时显示 `width × headHeight`；
- 杆底控制点拖动时可显示杆长（可选）。

读数气泡定位用头部框中心，否则会飘到整条生命线中间。

### 5.3 方向手柄 / quick create

当前 `getQuickCreateHandles` 基于整元素包围盒，生命线会出现：

- 底部圆点与杆底控制点重叠；
- 左右圆点在杆的中段，而不是头部。

P2 建议：

- 先对生命线隐藏 quick-create 方向手柄；
- 或在头部框四边重新生成，并在 P3 与「拖出消息」交互一起设计。

### 5.4 多选与组

- 多选时用标准联合包围盒与标准手柄；
- `isSelectedViaGroup` 时照现有逻辑不画单元素手柄/控制点；
- 自定义 UI 只在 `selectedElements.length === 1` 且非组选中生效。

### 5.5 旋转

- 单选生命线不提供旋转手柄；
- 已有 angle 的生命线仍按整元素中心旋转头部框；
- 自定义缩放数学用逆旋转处理指针坐标。

## 6. 实现清单

- [x] `element/src/compositeShape/registry.ts`
  - [x] `ShapeRegistration` 增加 `selectionFrame`；
  - [x] 生命线提供 `selectionFrame`；
  - [x] 生命线 `controlPoints` 增加 `lifeline-pole-end`。
- [x] `element/src/compositeShape/sequenceOutline.ts`
  - [x] `getCompositeShapeSelectionFrame` / `hasCompositeShapeSelectionFrame`（几何层统一 accessor）；
  - [x] `isPointInSequenceLifelineHead`；
  - [x] `clampSequenceLifelineHeight`；
  - [x] 文本安全区在头部缩小时夹取。
- [x] `element/src/transformHandles.ts`
  - [x] `getTransformHandles` 使用 `getElementSelectionFrameCoords`；
  - [x] 自定义选择框省略 rotation。
- [x] `element/src/resizeTest.ts`
  - [x] 贴边热区使用 `getElementSelectionFrameCoords`。
- [x] `element/src/resizeElements.ts`
  - [x] `transformElements` 生命线分支；
  - [x] `getSequenceLifelineResize` / `resizeSequenceLifeline`；
  - [x] 最小尺寸、文本重排、旋转锚点。
- [x] `element/src/transformStatus.ts`
  - [x] 生命线读数使用头部尺寸。
- [x] `excalidraw/renderer/interactiveScene.ts`
  - [x] 选择框使用 `getElementSelectionFrameCoords`；
  - [x] 读数气泡定位使用头部框中心。
- [x] `excalidraw/components/app/pointerSession.ts`
  - [x] `lifeline-pole-end` 只改 `element.height`。
- [x] `excalidraw/components/app/pointerSelection.ts`
  - [x] 控制点优先级沿用现有链路；`types.ts` 补 `lifeline-pole-end` 种类。
- [x] `excalidraw/components/app/pointerCanvas.ts`
  - [x] 双击杆不再进入文本编辑，只在头部内编辑。
- [x] `element/src/quickCreate.ts`
  - [x] 生命线抑制 quick-create 方向手柄，避免与杆底控制点重叠。

## 7. 测试

- [x] 单选生命线的选择框几何 = 头部盒（单测）；
- [x] 头部框 8 个手柄可用，无旋转手柄（单测）；
- [x] 左右缩放后杆仍居中（缩放结果 x/width 单测）；
- [x] `n` 缩放：头底与杆底不动，杆长不变（单测）；
- [x] `s` 缩放：头底移动，杆底不动，杆长变化（单测）；
- [x] 杆底控制点只改 `element.height`（`pointerSession` 特判 + clamp 单测）；
- [x] 夹取：`width / headHeight / poleLength` 不被拖到非法值（单测）；
- [x] 多选/组选回退标准框（代码路径：仅单元素使用自定义框）；
- [x] 锁定、只读、编辑文本时不显示手柄/控制点（沿用现有判据）；
- [x] 旋转后的生命线仍能正确缩放（旋转锚点单测）；
- [x] 文本重排后仍在头部框内（缩小头部文本区单测）；
- [x] 生命线不显示 quick-create 方向手柄（浏览器级单测）。

## 8. 验收

- [ ] 画布上单选生命线：只看到头部框 + 杆底控制点（待浏览器手工验收）；
- [x] 拉宽头部，杆自动居中（单测）；
- [x] 拉高/拉矮头部，标签与杆的关系符合上表（单测）；
- [x] 拖杆底控制点，杆变长/变短，头部不动（逻辑单测 + 代码审查）；
- [x] 点空白不选中生命线（P1 命中几何单测）；
- [x] 多选行为与普通图形一致（代码路径）；
- [ ] 没有手柄/热区残留在整条包围盒上（待浏览器手工验收）；

## 9. 不做

- 消息连线、activation 连接点 → P3；
- 通过方向手柄拖出消息 → P3；
- fragment 行结构 → P4。

## 10. 风险

- 选中框有**两条渲染路径**：已提交选中态走 `renderSelectionBorder`，hover / 按下未松开 / frame 高亮走 `renderElementsBoxHighlight`。两处必须同源，否则会出现「选中后是头部框，hover 时又变回整条框」。
- `getTransformHandles` / `resizeTest` / `renderSelectionBorder` / `renderElementsBoxHighlight` / `transformStatus` 五个消费者必须同源。
- 标准 resize 数学锚定整元素高度，不能直接复用；必须走专用 `resizeSequenceLifeline`。
- 杆底控制点与 quick-create 底部圆点可能重叠；P2 先抑制 quick-create。
- 文本自动适配与头部高度联动复杂；P1 的固定适配是前置条件。

## 11. 实施记录

自动化验证：

- `sequenceShape.test.ts`：106 个用例通过（新增选择框、手柄、缩放语义、旋转锚点、杆底控制点 clamp、文本区收缩等用例）；
- `packages/element` 全量测试：51 个文件、1701 passed（35 skipped，1 todo）；
- `quickCreateHandles.test.tsx`：95 个用例通过（新增生命线隐藏方向手柄用例）；
- `selectionHandles` / `resize` / `bounds` / `collision` / `frame` / `compositeShapeUI` / `shapeDrawer` 等相关测试通过；
- `packages/element` / `packages/excalidraw` typecheck 通过；
- 变更文件 ESLint（`--max-warnings=0`）通过。

已知限制：

- Shift/Alt 修饰键尚未接入生命线缩放（`shouldMaintainAspectRatio` / `shouldResizeFromCenter` 目前被忽略）。
- 杆底控制点的手势本身未做浏览器级自动化测试；逻辑通过 `clampSequenceLifelineHeight` 与代码审查覆盖。
- 浏览器手工验收（真实命中优先级、光标、触屏、导出）尚未执行。
- 多选/组选使用标准联合包围盒，包含整条杆，这是本期刻意的回退口径。
- 旋转后的生命线缩放已用单测验证锚点，但 UI 上不提供单选旋转手柄。

实施后修复：

- hover / 按下未松开时仍出现整条框：`renderElementsBoxHighlight` 的单元素分支原先直接用 `getElementAbsoluteCoords`，绕过了 `selectionFrame`。已改为 `getElementSelectionFrameCoords`，与已提交选中态同源。
