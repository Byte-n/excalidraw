# P4b：思维导图节点正文内嵌到 `texts.body`

## Context

`docs/text-embedding-plan.md` 的 P4 已完成便签部分；本期把 `mindmap-node` 的正文从独立的绑定 `type:"text"` 子元素迁移到节点自身的 `texts.body`，与 composite / flow / stickynote 共用同一套区域文本模型。完成后场景里不再存在思维导图的绑定文字元素，节点尺寸随正文自适应，编辑、样式、选择、复制、导出、协作重排都从 `node.texts.body` 读取。

当前分支 `feat/sequence-diagram-p1-p2`，工作区干净，基线为 `781fd2ee`。不做数据迁移、不做兼容层、不加 feature flag。

## 目标 schema

```ts
node.texts.body = {
  text: string,
  style: TextBlockStyle, // center/middle；根节点 16px/600/白，其余 14px/#1f2329
};
```

约束：空文本不落 key；节点只注册 `body` 一个区域。

## 核心设计决策

### 1. 区域安全区必须逐像素复刻旧行为

旧路径由 `getContainerCoords` + `getBoundTextMaxWidth/Height`（`packages/element/src/textElement.ts`）决定。不能简单用「居中」重算，必须复刻：

- rectangle / `text` 形态：`x=5, y=5, width=w-10, height=h-10`
- ellipse / `pill`：`x = 5 + w/2*(1-√2/2)`，`width = Math.round(w/2*√2) - 10`；y 轴同理
- diamond：`x = 5 + w/4`，`width = Math.round(w/2) - 10`；y 轴同理
- 宽高下限 `0.01`，避免极小节点出现负区域
- `fit`：`isMindmapLayoutFrozen(node) ? "fixed" : "auto"`；`wrap` 恒为 `"wrap"`，fixed 由 `regionLayout` 转成截断

### 2. 尺寸自适应

`getTextLayoutUpdates` 增加 mindmap 分支：不冻结且有文本时，用 `getLocalTextRegionLayout(node, "body")` 取布局；`layout.width > 区域宽` 时按 `computeContainerDimensionForBoundText(width, mappedShape)` 增宽，`layout.height > 区域高` 时增高；只增不减。`pill → ellipse`、`text → rectangle`。

### 3. 主题与默认样式

- `getMindmapNodeTextStyle(node)`（放在 `mindmap.ts`）：center/middle、默认字体、根节点 16/600/白、普通节点 14/#1f2329。
- `applyMindmapBranchTheme` 把 fontSize/fontWeight/color 写进 `node.texts.body.style`；比较门改为比较节点上的 style，行为保持「与默认一致才重派生」。
- 新建空节点没有 block 时，编辑会话使用 `getMindmapNodeTextStyle` 作为默认样式。

### 4. 编辑与重排

- `isEmbeddedTextElement`、`startRegionTextEditing`、`textRegionEditor.getLiveElement` 接纳 mindmap-node。
- `startTextEditing` 命中 mindmap-node 时进入区域编辑；`startNodeEditing` 不再依赖绑定文字。
- 区域提交后：写入 `texts`，按 fit 增长节点，再整图重排。重排必须走**带版本**的路径，否则 store 不识别变更（`packages/element/src/store.ts:930` 只认 version 增加）：
  - 新增 `relayoutMindmapScene(scene, graphId)`：`layoutMindmapScene` 求新元素后，对每个有差异的元素 `scene.mutateElement`（不含 version/versionNonce/updated 字段）。
  - `applyEmbeddedTextLayout` 的 mindmap 分支调用它，因此 Stats FontSize / MultiFontSize / actionProperties 自动生效。
- App.mindmap 内所有 `editingTextElement` 守卫统一改为同时判断 `editingTextRegion`，避免编辑中仍响应 Tab/Enter/拖拽/“+”。

### 5. 选择/命中/复制/导出

- 删除所有「text 子元素的 containerId 是 mindmap-node」分支：命中回退、选择归一化、完整图判定、图元素 id、拖拽元素扩展、锁定、隐藏、删除、可见性、convertToShape。
- 双击透明 `text` 形态节点：`pointerCanvas.ts` 的 `hasBoundTextElement(container)` 改为 `hasBoundTextElement(container) || getPrimaryTextRegion(container) !== null`。
- 大纲、根节点删除对话框、文本导出统一读 `node.texts.body.text`。
- 拖拽预览的节点正文用 `layoutTextRegionsLocal` 直接绘制（节点不再有 text 子元素）。
- `copyText` / `getTextFromElements` 纳入 `texts.body`，保持「复制为文本」可用。
- `actionBoundText` 的 `isEmbeddedTextContainer` 加入 mindmap-node。
- SearchMenu 需要在本期改：现有 `mindmapOutline.test.tsx` 已覆盖思维导图搜索。用节点区域布局构造匹配行，`SearchMatchItem.element` 指向节点本身；结果过滤、点击聚焦、画布高亮按节点绝对坐标适配。

### 6. 恢复、协作、缩放

- `restore.ts`：mindmap-node 归一化 `texts.body`（`normalizeText`、空文本丢弃、缺失 style 丢弃）；`restoreMindmaps` 仍用 `layoutMindmap` 排位置，删除绑定文字重定位循环，不额外按文本放大（保存时尺寸已 fit）。
- `reconcile.ts`：保留结构冲突判断与 `layoutMindmap`，删除绑定文字重定位循环。
- `tableScale.ts`：统一缩放时把 `texts.body.style.fontSize × scale`；字号下界计入节点正文字号；更新 `TableElementUpdate` 类型。
- `resizeElements.ts`：单元素缩放补 mindmap 正文的等比字号、最小尺寸与 fit（冻结节点只截断）；多元素等比缩放补字号缩放 + `MIN_FONT_SIZE`；`MultiDimension` 补内嵌字号缩放，保持原有「组缩放不重排图」语义。

