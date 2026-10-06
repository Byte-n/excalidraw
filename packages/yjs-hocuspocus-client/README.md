# @excalidraw/yjs-hocuspocus-client

`createHocuspocusHeadlessSession()` 让浏览器或 Node 作为普通 Hocuspocus 协作者进入宿主指定的画板 room。`createExcalidrawHocuspocusCollaboration()` 组合该 session 与 yjs editor controller，返回可直接传给 `<Excalidraw collaboration={collaboration} />` 的对象；session owns provider/连接与状态，yjs 负责 editor 场景绑定。Node/headless 路径不 attach editor，不初始化 DOM、IndexedDB 或浏览器存储。

## 宿主注入与生命周期

宿主提供 `url`、完整 `room`、`token({room,signal})`、`validateScene`，可注入 `WebSocketPolyfill`、`persistence`、`prepare`、`presence` factory、资源 transport 和业务 stateless 解析。包不解释 API URL、epoch、replica、权限业务字段或恢复策略。副本 `load` 完成后执行 `prepare({document,provider,signal})`，再启动连接；这些异步适配必须遵循 signal，迟到完成不会复活已关闭连接。首次同步默认超时 30 秒，可通过 `syncTimeoutMs` 调整。

默认创建 owned Doc、provider/socket；借用 Doc 时仍拥有自己创建的 provider/socket；显式借用 provider 时要求其 document 和 room 匹配，释放仅移除 session 自身监听。已认证且已同步的 borrowed provider 直接 ready，不重新连接。borrowed provider 的 token 与 socket 配置仍由原拥有者管理。注入 persistence 为会话专用适配，由 session 调用 close；presence 通道由 browser controller 释放，不能自行销毁共享 provider。

`ready` 表示首次远端同步和场景校验完成，连接/权限状态可通过 `getState`、`subscribe` 观察。断线重连复用同一 Doc/provider，重新认证和同步后解除写入门控。`setPermission` 提供宿主附加权限 gate，不能提升 server 已声明的 readonly scope。`refreshToken` 续签使用同一 provider；token 可返回字符串或 `{token,expiresAtMs}`，后者提前 30 秒自动续签。Hocuspocus onTokenSync 不会自动发送新 authenticated scope，宿主服务必须显式通过原生协议回传；业务 stateless 推送可由宿主解析后设置 gate。

`onAuthenticationFailed(reason)` 可按宿主策略选择 retry/reject/close（默认 close）。`reject(error)` 立即门控并停止 owned 网络发送，保留副本等待宿主恢复。宿主调用 `close({preserve(document)})` 时先停 socket、destroy provider，再停止 persistence、执行副本隔离回调，最后销毁 owned Doc；不得将旧被拒场景重新发回同一权威 room。browser controller 关闭后由宿主创建新 controller/Doc，重置 editor、撤销和异步资源代际；包不伪造原地 Yjs 清空恢复。`close` 幂等，`dispose` 触发同一关闭流程。

`applyCommand` 接受公开快照/import 命令，`mutate` 复用 yjs add/update/delete/connect 命令内核。一次本地发布仅产生一次 Yjs update。ready、发送完成和 unsyncedChanges 清零都不代表具体工具写入 ACK；断线有未同步本地更新时 `onError` 提供 `outcome: "unknown"`。本包不实现 AgentTool。

## 依赖与验证

消费方提供 `@excalidraw/yjs 0.1.0`、`@hocuspocus/provider 4.6.0` 和唯一一份 `yjs 13.6.32`。client 不依赖 server 包或应用业务类型；Hocuspocus/Yjs/yjs 内核为 external peer，Yarn 1 开发环境需提供 peer。生产不依赖 Node ws，Node 宿主显式注入其 WebSocket 实现。真实测试开发依赖为 Hocuspocus server、ws 与其类型；正式安装与 lock 验收按 vendor workspace 完成。

先构建 yjs 及其公开依赖，在 vendor 根运行：

```sh
yarn workspace @excalidraw/yjs-hocuspocus-client lint
yarn workspace @excalidraw/yjs-hocuspocus-client typecheck
yarn workspace @excalidraw/yjs-hocuspocus-client build
yarn workspace @excalidraw/yjs-hocuspocus-client test
```

`development` → `dist/dev/index.js`；`production`/`default` → `dist/prod/index.js`；声明 → `dist/types/yjs-hocuspocus-client/src/index.d.ts`。TypeScript 消费公开声明，不使用内部源码 alias。独立 Node Vitest 配置启动真实内存 Hocuspocus 与 ws，覆盖同步、收敛、拒绝、重连、权限、续签、取消、资源所有权与拒绝副本隔离；三种公开入口在没有 window/navigator/IndexedDB 的子进程导入。
