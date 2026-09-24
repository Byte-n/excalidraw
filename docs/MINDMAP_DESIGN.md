# Mindmap 设计方案

## 1. 设计目标

在 Excalidraw 画布中加入结构化 mindmap 能力，同时保留普通图形的原有行为。

目标包括：

- 明确区分普通图形、mindmap 根节点和 mindmap 普通节点。
- 支持树结构、同级顺序、折叠和自动布局。
- 支持拖拽节点时显示半透明子树、插入位置和实时布局预览。
- 节点变更后自动重新布局。
- 复用 Excalidraw 的文本编辑、样式、选择、复制、历史记录、协作和导出能力。
- mindmap 数据使用 Excalidraw 内部的正式类型，不占用 `customData`。

## 2. 已确定的设计约束

### 2.1 不使用 `customData`

`customData` 是提供给宿主应用和外部集成使用的扩展字段。mindmap 是 Excalidraw 内部能力，所有结构和行为字段都必须进入正式的元素类型和类型检查体系。

### 2.2 使用专用元素类型

普通图形继续使用现有类型，例如 `rectangle`、`ellipse` 和 `diamond`。

mindmap 节点使用新的元素类型：

```ts
type: "mindmap-node";
```

根节点和普通节点通过 `role` 区分，而不是使用两个不同的字符串类型。这样节点提升为根节点时只需要修改角色和父节点关系，不需要替换元素类型。

### 2.3 只有自动布局

mindmap 不提供 `layoutMode` 或 `positionMode`。

节点的 `x`、`y`、`width` 和 `height` 是自动布局的结果。新增、删除、编辑、折叠、重新挂接和排序等结构变更提交后，都要重新执行布局。

### 2.4 节点拖拽是结构操作

拖拽 mindmap 节点不是自由定位操作，而是改变父子关系或同级顺序。拖拽完成后提交结构变更，然后重新布局。

## 3. 元素模型

### 3.1 Mindmap 节点

建议新增以下字段：

```ts
type MindmapNodeRole = "root" | "node";
type MindmapNodeShape = "rectangle" | "ellipse" | "diamond" | "pill";

type ExcalidrawMindmapNodeElement = {
  type: "mindmap-node";
  graphId: string;
  role: MindmapNodeRole;
  parentId: string | null;
  order: FractionalIndex | null;
  collapsed: boolean;
  shape: MindmapNodeShape;
};
```

该类型同时包含 `_ExcalidrawElementBase` 的通用字段，例如：

- `id`、`x`、`y`、`width`、`height`；
- `strokeColor`、`backgroundColor`、`strokeWidth`、`roundness`；
- `boundElements`、`frameId`、`groupIds`、`locked`；
- `version`、`versionNonce`、`index`、`isDeleted`。

### 3.2 根节点和普通节点

根节点必须满足：

```ts
role === "root";
parentId === null;
order === null;
```

普通节点必须满足：

```ts
role === "node";
parentId !== null;
```

在 TypeScript 中可以将这两种情况表达为判别联合，以便在编译期检查关系约束。

### 3.3 节点文字

节点文字继续使用独立的 `ExcalidrawTextElement`，不直接嵌入 mindmap 节点：

- 将 `mindmap-node` 加入 `ExcalidrawTextContainer`；
- 文本元素通过 `containerId` 绑定到节点；
- 继续复用现有文字编辑、自动换行、字体、对齐和尺寸计算逻辑。

### 3.4 Mindmap 连接线

建议新增专用元素类型：

```ts
type: "mindmap-edge";
```

建议字段：

```ts
type ExcalidrawMindmapEdgeElement = {
  type: "mindmap-edge";
  graphId: string;
  parentId: string;
  childId: string;
  points: readonly LocalPoint[];
  routing: "orthogonal" | "curved";
};
```

连接线是结构化渲染元素，默认没有箭头头部，不允许像普通 Arrow 一样自由编辑端点。

节点的 `parentId` 是父子关系的主要来源。`mindmap-edge` 根据节点关系生成和修复，不能独立改变父子关系。恢复场景、结构变更和布局时需要保证节点关系与连接线一致。

### 3.5 图索引

