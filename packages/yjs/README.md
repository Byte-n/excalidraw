# @excalidraw/yjs

宿主无关的 Yjs 场景绑定与协作内核。基础 Excalidraw 不依赖 Yjs；本包不创建 provider、房间、认证或持久化服务，不依赖应用、业务 shared、HTTP client、Hocuspocus 或 IndexedDB。

## 消费与实例

通过 `@excalidraw/yjs` 公共入口消费运行时和类型，不引用 `src`、未导出的内部路径或应用实现。公共主入口 `createExcalidrawCollaboration` 创建可直接传给 `<Excalidraw collaboration={collaboration} />` 的会话；公共能力还包括基础场景绑定、会话、资源协调、跟随图与节流工具，以及 `orderExcalidrawSceneElements` / `projectExcalidrawDisplayElements` 的确定性显示投影。投影保留完整业务字段，关系解除和重复索引修复只作用于显示副本，不写文档。

统一入口接收宿主 `document`、`presence`、`assets`、`state`、`validateScene` 与 `onError`。Presence 通道提供 `sessionId`、`publish`、`subscribe`、`dispose`；远端会话身份由宿主校验并携带名称与颜色。资源 transport 提供上传、授权、下载，内部协调器由会话拥有。React 宿主按 Y.Doc 在 effect 中创建并清理实例，避免 StrictMode 废弃 render 遗留文档监听。实例在权限与连接变化时保持稳定；新文档绑定清空 editor 的旧撤销历史。宿主通过 `updateState` 更新编辑权限、首次同步、连接呈现与网络状态；通过命令、导入准备和快照方法对接业务操作。`prepareImportCommand().commit()` 自行完成原子发布、目标 overlay 清理和 editor 回灌，调用者无需额外刷新。

组合连接 session 时可注入 `borrowedBinding`：controller 校验其 document 身份并订阅 `subscribeRemoteSceneChange`，不创建第二份 binding，不写共享 gate，也不负责最终 dispose。binding 拥有者管理初始化、同步、权限和代际，controller 另行校验 editor 就绪与显示状态；controller 关闭只释放自己的场景订阅、display 与 editor 监听，随后连接 session 释放 binding。

内部场景控制器处理 canonical/display 双基线、显示版本水位、相对几何变化、局部重排、交互保护、初始化门控、资源 overlay 和显式命令。它通过宿主业务接纳 callback 校验完整候选场景，不消费宿主的排序、投影或变化识别算法。

```ts
import * as Y from "yjs";
import { createYjsSceneBinding } from "@excalidraw/yjs";

const doc = new Y.Doc();
const binding = createYjsSceneBinding<{ id: string; text: string }>({ doc });
binding.transact([{ id: "text", text: "宿主元素" }]);
binding.dispose();
```

editor 解绑仅清除指针/选区/跟随、计时器、DOM 监听与在途资源，支持 StrictMode 和重新挂载；会话 `dispose` 才释放宿主为本会话创建的 Presence 通道。通道不应直接销毁共享 provider。绑定释放不销毁宿主 doc，宿主在自身会话结束时管理 doc/provider 生命周期。基础绑定提供整对象事务写入；显式场景命令及 editor 撤销边界由下述命令内核与 controller 提供。

`yjs` 为 peer `^13.6.0`，开发与当前 Web 均锁定 `13.6.32`。core peer 为 `@excalidraw/excalidraw ^0.18.0`。公开入口可在 Node 中导入和使用基础绑定；editor attach 时才动态加载公开 core 根入口。加载期间只读，保留首次非 loading 初始化信号；迟到加载受绑定代际保护，失败通过 `onError(error, "restore")` 报告。包构建保持 `yjs` 和 core 根入口 external；场景内核仅调用 core 公开 restore 与 capture 能力，不打包第二份 editor/React。宿主必须提供一份运行时 Yjs，Vite 链接开发需在 `resolve.dedupe` 中包含 `yjs`，否则 Yarn 与 pnpm 各自的物理安装可能产生不同构造器。docs-platform Web 与 collaboration 通过本地 `file:` 依赖安装公开产物，使 Yjs/client/server 与宿主 provider 使用 pnpm peer 图中的同一 Yjs；Web 另保留 Vite 去重。vendor 独立 Yarn 安装用于包构建和测试，不承诺任意跨独立工程的直接 Node 导入天然去重。修改包后须重新构建并刷新宿主安装产物；docs-platform 根目录的 `pnpm vendor:build` 完成此顺序。

## 产物与命令

在 vendor 根目录执行以下命令，不自行下载第三方资源：

