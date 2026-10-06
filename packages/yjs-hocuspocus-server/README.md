# @excalidraw/yjs-hocuspocus-server

`createCanvasHocuspocusHooks(options)` 提供画板专用 Hocuspocus hooks adapter，不创建或拥有 Server，也不承载其他 room 的业务。宿主按 room 分流 hooks，保留认证、权限、epoch、共享传播、数据库、日志与关闭流程。

## 权威接纳

锁定 Hocuspocus 4.6.0 的真实顺序为 `beforeHandleMessage` 获取本进程 room 临界区，`beforeSync` 将 update 应用于 shadow candidate，完成通用不变量、宿主 schema/预算、transition、资产授权和异步操作后再次授权校验，然后返回。Hocuspocus 的 `readUpdate/readSyncStep2` 唯一应用权威文档、广播并触发 `onChange`；adapter 不在 `beforeSync` 额外 apply。`afterHandleMessage` 即使同步校验拒绝也由框架 finally 调用，释放临界区；`beforeHandleMessage` 自身失败自行释放。

通用根默认仅允许 elements/assets Map，`extraRootMaps` 显式扩展 Map 名称；不允许未知根、列表型根或嵌套元素/资产共享类型。通用数据、key/id、元素身份/版本/有限几何、完整墓碑、资产不可删除/改绑始终由包检查。缺失依赖的 Yjs 更新拒绝，不能将未验证的潜在状态留在权威文档。既有关系仍是软关系，不添加全场景双向关系硬约束；宿主可通过 transition 提供自身政策。

宿主注入 `validateDocument` 校验额外 metadata（例如 schema 版本）、`validator.validateScene` 校验场景 schema/预算，以及 `validateTransition`、`authorizeAssets` 与 `authorize`。`readScene` 可提供宿主公开结构读取；通用根/身份检查仍先运行，不因回调绕过。同步 scene/document validator 必须返回 undefined；授权和 transition 可异步。远端 actor 来自已认证 connection，Yjs origin 不携带认证身份。`onRejected` 可等待宿主原子拒绝登记后再抛出；`mapError` 转换到宿主 hook 错误，默认 `CanvasHookError` 提供稳定 reason/code，原始业务错误供宿主诊断。

## 持久化与卸载

`onChange` 同步复制 update 入本进程 WAL 队列，保留 sequence 和本地/远端 origin。框架不等待 onChange，异步 `onAccepted` 失败由 `onError` 唯一报告，不把异步落盘当作接纳 barrier。`flushIntervalMs` 可注入空闲刷新定时器；宿主也可主动调用 `flush(room)`。

repository 提供 load/append/snapshot/release；无数据库表名或业务类型依赖。append 失败保留整批并允许重试，等待期间新 update 保留在下一批。snapshot 在临界区捕获完整 update 与 `throughSequence`，flush 成功后提交；宿主只能压缩已包含的增量，不删除之后的 WAL。repository 必须原子检查 room fence；包的 `invalidate(room)` 停止旧 epoch 新接纳/落盘并丢弃其待写队列，不能阻止已经在途的外部写入，后者由 repository 的 fence 守卫拒绝。

`beforeUnloadDocument` 只 flush：框架等待期间可能出现新连接并取消卸载。实际文档卸载后 `afterUnloadDocument` 才 release repository 并删除 room 状态；release/flush 失败保留队列和状态供重试。主动 `release(room)` 用于宿主确认结束的生命周期，之后不继续使用该 room 实例。持久化错误通过 onError 报告，同时保留 Promise rejection 给宿主处理。

临界区只保证本进程。Hocuspocus Redis 无 connection 的共享 update 绕过 beforeSync；宿主必须保证传播来源已接纳、epoch 隔离和多实例锁，不能用本包或单进程测试声称分布式一致性。宿主直接写权威 Doc 也承担先校验责任；本包不接管既有共享通道。

## 依赖与验证

运行时 peer 为 `@excalidraw/yjs 0.1.0`、`@hocuspocus/server 4.6.0` 和唯一一份 `yjs 13.6.32`，不依赖 client 包或应用。测试开发依赖为 Hocuspocus provider、ws 与其类型；生产包不创建客户端。先构建 yjs，vendor 根运行：

```sh
yarn workspace @excalidraw/yjs-hocuspocus-server lint
yarn workspace @excalidraw/yjs-hocuspocus-server typecheck
yarn workspace @excalidraw/yjs-hocuspocus-server build
yarn workspace @excalidraw/yjs-hocuspocus-server test
```

development → dist/dev/index.js，production/default → dist/prod/index.js，声明 → dist/types/yjs-hocuspocus-server/src/index.d.ts。独立 Node Vitest 配置使用真实内存 Server/provider，验证唯一 apply/广播/WAL、非法更新权威不变、权限竞态、并发、awareness、持久化失败/水位/epoch与真实卸载；三条件公开入口无浏览器环境可导入。正式 workspace 依赖/lock 与宿主去重验收按整体构建完成。
