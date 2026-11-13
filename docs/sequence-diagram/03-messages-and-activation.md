# P3：消息与激活条

- **状态**：已实现（自动化验收通过；浏览器手工验收待做）
- **依赖**：P1；P2 可选（不影响消息语义，但会影响操作手感）
- **目标**：让生命线之间可以创建消息，并支持在杆上自动创建激活条。
- **原则**：复用现有箭头元素，不新增时序图专用连接线元素类型。

> **修订（2026-11-13）**：时序图的所有图形（8 个生命线、`sc-activation`、 `sc-fragment`）**不再提供 quick create 方向手柄**。已移除：激活条左 / 右方向手柄、拖到空白弹「插入图形」面板、拖到生命线杆上自动建条。唯一保留的特例是**生命线杆悬停 / 单击创建激活条**（§4.4）：预演与单击落地都不变。激活条也可由图形抽屉创建。
>
> **连接点（2026-11-13 重新实现）**：指针靠近激活条左 / 右竖边时（屏幕 12px 内，含略压进条内 4px）显示一个**跟随指针 y 的动态连接点**，不再是固定的几个锚点；按住该点拖拽即创建消息并全程预演。落点规则：终点吸附到**起点所在的激活条** → 折线（自消息），起点附近 12px 内不吸附；吸附到**其它激活条** → 水平直线；未吸附 → 沿出发边前方水平延伸，松手后按预演现状落地。消息线型由落点决定，不跟随当前箭头样式。**连接线工具**同样只显示指针所在的一个动态落点，不再绘制整组固定锚点；折线 / 非折线绑定的吸附 y 都取指针位置。

## 1. 实施前状态

- `isBindableElement` 刻意排除了 `sequence`（`packages/element/src/typeChecks.ts` 有注释说明）；
- 箭头不能绑定到生命线或激活条；
- `sc-activation` 只是独立圆角矩形，与生命线没有关系；
- 没有「拖到杆上自动建激活条」的手势。

以上问题已在本期修复；`sequence` 家族里仍只有 `sc-activation` 进入 `isBindableElement`，生命线保持不可绑。

## 2. 设计决策

沿用原始实施方案的决策：

| #   | 决策                                                                   |
| --- | ---------------------------------------------------------------------- |
| 1   | 消息复用现有箭头，不新建元素类型                                       |
| 2   | 只有 `sc-activation` 可作为箭头端点；生命线不直接接消息                |
| 3   | 激活条连接点只出左 / 右两个方向，且 y 跟随指针（动态连接点）          |
| 4   | 拖到生命线杆上时，在落点 y 自动创建激活条并连线                        |
| 5   | 落到空白 / frame / 其它形状 → 取消，不生成元素（不打开插入面板）       |
| 6   | 悬停生命线杆显示半透明激活条预演，单击在预演位置创建激活条（不建消息） |
| 7   | 激活条默认尺寸 16 × 100 由元素层常量派生，预置与杆上创建共用同一份     |
| 8   | 激活条与生命线杆建立持久绑定，生命线移动 / 缩放 / 旋转时激活条跟随     |
| 9   | 拖动激活条靠近杆时横向吸附到杆中心；落点建立 / 更新绑定，拖离则解绑    |
| 10  | 激活条宽度锁定，只能通过 `n` / `s` 修改高度（无角点、水平与旋转手柄）  |

补充约定：

- 消息箭头默认水平：起端 y 取动态连接点的指针 y；落到其它激活条时终点取「目标朝向源的边」并与起端同高，因此是水平线；
- 终点落在起点那条激活条上时改为折线（自消息）：右 / 左出去 → 竖向移动 → 再回到同一条边；
- 同步消息实线，返回消息虚线（按箭头样式，不新增字段）；
- 消息标签复用箭头绑定文本；
- 自消息起点附近的纵向死区（屏幕 12px）内不吸附终点，避免按下即产生自消息；
- 一次拖拽创建的所有元素（激活条 + 箭头）必须落在**同一条 undo 记录**里；
- 预演与落地必须共用同一个落点解析（`resolveSequenceMessagePlacement`），避免两套判定；
- 激活条与杆的绑定持久化在 `shape.link`（生命线 id + 本地 y），生命线一侧同步登记 `boundElements`；拖拽吸附阈值为 24px。

## 3. P3a：绑定基础

### 3.1 让 activation 可绑定

`packages/element/src/typeChecks.ts`：