不把完整树结构复制保存到单独字段中，而是根据元素构建临时索引：

```ts
type MindmapGraphIndex = {
  graphId: string;
  rootId: string;
  nodes: Map<string, ExcalidrawMindmapNodeElement>;
  parentById: Map<string, string | null>;
  childrenById: Map<string, readonly string[]>;
  edgeByChildId: Map<string, ExcalidrawMindmapEdgeElement>;
  depthById: Map<string, number>;
};
```

该索引用于布局、命中测试、拖拽预览和导航，不直接写入场景文件。

## 4. 数据不变量

每个 mindmap 必须满足：

- 一个 `graphId` 只能有一个根节点；
- 根节点没有父节点；
- 普通节点必须有同一 `graphId` 下的父节点；
- 不能形成环；
- 一个节点最多只能有一个父节点；
- 同一父节点下的 `order` 必须具有确定顺序；
- 每个非根节点最多有一条对应的 mindmap edge；
- edge 的 `parentId` 和 `childId` 必须指向同一 `graphId` 的节点；
- 普通图形和普通 Arrow 不参与 mindmap 结构。

恢复数据、粘贴数据和协作数据进入场景前都需要经过结构校验。

## 5. `order` 的作用

`order` 表示同一个父节点下的逻辑顺序，不是图层顺序，也不是 `x/y` 坐标。

它用于：

- 自动布局时确定兄弟节点的排列顺序；
- 拖拽到同级插入区域时确定插入位置；
- `ArrowUp` 和 `ArrowDown` 的同级导航；
- 大纲视图和文本导出的顺序；
- 协作场景下的确定性排序。

建议使用已有的 `FractionalIndex`，这样在两个节点中间插入新节点时不需要重排所有同级节点。

拖到空白位置不会修改 `order`，拖到明确的同级插入区域才会修改 `order`。

## 6. 自动布局

布局引擎应该是纯计算模块：输入树结构、节点尺寸和布局配置，输出节点位置、连接线点位和整体边界。

```ts
type MindmapLayoutResult = {
  elements: readonly ExcalidrawMindmapNodeElement[];
  edges: readonly ExcalidrawMindmapEdgeElement[];
  bounds: Bounds;
};
```

默认布局建议为从左到右：

- 根节点位于左侧；
- 子节点向右展开；
- 同级节点按照 `order` 垂直排列；
- 子树之间保留最小间距；
- 节点尺寸变化会影响相关层级的位置；
- 连接线自动绕开节点并重新计算路径。

后续可以增加右到左、上到下、下到上等方向，但方向属于布局配置，不是节点的布局模式。

以下操作提交后需要重新布局：

- 创建根节点、子节点和同级节点；
- 删除节点或子树；
- 修改 `parentId`；
- 修改 `order`；
- 修改节点文字或节点尺寸；
- 折叠或展开节点；
- 粘贴或导入子树；
- 改变布局方向或间距。

文字编辑期间可以只更新文本预览，文字编辑完成后再提交一次布局，避免每次输入都产生历史记录和完整布局。

## 7. 拖拽交互

### 7.1 拖拽会话

拖拽状态不写入元素，也不进入历史记录和协作同步：

```ts
type MindmapDragSession = {
  sourceIds: readonly string[];
  subtreeIds: readonly string[];
  pointerStart: ScenePoint;
  pointerCurrent: ScenePoint;
  targetNodeId: string | null;
  insertionMode: "child" | "before" | "after" | null;
  previewLayout: Map<string, { x: number; y: number }>;
  previewEdges: readonly ExcalidrawMindmapEdgeElement[];
};
```

### 7.2 拖拽开始

1. 命中 `mindmap-node` 后选中节点。
2. 指针移动超过拖拽阈值后创建拖拽会话。
3. 原节点和原连接线降低透明度。
4. 创建只用于渲染的半透明子树副本。
5. 子树副本不能插入 Scene，不能进入 History，也不能发送给协作者。

### 7.3 拖拽过程

拖拽过程中根据指针位置识别目标区域：

- 目标节点中心：作为目标节点的最后一个子节点；
- 目标节点上方区域：插入到目标节点之前；
- 目标节点下方区域：插入到目标节点之后；
- 自己或自己的后代：显示无效状态；
- 不同图的非法目标：显示无效状态。

