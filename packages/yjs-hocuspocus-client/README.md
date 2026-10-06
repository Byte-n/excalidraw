# @excalidraw/yjs-hocuspocus-client

客户端契约冻结 token provider、room、本地 session、连接和权限状态、取消、首次同步、错误以及 owned/borrowed 生命周期。浏览器 controller 类型兼容 Excalidraw 单 collaboration prop；Node session 无 editor attach。宿主注入 presence、资源 transport、场景校验与持久化，不固定 API URL、存储和业务 room 格式。

当前产物仅提供公开类型与构建骨架。`CreateHocuspocusHeadlessSession` 是函数签名类型，尚未导出运行时创建函数；包导入成功不代表协作运行时已经实现。旧 client 入口与历史存储不属于新包验收。

## 依赖与构建

消费方提供 `@excalidraw/yjs 0.1.0`、`@hocuspocus/provider 4.6.0` 和唯一一份 `yjs 13.6.32`。本包与另一 Hocuspocus 包互不依赖，不引用应用或 docs-platform 的业务类型。Hocuspocus/Yjs/yjs 内核均保留为 external peer；纯类型声明不引入运行时 DOM、浏览器存储或 server 初始化。Yarn 1 不自动安装 peer，独立开发环境需先提供以上 peer。

先构建 `@excalidraw/yjs` 及其公开依赖，再在 vendor 根执行：

```sh
yarn workspace @excalidraw/yjs-hocuspocus-client lint
yarn workspace @excalidraw/yjs-hocuspocus-client typecheck
yarn workspace @excalidraw/yjs-hocuspocus-client test
yarn workspace @excalidraw/yjs-hocuspocus-client build
```

`development` → `dist/dev/index.js`；`production`/`default` → `dist/prod/index.js`；声明 → `dist/types/yjs-hocuspocus-client/src/index.d.ts`。TypeScript 消费公开依赖的声明，不通过内部源码 alias 构建应用。`test` 当前允许 `_tests_` 没有测试：类型声明按 P2 由 TypeScript 验证，运行时实现时加入真实 Y.Doc/Hocuspocus 测试并移除 `--passWithNoTests`。
