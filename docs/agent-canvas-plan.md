# Excalidraw Agent 画布能力方案（v1 评审稿）

> 状态：待评审
> 范围：`packages/agent-tool`、`packages/element`、`packages/yjs`、`packages/excalidraw`、`packages/board-import`、文档与基础设施
> 本期结论：只提供 Agent tool；MCP 作为后续阶段的薄包装层，不在本期实现

---

## 1. 目标与非目标

### 1.1 目标

1. Agent 能创建整张图，并在**提交前**完成布局。
2. Agent 能修改已有节点/结构；变更后按领域策略决定是否重排（mindmap 强触发，sequence/flowchart 条件触发，普通图形只做局部 fit）。
3. 提供显式的布局工具，既能对新建元素布局，也能对**已有元素 ids** 重新布局：输入 ids、算法、起点、参数，返回最终几何与 warnings。
4. 文档按 guide/topic 按需查询，数据源从代码自动生成。
5. 服务端 Node 执行，布局由**发起写入的一方**计算后随协作广播；协作服务器不做布局。

新建与修改都支持，区别只在触发方式：新建走 `generate`/`apply` 前布局；已有元素走 `update` + 条件重排，或显式 `layout.apply`。

### 1.2 非目标（本期）

1. 不引入全局 `graphId` / `role` 字段；mindmap 现有 `graphId` 保留，sequence 不新增图 id。
2. 不承诺“任意人在编辑器里改一个节点就自动整理整图”；human 侧只保证选中/显式整理。
3. 不在 Hocuspocus 协作服务器里运行布局或文本度量。
4. 不做向量检索/RAG 文档；API 文档是封闭集合，用索引 + 精确查询。
5. 不做历史数据兼容/迁移（仓库当前无历史数据）。
6. 本期不实现 MCP server；typed MCP tools / resources 留到后续阶段。

> 注：`docs/sequence-diagram/README.md` 曾明确“不做语义化 DSL 或自动布局引擎”；本方案是对该范围的扩展，需在评审时确认。

---

## 2. 总体架构

```text
Agent tools ─> Canvas SDK (Node, 无 UI) ─> element / yjs 内核
                    ↑
浏览器编辑器 ───────┘（复用纯布局与文本 fit）

后续阶段（不在本期）：MCP server ─> Canvas SDK
```

- **Canvas SDK**：纯逻辑，负责 skeleton 归一化、文本度量、布局、校验、回执。
- **Agent tool**：`execute_code` 注入 SDK；`canvas_docs` 提供文档查询；`canvas_export` 提供 JSON/PNG/SVG。
- **浏览器编辑器**：复用同一个纯布局模块和文本 fit；人工编辑仍走本地提交。
- **协作服务器**：同步、持久化、鉴权、`validateScene`，不计算布局。
- **MCP**：本期不实现；后续只作为 SDK 的薄包装，不重复业务逻辑。

---

## 3. Agent tools

保持 4 个工具，避免工具面膨胀。

| 工具 | 作用 | 读写 | 说明 |
| --- | --- | --- | --- |
| `canvas_overview` | 返回一页规则 + 紧凑索引（guide 列表、shape id、layout 算法、错误码） | 只读 | 替代 `high_level_overview`；不返回全文文档 |
| `canvas_docs` | `{ action: "index" \| "read" \| "search", guide?, topic?, query? }` | 只读 | 替代 `collaboration_api_info` |
| `execute_code` | 在沙箱执行 JS，注入 Canvas SDK | 读/写 | 主力工具；返回 JSON，自动收集 apply/execute 回执 |
| `canvas_export` | 导出场景 JSON / SVG / PNG | 只读 | 供视觉反馈与交付 |

`canvas_overview` 返回内容建议：

- 画布基本约定：坐标、单位、z-order、label、auto/fixed；
- 文档索引：guide + topic 名称；
- 60 个 shape id 的紧凑列表（或分页）；
- layout 算法 id + 一句话说明；
- 错误/警告码分类；
- “不要手写 canonical JSON”“布局在创建时强触发”等硬规则。

