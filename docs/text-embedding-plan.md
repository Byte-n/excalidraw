# 图形文本内嵌化设计方案

## 0. 前提与边界

- **不做数据迁移、不做双读双写、不加 feature flag**：按仓库「无历史数据」的前提，直接切换 schema，旧场景 JSON 不作为输入。
- 迁移期内允许「部分家族已内嵌、部分家族仍是绑定文字元素」的中间态，但这是**开发脚手架**，最终整体删除；不保留两套长期模型。
- 独立文字仍然是 `type: "text"` 元素，但内容同样走 `texts.body`，全场景只有一种文本 schema。
- 箭头端点文字不内嵌：它浮在箭头外，继续做独立 text 元素，由 `startBinding` / `endBinding` 绑定。
- 箭头中点标签属于箭头，走 `texts.label`。

## 1. 命名基线

```ts
export type TextRegionKey =
  | "body" // 主文本：形状正文、便签、思维导图节点、独立文字、fragment operator tab
  | "title" // 次级固定槽：dataflow-process 标题
  | "label" // 线性元素中点标签
  | `cell:${string}` // table 单元格文字（cellId = table.cells[].id）
  | `row:${string}`; // sequence fragment 正文行文字（rowId = shape.fragment.rows[].id）

export type TextBlock = Readonly<{
  /** 唯一事实来源；换行后的显示文本是派生值，不落盘 */
  text: string;
  style: TextBlockStyle;
  /** 仅当区域定义无法推导时才存，例如箭头标签沿路径的位置 */
  placement?: Readonly<{
    labelPosition?: number;
  }>;
}>;

export type TextBlockStyle = Readonly<{
  fontFamily: FontFamilyValues;
  /** 用户选择的字号；fit 后的实际渲染字号是派生值 */
  fontSize: number;
  fontWeight?: number;
  lineHeight: UnitlessLineHeight;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  /** 缺省 = 跟随元素 ink（便签、思维导图根节点） */
  color?: string;
}>;

/** 元素自己拥有的全部文本区域；不存在即无文本，空区域不落 key。 */
export type TextBlockMap = Readonly<Partial<Record<TextRegionKey, TextBlock>>>;

type _ExcalidrawElementBase = Readonly<{
  // ...既有字段
  /** 元素自己拥有的文本区域；只有区域注册表声明过的 key 才合法 */
  texts?: TextBlockMap;
}>;

/** 独立文字：几何归元素自己，文本走统一的 texts.body */
type ExcalidrawTextElement = Merge<
  _ExcalidrawElementBase,
  Readonly<{
    type: "text";
    texts: Readonly<{ body: TextBlock }>;
    autoResize: boolean;
  }>
>;
```

访问路径统一为 `element.texts?.body?.text`，实际代码通过 helper 取值：

```ts
export const getTextBlock = (
  element: ExcalidrawElement,
  key: TextRegionKey,
): TextBlock | undefined => element.texts?.[key];
```

## 2. 目标架构

```text
element.texts (持久化：text / style / placement)
        │
        ▼
getTextRegions(element)          ← 每个家族的区域定义（body/title/label/cell:/row:）
        │
        ▼
layoutElementText(element)       ← 纯函数：区域矩形、换行/截断、fit、样式解析
        │
        ├── TextRegionLayout[] ──► 渲染（Canvas / SVG / 静态导出）
        ├── TextRegionLayout[] ──► 命中测试 / 编辑会话 / bounds
        └── TextLayoutPatch   ──► 回写元素几何（auto-fit、表格行高、fragment 行高）
```

模块放在 `packages/element/src/text/`：

| 模块 | 职责 |
| --- | --- |
| `types.ts` | `TextRegionKey`、`TextBlock`、`TextBlockStyle`、`TextBlockMap`、`TextRegionDefinition`、`TextRegionLayout` |
| `keys.ts` | key 工厂/解析：`cellKey`、`rowKey` |
| `regions.ts` | 按 `element.type` / `shape.id` 生成区域定义；区域命中 |
| `layout.ts` | 文本测量、换行/截断、fit、区域坐标；产出 layout + geometry patch |
| `style.ts` | 有效样式解析：区域默认值、便签 ink、思维导图根节点、表头字重 |
| `ops.ts` | `setTextBlock` / `removeTextBlock` / `normalizeTextBlocks` / `detachTextRegion` |
| `editing.ts` | `TextEditingSession`、编辑目标 |
| `cache.ts` | 按 `element.version` 缓存 layout |

