# @excalidraw/yjs-hocuspocus-server

服务端契约仅返回画板专用 Hocuspocus hooks，不创建完整 Server。泛型注入已认证 actor、场景 schema/预算/关系政策、资产授权、transition 与 repository。授权应在异步操作后再次检查；origin 不承担远端身份。宿主负责 epoch fence、多实例锁、共享传播、WAL 与 snapshot 水位。

当前产物仅提供公开类型与构建骨架。`CreateCanvasHocuspocusHooks` 是函数签名类型，尚未导出运行时创建函数；包导入成功不代表协作运行时已经实现。旧 client 入口与历史存储不属于新包验收。

## 依赖与构建

消费方提供 `@excalidraw/yjs 0.1.0`、`@hocuspocus/server 4.6.0` 和唯一一份 `yjs 13.6.32`。本包与另一 Hocuspocus 包互不依赖，不引用应用或 docs-platform 的业务类型。Hocuspocus/Yjs/yjs 内核均保留为 external peer；纯类型声明不引入运行时 DOM、浏览器存储或 server 初始化。Yarn 1 不自动安装 peer，独立开发环境需先提供以上 peer。

先构建 `@excalidraw/yjs` 及其公开依赖，再在 vendor 根执行：

```sh
yarn workspace @excalidraw/yjs-hocuspocus-server lint
yarn workspace @excalidraw/yjs-hocuspocus-server typecheck
yarn workspace @excalidraw/yjs-hocuspocus-server test
yarn workspace @excalidraw/yjs-hocuspocus-server build
```

`development` → `dist/dev/index.js`；`production`/`default` → `dist/prod/index.js`；声明 → `dist/types/yjs-hocuspocus-server/src/index.d.ts`。TypeScript 消费公开依赖的声明，不通过内部源码 alias 构建应用。`test` 当前允许 `_tests_` 没有测试：类型声明按 P2 由 TypeScript 验证，运行时实现时加入真实 Y.Doc/Hocuspocus 测试并移除 `--passWithNoTests`。