---

## 4. MCP（本期不做）

本期只交付 Agent tool。MCP 作为后续阶段：

- 届时只做 schema 转换、鉴权、审批、限流、annotations、resources；
- 可以暴露 `execute_code`，也可以提供 typed tools，或两者并存；
- 全部调用同一个 Canvas SDK，不新增业务逻辑。

这样本期的验收面收敛在 Agent tool + SDK + 内核改造，不被 MCP 的传输、鉴权、审批分散。

---

## 5. execute_code SDK

```ts
// 只读
canvas.scene.get({ view?: "summary" | "full", ids?, region? })
canvas.scene.search({ query, types?, limit?, offset? })
canvas.scene.getElements(ids)
canvas.text.measure({ text, style })
canvas.text.fit({ text, style, maxWidth, maxHeight? })
canvas.docs.index({ kind? })
canvas.docs.read({ guide, topic?, includeExamples? })
canvas.docs.search({ query, kind? })
canvas.schema.get({ type })
canvas.validate({ ids?, checks? })

// 写入
canvas.apply({ idempotencyKey?, expectedVersions?, ops, dryRun? })
canvas.layout.apply({ ids, algorithm, origin, options?, scope?, dryRun? })
canvas.generate.diagram({ format: "mermaid" | "json", source | spec, origin?, layout? })
canvas.generate.sequence({ participants, messages, fragments, origin?, layout? })
canvas.generate.mindmap({ root, children, direction?, origin? })
canvas.generate.table({ columns, rows, maxWidth?, origin? })
canvas.generate.chart({ kind, data, series?, axes?, origin? })
canvas.export({ format: "json" | "svg" | "png", ids?, region?, scale? })
```

写操作返回统一结构：

```ts
{
  elements: Array<{ id, tempId?, bounds, label?, warnings? }>,
  bounds: { x, y, width, height },
  layoutToken?: string,
  warnings: Warning[],
}
```

---

## 6. 语义操作清单

`apply` 的 `ops` 按领域分组，统一 `op` 判别式。

| 领域 | 操作 | 关键参数 |
| --- | --- | --- |
| 通用元素 | `add` / `update` / `delete` / `move` / `resize` | skeleton、patch、expectedVersion |
| 连接线 | `connect` / `disconnect` / `reconnect` | from/to（id 或 tempId）、anchor、routing、label、arrowheads |
| 文本 | `addText` / `updateText` | text、style、autoResize、width |
| 图形 | `addShape` / `updateShape` | kind、geometry、label、style、shapeOptions |
| 脑图 | `addChild` / `addSibling` / `rename` / `move` / `reparent` / `deleteSubtree` | graphId、parentId、order |
| 时序图 | `addParticipant` / `removeParticipant` / `addMessage` / `updateMessage` / `removeMessage` / `addFragment` / `updateFragment` / `setMode` | participants、messages、fragments、mode |
| 表格 | `setCellText` / `insertRow` / `deleteRow` / `insertColumn` / `deleteColumn` / `mergeCells` / `splitCell` / `setCellStyle` | tableId、cellId、style |
| 布局 | `arrange` / `align` / `distribute` / `grid` / `stack` | ids、strategy、origin、options |
| 校验 | `checkOverlap` / `checkOverflow` / `checkBindings` / `checkDangling` | ids、scope |

统一规则：

- `add` 只收 skeleton，不收 `id/seed/index/version/versionNonce/updated`；
- 同批引用用 `tempId`，返回 `tempId → id` 映射；
- 写操作带 `expectedVersions` 或场景 revision；
- 所有失败整批回滚，不产生半张图。

### 6.1 skeleton 示例

```json
{
  "op": "addShape",
  "tempId": "svc",
  "type": "rectangle",
  "x": 0, "y": 0, "width": 160, "height": 80,
  "label": { "text": "订单服务", "fontSize": 20, "fit": "auto" }
}
```