依赖方向保持 `common → element/text → element → excalidraw → yjs`，`text/` 不反向依赖 app。

## 3. 核心 API

```ts
export type TextRegionDefinition = Readonly<{
  key: TextRegionKey;
  /** 元素局部坐标中的区域矩形 */
  bounds: LocalRect;
  wrap: "wrap" | "truncate" | "single-line";
  /** auto：文字决定元素尺寸；fixed：元素尺寸决定文字 */
  fit: "auto" | "fixed";
  defaultStyle: TextBlockStyle;
  editable: boolean;
}>;

export type TextRegionLayout = Readonly<{
  key: TextRegionKey;
  text: string;
  lines: readonly string[];
  x: number;
  y: number;
  width: number;
  height: number;
  angle: Radians;
  fontSize: number;
  fontFamily: FontFamilyValues;
  fontWeight?: number;
  lineHeight: UnitlessLineHeight;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  color: string;
}>;

export type TextLayoutPatch =
  | {
      kind: "element";
      updates: Partial<Pick<ExcalidrawElement, "width" | "height" | "x" | "y">>;
    }
  | { kind: "tableRow"; rowId: string; height: number }
  | { kind: "fragmentRow"; rowId: string; height: number };

export const getTextRegions = (
  element: ExcalidrawElement,
): readonly TextRegionDefinition[];

export const getTextRegionAtPosition = (
  element: ExcalidrawElement,
  localPoint: LocalPoint,
): TextRegionKey | null;

export const layoutElementText = (
  element: ExcalidrawElement,
): {
  layouts: readonly TextRegionLayout[];
  patch?: TextLayoutPatch;
};

export const getTextRegionLayout = (
  element: ExcalidrawElement,
  key: TextRegionKey,
): TextRegionLayout | null;
```

编辑态：

```ts
export type TextEditingTarget = Readonly<{
  elementId: string;
  region: TextRegionKey;
}>;

export type TextEditingSession = Readonly<{
  target: TextEditingTarget;
  initialText: string;
  view: TextRegionLayout;
}>;
```

`app.state.editingTextElement: ExcalidrawTextElement | null` 改为 `editingText: TextEditingSession | null`。

## 4. 区域 key 归属

| 元素 | 合法 key | 说明 |
| --- | --- | --- |
| `composite`、`flow`、`sequence`（非 fragment） | `body` | 单一正文 |
| `dataflow`（`df-process`） | `body`、`title` | 正文和顶部标题槽 |
| `stickynote`、`mindmap-node` | `body` | 单一正文 |
| `text`（独立文字） | `body` | 文本元素的正文 |
| `arrow`、`line` | `label` | 中点标签 |
| `table` | `cell:<cellId>` | 每个可见单元格至多一个；合并后只保留 anchor |
| `sequence`（`sc-fragment`） | `body`、`row:<rowId>` | `body` 是 operator tab；`row` 只覆盖正文行，不含 header 行 |

key 工厂：

```ts
export const textRegionKey = {
  cell: (cellId: string) => `cell:${cellId}` as const,
  row: (rowId: string) => `row:${rowId}` as const,
};
```

## 5. 数据结构不变量

1. **空区域不占 key**：`text === ""` 时删除该 key，不存空 block。
2. `cell:<id>` 的 id 必须存在于 `table.cells`；被合并覆盖的单元格（`mergedInto` 非空）不得带 key，文本只挂在 anchor 上。
3. `row:<id>` 的 id 必须存在于 `shape.fragment.rows`，且不能是 header 行（`rows[0]`）。
4. 每个 key 对应一个唯一区域；结构删除（删行、删列、合并单元格）时同步删除或迁移对应 key。
5. 持久化只有 `text`、`style`、`placement`；文字位置、尺寸、换行结果、fit 后的字号全部派生。
6. 单元格里的 `content` 成员（图片、frame、独立文字等）不属于文本模型，继续用 `containerRef: tableCell { cellId, role: "content" }` 表示成员关系。
7. fragment 的 `SequenceFragmentRow.label` 不再需要，行文字统一落在 `texts["row:<id>"]`。

## 6. 分期计划

