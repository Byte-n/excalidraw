# 文本内嵌化迁移交接文档

更新时间：2026-11-16
分支：`feat/sequence-diagram-p1-p2`
最后提交：`0e635e8f refactor(text): 移除容器绑定文字机制`

## 1. 状态

文本内嵌化迁移已完成。所有容器文字都由元素自身的 `element.texts` 区域承载，
绑定 `type:"text"` 子元素的生产、渲染、编辑、绑定与协作链路已全部删除。

硬约束（后续改动继续遵守）：

- 破坏性改动，不写数据迁移、不双读双写、不加兼容层。
- 代码注释用中文，不描述旧结构或历史逻辑。
- 单元测试禁止新增 `console.log`。
- 不改 `docs/lark-exmples/`。
- 代码变更落地前跑受影响子包的 test + typecheck。

## 2. 架构

核心模块在 `packages/element/src/text/`：

- `types.ts`：`TextRegionKey`、`TextBlock`、`TextBlockStyle`、`TextBlockMap`、
  `TextRegionDefinition`、`TextRegionLayout`。
- `keys.ts`：`body/title/label/cell:<id>/row:<id>` key 工厂与解析。
- `ops.ts`：`getTextBlock/withTextBlock/withoutTextBlock`。
- `regions.ts`：按元素家族生成区域；命中测试。
- `layout.ts`：测量、换行、截断、单行。
- `regionLayout.ts`：区域内的定位/对齐/旋转；表格、片段、标签有家族样式解析。
- `applyLayout.ts`：按家族求尺寸反馈（形状 auto-fit、便签、脑图）。
- `elementText.ts`：文字元素访问器（内容仍存 `texts.body`）。
- `labelLayout.ts`：线性元素中点标签沿路径定位，文字保持水平。
- `tableTextStyle.ts`：表格单元格样式/表头权重/行高派生。

渲染：

- Canvas：`packages/element/src/renderElement.ts` 的 `drawTextRegions`。
- SVG：`packages/excalidraw/renderer/staticSvgScene.ts`。
- 编辑：`packages/excalidraw/components/app/regionText.ts` +
  `packages/excalidraw/wysiwyg/textRegionEditor.ts`。
- 样式入口：`packages/excalidraw/components/app/textStyleTargets.ts`，
  被 actionProperties / Stats 复用。

已迁移的家族（全部读 `texts`）：

| 家族 | 区域 key | 备注 |
| --- | --- | --- |
| composite / flow | `body` | auto-fit 尺寸 |
| dataflow `df-process` | `title` + `body` | 标题固定单行、不撑几何 |
| stickynote | `body` | 字号 fit、高度/baseHeight |
| mindmap-node | `body` | 根节点 16/600/白；layoutFrozen 截断 |
| table | `cell:<cellId>` | 行高撑高、表头 600 派生、合并/拆分/复制 remap |
| sc-fragment | `body` + `row:<rowId>` | operator tab + 正文行 |
| sc-lifeline-* | `body` | 头部撑高、杆长不变 |
| arrow / line | `label` | `placement.labelPosition`，文字保持水平 |

文字元素只剩自由文字与箭头端点文字，内容统一存 `texts.body`。
`boundElements` 仅保留箭头绑定与激活条绑定。

## 3. 提交记录

| 提交 | 内容 |
| --- | --- |
| `781fd2ee` | 便签正文内嵌 |
| `c9a28539` | 脑图节点声明正文区域与自适应尺寸 |
| `3f1e102a` | 脑图正文内嵌到 texts.body |
| `823055be` | 清理脑图绑定文字残留 |
| `594e9c5b` | dataflow 正文/标题双区域 |
| `1dfceb2e` | 表格单元格文本内嵌 |
| `ed3bb8bd` | sequence fragment 文本内嵌 |
| `ad504ccb` | 箭头/直线中点标签内嵌 |
| `a9e7fbff` | 独立文字改用 texts.body 存储 |
| `30b02bf9` | 生命线标签内嵌到 texts.body |
| `0e635e8f` | 移除容器绑定文字机制（P8d） |

## 4. 验证结果（`0e635e8f`）

- `@excalidraw/element`：62 文件，1821 passed / 33 skipped；typecheck 通过。
- `@excalidraw/excalidraw`：147 文件，2443 passed / 11 skipped；typecheck 通过。
- `@excalidraw/yjs`：14 文件，86 passed；typecheck 通过。
- `@excalidraw/board-import`：5 文件，80 passed；typecheck 通过。
- `@excalidraw/agent-tool`：typecheck 通过，`docs:check` 通过。
- `yarn build:element` 通过。

## 5. 行为决策记录

- 脑图 `layoutFrozen` 节点正文只截断，不参与尺寸反解。
- dataflow 标题固定单行（`DATAFLOW_PROCESS_TITLE_HEIGHT`），正文 auto-fit。
- 表格行/列 `backgroundText` 样式与表头 600 权重是渲染期派生，不写回 block。
- fragment 行 key 用 `row:<rowId>`，header 行是 `body`。
- 箭头标签永远水平，位置存 `placement.labelPosition`，端点文字仍是独立 text。
- 生命线正文撑高头部，宽度和杆长不变。
- 便签正文 fit 改变高度后，绑定箭头随高度重锚。
- 表格等比缩放时，便签正文 `fontSize` 同步放大；单向拉伸只改几何。
- SearchMenu 适配嵌入区域文本，不再只搜 text 元素。

## 6. 关键文件地图

- 文本内核：`packages/element/src/text/`
- 元素类型：`packages/element/src/types.ts`
- 构造：`packages/element/src/newElement.ts`
- 区域编辑：`packages/excalidraw/components/app/regionText.ts`、
  `packages/excalidraw/wysiwyg/textRegionEditor.ts`
- 样式入口：`packages/excalidraw/components/app/textStyleTargets.ts`
- 生产端：`packages/element/src/transform.ts`、
  `packages/board-import/src/feishu/convert.ts`
- 协作：`packages/yjs/src/scene-projection.ts`、
  `packages/yjs/src/excalidraw-scene-session.ts`