服务端补：`id`、`seed`、`index`、版本、时间戳、默认样式、`texts.body`、最终 width/height。

### 6.2 常见纠正与 warnings

- `"circle"` → `"ellipse"`；
- `label: "文本"` → `{ text: "文本" }`；
- `fontFamily: "Virgil"` → 枚举值；
- 未知类型/字段/非法几何 → 报错并列出合法值，不猜。

warning 结构：

```json
{ "code": "input_corrected", "path": "ops[0].type", "from": "circle", "to": "ellipse" }
```

---

## 7. 布局能力

| 场景 | 算法 id | 引擎 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| 流程图 / DAG | `layered` | @dagrejs/dagre（MIT）或自研 | 新增 | 方向、层距、节点距、正交路由 |
| 脑图 / 组织树 | `tree` | 现有 `layoutMindmap` | 已有 | 继承 `graphId`，强触发重排 |
| 时序图 | `sequence` | 自研 | 新增 | participants、messages、activations、fragments |
| 表格 | `table` | 现有表格布局 | 已有 | 行高/列宽/合并 |
| 图表 | `chart` | 自研笛卡尔布局 | 新增 | 轴、网格、系列、图例 |
| 卡片 / 泳道 | `grid` / `stack` / `row` / `column` | 自研或 yoga-layout（MIT） | 新增 | 容器约束布局 |
| 对齐 / 分布 | `align` / `distribute` | 自研 | 新增 | 对已有元素操作 |
| 任意关系网 | `force` | d3-force（ISC） | 可选 | 非确定性较强，默认关闭 |
| 自由画布 | `none` | — | — | 只校验，不布局 |

统一参数：

```ts
{
  ids: string[],
  algorithm: string,
  origin: { x: number, y: number },
  options?: Record<string, unknown>,
  scope?: "ids" | "subtree" | "connected",
  dryRun?: boolean
}
```

返回：`elements`、`bounds`、`layoutToken`、`warnings`。

### 7.1 各领域重排策略

| 领域 | 单节点变更后 | 触发方式 |
| --- | --- | --- |
| mindmap | 强制整图重排 | `reflow: "graph"` / `layout.apply({ ids: graphIds, algorithm: "tree" })` |
| sequence | 条件重排 | 调用方传 `diagramRef.elementIds`；否则只做局部 fit |
| flowchart | 结构变更时重排 | 显式 `layout.apply` 或创建时布局 |
| 普通图形 | 只做 label fit | 不触发图布局 |
| table | 内部行高/列宽重算 | 已有 |

### 7.2 并发与一致性

- 只有发起语义变更的一方计算布局，并把坐标写入同一次事务；
- 远端客户端只应用，不重算；
- `expectedVersions` / 场景 revision 冲突时重读、重算、重试；
- 幂等键去重 Agent 重试；
- 字体、算法版本、seed 固定，保证浏览器与 Node 结果一致。

### 7.3 自研边界

判断标准：**领域特有、几何规则明确、没有合适库的 → 自研；通用算法、格式解析、光栅化、沙箱 → 用库**。自研不是零成本，要自己承担确定性、边界用例和回归测试。

