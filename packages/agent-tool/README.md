# @excalidraw/agent-tool

面向 Agent 的画布工具包：提供 4 个工具（`canvas_overview` / `canvas_docs` / `execute_code` / `canvas_export`），由宿主在服务端（Node）借用一次 Hocuspocus headless session 执行。`execute_code` 注入的 Canvas SDK 负责场景读取、语义写入、文本度量、布局、校验与文档查询；包内不建立连接、不做鉴权/审批，也不关闭 session。MCP 不在本期范围。

## 工具

| 工具 | 作用 | 读写 |
| --- | --- | --- |
| `canvas_overview` | 一页硬规则与索引：工具/读写边界、`apply`/`layout` 用法、guide 列表、60 个 shape id、9 个布局算法、错误码 | 只读 |
| `canvas_docs` | `{ action: "index" \| "read" \| "search", guide?, topic?, query?, kind?, limit? }` 按需查询文档 | 只读 |
| `execute_code` | 在宿主选择的执行器中运行 JS，注入 `canvas` SDK；返回 JSON 结果并收集写入回执 | 读/写（由 `mode` 决定） |
| `canvas_export` | 读取指定画板的完整 canonical 场景 JSON 快照 | 只读 |

`canvas_overview` 不接收参数；`canvas_docs` 的 `read` 不传 `topic` 时只返回该 guide 的 topic 列表。

## 快速示例

```ts
import { createCanvasExecuteCodeTool } from "@excalidraw/agent-tool";

const tool = createCanvasExecuteCodeTool({
  sessionFactory: () => session,
  executor: sandboxExecutor, // 可选，宿主提供的隔离执行器
});

await tool.execute({
  canvasId,
  mode: "write",
  code: `
    const r = await canvas.apply({ ops: [...] });
    await canvas.layout.apply({ ids: Object.values(r.tempIds), algorithm: "layered" });
    return r;
  `,
});
```

省略 `executor` 时使用包内的直接执行器：严格模式 `AsyncFunction` 调用本次执行构造的 SDK，不隔离全局、不限制内存、不中断同步循环；需要隔离时由宿主注入执行器。宿主可用 `createCanvasScriptTools(hooks)` 一次构造 4 个工具，它们共享同一个 `sessionFactory`。

`execute_code` 输入为 `{ canvasId, code, mode: "read" | "write" }`（严格 schema，拒绝额外字段）。宿主 hook：

- `sessionFactory(context)`：同步或异步返回已打开、已授权的 headless session；`context` 含校验后的 `canvasId`、`mode`、`code` 与独立 `signal`。
- `sdkFactory?(session, context)`：替换默认 `createCanvasSdk`。
- `executor?`：替换脚本执行器，接收 `code`、`canvas`、`signal`、`cancel`、`onError`，返回符合输出 schema 的 JSON 信封。
- `onError?(error, context)`：接收原始异常；输出只返回稳定错误码。

## `execute_code` 注入的 Canvas SDK

脚本中的 `canvas` 是冻结 facade，所有方法都返回 Promise：

| 方法 | 说明 |
| --- | --- |
| `scene.get({ view?, ids?, region? })` | `summary` 返回轻量摘要与 `total`；`full` 返回 canonical 快照 |
| `scene.search({ query, types?, limit?, offset? })` | 按文本/类型分页搜索未删除元素 |
| `scene.getElements(ids)` | 按 id 读取完整 canonical 元素，缺失即 `target_not_found` |
| `text.measure({ text, style? })` | 返回宽高、行高与行数；Node 端自动安装确定性度量 |
| `text.fit({ text, style?, maxWidth, maxHeight? })` | 换行并返回是否截断 |
| `apply({ ops, expectedVersions?, dryRun?, idempotencyKey? })` | 语义操作批，返回写回执 |
| `layout.apply({ ids, algorithm, origin?, options?, dryRun? })` | 对已有 id 计算并提交布局 |
| `validate({ ids?, checks? })` | `overlap` / `overflow` / `bindings` / `dangling` 结构校验 |
| `schema.get({ type })` | 返回 `apply`/`layout`/`text`/`validate`/`scene`/`export` 的 JSON Schema |
| `export({ format?, ids?, region? })` | 仅支持 JSON 快照 |
| `docs.index({ kind? })` | guide/topic 索引 |
| `docs.read({ guide, topic?, includeExamples? })` | 读取 guide 或单个 topic |
| `docs.search({ query, kind?, limit? })` | 标题/摘要/正文搜索 |

## `apply` 语义

- `ops` 只收语义 skeleton：`addShape` / `addText` / `updateShape` / `updateText` / `connect` / `updateConnector` / `delete` / `move` / `resize` / `mindmap` / `table` / `sequence` / `layout`。`id`、`seed`、`index`、版本与时间戳由服务端生成。
- 同批引用用 `tempId`，回执 `tempIds` 给出 `tempId → id` 映射；连线端点也接受 `{ point }`。
- 确定性的输入纠正（如 `"circle"` → `"ellipse"`、字符串 label → `{ text }`、字体名 → 枚举）会产生 `input_corrected` warning，不阻断提交。
- 任一操作失败整批回滚，不产生半张图；`dryRun: true` 只计算不提交。
- `expectedVersions` 做乐观并发保护，冲突报 `version_conflict`；`idempotencyKey` 让重试返回同一回执。
- 写入要求 `mode: "write"` 且会话可编辑，否则报 `not_editable`。

