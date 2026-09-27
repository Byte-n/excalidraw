# `App.tsx` 拆分方案

## 1. 文件定位

`packages/excalidraw/components/App.tsx` 不是普通的页面组件，而是 Excalidraw 的核心运行时。它同时承担 React 根组件、编辑器状态容器、场景控制器、输入事件状态机、渲染入口和对外 API，因此目前约 14,296 行。

合理的目标是让 `App` 成为“运行时协调器”：负责组装核心对象和各个 controller，协调 React 生命周期、`AppState`、`Scene`、`Renderer` 和外部 API；具体能力由独立模块负责。

## 2. 当前职责

| 区域 | 主要职责 |
| --- | --- |
| `647` 附近 | 持有 `Scene`、`Renderer`、`Fonts`、`Store`、`History`、`Library` 等核心对象，并初始化工具 controller |
| `835` 附近 | 创建 `ExcalidrawImperativeAPI`，暴露场景、文件、视口、动作和事件 API |
| `976-1133` | 判断 interaction、navigation、embed、browser zoom、UI 控件和工具是否可用 |
| `1143-1520` | 处理 iframe 消息、箭头绑定和绑定模式 |
| `1520-2133` | 管理 embeddable iframe、校验状态和 DOM overlay |
| `2134-2364` | 渲染 frame 名称和 frame 编辑状态 |
| `2372-2872` | 渲染整个编辑器，包括 Context Provider、工具栏、画布、弹窗和浮层 |
| `2890-3233` | 导出图片、Magic Frame、插件调用和取色器 |
| `3336-4564` | 初始化场景、React 生命周期、交互模式切换和 DOM 事件监听 |
| `4568-5194` | 复制、剪切、粘贴、拖放和混合内容导入 |
| `5195-5599` | 更新 `AppState`、场景元素、文件、渲染覆盖层和协作状态 |
| `5607-6463` | 键盘、快捷键、工具切换和触控手势 |
| `6464-7281` | 文本编辑、WYSIWYG、文字绑定、文字定位和命中测试 |
| `7322-12777` | Canvas 点击、hover、链接、选区、拖动、缩放、旋转、裁剪和橡皮擦 |
| `12888-13496` | 图片初始化、图片缓存、文件加载和拖放 |
| `13497-14270` | Context Menu、DOM 坐标刷新、语言更新和测试 Hook |

## 3. 目标目录结构

项目中已经存在 `App.viewport.ts`、`App.pan.ts`、`App.wheel.ts` 等能力模块。新增文件建议集中放在 `components/app/` 二级目录中，继续沿用 controller 模式。保留 `components/App.tsx` 作为外部入口和兼容层，避免与 `components/App/` 同名目录产生模块解析歧义：

```text
components/
  App.tsx                    # React 外壳、核心字段和 controller 组装
  app/
    context.ts               # Context、Provider 相关 hooks
    render.tsx               # 根 JSX 和 Provider 组合
    embeds.tsx               # iframe / embeddable DOM overlay
    frames.tsx               # frame 名称和 frame DOM 状态
    lifecycle.ts             # mount/update/unmount、初始化和销毁
    eventListeners.ts        # add/removeEventListeners
    scene.ts                 # scene、history、store、syncActionResult
    files.ts                 # 图片、文件和 imageCache
    clipboard.ts             # copy/cut/paste/drop
    export.ts                # 导出和 imperative API 相关能力
    magicFrame.ts            # Magic Frame 和 diagram-to-code
    keyboard.ts              # 键盘和快捷键
    gesture.ts               # touch / Safari gesture
    text.ts                  # 文本编辑和 WYSIWYG
    hitTest.ts               # 命中测试
    pointerCanvas.ts         # click、hover、link、frame highlight
    pointerSelection.ts      # 选择、拖动、缩放、旋转、裁剪
    pointerErase.ts          # 橡皮擦和删除交互
    pointerSession.ts        # pointer 会话、临时监听器和清理
    contextMenu.ts           # Context Menu
```

最终 `App.tsx` 只保留：

- React class 和核心字段
- `Scene`、`Renderer`、`Store` 等对象初始化
- controller 初始化和相互协调
- lifecycle 方法的委托
- `render()` 对 `AppView` 的调用
- 对外兼容的公共方法和 API

目标是将 `App.tsx` 控制在约 1,500 ～ 2,500 行，而不是把同一个巨型类原样搬到多个文件。

## 4. 分阶段迁移

### 阶段一：低风险拆分

先处理不涉及复杂 pointer 状态机的部分。

1. **`app/context.ts`**

   抽出 `App.tsx` 中 Context 和 hooks 的定义。`App.tsx` 继续 re-export 原有导出，避免一次性修改大量 import。