| 阶段 | 内容                                                 | 依赖  | 风险 |
| ---- | ---------------------------------------------------- | ----- | ---- |
| P0   | 文本地基模块（纯新增）                               | —     | 低   |
| P1   | 区域基础设施 + 基类 `texts`                          | P0    | 低   |
| P2   | 编辑会话、区域命中、入口统一                         | P1    | 中   |
| P3   | 单区域形状（composite/flow/note/mindmap）            | P2    | 中   |
| P4   | dataflow 双区域（body + title）                      | P3    | 低   |
| P5   | 表格单元格文字                                       | P2    | 高   |
| P6   | sequence fragment                                    | P2    | 中   |
| P7   | 箭头标签                                             | P2    | 中   |
| P8   | 独立文字 schema 切换、旧机制清理、协同/导出/性能收口 | P3–P7 | 高   |

P3 与 P5/P6/P7 在 P2 完成后可并行推进；P8 必须最后。每期结束时主干可编译、可测试、可合并。

### P0 — 文本地基（纯新增）

**目标**：把文本能力从 `textElement.ts` 中抽出来，形成独立模块，不接任何现有行为。

**新增**

```text
packages/element/src/text/
├── types.ts      TextRegionKey / TextBlock / TextBlockStyle / TextBlockMap / TextRegionDefinition
├── keys.ts       cellKey / rowKey
├── regions.ts    getTextRegions / getTextRegionAtPosition（先只实现独立文字 body）
├── layout.ts     layoutElementText / getTextRegionLayout / TextLayoutPatch
├── style.ts      有效样式解析
├── ops.ts        setTextBlock / removeTextBlock / normalizeTextBlocks
└── cache.ts      layout 缓存（先留接口）
```

**工作项**

1. 定义 key 语法与工厂：`body` / `title` / `label` / `cell:<id>` / `row:<id>`。
2. 把现有 `wrapText` / `measureText` / `getLineHeightInPx` 的使用收敛到 `layout.ts`。
3. 实现 `layoutElementText` 的纯函数骨架：输入元素，输出区域布局与可选 geometry patch。
4. 单测：key 语法、换行/截断、空文本、fit 收敛。

**出口**：新增模块单测通过；现有代码零改动；`yarn workspace @excalidraw/element typecheck` 通过。

### P1 — 区域基础设施（基类字段 + 区域注册表）

**目标**：让元素能声明并命中自己的文本区域，不接渲染/编辑，不改变现有行为。

**工作项**

- `packages/element/src/types.ts`：基类增加 `texts?: TextBlockMap`；独立文字仍保留现有 `text: string` 等字段，与 `texts` 不冲突。
- `text/regions.ts`：实现 `getTextRegions(element)`、`getTextRegionAtPosition(element, localPoint)`、`getPrimaryTextRegion(element)`；先覆盖 `composite` / `flow` / `sequence` / `dataflow` 的 `body` 区域（复用 `getCompositeShapePaddedTextBounds`），其余家族返回空数组。
- `TextRegionDefinition` 去掉尚未使用的 `defaultStyle`，保留 `key` / `bounds` / `wrap` / `fit` / `editable`。
- 单测：矩形/椭圆/菱形的区域矩形、fit 模式、命中内外。

**出口**：类型与单测通过；现有渲染、编辑、序列化行为零变化。

### P2 — 编辑会话与区域命中

**目标**：所有文字编辑入口不再依赖「文字元素」。

**工作项**

- `app.state.editingTextElement` → `editingText: TextEditingSession | null`。
- `textWysiwyg.tsx` 接收 session + layout，不再接收元素。
- `app/text.ts` 的 `startTextEditing` 改为接收 `{ elementId, region }` 或空白点。
- 入口统一：文字工具、双击、Enter、画完形状、`quickCreate`、`finalize`。
- `getTextElementAtPosition` → `getTextRegionAtPosition`。
- 编辑态渲染（`interactiveScene` 的编辑框）改为 layout 驱动。

**出口**：独立文字所有入口行为不变；`editingTextElement` 全仓归零；双击空白创建、双击文字编辑、Escape 取消、空提交删除。

### P3 — 单区域形状

**目标**：composite / flow / stickynote / mindmap-node 的正文内嵌。

**工作项**

1. `regions.ts` 实现形状 `body` 区域矩形：
   - 复用 `getCompositePaddedTextBounds`、`getTextContainerShape` 的椭圆/菱形/气泡/花括号内缩；
   - 便签 padding、思维导图节点矩形。
2. 渲染：`renderElement` 在几何之后绘制区域文字；不再生成绑定文字元素。
3. 编辑：双击进入 `body`；空内容删除 key。
4. 布局 fit：
   - `auto`：输出元素尺寸 patch；
   - `fixed`：换行/截断，不动元素尺寸。