## `layout.apply`

- 算法：`layered`、`tree`、`sequence`、`grid`、`row`、`column`、`stack`、`align`、`distribute`。
- 参数：`{ ids, algorithm, origin?, options?, dryRun? }`；`options` 支持 `direction`（`TB`/`LR`）、`rankGap`、`nodeGap`、`gap`、`columns`、`axis`、`position`。
- 也可在 `apply` 的 `ops` 末尾加 `{ op: "layout", algorithm }`，在同一次事务内布局本批新建元素；不传 `ids` 时作用于本批创建的非连线元素。
- 返回 `elements`、`bounds`、`warnings`、`affectedElementIds`、`layoutToken`。
- 布局由**发起写入的一方**计算并随同一次事务提交；协作服务器不布局，远端只应用结果。

## 时序图语义

`op: "sequence"` 提供参与者、消息、激活条与组合片段的增量操作：

| action | 参数 | 说明 |
| --- | --- | --- |
| `addParticipant` | `kind`、`x`、`y`、`label?`、`width?`、`height?` | 创建 8 种生命线之一；省略尺寸时使用头部 + 默认杆长 |
| `removeParticipant` | `participantId` | 级联删除其激活条与消息 |
| `addMessage` | `from`、`to`、`y?`、`order?`、`label?` | 自动复用/创建两端激活条并绑定；同一参与者生成自消息 |
| `updateMessage` / `removeMessage` | `messageId`、`label?` | 修改标签或删除消息 |
| `addFragment` | `x`、`y`、`operator?`、`width?`、`height?` | 创建组合片段并初始化页签行 + 正文行 |
| `updateFragment` | `fragmentId`、`operator?`、`insertRowAt?`、`deleteRowId?` | 改页签或增删正文行，元素高度同步 |

`sequence` 布局把参与者按当前 x 排列、顶部对齐，消息按当前 y 顺序逐行排布：

- `gap`：参与者头部间距，默认 160；
- `nodeGap`：最高头部下方到首条消息的距离，默认 80；
- `rankGap`：消息行距，默认 56；
- 生命线高度自动增长覆盖消息，激活条随消息行调整，组合片段扩展到覆盖原有生命线与消息。

## 文档体系

- 9 个 guide、27 个 topic：`core` / `shapes` / `connectors` / `mindmap` / `sequence` / `layout` / `document` / `errors` / `examples`。
- `canvas_docs` 与 `canvas.docs` 共用同一份数据：`index` / `read` / `search`。
- 单次 `read` 上限约 4000 字符，超出返回摘要 + 钻取提示并标记 `truncated`；响应带 `docsVersion` 用于判断缓存是否过期。
- API 签名由 `scripts/generate-api-docs.mjs` 用 TypeScript Compiler API 从 `CanvasSdk` 自动生成到 `src/api-documentation.generated.ts`（13 个成员）；shape/layout/error 清单从代码常量派生，人工 guide 只写判断与任务配方。
- `yarn docs:generate` 重新生成；`yarn docs:check` 校验产物是否过期（build 也会自动生成）。

## 回执与错误

写入回执：

```ts
{
  elements: Array<{ id, tempId?, type, kind?, bounds, label? }>,
  bounds,            // 回执可见元素的并集包围盒
  warnings,          // 非阻断纠正与布局提示
  changedElementIds, // 变更 id 分类
  createdElementIds,
  deletedElementIds,
  tempIds,           // tempId → id
  references,        // 各操作的领域引用
}
```

`execute_code` 成功时返回 `{ ok: true, status, result, receipts }`；`status: "local_applied"` 仅表示本地事务提交成功，不代表远端客户端已同步或服务端已持久化。`layout.apply` 回执另含 `affectedElementIds` 与 `layoutToken`。

失败时返回 `{ ok: false, error: { code, message, details?, retryable?, hint? }, receipts? }`：`details` 可含 `issues`、`legalValues`、`availableGuides/availableTopics` 等可操作信息；失败前已提交的调用仍会出现在 `receipts` 中。

## 宿主职责与边界

- 连接、鉴权、审批、超时、取消与配额由宿主负责；`signal` 为合作取消，异步 SDK 调用在取消后必须停止提交。
- 会话生命周期不在包内：工具工厂只借用 session，不调用 `close`，宿主需自行释放。
- 本期未提供：`generate.*`、SVG/PNG 导出、MCP server。

## 开发

在本目录运行 `yarn test`、`yarn typecheck`、`yarn lint`、`yarn docs:check`；`yarn build` 会先生成 API 文档再构建 ESM 与声明产物。
