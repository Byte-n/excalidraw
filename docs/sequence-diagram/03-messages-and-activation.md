# P3：消息与激活条

- **状态**：已实现（自动化验收通过；浏览器手工验收待做）
- **依赖**：P1；P2 可选（不影响消息语义，但会影响操作手感）
- **目标**：让生命线之间可以创建消息，并支持在杆上自动创建激活条。
- **原则**：复用现有箭头元素，不新增时序图专用连接线元素类型。

> **修订（2026-11-13）**：时序图的所有图形（8 个生命线、`sc-activation`、 `sc-fragment`）**不再提供 quick create 指示器及相关功能**。已移除：激活条左 / 右方向手柄、悬停激活条出连接点、从激活条拖拽建消息、拖到空白弹「插入图形」面板、生命线杆悬停 / 单击创建激活条，以及对应预演与渲染。激活条改由图形抽屉创建；消息用箭头工具连接激活条两端。下方 P3 的历史设计与验收记录保留，但标有「已移除」的交互不再生效。

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
| 3   | 激活条连接点只出左 / 右两个方向                                        |
| 4   | 拖到生命线杆上时，在落点 y 自动创建激活条并连线                        |
| 5   | 落到空白 / frame / 其它形状 → 取消，不生成元素（不打开插入面板）       |
| 6   | 悬停生命线杆显示半透明激活条预演，单击在预演位置创建激活条（不建消息） |
| 7   | 激活条默认尺寸 30 × 100 由元素层常量派生，预置与杆上创建共用同一份     |
| 8   | 激活条与生命线杆建立持久绑定，生命线移动 / 缩放 / 旋转时激活条跟随     |
| 9   | 拖动激活条靠近杆时横向吸附到杆中心；落点建立 / 更新绑定，拖离则解绑    |
| 10  | 激活条宽度锁定，只能通过 n / s（及角点）修改高度                       |

补充约定：

- 消息箭头默认水平：起端 y 取出发激活条中点；落到已有激活条时把该 y 夹进目标激活条的竖向范围，因此同高激活条之间是水平线；
- 同步消息实线，返回消息虚线（按箭头样式，不新增字段）；
- 消息标签复用箭头绑定文本；
- 自消息先支持「同一条激活条右边缘上下两个 y 偏移的挂点」，复杂回路放到后续；
- 一次拖拽创建的所有元素（激活条 + 箭头）必须落在**同一条 undo 记录**里；
- 预演与落地必须共用同一个落点解析（`resolveActivationDrop`），避免两套判定；
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

- 左：`(element.x, element.y + element.height / 2)`；
- 右：`(element.x + element.width, element.y + element.height / 2)`；
- 旋转后按 `element.angle` 绕中心旋转。

每条边不是一个固定中点，而是一组**自动吸附点**：沿左 / 右边缘按高度自适应分布（包含垂直中点，避开上下角），上下边不提供连接点。拖拽连线端点时吸附到所选边最近的锚点，`attachPoint` 的 y 比例随锚点写入。

实现：

- `getActivationAnchor(element, side, localY)` 返回旋转后的边缘点；
- `getActivationAnchorAtSceneY(element, side, sceneY)` 把一个场景 y 夹进激活条的竖向范围后取边缘点，消息保持水平靠的就是它；
- `snapToMid` 给 `sc-activation` 增加专用分支：只按指针在中心左 / 右选左右边缘，不再产生上 / 下吸附；
- ~~quick-create 只生成左 / 右两个手柄。~~（2026-11-13 移除：时序图形不再有 quick create 手柄）

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

**宽度锁定**：激活条只有高度可改。`getTransformHandles` 隐藏 `e` / `w` 与旋转手柄，并强制生成 `n` / `s`；`getSequenceActivationResize` 只取 `n` / `s` 分量， `x` 与 `width` 始终取原值（旋转时以对边中点为锚保持位置）。

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
- 新激活条 `x/y` 由「中心 ± 30×100 / 2」反推，再带上生命线的 `angle`。

「空白取消」只对**激活条作为源**的口径生效：普通基础图形拖到空白仍走原有的「插入图形」面板，避免改变既有 quick-create 行为。

### 4.3 交互优先级

已有的优先级：

1. 复合图形控制点（P2 的杆底控制点）；
2. quick-create 手柄；
3. 变换手柄；
4. 元素命中。

新增 hover 连接点后要保持这个顺序，避免「悬停激活条时点到了下面的生命线」或「杆底控制点被连接点抢走」。

### 4.4 悬停杆创建激活条（已移除，2026-11-13）

参考交互：指针悬浮在虚线杆上时，杆上浮出一条半透明的激活条；单击即在该位置创建一条真实激活条。

| 阶段 | 行为 |
| --- | --- |
| 悬停 | 指针在杆走廊内且生命线是最上层命中 → 画半透明激活条预演（30×100） |
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
  - [x] 左右边缘多个自动吸附点（`getSequenceActivationAnchorLocalYs` / `getSequenceActivationAnchors` / `snapSequenceActivationLocalY`）；
  - [x] `isPointOnSequenceLifelinePole`；
  - [x] `getSequenceLifelinePoleActivationPlacement`（夹取 + 旋转）；
  - [x] `getActivationAnchor` / `getActivationAnchorAtSceneY`。
- [x] `element/src/typeChecks.ts`
  - [x] `isBindableElement` 只放开 `sc-activation`（`sequence` 家族里的生命线仍排除）。
- [x] `element/src/binding.ts`
  - [x] `snapToMid` 的 activation 分支只吸附左 / 右边缘；
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
- [x] 激活条只能改高度：无 `e` / `w` / 旋转手柄，`n` / `s` 与角点只改高度；
- [x] 悬停激活条只出现左 / 右两点；
- [x] 拖到另一个激活条生成箭头（两端 y 对齐，消息水平）；
- [x] 拖到杆上生成激活条 + 箭头；
- [x] 拖到空白 / frame / 其它形状取消（不打开插入面板）；
- [x] 悬停杆出现半透明激活条，预览位置随指针 y / 夹取；
- [x] 单击杆创建激活条，尺寸 30×100、顶部对齐单击 y、水平居中于杆；
- [x] 在杆上拖拽不创建激活条（移动生命线的既有语义保留）；
- [x] 触屏 / 笔的命中半径正确；
- [x] undo 一次撤销整次创建；
- [x] 预演与落地位置一致。

## 7. 验收

- [x] 能在两条生命线之间画出水平消息；
- [x] 消息端点落在激活条左右边缘；
- [x] 从激活条拖到杆上能自动生成激活条与消息；
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