每次有效目标变化时：

1. 在影子树中临时修改 `parentId` 和 `order`；
2. 运行自动布局；
3. 更新半透明子树位置；
4. 更新半透明连接线；
5. 绘制插入位置指示器和目标节点高亮。

布局计算应按 animation frame 节流，避免每个 pointermove 都触发完整 React 渲染。

### 7.4 拖拽结束

有效目标上松开指针时提交一个原子操作：

- 修改被拖拽节点的 `parentId`；
- 修改 `order`；
- 重新生成受影响的 edge；
- 执行自动布局；
- 一次性写入场景、History 和协作状态；
- 清除所有本地预览。

按下 `Escape` 或在空白区域松开时取消拖拽，恢复原状态。

根节点不能挂接到其他节点。移动整棵 mindmap 可以作为单独的“移动整图”操作处理，不能通过改变节点父子关系实现。

### 7.5 拖拽修饰键

- `Shift`：锁定主要方向，并暂时关闭挂接预览；
- `Alt/Option`：复制当前子树，再将复制结果挂接到目标位置；
- `Escape`：取消拖拽；
- 空白区域：不产生自由定位，默认取消操作。

## 8. 创建和编辑

- Mindmap 工具点击空白处创建根节点并进入文本编辑。
- 悬停节点时显示添加子节点控制点。
- `Enter` 创建同级节点。
- `Tab` 创建子节点。
- 根节点按 `Enter` 时创建第一个子节点。
- 双击节点进入文字编辑。
- 节点尺寸根据文字自动调整，并重新布局。
- 节点可以修改填充色、边框色、字体、圆角、透明度和形状。
- 样式修改不改变 mindmap 结构。

## 9. 键盘导航

仅在选中单个 mindmap 节点且未进入文字编辑时处理：

- `ArrowUp` / `ArrowDown`：切换同级节点；
- `ArrowLeft`：选择父节点；
- `ArrowRight`：选择第一个子节点；
- `Enter`：创建同级节点；
- `Tab`：创建子节点；
- `Shift + Tab`：将节点提升一级；
- `Space`：折叠或展开；
- `Delete`：无弹窗删除节点及完整子树，根节点则删除整张图；
- `Shift + Delete`：删除当前节点并保留后代；仅多个直属子节点时选择处理方式；
- `Escape`：退出当前操作。

文字编辑期间保留文本编辑器的默认按键行为。

## 10. 删除和折叠

### 删除

- `Delete` 默认删除当前节点及全部后代，包括折叠隐藏的后代、绑定文字与对应 edge，不弹窗；删除根节点就是删除整张图。
- `Shift + Delete` 保留后代，只删除当前节点。子节点数量按直属子节点计算。
- 根节点没有子节点时直接删除；只有一个子节点时自动将其作为新根；多个子节点时弹窗指定新根，其余分支按原顺序追加到新根已有子节点之后。
- 普通节点没有子节点时直接删除；只有一个子节点时由它接替被删节点的位置，仍挂在原父节点下。
- 普通节点有多个子节点时弹窗选择：将所有子节点按原顺序放入原父节点下、占据原节点的位置；或指定一个直属子节点接替原节点，其余分支按原顺序追加到接替节点已有子节点之后。
- 普通节点的接替操作保留原父节点、同级位置和 `graphId`，不拆图；所有分支的内部关系和绑定文字保留。
- 弹窗取消不改变场景或历史；确认后的结构及自动布局可一次撤销重做。菜单与键盘规则一致。

### 折叠

- 节点旁显示折叠控制点。
- 折叠后隐藏后代节点和 edge，但不删除数据。
- 隐藏的后代不参与命中测试和普通框选。
- 折叠状态提交后重新布局可见节点。
- 导出时默认导出当前可见状态，同时保留 JSON 中的完整子树。

## 11. 与普通图形的边界