| 能力 | 建议 | 理由 | 复杂度 |
| --- | --- | --- | --- |
| 时序图布局 | 自研 | 领域特有，没有现成库；已有 `sc-*` 几何、绑定、文本 fit | 中 |
| 表格布局 | 复用现有 | `tableStruct` / 行高 / 合并已有实现 | 低 |
| 图表几何 | 自研 | 轴、刻度、柱/线/饼都是纯数学 | 中低 |
| grid / stack / row / column | 自研 | 只需间距、对齐、换行子集，不需要完整 Flexbox | 低 |
| align / distribute | 自研 | 纯几何计算 | 低 |
| 树布局 | 复用 `layoutMindmap` | 已有 tidy tree、方向、间距 | 低 |
| 分层 DAG（layered） | @dagrejs/dagre | Sugiyama 的分层、交叉最小化、坐标分配不适合轻量自研 | 自研为高 |
| 正交避障路由 | 先复用现有 elbow；后续自研网格 A* | 小图可接受；大图/复杂障碍需要优化 | 中 |
| 力导向（force） | 本期不做；需要时用 d3-force（ISC） | 非核心布局，自研不划算 | 低（引入）/高（自研） |
| 文本度量 | 构建期用 opentype.js/fontkit 生成 metrics 表，运行时求和；需要像素级一致时用 @napi-rs/canvas | 运行时零字体库依赖；但 kerning/CJK fallback 要接受差异或改用 canvas | 中 |
| PNG 导出 | @napi-rs/canvas | PNG 编码与光栅化不适合自研 | 自研为高 |
| SVG 导出 | 复用现有 static SVG 渲染 | 已有 | 低 |
| 沙箱 | 轻量：worker_threads + `vm`；强隔离：QuickJS/WASM | 不自研 JS 引擎；`vm` 不是安全边界，要明确声明 | 自研为高 |
| Mermaid 解析 | 本期只收语义 JSON；后续用 @mermaid-js/parser | 全量语法/语义解析不适合自研 | 自研为高 |
| docs 生成 | 自研（TS Compiler API + registry + Zod） | 已有脚本可扩展 | 中低 |
| skeleton / 校验 / warnings | 自研 | 领域规则明确 | 低 |
| 确定性 PRNG | 自研 | 十几行代码，避免依赖 | 低 |

建议保留的第三方依赖：

- `@dagrejs/dagre`（MIT）：唯一的通用图布局引擎；
- `@napi-rs/canvas`（MIT + Skia BSD-3）：文本度量与 PNG；
- `quickjs-emscripten`（MIT）：需要强隔离时使用；
- 已有 `zod`、`typescript`、`prettier`；
- 可选：`d3-force`（ISC）、`@mermaid-js/parser`（MIT）、`yoga-layout`（MIT，仅完整 flex 场景）。

不建议自研：

- 通用 Sugiyama 分层布局（环、交叉最小化、端口、复合节点）；
- 字体解析/光栅化、PNG 编码；
- JS 引擎/安全沙箱；
- 完整 Mermaid 解析器。

---

## 8. 文档体系

### 8.1 数据源

| 数据源 | 生成内容 |
| --- | --- |
| TS 类型 + JSDoc | API 签名、参数、返回、字段说明 |
| Zod schema | JSON Schema、必填/可选、默认值、范围 |
| shape registry | 60 个 shape id、family、默认参数、选项范围、label 能力 |
| layout registry | 算法、版本、参数 schema、支持类型 |
| 常量/枚举 | 字体、字号、对齐、箭头、`TEXT_GAP`、`BOUND_TEXT_PADDING` |
| 错误/警告码 | code、分类、可否重试、修复建议 |
| 人工指南 | 决策建议、取舍、任务配方 |
| 可执行示例 | 编译并跑通的代码 + 预期结果 |

### 8.2 查询接口

```ts
canvas.docs.index({ kind?: "guide" | "type" | "shape" | "layout" | "error" })
canvas.docs.read({ guide, topic?, includeExamples? })
canvas.docs.search({ query, kind? })
```

规则：

- 首次只返回 topic 列表；
- 单次响应设字符上限（如 2–4k），超出返回摘要 + 钻取提示；
- `core` 主题读一次后可缓存；
- 响应带 `docsVersion`；
- 后续 MCP 阶段可把同一份数据暴露为 resources。

### 8.3 构建与校验

- `scripts/generate-docs.mjs`：TS Compiler API + registry introspection + Zod → 静态 `docs.generated/*.ts`；
- `docs:check`：产物过期、覆盖率、链接、示例可执行；
- 禁止在 docs 中出现 `versionNonce/seed/index` 等持久化内部字段；
- 人工指南只写“判断”，字段事实全部自动生成。

