# PR6：清理与收口

> **状态**：未开始。
> **依赖**：PR3（连接接入）、PR4（时序 affordance）、PR5（通用 hover）。可在三者全部合入后开始。
> **交付后的结果**：旧落点函数、旧 hover 字段、旧预览分支全部删除；指针交互只有一条解析链、一份状态、一个 cursor 写者。
> **原则**：先确认无消费者，再删除；每删一类单独 commit，保证可回滚。

## 1. 目标

| # | 目标 | 验收 |
| --- | --- | --- |
| G1 | 删除 `suggestedBinding` | `rg suggestedBinding` 无生产引用 |
| G2 | 删除旧落点函数 | `getSnapOutlineMidPoint` / `projectAttachPointOntoDiagonal` / `getDiagonalsForBindableElement` / `snapToMid` / `getActivationBindingPoint` 无引用 |
| G3 | 删除平行 hover 字段 | `AppQuickCreate` / `AppMindmap` 无 hover 字段 |
| G4 | 渲染器不再重算几何 | 无 `getSnapOutlineMidPoint`、无中点 / 锚点重算 |
| G5 | 单一 cursor 写者 | `cursor.set` 只出现在 `AppCursor` 与 `applyPointerFrame` |

## 2. 非目标

- 不改变任何已迁移行为。
- 不新增功能。
- 不做历史数据兼容。
- 不重构与指针无关的模块。

## 3. 删除清单

### 3.1 `suggestedBinding`