- 普通图形不自动加入 mindmap。
- 普通 Arrow 不自动成为 mindmap edge。
- 普通图形拖到 mindmap 节点附近不会产生关系。
- 普通图形和 mindmap 节点混合选择时，使用 Excalidraw 原生整体移动。
- 只选择 mindmap 节点时，使用 mindmap 语义拖拽。
- Mindmap 节点仍可使用链接、锁定、复制、粘贴和导出能力。
- 将 mindmap 节点转换为普通图形前，必须解除其结构关系。

## 12. 复制、粘贴和导入导出

- 复制整棵 mindmap 时生成新的 `graphId` 和新的节点 ID。
- 复制子树时可以作为当前节点的子节点粘贴，也可以作为新的 mindmap 粘贴。
- 普通 Excalidraw 复制流程需要识别并完整复制 mindmap 节点、文本和 edge。
- JSON 场景保存所有 mindmap 类型和字段。
- PNG、SVG 导出包含当前布局和当前可见状态。
- 后续可增加 Markdown、Outline 和 OPML 导入导出。

## 13. 历史记录和协作

以下操作各自形成一个原子 History 记录：

- 创建节点；
- 删除节点或子树；
- 修改父子关系；
- 修改同级顺序；
- 修改文本和节点尺寸；
- 折叠或展开；
- 自动布局结果提交。

拖拽过程中的透明度、影子节点、插入指示器和预览布局只在当前客户端存在，不参与协作同步。

协作数据进入场景前需要校验：

- 是否只有一个根节点；
- 是否存在环；
- 父节点和子节点是否属于同一 `graphId`；
- edge 是否匹配节点关系；
- `order` 是否可以确定排序。

## 14. 建议的代码拆分

### `packages/element/src/types.ts`

- 新增 mindmap node 和 edge 类型；
- 更新 `ExcalidrawElement` 联合类型；
- 更新文本容器和可绑定元素类型。

### `packages/element/src/mindmap.ts`

- 类型守卫；
- `MindmapGraphIndex`；
- 结构不变量校验；
- 子树遍历；
- 同级排序；
- 自动布局；
- edge 生成和修复；
- 拖拽预览的影子树计算。

### `packages/element/src/newElement.ts`

- `newMindmapNodeElement()`；
- `newMindmapEdgeElement()`；
- 节点默认样式和默认尺寸。

### `packages/excalidraw/components/App.mindmap.ts`

- Mindmap 键盘操作；
- pointer down/move/up；
- `MindmapDragSession`；
- 结构操作提交；
- 与普通选择流程的边界处理。

### `packages/excalidraw/renderer/`

- mindmap 节点形状；
- mindmap edge；
- 根节点和普通节点的视觉差异；
- 折叠和添加子节点控制点；
- 半透明子树和插入位置预览。

### `packages/excalidraw/actions/`

- 创建节点；
- 创建同级节点和子节点；
- 删除节点和子树；
- 重新挂接；
- 调整同级顺序；
- 折叠和展开；
- 重新布局。

## 15. 实施阶段

### MVP

- 专用 `mindmap-node` 和 `mindmap-edge` 类型；
- 根节点和普通节点区分；
- 节点文字编辑；
- 添加子节点和同级节点；
- `parentId` 和 `order`；
- 自动布局；
- 子树拖拽、挂接和同级排序；
- 折叠和展开；
- 删除和撤销重做；
- JSON 保存和恢复。

### 第二阶段

- 多种布局方向；
- 节点和 edge 样式面板；
- 键盘导航完善；
- 复制子树；
- 搜索和定位；
- 移动端触摸拖拽；
- Mindmap 专用上下文菜单。

### 第三阶段

- Markdown、Outline、OPML 导入导出；
- 大纲侧栏；
- 节点模板和主题；
- 协作冲突提示；
- AI 生成和重排子树。

## 16. 核心验收标准

- 普通图形不会被误识别为 mindmap 节点。
- 每个 `graphId` 始终只有一个根节点。
- 任意结构操作都不会产生环或孤儿节点。
- 拖拽过程中原节点、半透明副本和插入预览不会进入 History 或协作数据。
- 松开鼠标后只产生一次原子变更，并完成自动布局。
- 修改文字、尺寸、父子关系或折叠状态后，布局结果稳定且可重复。
- 复制、粘贴、撤销、重做、保存、恢复和导出都保持 mindmap 结构。