2. **`app/embeds.tsx`**

   抽出 iframe 引用、嵌入内容校验、`renderEmbeddables()` 和窗口消息处理。

3. **`app/frames.tsx`**

   抽出 `renderFrameNames()`、frame 名称编辑和 frame bounds 缓存。

4. **`app/render.tsx`**

   将根 JSX 和 Provider 组合提取为 `AppView`。`App.render()` 只负责准备渲染数据并返回 `<AppView app={this} />`。

### 阶段二：数据和生命周期

1. **`app/lifecycle.ts`**

   抽出 `initializeScene`、`componentDidMount`、`componentDidUpdate`、`componentWillUnmount`、交互模式切换和强制工具同步。

2. **`app/eventListeners.ts`**

   抽出 `addEventListeners`、`removeEventListeners` 以及 resize、blur、unload、fullscreen 监听。

3. **`app/scene.ts`**

   抽出 `resetScene`、`resetHistory`、`resetStore`、`syncActionResult`、`updateScene`、`applyDeltas`、`mutateElement` 和 render overrides。

4. **`app/files.ts`**

   抽出图片初始化、`imageCache`、`addFiles`、文件加载和拖放。

`componentDidUpdate` 的执行顺序必须保持不变。它同时负责状态观察、embeddable 更新、store commit 和 `onChange` 通知，是这一阶段的主要风险点。

### 阶段三：输入和编辑能力

1. **`app/keyboard.ts`**：`onKeyDown`、`onKeyUp`、浏览器 zoom、PageUp/PageDown 和工具快捷键。
2. **`app/gesture.ts`**：touch gesture、Safari gesture 和多指缩放。
3. **`app/text.ts`**：`startTextEditing`、`handleTextWysiwyg`、文字绑定和文本自动调整大小。
4. **`app/hitTest.ts`**：`getElementAtPosition`、`getElementsAtPosition`、`hitElement` 和文本容器查找。

命中测试是高频路径，应使用明确的窄依赖接口，避免让它继续依赖完整的 `App`。

### 阶段四：pointer 状态机

pointer 代码不建议直接合并成一个新的 `App.pointer.ts`，而应按状态转移拆分：

- **`app/pointerCanvas.ts`**：click、double click、hover、链接和 frame 高亮
- **`app/pointerSelection.ts`**：框选、元素选择、拖动、缩放、旋转和裁剪
- **`app/pointerErase.ts`**：橡皮擦和待删除元素恢复
- **`app/pointerSession.ts`**：pointer down/up 生命周期、临时监听器、拖动会话和清理

文件顶部的模块级可变变量也应在这一阶段处理，例如 `gesture`、`lastPointerUp`、`didTapTwice`、`touchTimeout`、粘贴状态和 scrollbar 状态。建议逐步收敛成 `App` 实例级的 `interactionState`，避免多个 Excalidraw 实例共享输入状态。

## 5. 依赖设计

初期可以沿用已有 controller 的模式。由于 controller 位于 `components/app/`，从 controller 导入外层 `App` 时应使用 `../App`：

```ts
import type App from "../App";
```

controller 通过 `app.scene`、`app.state`、`app.setState()` 等调用现有能力，先保证行为不变。完成第一轮拆分后，再将完整 `App` 依赖收窄为专用接口：

```ts
type PointerControllerApp = Pick<
  AppClassProperties,
  "scene" | "state" | "setActiveTool" | "cursor"
> & {
  setAppState: AppClassProperties["setAppState"];
};
```

需要遵守以下约束：

- 新增 DOM/browser API 时使用 `app.ownerDocument` 和 `app.ownerWindow`。
- 在现有类型上覆盖字段时使用 `Merge<Base, Overrides>`，不要使用 `Omit<Base, keyof Overrides> & Overrides`。
- `App.tsx` 到各 controller 尽量只保留 type-only import，避免运行时循环依赖。
- 保留 `App.tsx` 的公共导出和兼容 re-export，降低迁移范围。

## 6. 验证和回归重点

每个阶段单独提交和验证：

```bash
yarn test:typecheck
yarn test:code
yarn test:app packages/excalidraw/tests/App.test.tsx
yarn test:app packages/excalidraw/tests/appStateHooks.test.tsx
```

重点检查：

- Context Provider 层级和 hooks 行为
- `ExcalidrawImperativeAPI` 的对象生命周期和销毁后的错误语义
- `componentDidUpdate` 中的 `onChange`、`onScrollChange` 和 store commit 顺序
- pointer 事件监听的添加和清理
- 多实例编辑器之间是否相互影响
- iframe、图片、粘贴、拖放和文本编辑
- 现有 App 快照和相关交互测试

建议每个阶段只做结构迁移，不同时重写业务逻辑。等边界稳定后，再继续收窄 controller 的依赖接口和清理冗余 import。
