# @excalidraw/agent-tool

提供画板脚本说明、执行与导出工具。连接、鉴权、审批和 session 生命周期由宿主维护；本包根据每次执行借用的 Hocuspocus headless session 构造 Collaboration，不依赖 Node 或任何沙箱实现。

```ts
const tool = createCanvasExecuteCodeTool({
  sessionFactory: () => session,
  executor: sandboxExecutor, // 可选，由宿主提供
  onError: (error, context) => reportExecutionError(error, context.canvasId),
});
await tool.execute({ canvasId, code: "return await collaboration.getScene();", mode: "read" }, { signal });
```

省略 `executor` 时，内部使用严格模式 AsyncFunction 直接执行代码并调用本次执行构造的协作对象；这是直接执行，不隔离全局、限制内存或强制中断同步循环。执行器接收 code、collaboration、signal、cancel 与错误回调，返回符合 ScriptOutputSchema 的 JSON 信封；需要隔离时由宿主显式注入执行器。

`sessionFactory(context)` 可同步或异步返回已打开、已授权的 `HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>`。宿主在创建 headless session 时注入 canonical 场景校验，session 的 `getSceneSnapshot()` 在内部检查 JSON 数据并校验原始和复制后的完整场景，不应用 schema transform 的显示投影。默认 `createCanvasCollaboration` 复核同步、generation、实时编辑权限与 mode，调用公开场景命令内核；新增元素复制为 JSON 数据后，由 binding 在事务前校验完整候选场景。`query` / `createElement` 当前返回 `unsupported_collaboration_method`。可选 `collaborationFactory(session, context)` 用于测试或特殊适配，不转移连接和生命周期职责。

新增元素输入必须是完整 JSON 数据，拒绝 undefined、访问器和非枚举字段，不静默删除非法属性；读取快照仍允许业务 schema 认可的可选字段缺省。

工厂 context 包含校验后的 canvasId、mode、code 与独立执行 signal。结束释放该作用域；异步协作能力必须合作响应取消，禁止取消后提交。默认执行器收敛已开始的调用并登记 mutate/execute 真实回执，协作方法失败则整个执行失败，保留此前回执；onError 接收原始异常，输出只返回稳定错误。默认执行器校验完整 JSON，拒绝循环、getter、非普通对象、undefined 字段及稀疏数组。

`createCanvasExportTool({ sessionFactory })` 通过已校验的 canvasId 和可选 signal 借用会话，在包内检查取消、同步和 generation，与脚本读取共用 session.getSceneSnapshot() 的 canonical 校验与复制能力，生成完整场景 JSON 信封。导出不执行脚本，也不依赖 executor。

`createCanvasScriptTools` 接收共用的 sessionFactory 和可选执行 hooks，构造四个工具；其 sessionFactory 同时接收脚本执行或导出上下文。生命周期始终属于宿主：工具工厂借用会话且不调用 close，宿主必须在 finally 中调用 session.close() 释放资源。

在本目录运行 `yarn build`、`yarn lint`、`yarn typecheck`、`yarn test`。build 生成既有 development/production/default ESM 与声明产物；本包不构建或携带 Worker。