---

## 9. 除协作、agent tool 外还需改造的模块

| 模块 | 改造 |
| --- | --- |
| `packages/element` | 新增 `layout/`（layered/tree/sequence/grid/align）、`layoutSequenceScene`、语义操作 `applySequenceOperation`、`text.measure/fit` 公共 API、warnings 类型；保留 mindmap `graphId` |
| `packages/common` | 字体度量接口与常量；Node/Browser 共用度量约定 |
| `packages/yjs` | `execute` 增加 `sequence` / `layout` 域；`mutate` 对时序成员的几何/文本 patch 加守卫或 normalize；`expectedVersion` / 幂等 |
| `packages/yjs-hocuspocus-client` | headless session 注入字体度量；回执携带 warnings/layoutToken；不引入布局 |
| `packages/yjs-hocuspocus-server` | 仅保留同步/持久化/`validateScene`；不运行布局 |
| `packages/excalidraw` | 新增“自动布局 / 整理选中 / 整理时序图 / 对齐分布” action；文本 reflow 增加 `reflow: "diagram"` 分支；序列图可选客户端 layoutRef；导出 PNG/SVG |
| `packages/board-import` | 复用布局与真实字体度量；Lark 时序图导入接入 |
| 新增 `@excalidraw/layout`（或 element 子模块） | 算法 registry、引擎适配、确定性/worker 友好 |
| 文档管线 | `generate-docs`、`docs.generated`、guides、examples、CI |
| Node 基础设施 | 字体文件与构建期 metrics 表（opentype.js/fontkit，MIT）或 `@napi-rs/canvas`（MIT）度量；worker_threads；PNG/SVG 导出（`@napi-rs/canvas`，避免 MPL 的 resvg）；沙箱（轻量 worker_threads+`vm` / 强隔离 QuickJS/WASM）；超时/内存/元素配额；许可证扫描 |
| 测试 | 布局 golden/property 测试（幂等、无重叠、bounds）、浏览器/Node 一致性、字体一致性、Agent 集成 |
| 版本治理 | SDK/API 版本、`docsVersion`、`layoutVersion`、错误码稳定 |

### 9.1 第三方依赖与许可证策略

严格说没有“零风险”，落地方式是**白名单 + CI 扫描 + 保留 NOTICE**：

- 允许：MIT、ISC、BSD-2/3-Clause、Apache-2.0（保留 NOTICE）、0BSD、Unlicense、CC0（仅数据/字体）；
- 禁止：GPL/LGPL/AGPL、EPL、MPL、CDDL、SSPL、BUSL、Commons-Clause，以及许可证不明确的包；
- 新依赖必须固定版本、检查传递依赖、保留 LICENSE/NOTICE，并在 PR 中说明用途；
- CI 增加许可证扫描（如 `license-checker` / `yarn licenses list`），命中禁止清单直接失败；
- 字体单独审计：Excalifont/Nunito 等随包分发时附 OFL 许可证与版权声明；
- 原生/二进制依赖（canvas、QuickJS、WASM）额外确认来源与再分发许可。

| 用途 | 选型 | 许可证 | 结论 |
| --- | --- | --- | --- |
| 分层布局 | @dagrejs/dagre / 自研 | MIT | ✅ |
| 树布局 | 现有 `layoutMindmap` | 仓库自有 | ✅ |
| 力导向（可选） | 本期不做；需要时 d3-force | ISC | ✅ |
| 卡片/泳道 | 自研（简单 stack/grid）；完整 flex 时 yoga-layout | MIT | ✅ |
| 文本度量 | 构建期 metrics 表；像素级一致时 @napi-rs/canvas | MIT（Skia BSD-3） | ✅ |
| PNG 导出 | @napi-rs/canvas | MIT | ✅ |
| SVG 导出 | 仓库 static SVG 渲染 | 仓库自有 | ✅ |
| 沙箱 | 轻量 worker_threads+`vm`；强隔离 QuickJS/WASM | MIT / 内置 | ✅ |
| Mermaid 解析（后续） | 本期只收语义 JSON；后续 @mermaid-js/parser | MIT | ✅ |
| MCP SDK（后续） | @modelcontextprotocol/sdk | MIT | ✅ |
| 分层布局（候选） | elkjs | EPL-2.0 | ❌ |
| 图布局（候选） | Graphviz | EPL-1.0 | ❌ |
| PNG 导出（候选） | resvg-js | MPL-2.0 | ❌ |