```ts
export const isBindableElement = (element, includeLocked = true) => {
  return (
    ...
    (element.type === "composite" ||
      element.type === "flow" ||
      (element.type === "sequence" && isActivationElement(element)) || // 新增
      element.type === "stickynote" ||
      ...
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

激活条只需要左 / 右两个方向：

- 左：`(element.x, element.y + localY)`；
- 右：`(element.x + element.width, element.y + localY)`；
- 旋转后按 `element.angle` 绕中心旋转。

连接点**不是固定锚点**：指针靠近左 / 右竖边时，点贴在边上、`localY` 直接取指针位置（夹在条的竖向范围内）。指针必须落在条的纵向范围内，横向允许在边外 `SEQUENCE_CONNECTION_SNAP_DISTANCE`（屏幕 12px）内；允许略压进条内 `SEQUENCE_CONNECTION_INSIDE_TOLERANCE`（屏幕 4px，覆盖圆点内半圈）以便点圆点时优先进入建消息手势，条身中心仍然用于选择 / 拖动。

实现：

- `getActivationAnchor(element, side, localY)` 返回旋转后的边缘点，动态连接点直接复用它；
- `getActivationEdgeSide` / `getActivationBindingPoint` 是连接线工具与消息创建共用的落点几何：贴左还是右由**箭头另一端**决定（指针压在窄条内部时，指针自己的 x 分不出左右），y 取焦点位置并在条内夹取；
- 落点指示器与连接点圆点共用同一套画法（选择色填充 + 白描边，拖拽中半径略大、悬停预判小一号），不再复用通用吸附锚点的实心大圆；
- 拖拽消息时，终点吸附到激活条上（含拖回起点的自消息）就在落点画同款圆点，自由延伸不画——起点与终点用同一个标记；
- `AppQuickCreate.resolveSequenceConnection` 扫描指针附近的激活条，取最近的一条边，算出贴边点；
- 消息落点由 `AppQuickCreate.resolveSequenceMessagePlacement` 统一解析（预演与落地同源）：
  - 指针在起点那条激活条内、且离起点超过 `SEQUENCE_CONNECTION_MIN_SELF_GAP`（屏幕 12px）→ 自消息（四点折线，向外绕 `SEQUENCE_SELF_MESSAGE_OFFSET`）；
  - 指针压在其它激活条上、且起端 y 落在目标竖向范围内 → 水平直线，终点取目标朝向源的边；
  - 其余 → 水平自由端，只沿出发边外法线前方延伸。

### 3.3 消息箭头

箭头复用 `binding.ts` 的现有绑定：

- `startBinding` / `endBinding` 指向激活条；
- `attachPoint` 归一化 y 取中点；
- 移动激活条或生命线时，箭头通过 `updateBoundElements` 跟随。

### 3.4 激活条 ↔ 生命线绑定

激活条是独立元素，但要记住自己挂在哪根杆上：

```ts
// 激活条的 shape 数据
shape: {
  id: "sc-activation";
  schemaVersion: 1;
  link?: { lifelineId: string; localY: number }; // localY = 中心在生命线本地坐标的 y
}
```

生命线一侧同时登记 `boundElements: [{ id, type: "activation" }]`，两侧由 `sequenceActivation.ts` 统一维护：

| 场景 | 处理 |
| --- | --- |
| 在杆上创建激活条（单击 / 拖到杆） | 写入 `link`，并在生命线的 `boundElements` 里登记 |
| 生命线移动 / 缩放 / 旋转 / 键盘位移 / 对齐分布 | `updateBoundElements` 对生命线额外调用 `updateSequenceActivationsForLifeline`：按 `link.localY` 重新计算中心（旋转随生命线），并夹在杆范围内；随后更新绑在激活条上的消息箭头 |
| 拖动激活条 | `dragElements` 在 24px 阈值内横向吸附到最近杆中心、写入 / 更新 `link`；越过阈值则解绑并自由移动 |
| 复制 / 粘贴 | 连续复制时重映射 `lifelineId`；只复制激活条时丢弃 `link`（避免副本叠在原生命线上） |

**宽度锁定**：激活条只有高度可改。`getTransformHandles` 隐藏 `e` / `w`、四个角点与旋转手柄（角点是比例缩放，会同时暗示改宽），并强制生成 `n` / `s`；`resizeTest` 的贴边兜底热区同样跳过 `e` / `w`，避免悬停左 / 右边缘时出现水平缩放光标；`getSequenceActivationResize` 只取 `n` / `s` 分量， `x` 与 `width` 始终取原值（旋转时以对边中点为锚保持位置）。动态连接点的按下手势优先于移动：命中连接点（含圆点压进条内的内半圈）时不会拖动激活条。

## 4. P3b：创建交互

### 4.1 悬停激活条出连接点（已移除，2026-11-13）

现有 quick-create 方向手柄：

- `packages/element/src/quickCreate.ts`：`getQuickCreateHandles` / `hitTestQuickCreateHandle`；
- `packages/excalidraw/components/App.quickCreate.ts`：手势状态机；
- `packages/excalidraw/renderer/interactiveScene.ts`：绘制与预演。

需要新增：

1. 激活条的 hover 解析（当前手柄只在选中后出现）：`AppQuickCreate` 维护 `hoveredHandleTargetId`，命中激活条本体或它的手柄热区时把它作为手柄源；已选中的 quick-create 目标优先，悬停档只在没有选中目标时生效；
2. 只生成左 / 右两个点，而不是四边中点；
3. 连接点偏移不要用基础图形的固定 22px，激活条取 14px；
4. 预演与落地共用同一个 `resolveActivationDrop`，避免两套判定；
5. 拖拽中悬停目标要保留（指针离开激活条本体、进入手柄热区时不能把源丢掉）。

### 4.2 落点三分支（已移除，2026-11-13）

`App.quickCreate.handlePointerUp` 的落点解析增加：

| 落点 | 行为 |
| --- | --- |
| 另一个激活条 | 直接创建箭头，两端绑定 |
| 生命线杆 | 在落点 y 创建激活条（顶部对齐落点、水平居中于杆），再创建箭头 |
| 空白 / frame / 其它形状 | 取消，不打开插入面板 |

「落到杆上」的判定直接复用 P1 的 `hitPaths` 与新增的杆几何：

- 用 `getElementsAtPosition` 取**严格最上层**命中，且必须是该生命线（激活条压在杆上时优先激活条）；不能使用 `getElementAtPosition`——它会把选中元素的包围盒算作命中、并在严格重测失败时回退到下面那个元素；
- `isPointOnSequenceLifelinePole` 命中杆走廊（不含头部）；
- `getSequenceLifelinePoleActivationPlacement` 把落点 y 作为新激活条的**顶边**（向下展开），中心 = 落点 y + H/2，再夹到 `headHeight + MIN_ACTIVATION_OFFSET + H/2 … poleEnd - MIN_ACTIVATION_OFFSET - H/2`，杆太短时居中于杆；返回旋转后的中心、`angle` 与中心 `localY`；
- 候选位置与杆上已有激活条的区间相交（含 `MIN_ACTIVATION_OFFSET` 间隙）时，不预演也不创建；
- 新激活条 `x/y` 由「中心 ± 16×100 / 2」反推，再带上生命线的 `angle`。

「空白取消」只对**激活条作为源**的口径生效：普通基础图形拖到空白仍走原有的「插入图形」面板，避免改变既有 quick-create 行为。

### 4.3 交互优先级

已有的优先级：

1. 复合图形控制点（P2 的杆底控制点）；
2. quick-create 手柄；
3. 变换手柄；
4. 元素命中。

新增 hover 连接点后要保持这个顺序，避免「悬停激活条时点到了下面的生命线」或「杆底控制点被连接点抢走」。

### 4.4 悬停杆创建激活条（2026-11-13 保留的唯一 quick create 特例）

参考交互：指针悬浮在虚线杆上时，杆上浮出一条半透明的激活条；单击即在该位置创建一条真实激活条。

| 阶段 | 行为 |
| --- | --- |
| 悬停 | 指针在杆走廊内且生命线是最上层命中 → 画半透明激活条预演（16×100） |
| 悬停移动 | 预演**顶部贴着指针 y**、向下展开，水平居中于杆；靠近杆两端时整体夹回杆内 |
| 单击 | 在预演位置创建激活条、选中它、一步撤销；不创建消息 |
| 拖拽 | 越过阈值即视为「拖杆移动生命线」，不创建激活条（保留 P2 的移动语义） |
| Esc / 取消 | 不创建 |
| 不出现 | 只读、锁定、编辑文本、按住修饰键、建图 / 选择拖拽中、指针下压着别的元素 |

实现要点：

1. 悬停只改 `AppQuickCreate` 的组件字段并 `repaint.request()`，不进 `appState`；
2. 预演元素用与真实创建同一套 `buildPresetElementsCentered` 装配，固定身份（`preview:quick-create:pole-activation`），不推进共享 id / 随机序列；
3. 预演缓存按「生命线 id + version + 中心 + 角度」做键，避免每帧重建；
4. 单击在 `preparePointerDown` 只「臂化」，`handlePointerUp` 时用拖动距离判定是点击还是拖拽——这样 P2 的「拖杆移动生命线」不被破坏；
5. 创建走 `insertNewElements` + `scheduleCapture`，与消息创建一样是单条 undo；
6. 生命线头部的悬停不触发（避免与文本编辑 / 选择语义冲突）。

## 5. 实现清单

- [x] `element/src/compositeShape/sequenceOutline.ts`
  - [x] `isActivationElement`；
  - [x] 激活条尺寸常量 `SEQUENCE_ACTIVATION_WIDTH/HEIGHT`；
  - [x] 动态连接点几何：`getActivationAnchor`（旧的多锚点助手保留为工具函数，交互吸附已改为指针 y）；
  - [x] `isPointOnSequenceLifelinePole`；
  - [x] `getSequenceLifelinePoleActivationPlacement`（夹取 + 旋转）；
  - [x] `getActivationAnchorAtSceneY`（保留为工具函数）。
- [x] `element/src/typeChecks.ts`
  - [x] `isBindableElement` 只放开 `sc-activation`（`sequence` 家族里的生命线仍排除）。
- [x] `element/src/binding.ts`
  - [x] `snapToMid` 的 activation 分支只吸附左 / 右边缘，y 取指针位置（动态）；
  - [x] 消息箭头端点由显式 `focusPoint` 投影，落点与预演同源；
  - [x] 生命线作为「落点参考」但不进入 `isBindableElement`；
  - [x] 生命线几何变化时调用 `updateSequenceActivationsForLifeline`，再更新绑在激活条上的箭头。
- [x] `element/src/sequenceActivation.ts`（新增）
  - [x] 激活条 `link` 的读写与生命线 `boundElements` 登记 / 解除；
  - [x] 生命线跟随重排（夹取 localY、随 angle 旋转）；
  - [x] 拖拽吸附（24px 阈值）与落点解绑；
  - [x] 复制时的 `lifelineId` 重映射 / 丢弃。
- [x] `element/src/dragElements.ts`
  - [x] 激活条拖拽分支：吸附、建立 / 更新绑定、拖离解绑；
  - [x] 生命线与激活条同时拖动时，收尾统一重排一次。
- [x] `element/src/resizeElements.ts`
  - [x] `getSequenceActivationResize` / `resizeSequenceActivation`：只改高度；
  - [x] 生命线缩放后触发激活条跟随。
- [x] `element/src/transformHandles.ts`
  - [x] 激活条隐藏 `e` / `w` / 旋转手柄，强制生成 `n` / `s`。
- [x] `element/src/quickCreate.ts`
  - [x] 手柄目标支持显式覆盖（悬停激活条）；
  - [x] 左 / 右两点手柄与 14px 偏移；
  - [x] 激活条落点类型（activation / lifeline-pole / cancel）。
- [x] `excalidraw/components/App.quickCreate.ts`
  - [x] hover 激活条目标解析（含手柄热区保持）；
  - [x] 杆悬停预演 + 单击创建（`preparePointerDown` 臂化 / `handlePointerUp` 判定点击）；
  - [x] `handlePointerUp` 三分支（激活条 / 杆 / 取消）；
  - [x] 预演 ghosts（激活条 + 箭头），与落地共用 `resolveActivationDrop`；
  - [x] 杆上创建的激活条写入 `link` 并登记到生命线 `boundElements`；
  - [x] 单条 undo 记录。
- [x] `excalidraw/renderer/interactiveScene.ts`
  - [x] 未选中激活条的悬停手柄；
  - [x] 杆上的半透明激活条预演。
- [x] `excalidraw/components/app/pointerSession.ts`
  - [x] 沿用现有 quick-create 接管点；杆点击走通用选择路径，抬起时再判定。
- [x] `excalidraw/_tests_/quickCreateHandles.test.tsx`
  - [x] 新增时序分支用例；
- [x] `packages/element/_tests_/sequenceShape.test.ts`
  - [x] 杆命中 / 落点夹取 / 锚点单测。

## 6. 测试

- [x] activation 可被箭头绑定；
- [x] 移动激活条，箭头跟随；
- [x] 移动生命线，绑定的激活条与消息箭头跟随；
- [x] 杆变短时绑定的激活条被夹回杆内；
- [x] 拖动激活条靠近杆时吸附到杆中心并建立绑定；
- [x] 拖动已绑定激活条只沿杆滑动；拖离 24px 阈值后解绑；
- [x] 连续复制时重映射绑定，单独复制激活条时丢弃绑定；
- [x] 激活条只能改高度：无 `e` / `w`、角点与旋转手柄，也不响应左 / 右边缘的水平缩放热区；
- [x] 悬停激活条只出现左 / 右两点；
- [x] 拖到另一个激活条生成箭头（两端 y 对齐，消息水平）；
- [x] 拖到杆上生成激活条 + 箭头；
- [x] 拖到空白 / frame / 其它形状取消（不打开插入面板）；
- [x] 悬停杆出现半透明激活条，预览位置随指针 y / 夹取；
- [x] 单击杆创建激活条，尺寸 16×100、顶部对齐单击 y、水平居中于杆；
- [x] 在杆上拖拽不创建激活条（移动生命线的既有语义保留）；
- [x] 触屏 / 笔的命中半径正确；
- [x] undo 一次撤销整次创建；
- [x] 预演与落地位置一致。

## 7. 验收

- [x] 能在两条生命线之间画出水平消息；
- [x] 指针靠近激活条左 / 右竖边时出现跟随指针 y 的动态连接点（条身中心不出点）；
- [x] 从连接点拖到另一条激活条生成水平直线消息，两端绑定；拖拽中终点落在目标激活条上时显示与起点同款的落点圆点；
- [x] 拖回起点所在的激活条生成折线自消息（两端绑定同一条）；
- [x] 起点附近 12px 纵向死区内不吸附成自消息终点；
- [x] 未吸附到任何激活条时保持水平延伸，松手按预演现状落地（只绑起端）；
- [x] 拖拽箭头端点 / 新建箭头落到激活条上时，只显示一个跟随指针 y 的落点指示器，且与最终绑定位置一致；
- [x] 消息端点落在激活条左右边缘；
- [x] 悬停杆、单击生成激活条；
- [x] 激活条跟随生命线移动 / 缩放；
- [x] 拖入杆时吸附并建立绑定；
- [x] 激活条宽度不可改、只能改高度；
- [ ] 消息标签可编辑（复用箭头绑定文本，待浏览器手工验收）；
- [x] 激活条与消息的 z-order 正确（激活条在生命线上，消息在最上）；
- [x] 既有 quick-create 用例不回归。

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
- 杆悬停与「拖杆移动生命线」共用同一次按下：单击创建、拖拽移动，判定只能放在 `pointerup`，且阈值与 quick-create 共用 `DRAGGING_THRESHOLD`。
- 杆悬停要求生命线是 `getElementAtPosition` 的最上层命中：激活条压在杆上时不能再出预演，否则会在已有激活条上叠一条新的。
- 预演元素每帧都会被渲染层取一次，必须缓存（元素对象上的离屏位图缓存按对象身份命中），否则悬停期间会持续重建位图。
- 绑定是**持久化**的：`shape.link` 会写进文件 / 剪贴板，旧的 `link` 指向已删除生命线时只能跳过（未做删除级联）。
- 吸附只在指针拖拽路径生效；键盘位移、外部 API 改几何等路径不会重新吸附，绑定会保留到下一次生命线变化。
- 生命线与激活条同时选中拖动时，逐个更新会读到半新半旧坐标；`dragElements` 末尾的收尾 pass 是保证一致性的关键，不能删。
- 复制规则在 `fixDuplicatedBindingsAfterDuplication`：只复制激活条时必须丢弃 `link`，否则副本会叠到原生命线上。

## 10. 实施记录

自动化验证：

- `packages/element` 全量测试：51 个文件、1712 passed（35 skipped，1 todo）；
- `sequenceShape.test.ts`：117 个用例通过（新增激活条识别、杆命中 / 夹取、左右锚点、跟随 / 吸附、宽高锁定等 11 例）；
- `quickCreateHandles.test.tsx`：113 个用例通过（新增时序分支 18 例）；
- `data/restore` / `onDuplicate` / `arrowBinding` / `compositeShapeUI` / `pointerSession` / `selection` 通过（schema 与复制路径回归）；
- `arrowBinding` / `arrowEndpointTextBinding` / `compositeShapeUI` / `convertElementType.binding` / `pointerSession` / `selection` / `shapeDrawer` / `sequenceShapeIcon` 相关套件通过；
- `packages/element` / `packages/excalidraw` typecheck 通过；
- 变更文件 ESLint（`--max-warnings=0`）通过。

已知限制：

- 删除生命线不会级联删除 / 解绑其激活条；旧的 `link` 在跟随更新时被跳过。
- 键盘位移 / 外部 API 改激活条几何不会重新吸附（吸附只在指针拖拽路径生效）。
- 自消息只留了「右边缘上下两个 y 偏移」的几何入口，交互尚未实现。
- 消息箭头沿用仓库的 binding gap：端点停在激活条边缘外约 5–6px，而不是零间隙贴边。
- 悬停档手柄的优先级低于任何选中态：有选中项时不在别的激活条上出悬停手柄。
- 浏览器手工验收（悬停手感、触屏、缩放、真实 z-order）尚未执行。
