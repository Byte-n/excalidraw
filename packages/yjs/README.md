# @excalidraw/yjs

宿主无关的 Yjs 场景绑定与协作内核。基础 Excalidraw 不依赖 Yjs；本包不创建 provider、房间、认证或持久化服务，不依赖应用、业务 shared、HTTP client、Hocuspocus 或 IndexedDB。

## 消费与实例

通过 `@excalidraw/yjs` 公共入口消费运行时和类型，不引用 `src`、未导出的内部路径或应用实现。公共主入口 `createExcalidrawCollaboration` 创建可直接传给 `<Excalidraw collaboration={collaboration} />` 的会话；公共能力还包括基础场景绑定、会话、资源协调、跟随图与节流工具，以及 `orderExcalidrawSceneElements` / `projectExcalidrawDisplayElements` 的确定性显示投影。投影保留完整业务字段，关系解除和重复索引修复只作用于显示副本，不写文档。

统一入口接收宿主 `document`、`presence`、`assets`、`state`、`validateScene` 与 `onError`。Presence 通道提供 `sessionId`、`publish`、`subscribe`、`dispose`；远端会话身份由宿主校验并携带名称与颜色。资源 transport 提供上传、授权、下载，内部协调器由会话拥有。React 宿主按 Y.Doc 在 effect 中创建并清理实例，避免 StrictMode 废弃 render 遗留文档监听。实例在权限与连接变化时保持稳定；新文档绑定清空 editor 的旧撤销历史。宿主通过 `updateState` 更新编辑权限、首次同步、连接呈现与网络状态；通过命令、导入准备和快照方法对接业务操作。`prepareImportCommand().commit()` 自行完成原子发布、目标 overlay 清理和 editor 回灌，调用者无需额外刷新。

内部场景控制器处理 canonical/display 双基线、显示版本水位、相对几何变化、局部重排、交互保护、初始化门控、资源 overlay 和显式命令。它通过宿主业务接纳 callback 校验完整候选场景，不消费宿主的排序、投影或变化识别算法。

```ts
import * as Y from "yjs";
import { createYjsSceneBinding } from "@excalidraw/yjs";

const doc = new Y.Doc();
const binding = createYjsSceneBinding<{ id: string; text: string }>({ doc });
binding.transact([{ id: "text", text: "宿主元素" }]);
binding.dispose();
```

editor 解绑仅清除指针/选区/跟随、计时器、DOM 监听与在途资源，支持 StrictMode 和重新挂载；会话 `dispose` 才释放宿主为本会话创建的 Presence 通道。通道不应直接销毁共享 provider。绑定释放不销毁宿主 doc，宿主在自身会话结束时管理 doc/provider 生命周期。此基础快照接口不代表完整增量/撤销/命令契约已实现。

`yjs` 为 peer `^13.6.0`，开发与当前 Web 均锁定 `13.6.32`。core peer 为 `@excalidraw/excalidraw ^0.18.0`。公开入口可在 Node 中导入和使用基础绑定；editor attach 时才动态加载公开 core 根入口。加载期间只读，保留首次非 loading 初始化信号；迟到加载受绑定代际保护，失败通过 `onError(error, "restore")` 报告。包构建保持 `yjs` 和 core 根入口 external；场景内核仅调用 core 公开 restore 与 capture 能力，不打包第二份 editor/React。宿主必须提供一份运行时 Yjs，Vite 链接开发需在 `resolve.dedupe` 中包含 `yjs`，否则 Yarn 与 pnpm 各自的物理安装可能产生不同构造器。当前 Web 的真实构建验证两侧 peer 解析汇合到宿主 pnpm 版本；不承诺跨独立工程的直接 Node 导入天然去重。

## 产物与命令

在 vendor 根目录执行以下命令，不自行下载第三方资源：

| 命令 | 说明 |
| --- | --- |
| `yarn --cwd packages/yjs build:esm` | 构建 dev/prod ESM 与声明；先准备公开 core peer 产物 |
| `yarn --cwd packages/yjs gen:types` | 清理并重新生成 `dist/types` 声明 |
| `yarn --cwd packages/yjs typecheck` | source 与 `_tests_` TypeScript 严格检查 |
| `yarn --cwd packages/yjs lint` | source 与测试 ESLint，禁止 warning |
| `yarn --cwd packages/yjs test` | 真实 Y.Doc 与公开包入口测试，先构建产物 |
| `yarn build:packages` | common → fractional-indexing → laser-pointer → math → element → excalidraw → yjs |

运行时 `development` 条件解析到 `dist/dev/index.js`；`production` 和默认解析到 `dist/prod/index.js`；类型解析到 `dist/types/yjs/src/index.d.ts`。发布文件限定 `dist/*`，不依赖源码 alias。从仓库根运行 `pnpm --dir apps/web test:canvas-package` 验证三种条件导出、产物依赖边界及实际 Web 构建中的单一 Yjs；Web `typecheck` 的消费者直接读取 exports 指向的声明。