| 命令 | 说明 |
| --- | --- |
| `yarn --cwd packages/yjs build:esm` | 构建 dev/prod ESM 与声明；先准备公开 core peer 产物 |
| `yarn --cwd packages/yjs gen:types` | 清理并重新生成 `dist/types` 声明 |
| `yarn --cwd packages/yjs typecheck` | source 与 `_tests_` TypeScript 严格检查 |
| `yarn --cwd packages/yjs lint` | source 与测试 ESLint，禁止 warning |
| `yarn --cwd packages/yjs test` | 真实 Y.Doc 与公开包入口测试，先构建产物 |
| `yarn build:packages` | common → fractional-indexing → laser-pointer → math → element → excalidraw → yjs → yjs-hocuspocus-client → yjs-hocuspocus-server |

运行时 `development` 条件解析到 `dist/dev/index.js`；`production` 和默认解析到 `dist/prod/index.js`；类型解析到 `dist/types/yjs/src/index.d.ts`。发布文件限定 `dist/*`，不依赖源码 alias。从仓库根运行 `pnpm --dir apps/web test:canvas-package` 验证三种条件导出、产物依赖边界及实际 Web 构建中的单一 Yjs；Web `typecheck` 的消费者直接读取 exports 指向的声明。

## Node 场景命令能力边界

锁定的 `@excalidraw/element 0.18.0` 公开根入口可在无 DOM 的 Node 中导入。公开 `newElement`、`newTextElement`、`newArrowElement` 支持 headless factory；文字需要宿主通过公开 `setCustomTextMetricsProvider` 注入度量。`calculateFixedPointForNonElbowArrowBinding` 和 `calculateFixedPointForElbowArrowBinding` 可用元素 Map 计算连接几何。高层 `convertToExcalidrawElements` 及 `bindBindingElement` 依赖 Scene/DOM，不能用于 headless 命令路径；core 根 Node 导入当前也受 roughjs 扩展名解析限制。场景命令使用公开 element factory/纯几何，在完整候选场景内同步维护反向关系，不扩展 core 或将软关系升级成全场景硬约束。

Hocuspocus 会话与 hooks 契约分别位于 `@excalidraw/yjs-hocuspocus-client` 和 `@excalidraw/yjs-hocuspocus-server`，均锁定 Hocuspocus `4.6.0` 与 Yjs `13.6.32` peer；本包继续不依赖 Hocuspocus。通用场景结构和算法与宿主 schema、预算、资产授权及 epoch/replica 政策保持分离。

## Headless 场景命令

`createExcalidrawSceneCommands({ binding, validateScene })` 在可写绑定上运行批量 `add`、`update`、`delete`、`connect`。先克隆完整 canonical 场景、计算候选、检查目标和 `expectedVersion`、元素身份与有限几何、宿主同步校验及资产不可改绑，再一次无异步事务发布。同步校验返回 `undefined`，不得返回 Promise；失败不会改变 Y.Doc 或其 state vector。`update` 由内核生成版本、nonce 与时间，不允许覆盖身份、类型和关系字段；删除保留完整墓碑。返回 ID 仅表示本地发布，不代表远端写入接纳 ACK。

`connect` 接收 line/arrow 的 start/end `{ elementId, fixedPoint, mode }`，同批修订连接线与两端 `boundElements`，重连时移除该连接线的旧反向引用；不对不相关 canonical 软关系追加全场景硬约束，显示投影仍不回写。关系指向已删除/不存在的目标会在事务前拒绝。`createSceneConnectionEndpoint` 用公开 element 几何计算 arrow/elbow 的 fixedPoint；line 可由宿主提供显式 endpoint。

`createSceneElement`、`createSceneTextElement`、`createSceneLineElement`、`createSceneArrowElement` 使用锁定 element 公开 factory 生成完整元素和身份，填入合法 fractional index；矩形等基本图形在当前版本规范化为 `composite_shape`。多个图形默认同索引允许并发，canonical 顺序仍由 index 和 ID 确定；需要指定位置时由宿主提供公开 factory 的 index。文字度量通过 `setCustomTextMetricsProvider` 显式注入，此 provider 是 element 的进程级配置，宿主应在创建文字前统一初始化。Node 测试直接导入三种条件公开产物，无 DOM、IndexedDB 或 editor attach，并验证单份 Yjs 与一批一次 update。

common 公开产物的模块级平台检测已提供无 navigator/window/document 的 Node 守卫；无浏览器环境的平台标志为 false。严格 Node 工厂回归在移除 navigator 后动态导入公开入口，避免 Node 内置 navigator 掩盖初始化依赖。