| 类别 | 位置 | 处置 |
| --- | --- | --- |
| 类型 | [types.ts:636](../../packages/excalidraw/types.ts#L636) | 删除字段 |
| 初始值 | [appState.ts:120](../../packages/excalidraw/appState.ts#L120)、`:290` | 删除 |
| 写入 | [pointerCanvas.ts:960](../../packages/excalidraw/components/app/pointerCanvas.ts#L960)、`:1104` | PR3 已改为 frame 镜像；此处删除 |
| 写入 | [pointerSelection.ts:1531](../../packages/excalidraw/components/app/pointerSelection.ts#L1531) | 删除 |
| 写入 | [linearElementEditor.ts:2459](../../packages/element/src/linearElementEditor.ts#L2459)、`:2560`、`:2581`、`:2599`、`:2620` | 删除；预览读 frame |
| 清理 | `actionDeselect.ts:106/132`、`actionFinalize.tsx:274/478`、`keyboard.ts:237/896`、`pointerSession.ts:471/2308/2513/3364/3379`、`pointerSelection.ts:151/1272`、`lifecycle.ts:109` | 删除 |
| 读取 | [interactiveScene.ts:3726](../../packages/excalidraw/renderer/interactiveScene.ts#L3726)、`:601` 起 | 改读 frame `connection` target |
| 读取 | [linearElementEditor.ts:493](../../packages/element/src/linearElementEditor.ts#L493) | 删除比较；预览由 frame 驱动 |
| 返回对象 | [linearElementEditor.ts:372](../../packages/element/src/linearElementEditor.ts#L372)、`:434`、`:471`、`:506`、`:516`、`:622`、`:661`、`:726` | 删除 `suggestedBinding` 字段；预览由 frame 驱动 |
| 读取 | [pointerSession.ts:1592](../../packages/excalidraw/components/app/pointerSession.ts#L1592) | 删除变更检测 |
| 传参 | [LayerUI.tsx:725](../../packages/excalidraw/components/LayerUI.tsx#L725)、`StaticCanvas` / `InteractiveCanvas` props | 删除 |

### 3.2 旧落点函数

| 函数 | 位置 | 前置确认 |
| --- | --- | --- |
| `getSnapOutlineMidPoint` | [utils.ts:519](../../packages/element/src/utils.ts#L519) | 无调用方（PR3 / PR4 已迁移） |
| `projectAttachPointOntoDiagonal` | [utils.ts:597](../../packages/element/src/utils.ts#L597) | 无调用方 |
| `getDiagonalsForBindableElement` | [utils.ts:435](../../packages/element/src/utils.ts#L435) | 仅被上一项使用 |
| `snapToMid` | [binding.ts:1344](../../packages/element/src/binding.ts#L1344) | 无调用方（3b 已迁移） |
| `getActivationBindingPoint` | [sequenceOutline.ts:439](../../packages/element/src/compositeShape/sequenceOutline.ts#L439) | 无调用方；activation spec 取代；同时删除 `compositeShape.ts` 的 re-export |
| `getActivationAnchor` 的重复包装 | `sequenceOutline.ts:387` | 若仅剩 spec 内部使用则保留，否则删除 |
| 激活条分支 | [binding.ts:1812](../../packages/element/src/binding.ts#L1812)、[utils.ts:532](../../packages/element/src/utils.ts#L532)、[interactiveScene.ts:737](../../packages/excalidraw/renderer/interactiveScene.ts#L737) | 删除 |
| 曲线外移分支 | [binding.ts:1835](../../packages/element/src/binding.ts#L1835) | ② 档覆盖，删除 |

删除前执行：

```bash
rg "getSnapOutlineMidPoint|projectAttachPointOntoDiagonal|getDiagonalsForBindableElement|snapToMid|getActivationBindingPoint" packages
```

只允许测试里出现（测试也应同步删除或改为新 API）。

### 3.3 平行 hover 字段

| 模块 | 字段 | 处置 |
| --- | --- | --- |
| `AppQuickCreate` | `hovered` / `poleActivation` / `sequenceConnection` / `poleActivationClick` / `drag` / `sequenceConnectionDrag` | PR4 已删除；PR6 确认无残留 |
| `AppMindmap` | `hoveredNodeId` / `hoveredAddButton` | 5b 删除；PR6 确认 |
| `App.transformStatus` | `hoveredHandle` | 改为从 frame 读取；若保留，只能由 dispatch 写 |
| `AppState` | `frameToHighlight` | 能由 frame target 表达则删除；否则保留为 dispatch 写 |
| `AppState` | `highlightedTableCell` | 保留为 dispatch 写（像素级 cell，不是 target） |
| `AppState` | `hoveredElementIds` | 保留为 dispatch 写，供链接选择器 / 多元素 highlight |
| `AppState` | `hoveredElementId` | 保留：画框标题是 DOM，由 `frames.tsx` 桥接，不是 canvas target |
| `AppState` | `tableStructureHover` / `fragmentStructureHover` | 容器 provider 内部状态；确认只由 provider `renderHover` / `clearHover` 写 |

**判定标准**：如果字段能被「单个 target + point」完全表达，删除；如果承载多元素或像素级信息，保留为**派生视图**，但必须只有 dispatch 写。

### 3.4 渲染器

| 位置 | 删除内容 |
| --- | --- |
| [interactiveScene.ts:599–:896](../../packages/excalidraw/renderer/interactiveScene.ts#L599) | `suggestedBinding.midPoint`、中点 / 锚点重算、激活条特例 |
| [interactiveScene.ts:737](../../packages/excalidraw/renderer/interactiveScene.ts#L737) | `renderSequenceActivationDot` 并入通用落点圆点 |
| [interactiveScene.ts:1452](../../packages/excalidraw/renderer/interactiveScene.ts#L1452) | 手柄 hover 改读 frame（PR4） |
| [interactiveScene.ts:4396](../../packages/excalidraw/renderer/interactiveScene.ts#L4396)、`:4398` | 杆 / 连接线预演改读 frame（PR4） |
| [interactiveScene.ts:3799–:3815](../../packages/excalidraw/renderer/interactiveScene.ts#L3799) | hover 框改读 frame 或保留的派生视图 |

渲染器只允许：

- 读 `app.pointer.getFrame()`；
- 读 ghost / pending 缓存；
- 读保留的派生视图（`hoveredElementIds` 等）。

不得再调用任何 `getSnap*` / `resolve*` / `getActivationBindingPoint`。

## 4. 终态架构

```text
raw pointer event
      │
      ▼
resolvePointerFrame(app, { point, phase, mode, pointerType })
      │   ├─ resolveInteractionTarget（手柄 / 容器 / 元素）
      │   ├─ providers（composite / quickCreate / connection / activationEdge / pole）
      │   └─ 纯函数：不写 cursor / state / repaint
      ▼
applyPointerFrame(app, frame)
      │   ├─ clearPointerHover（providers / mindmap / quickCreate / 派生字段）
      │   ├─ switch target.kind → hover / armed / gesture / ghost
      │   ├─ updateDerivedPointerState（frame / cell / link）
      │   ├─ cursor.set(getCursorForPointerTarget(...))  ← 唯一 cursor 写者
      │   └─ app.pointer.setFrame(frame)
      ▼
renderInteractiveScene
      ├─ switch (frame.target.kind)  ← 预览 / 落点 / 手柄
      └─ ghost / pending 缓存
```

状态归属：

| 状态 | 归属 |
| --- | --- |
| 当前 target / phase / owner / point / origin | `AppPointerState` |
| ghost / pending ghost | 各模块渲染缓存 |
| 异步待决 | `AppQuickCreate.pendingInsert` |
| 输入状态 | `modifierHeld` |
| 多元素 / 像素级派生视图 | `hoveredElementIds` / `highlightedTableCell` 等（dispatch 写） |
| 连接落点 | `ConnectionHit`（frame payload） |

## 5. 最终验收

### 5.1 自动化

- [ ] 全量测试：
  ```bash
  yarn test:all
  ```
- [ ] 各包 typecheck：
  ```bash
  yarn workspace element typecheck
  yarn workspace excalidraw typecheck
  yarn workspace yjs typecheck
  yarn workspace board-import typecheck
  ```
- [ ] 代码规范：
  ```bash
  yarn test:code
  ```

### 5.2 性质测试

- [ ] 同一坐标先 hover 再 pointerdown，target 深度相等；
- [ ] 连接预览点 = 松手落点，误差 < 0.01（所有家族 × 三种箭头 × 四种模式）；
- [ ] 每帧 `cursor.set` ≤ 1；
- [ ] 杆预演可见 ⇒ 单击可创建且几何一致；
- [ ] 预演可见 ⇒ 不同时存在其它 affordance；
- [ ] 从容器控制区移到普通元素，容器 hover 被清理。

### 5.3 grep 验收

```bash
rg "suggestedBinding" packages/excalidraw packages/element
rg "getSnapOutlineMidPoint|projectAttachPointOntoDiagonal|getDiagonalsForBindableElement|snapToMid|getActivationBindingPoint" packages/element/src packages/excalidraw
rg "cursor\.set" packages/excalidraw/components/app/pointerCanvas.ts packages/excalidraw/components/app/pointerSession.ts packages/excalidraw/components/app/pointerSelection.ts
```

- [ ] 第一条无生产引用；
- [ ] 第二条无引用；
- [ ] 第三条只剩 `AppCursor`、`applyPointerFrame`，以及 pan / 滚动条 / 手型工具等**非画布 target** 的早退路径（这些路径不产生 frame）。

### 5.4 人工验收

- [ ] 鼠标 / 触屏 / 触控笔：hover 与按下目标一致；
- [ ] 旋转 / 缩放 / 多选 / 组选 / 锁定 / 只读；
- [ ] 表格轨道 / 插入点 / 画框边框 / fragment 行控件；
- [ ] 时序图：激活条连接点、杆预演、消息拖拽、方向手柄；
- [ ] 链接 / embed / view-mode cursor。

## 6. 实施步骤

- [ ] 跑 §5.3 grep，列出所有待删符号与剩余调用方。
- [ ] 先删 `suggestedBinding`（类型 → 写入 → 读取 → 清理），每步 typecheck。
- [ ] 删旧落点函数与分支（§3.2），每步 typecheck。
- [ ] 删平行 hover 字段（§3.3），确认渲染改读 frame。
- [ ] 精简渲染器（§3.4）。
- [ ] 跑全量测试与性质测试。
- [ ] 更新本目录 README 的「实施记录」。

## 7. 风险

| 风险 | 缓解 |
| --- | --- |
| 仍有隐藏消费者 | 每删一类先 `rg` + `tsc --noEmit`；按符号分 commit |
| 测试依赖旧字段 | 同步改测试为新 API；不保留为测试专用的导出 |
| 快照大面积变化 | 快照差异逐条审阅；只允许行为已迁移的差异 |
| 删除顺序导致中间态不可编译 | 按「类型 → 写入 → 读取 → 清理」顺序；每步可编译 |
| 渲染器仍偷偷重算 | grep `getSnap` / `resolve` / `getActivationBindingPoint`；review 检查 |

## 8. 完成定义

- 生产代码中只有一条指针解析链；
- 只有一份 frame 状态描述 hover / down / gesture；
- 只有 `applyPointerFrame` 写 cursor；
- 连接预览与落点同源；
- 渲染器不重算几何；
- 所有验收项通过。

## 实施记录（2026-11-14，6a：删除 suggestedBinding）

- 实际改动：删除 `AppState["suggestedBinding"]`（类型 / 初始值 / appState 导出 /
  Static·InteractiveCanvas props / LayerUI / actionDeselect / actionFinalize / keyboard /
  lifecycle / pointerCanvas / pointerSelection / pointerSession 的全部写入与清理），
  删除 `linearElementEditor` 返回对象与比较中的该字段。新增
  `element/src/connection/preview.ts`：端点/折线点拖拽时把落点写成 gesture 帧
  （`setConnectionPreviewFrame` / `clearConnectionPreviewFrame`），渲染器只读
  `app.pointer.getFrame()` + scene 绘制 binding highlight。删除
  `connection/suggestedBinding.ts`、`isSameSuggestedBinding`、`suggestedBindingForElbow`。
- 与计划的偏差：预览帧 helper 放在 element 包（线性编辑器在 element 内，依赖方向
  决定了不能放 pointerDispatch）；`handleHoverSelectedLinearElement` 不再在拖拽中把
  `isDragging` 置 false（旧行为由镜像 setState 顺带覆盖，删除后需保留拖拽态）。
  另含两个 PR5 回归修复（见 `30a39bf8`）：多选手柄优先于 linearHandle；armed 帧
  复用上次 hover target，避免命中缓存污染导致 pointerup 误取消选择。
- 基线变化：contextmenu / regression / utils export 快照仅删 `"suggestedBinding": null`
  行；history 快照 63 行字段 + 5 个渲染计数 -1（删除仅为镜像的 setState）+ 1 个
  skip 用例陈旧快照；`move.test` inline 计数 interactive 23→24、static 17→16
  （预览帧显式重绘取代镜像 setState）。
- 新增/调整测试：`connectionPreview.test.tsx` 改读 frame 的 connection target；
  element 包 1841 项全绿；excalidraw 全量仅 3 个既有 animation 失败。
- grep：生产/测试/快照无 `suggestedBinding`（CHANGELOG 历史文案与无关的
  `suggestedBindings` 复数导出除外）。
- 遗留问题：6b 删除旧落点函数与渲染器重算，并跑最终验收。