### 7. 生产端

- `mindmapScene.ts appendNode`：不再 `newTextElement`/`boundElements`，直接写 `texts.body`；空文本不写 key。
- `buildMindmapGraphFromTree` 的 identity 改为「每个节点一个 id/seed」；预览、导入、拖入行为一致。
- `board-import` 的 mindmap 分支：节点直接写 `texts.body`，不再生成 `#text` 元素；更新其测试。

## 任务拆分（subagent 执行，我验收并提交）

### Task A：元素层区域基础设施（行为中性）

文件：

- `packages/element/src/text/regions.ts`
- `packages/element/src/text/applyLayout.ts`
- `packages/element/src/mindmap.ts`（`getMindmapNodeTextStyle`）
- `packages/element/_tests_/textRegions.test.ts`
- `packages/element/_tests_/textApplyLayout.test.ts`

内容：注册 mindmap body 区域；实现 mindmap fit 分支；默认样式 helper；覆盖矩形/椭圆/菱形/pill/text、冻结截断、只增不减、默认样式。

验收：`yarn workspace @excalidraw/element test`、`yarn workspace @excalidraw/element typecheck`。现有测试零回归。

### Task B1：element 包迁移

文件：

- `packages/element/src/mindmapScene.ts`
- `packages/element/src/mindmap.ts`
- `packages/element/src/resizeElements.ts`
- `packages/element/src/tableScale.ts`
- `packages/element/_tests_/mindmapScene.test.ts`
- `packages/element/_tests_/mindmap.test.ts`
- `packages/element/_tests_/tableScale.test.ts`
- `packages/element/_tests_/duplicate.test.tsx`
- `packages/element/_tests_/reanchorBaseline.test.ts` 及快照
- `packages/board-import/src/feishu/convert.ts` 及其测试

内容：创建/布局/重命名/主题/选择/可见性/删除/缩放全部切到 `texts.body`；新增 `relayoutMindmapScene`；restore/reconcile 归属 B2，但 element 侧 API 先落定。

验收：element 与 board-import 的 test + typecheck。excalidraw 包此时可能红，不提交。

### Task B2：excalidraw 包迁移与测试

文件：

- `packages/excalidraw/components/app/regionText.ts`
- `packages/excalidraw/wysiwyg/textRegionEditor.ts`
- `packages/excalidraw/components/app/text.ts`
- `packages/excalidraw/components/app/textStyleTargets.ts`
- `packages/excalidraw/components/App.mindmap.ts`
- `packages/excalidraw/components/app/pointerCanvas.ts`
- `packages/excalidraw/components/mindmapOutlineModel.ts`
- `packages/excalidraw/components/MindmapRootDeleteDialog.tsx`
- `packages/excalidraw/components/SearchMenu.tsx`
- `packages/excalidraw/data/mindmapText.ts`
- `packages/excalidraw/data/restore.ts`
- `packages/excalidraw/data/reconcile.ts`
- `packages/excalidraw/actions/actionBoundText.tsx`
- `packages/excalidraw/actions/actionClipboard.tsx`
- `packages/excalidraw/_tests_/mindmap*.test.*`、`helpers/api.ts`、`data/mindmap-reconcile.test.ts`、`quickCreateHandles`、`creationPreset`、`convertElementType`、`clipboard`、`actionProperties` 等相关用例与快照
- 新增 `packages/excalidraw/_tests_/mindmapTextEmbedding.test.tsx`

内容：区域编辑入口、默认样式、提交后重排、样式/Stats 重排、删除绑定文字分支、搜索/大纲/复制/导出/预览适配、restore/reconcile 清理。

验收：`yarn workspace @excalidraw/excalidraw test`、`typecheck`；回跑 element 与 board-import 全量。

B1 + B2 一起提交为功能提交。

### Task C：清理与收口

- 删除 `textElement.ts` 中仅供 mindmap 绑定文字的 `getTextContainerShape` 特判与冻结分支。
- 删除 App.mindmap / mindmap.ts / restore / reconcile 中残留的 text-child 分支与未使用导入。
- 全仓 grep 确认无 `mindmap.*-text` 生产代码。
- 新增/更新 mindmap 文本内嵌回归：编辑、空提交、根节点样式、主题重派生、冻结截断、删除/复制/撤销、SVG/PNG 导出、搜索结果。

验收：三个包 test + typecheck 全绿。

## 提交计划

1. `feat(element): 脑图节点声明正文文本区域`（Task A）
2. `feat(mindmap): 节点正文内嵌到 texts.body`（Task B1+B2）
3. `refactor(mindmap): 移除节点绑定文字残留`（Task C）

## 总验收命令

```bash
yarn workspace @excalidraw/element test
yarn workspace @excalidraw/element typecheck
yarn workspace @excalidraw/excalidraw test
yarn workspace @excalidraw/excalidraw typecheck
yarn workspace @excalidraw/board-import test
yarn workspace @excalidraw/board-import typecheck
```

## 主要风险

- 区域安全区的取整差异会改变快照：必须按 legacy 公式，不按居中重算。
- `Scene.replaceAllElements` 不递增版本：重排必须走 `mutateElement` 或 App 的差异提交。
- 编辑态守卫漏掉 `editingTextRegion` 会导致编辑时快捷键/拖拽串扰。
- SearchMenu、大纲、复制为文本、拖拽预览是容易漏掉的消费端。
- `layoutFrozen` 节点改为截断显示，属于本期明确行为变化。
