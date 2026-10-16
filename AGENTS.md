# Guidelines

- For new DOM/browser API usage, use `app.ownerDocument` and `app.ownerWindow` instead of globals; without `app`, derive them from the mounted node's `ownerDocument` and its `defaultView`.
- When overriding properties of an existing type, prefer `Merge<Base, Overrides>` from `@excalidraw/common/utility-types` over `Omit<Base, keyof Overrides> & Overrides`.
- In React tests, wrap state-triggering interactions and updates in `act()`; use `await act(async () => { ... })` when the update may be asynchronous, and wait for it before making assertions.
- 单元测试中禁止添加日志打印。可以存在临时的调试日志，但也应该在事后移除。
- 代码变更（不含纯文档改动）落地前，须对受影响的子包执行测试与 TS 类型校验：在仓库根目录运行 `yarn workspace <pkg-name> test` 与 `yarn workspace <pkg-name> typecheck`；若变更跨多个子包，逐个执行。
- 禁止为源代码之外的内容添加测试用例覆盖。
- 禁止读取、变更 `docs/lark-exmples/` 下的文件。

## 经验

- 绘制**不入场景**的元素（跟随光标的预设预览、拖出预览等）时，必须传显式 `id` 与 `seed`：构造函数默认会消耗全局的 id 计数器与随机序列，把同一会话里后续真实元素的 id/seed 整体推后一位，导致一批无关的快照测试失败。见 [docs/offscreen-preview-identity.md](docs/offscreen-preview-identity.md)。
- 断言「元素没了」用 `h.elements.filter((el) => !el.isDeleted)`：`window.h.elements` 是 `getElementsIncludingDeleted()`，撤销只置墓碑。