5. 便签：`style.color` 缺省跟随 `strokeColor`；`style.fontSize` 是意图，fit 字号派生；`baseHeight` 逻辑保留。
6. 思维导图：根节点反色/字重进区域默认样式；`layoutFrozen` 走截断。
7. resize：`handleBindTextResize` → `applyTextLayout` + 区域重排。
8. 删除/复制/分组/框选：移除文本级联与文本重绑。
9. `actionBindText` / `actionWrapTextInContainer` 对已迁移家族禁用（P8 删除）。

**出口**：这些形状的正文不再出现在 `h.elements`；编辑、换行、auto-fit、resize、复制、删除、导出全部通过；补一组按家族的特征测试。

### P4 — dataflow 双区域

**目标**：`body` + `title` 两个区域独立编辑。

**工作项**

- `regions.ts`：`title` 使用 `getDataflowProcessTitleTextBounds`，单行、固定区域。
- 命中：标题带 → `title`，其余 → `body`。
- 布局：标题不允许换行；标题字号变化驱动标题带高度。
- 编辑入口：Enter 默认 `body`；双击/文字工具按坐标选区域。

**出口**：两个区域可独立编辑、独立样式、独立空内容；标题区域不可换行。

### P5 — 表格

**目标**：单元格文字内嵌，`content` 成员关系保持不变。

**工作项**

1. `regions.ts`：只为可见 anchor 生成 `cell:<cellId>`；`mergedInto` 覆盖单元格不生成。
2. 布局：`wrap`；行高随文字 → `TextLayoutPatch: tableRow`；列宽仍由表格控制。
3. 样式：cell → row → column → table 的解析顺序保留；表头 600 字重保留。
4. 渲染：表格绘制填充/网格后绘制单元格文字；`content` 成员仍是独立元素，绘制在其上。
5. 结构操作：
   - 合并：anchor 保留拼接文本，其余 key 删除；
   - 拆分：anchor 保留，新单元格空；
   - 增删行列：删除对应 key；
   - 复制：`regenerateTableIds` 的 `cellIdMap` 同步重映射 `texts` key。
6. 序列化：restore 丢弃非法 cellId / 覆盖单元格 / 空 key。
7. `commitCanvasElementOperation` 的 `value/style` 写入 `texts["cell:<id>"]`。
8. 删除 `tableCell.role = "backgroundText"` 的文本用法（P8 收尾）。

**出口**：表格编辑、合并/拆分、行列增删、复制、restore round-trip、导出全部通过；单元格文字不再作为独立元素存在；cell 内其它元素不受影响。

### P6 — sequence fragment

**目标**：operator tab 与正文行文字内嵌。

**工作项**

- `regions.ts`：`body`（header tab）+ `row:<rowId>`（仅正文行）。
- operator tab 宽度随文本增长，首行高度随之增长。
- 正文行换行撑高 → `TextLayoutPatch: fragmentRow`。
- 删除 `FragmentRowContainerRef` 与 `SequenceFragmentRow.label`。
- 复制：行 id 随 shape 数据复制；确认复制路径不重生成行 id，否则补 key 重映射。

**出口**：tab 编辑、行文字换行/行高、复制、restore 全部通过。

### P7 — 箭头标签

**目标**：中点标签内嵌；端点文字保持独立元素。

**工作项**

1. `regions.ts`：`label` 区域由路径参数 + `placement.labelPosition` 计算。
2. 标签拖动 → 只改 `placement.labelPosition`。
3. 渲染：箭头绘制时用 label layout 计算「文字洞」，even-odd 裁剪后画文字。
4. SVG 导出：用 clipPath/mask 实现等价效果。
5. bounds：线性元素 bbox 并上 label 区域（替换 `bounds.ts` 的绑定文字逻辑）。
6. 端点文字：保持 `startBinding` / `endBinding` 指向独立 text 元素，不做改动。

**出口**：标签编辑/拖动/双击/导出/命中全部通过；端点文字行为不变。

### P8 — 独立文字 schema 切换与清理

**目标**：独立文字统一为 `texts.body`，并删除旧的绑定文字机制。

**独立文字切换**