---

## 10. 数据契约

- **skeleton**：只含语义字段；服务端生成 id/seed/index/版本。
- **tempId**：仅同批有效；返回映射；禁止悬空/成环。
- **layoutRef（客户端契约）**：`{ elementIds, algorithm, options, origin, layoutVersion, policy }`；由 Agent 会话或 `customData` 保存，不作为核心 schema。
- **回执**：`{ elements, bounds, layoutToken, warnings }`；`local_applied` 不代表远端持久化。
- **错误**：`{ code, message, details?, retryable?, hint? }`；warnings 不阻断提交。

---

## 11. 分阶段计划

### P0（基础能力）

- Canvas SDK 骨架：`scene/text/apply/layout/docs/export`；
- skeleton + tempId + 服务端身份生成；
- `text.measure/fit`；
- `layout.apply` 支持 `tree`（mindmap）与 `layered`（flowchart）；
- Agent tools 替换为 `canvas_overview/canvas_docs/execute_code/canvas_export`；
- `docs.index/read` + 自动生成管线；
- 验收：整图创建、节点更新、条件重排、文档查询、类型/测试通过。

### P1（语义图与生成）

- `sequence` 语义操作 + `layout.apply({ algorithm: "sequence" })`；
- `generate.diagram/sequence/mindmap/table`；
- warnings/纠正规则；
- 浏览器“整理选中/整理时序图/对齐分布” action；
- 验收：flowchart、sequence、mindmap、table 创建与重排；浏览器/Node 坐标一致。

### P2（生产化与扩展）

- 沙箱执行器与配额；
- PNG/SVG 导出与视觉反馈；
- chart/presentation/freeform；
- 验收：Agent 端到端、并发冲突重试、导出可用。

### 后续（不在本期）

- MCP server：transport、鉴权、审批、限流、annotations、resources；
- typed MCP tools 或 `execute_code` 两种形态二选一/并存；
- 全部复用本期的 Canvas SDK。

---

## 12. 风险与待决问题

1. **human 自动重排的边界**：没有全局 graphId，是否只做“选中后整理”？编辑器是否需要客户端 `layoutRef` 持久化？
2. **布局引擎选型**：只允许 MIT/ISC/BSD/Apache-2.0 等宽松许可；使用 @dagrejs/dagre（MIT）或自研，排除 elkjs（EPL-2.0）与 Graphviz（EPL-1.0）；关注包体积与 worker 化。
3. **sequence 跨会话成员发现**：Agent 会话丢失 ids 后，如何恢复？`customData.layoutRef` 是否可接受？
4. **字体一致性**：Node 端用 `@napi-rs/canvas`（MIT，含 Skia BSD）或 opentype.js/fontkit（MIT）；CJK fallback 与浏览器必须一致，并随包附带字体许可证（OFL 等）。
5. **PNG 导出**：优先 `@napi-rs/canvas`（MIT）；排除 resvg（MPL-2.0）；关注与浏览器渲染差异，必要时独立 headless worker。
6. **MCP 后续形态**：typed tools 还是 `execute_code`，或两者并存；本期不决策。
7. **兼容性**：现有 `high_level_overview` / `collaboration_api_info` 是否直接替换，还是保留别名过渡。
