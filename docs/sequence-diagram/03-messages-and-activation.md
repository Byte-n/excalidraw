# P3：消息与激活条

- **状态**：未开始
- **依赖**：P1；P2 可选（不影响消息语义，但会影响操作手感）
- **目标**：让生命线之间可以创建消息，并支持在杆上自动创建激活条。
- **原则**：复用现有箭头元素，不新增时序图专用连接线元素类型。

## 1. 当前状态

- `isBindableElement` 刻意排除了 `sequence`（`packages/element/src/typeChecks.ts` 有注释说明）；
- 箭头不能绑定到生命线或激活条；
- `sc-activation` 只是独立圆角矩形，与生命线没有关系；
- 没有「拖到杆上自动建激活条」的手势。

## 2. 设计决策

沿用原始实施方案的决策：

| #   | 决策                                                    |
| --- | ------------------------------------------------------- |
| 1   | 消息复用现有箭头，不新建元素类型                        |
| 2   | 只有 `sc-activation` 可作为箭头端点；生命线不直接接消息 |
| 3   | 激活条连接点只出左 / 右两个方向                         |
| 4   | 拖到生命线杆上时，在落点 y 自动创建激活条并连线         |
| 5   | 落到空白 / frame / 其它形状 → 取消，不生成元素          |

补充约定：

- 消息箭头默认水平：两端 y 对齐到激活条中点或落点 y；
- 同步消息实线，返回消息虚线（按箭头样式，不新增字段）；
- 消息标签复用箭头绑定文本；
- 自消息先支持「同一条激活条的上下两个连接点」，复杂回路放到后续；
- 一次拖拽创建的所有元素（激活条 + 箭头）必须落在**同一条 undo 记录**里。

## 3. P3a：绑定基础

### 3.1 让 activation 可绑定

`packages/element/src/typeChecks.ts`：

```ts
export const isBindableElement = (element, includeLocked = true) => {
  return (
    ...
    (element.type === "composite" ||
      element.type === "flow" ||
      element.type === "stickynote" ||
      ...
      isActivationElement(element)) // 新增
  );
};
```

只放开 `sc-activation`，**不要**顺手把 8 个生命线也放进 `isBindableElement`。生命线只作为「落点容器」，消息端点落在激活条上。

新增判据：

```ts
export const isActivationElement = (element) =>
  isShapeWithId(element, "sc-activation");
```

### 3.2 连接点

激活条只需要左 / 右两个锚点：

- 左：`(element.x, element.y + element.height / 2)`；
- 右：`(element.x + element.width, element.y + element.height / 2)`；
- 旋转后按 `element.angle` 绕中心旋转。

实现可复用 `getCompositeShapeAnchors`，但只返回左右两个；或在 `binding.ts` 里给 `sc-activation` 增加专用 `headingForPointFromElement` / `snapToMid` 分支。

### 3.3 消息箭头

箭头复用 `binding.ts` 的现有绑定：

- `startBinding` / `endBinding` 指向激活条；
- `attachPoint` 归一化 y 取中点；
- 移动激活条或生命线时，箭头通过 `updateBoundElements` 跟随。

## 4. P3b：创建交互

### 4.1 悬停激活条出连接点

现有 quick-create 方向手柄：

- `packages/element/src/quickCreate.ts`：`getQuickCreateHandles` / `hitTestQuickCreateHandle`；
- `packages/excalidraw/components/App.quickCreate.ts`：手势状态机；
- `packages/excalidraw/renderer/interactiveScene.ts`：绘制与预演。

需要新增：

1. 激活条的 hover 解析（当前手柄只在选中后出现）；
2. 只生成左 / 右两个点，而不是四边中点；
3. 连接点偏移不要用基础图形的固定 gap，按激活条窄高尺寸取小值；
4. 预演与落地共用同一个 `resolveDragEndTarget`，避免两套判定。

### 4.2 落点三分支

`App.quickCreate.handlePointerUp` 的落点解析增加：

| 落点                    | 行为                                            |
| ----------------------- | ----------------------------------------------- |
| 另一个激活条            | 直接创建箭头，两端绑定                          |
| 生命线杆                | 在落点 y 创建激活条（水平居中于杆），再创建箭头 |
| 空白 / frame / 其它形状 | 取消，不打开插入面板                            |