- `ExcalidrawTextElement` 去掉 `text` / `originalText` / `fontSize` / `fontFamily` / `lineHeight` / `textAlign` / `verticalAlign` / `fontWeight` / `baseFontSize`，改为 `texts.body`；保留 `autoResize`。
- `newTextElement`、`textWysiwyg`、渲染、导出、actions、Stats、Search、restore 全部切到 `texts.body`。
- `texts.body.text` 是源文本，换行由 layout 派生；空内容删除整个元素。

**删除**

- `containerId` / `containerSlot` / `labelPosition` / `baseFontSize`（文字元素上）。
- `boundElements` 中的 text 引用、`ExcalidrawTextContainer`、`isTextBindableContainer`、`hasBoundTextElement`、`getBoundTextElement*`、`getContainerElement`。
- `actionBindText` / `actionUnbindText` / `actionWrapTextInContainer`（保留 `detachTextRegion`）。
- `containerRef` 的 `fragmentRow` 分支；`tableCell.role` 只保留 `content`。

**收口**

- `restore` / `reconcile` / `duplicate` / clipboard / `scene-projection` / `scene-commands` 改为内嵌文本模型。
- `SearchMenu`、SVG/PNG 导出、agent-tool 文档。
- layout cache 按 `element.version` 落地。
- 旧符号 grep 归零。

**出口**：三个子包 `test` + `typecheck` 全绿；渲染与交互回归通过。

## 7. 关键机制

### 7.1 布局是纯函数，几何通过 patch 回写

当前 `redrawTextBoundingBox` 会在编辑提交时直接 mutate 容器，渲染路径是只读的。新模型把两者分开：

- `layoutElementText(element)` 只读，返回区域布局 + 可选几何 patch；
- 内容/样式变更、resize、结构变更后调用一次 `applyTextLayout(scene, element)`；
- 渲染、命中、导出永远只读 layout，不触发 mutation。

这样避免「渲染时顺手改数据」导致的协同/撤销噪声，也便于缓存。auto-fit 必须保证一次应用后收敛，dev 环境加断言。

### 7.2 编辑会话替代「假元素」

`textWysiwyg` 只需要位置、宽高、角度、字体、对齐和内容。用 `TextRegionLayout` 提供这些，不构造临时元素（避免消耗 id/seed）。

提交时：

```ts
setTextBlock(scene, element, region, { text, style });
if (text === "") {
  removeTextBlock(scene, element, region);
}
applyTextLayout(scene, element);
```

独立文字提交空内容时删除整个元素。

### 7.3 渲染

- 新增 `renderTextLayout(ctx, layout, config)`，Canvas 与 SVG 共用同一份 layout。
- 形状：绘制几何 → 绘制所有区域。
- 表格：填充/网格 → 单元格文字；content 成员仍按场景顺序后绘制。
- 箭头：几何 + label hole + label 一次画完。
- 独立文字：元素自身绘制 `body`。

### 7.4 命中与入口

| 入口 | 目标 |
| --- | --- |
| 文字工具点空白 | 新建独立文字 `body` |
| 文字工具点元素 | 坐标命中的区域 |
| 双击元素 | 坐标命中的区域 |
| Enter | 元素的主区域（`body` / `label` / fragment `body`） |
| 画完形状 | `body` |
| 双击表格单元格 | `cell:<cellId>` |
| 双击 fragment 正文行 / tab | `row:<rowId>` / `body` |

文本区域不参与独立命中：单击仍然选中元素，只有双击/文字工具才进入区域编辑。

### 7.5 变换与 resize

- 平移/旋转：不做任何文本补偿，layout 自动跟随。
- 形状 resize：按 `wrap` / `truncate` 重新布局；auto-fit 形状按现有 `handleBindTextResize` 规则回写尺寸。
- 表格：行高随文字，列宽不由文字驱动。
- fragment：行高随文字。
- 箭头：标签随路径参数；拖动只改 `labelPosition`。

## 8. 样式操作作用域

| 场景 | 作用目标 |
| --- | --- |
| 正在编辑某个区域 | 只改当前 `{ elementId, region }` |
| 选中单个形状、便签、思维导图节点、独立文字 | 该元素的 `body` |
| 选中单个箭头 | 该箭头的 `label` |
| 多选 | 每个元素各自的主区域 |
| 选中 `df-process` 但未编辑 | 只改 `body`；要改 `title` 先双击标题进入编辑 |
| 选中表格但未聚焦单元格 | 文字样式操作禁用；表格文字样式走表格自身的行/列/单元格样式 |
| 正在编辑表格单元格 | 只改该 `cell:<id>` |
| 便签 | 文字颜色跟随便签 ink；颜色操作改 `strokeColor`，字体/字号/对齐改 `body.style` |

