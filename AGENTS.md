# Guidelines

- For new DOM/browser API usage, use `app.ownerDocument` and `app.ownerWindow` instead of globals; without `app`, derive them from the mounted node's `ownerDocument` and its `defaultView`.
- When overriding properties of an existing type, prefer `Merge<Base, Overrides>` from `@excalidraw/common/utility-types` over `Omit<Base, keyof Overrides> & Overrides`.
- In React tests, wrap state-triggering interactions and updates in `act()`; use `await act(async () => { ... })` when the update may be asynchronous, and wait for it before making assertions.
- 单元测试中禁止添加日志打印。可以存在临时的调试日志，但也应该在事后移除。
- 代码变更（不含纯文档改动）落地前，须对受影响的子包执行测试与 TS 类型校验：在仓库根目录运行
  `yarn workspace <pkg-name> test` 与 `yarn workspace <pkg-name> typecheck`；若变更跨多个子包，逐个执行。