「落到杆上」的判定直接复用 P1 的 `hitPaths`：

- 命中杆走廊；
- 取落点 y 夹到 `headHeight + MIN_ACTIVATION_OFFSET … element.height`；
- 新激活条 `x = lifeline.x + lifeline.width / 2 - ACTIVATION_WIDTH / 2`；
- 新激活条 `y = 落点 y - ACTIVATION_HEIGHT / 2`（或按落点作为顶部，二选一并写进测试）。

### 4.3 交互优先级

已有的优先级：

1. 复合图形控制点（P2 的杆底控制点）；
2. quick-create 手柄；
3. 变换手柄；
4. 元素命中。

新增 hover 连接点后要保持这个顺序，避免「悬停激活条时点到了下面的生命线」或「杆底控制点被连接点抢走」。

## 5. 实现清单

- [ ] `element/src/typeChecks.ts`
  - [ ] 新增 `isActivationElement`；
  - [ ] `isBindableElement` 只放开 activation。
- [ ] `element/src/binding.ts`
  - [ ] activation 左 / 右锚点；
  - [ ] 消息箭头端点投影与吸附；
  - [ ] 生命线作为「落点参考」但不作为可绑元素。
- [ ] `element/src/quickCreate.ts`
  - [ ] 激活条 hover 目标解析；
  - [ ] 左 / 右两点手柄；
  - [ ] 落点类型扩展（activation / lifeline-pole / cancel）。
- [ ] `excalidraw/components/App.quickCreate.ts`
  - [ ] `preparePointerDown` 支持 hover 激活条；
  - [ ] `handlePointerUp` 三分支；
  - [ ] 预演 ghosts（激活条 + 箭头）；
  - [ ] 单条 undo 记录。
- [ ] `excalidraw/renderer/interactiveScene.ts`
  - [ ] 新增连接点的绘制 / 命中反馈（复用 quick-create 渲染）。
- [ ] `excalidraw/components/app/pointerSelection.ts` / `pointerSession.ts`
  - [ ] 与 P2 的控制点、变换手柄排优先级。
- [ ] `excalidraw/_tests_/quickCreateHandles.test.tsx`
  - [ ] 新增时序分支用例。

## 6. 测试

- [ ] activation 可被箭头绑定；
- [ ] 移动激活条，箭头跟随；
- [ ] 移动生命线，激活条与箭头跟随（若激活条是手动放置的，不自动跟随；若由拖拽创建，记录来源后可跟随，P3 先不做）；
- [ ] 悬停激活条只出现左 / 右两点；
- [ ] 拖到另一个激活条生成箭头；
- [ ] 拖到杆上生成激活条 + 箭头；
- [ ] 拖到空白 / frame / 其它形状取消；
- [ ] 触屏 / 笔的命中半径正确；
- [ ] undo 一次撤销整次创建；
- [ ] 预演与落地位置一致。

## 7. 验收

- [ ] 能在两条生命线之间画出水平消息；
- [ ] 消息端点落在激活条左右边缘；
- [ ] 从激活条拖到杆上能自动生成激活条与消息；
- [ ] 消息标签可编辑；
- [ ] 激活条与消息的 z-order 正确（激活条在生命线上，消息在最上）；
- [ ] 既有 quick-create 用例不回归。

## 8. 不做

- 时序图专用消息元素 / 语义字段（fromLifelineId、消息序号、同步/异步枚举）→ 后续 P6 或语义化阶段；
- 消息自动排序、自动布局；
- 生命线直接作为箭头端点；
- activation 的 create/destroy 语义；
- Lark 回写。

## 9. 风险

- 箭头绑定模型以元素为端点，activation 的生命周期（删除生命线时是否级联删除）需要明确；P3 先按「activation 是独立元素」处理。
- quick-create 手柄原本是「选中后出现」，时序需要「悬停出现」，这是行为差异，要单独回归触屏与旋转。
- 落点判定依赖 P1 的 `hitPaths`；P1 未完成时不要启动 P3b。
- 自动创建多个元素时，undo / 协作同步要保证原子性。