Stats 面板（字号、字体、对齐）读取和写入都走同一套「主区域解析」，不再直接遍历 `isTextElement` 元素。

## 9. 序列化与一致性

| 位置 | 改动 |
| --- | --- |
| `restore.ts` | 解析 `texts` map；丢弃非法 key、空 block、覆盖单元格 key、header 行 key；不做绑定修复 |
| `reconcile.ts` | 元素级合并，内嵌文本随元素一起走；删除文本特判 |
| `duplicate.ts` | 文本自动复制；只保留表格/结构 id 的 key 重映射 |
| clipboard | 同上，不再有文本重绑 |
| `Scene` 校验 | 新增 `assertValidTextBlocks`：key 合法、结构 id 存在、每个 cell/row 至多一个、不允许空 text |
| `scene-projection`（yjs） | 删除 text 的 `containerId` / `backgroundText` 特判；保留 cell content 成员的 containerRef 校验 |
| `scene-commands`（yjs） | 元素校验改为接受 `texts` map；移除 text 专用字段校验 |
| history | 文本编辑就是元素 mutation；删除「编辑文字元素收尾」的专用逻辑 |

**协同粒度风险**：当前 Yjs 以元素为单位同步（`versionNonce` LWW），内嵌后同一表格不同单元格的并发编辑会互相覆盖。这是本方案最大的取舍。可选缓解：

1. 接受现状（元素级 LWW），后续再做字段级同步；
2. 对表格引入按 `cell:<id>` 的字段级 CRDT；
3. 表格文字继续保留独立元素（与统一模型冲突，不推荐）。

建议先按 1 落地，并显式记录该限制。

## 10. 测试策略

- **迁移前先补特征测试**：每个家族补一组「编辑、换行、缩放、复制、导出、空内容」的行为测试，迁移后断言渲染结果与交互，而不是断言场景里有几个 text 元素。
- 新增单测：key 语法、区域注册表、layout、patch 收敛、归一化不变量、表格复制 key 重映射。
- 快照策略：`h.elements` 数量与结构断言必然变化，按「元素减少、文本内嵌」更新；渲染快照应保持像素/结构等价。
- 每个阶段按 AGENTS 执行对应子包测试与类型校验：
  - `yarn workspace @excalidraw/element test && yarn workspace @excalidraw/element typecheck`
  - `yarn workspace @excalidraw/excalidraw test && yarn workspace @excalidraw/excalidraw typecheck`
  - `yarn workspace @excalidraw/yjs test && yarn workspace @excalidraw/yjs typecheck`

## 11. 主要风险

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| Yjs 并发粒度 | 同元素多区域并发编辑 LWW | 接受并记录；后续字段级同步 |
| auto-fit 收敛 | 文字 ↔ 容器尺寸循环 | patch 应用后做一次不动点断言 |
| 箭头 label 的洞与 bounds | 现有渲染强依赖独立 text 元素 | P7 单独处理，补导出与命中测试 |
| 测试面积大 | `editingTextElement` 173 处、bound text 相关 185 处 | 以 P1/P2 统一收口，后续家族只改局部 |
| 样式操作语义 | 选中形状时改字体作用于哪个区域 | 按第 8 节规则实现 |
| 公共 API | `getBoundTextElement` 等导出被移除 | 同步更新 API 文档/agent 文档 |
| 性能 | 每元素多区域测量 | layout cache 按 `element.version` 缓存 |

## 12. 立即开工清单（P0 + P1）

1. 新建 `text/types.ts`，确定 `TextBlock` / `TextBlockMap` / `TextRegionKey`。
2. 新建 `text/ops.ts` 的纯函数骨架与单测。
3. 改 `types.ts`：基类 `texts?`、`ExcalidrawTextElement` 结构。
4. 改 `newElement.ts` 的 `newTextElement`。
5. 改 `textWysiwyg.tsx` 读写路径。
6. 改 `renderElement.ts` + SVG 渲染的独立文字路径。
7. 改 `restore.ts` 解析 `texts`。
8. 批量修样式/Stats/Search/复制粘贴的编译错误。
9. 清掉 `originalText`，补 layout 派生显示行。
10. 跑 `@excalidraw/element` 与 `@excalidraw/excalidraw` 的 test + typecheck，更新受影响的快照。
