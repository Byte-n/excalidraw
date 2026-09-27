# 行数超过 3000 的文件

统计日期：2026-09-28。

## 统计范围与规则

- 扫描项目目录中的所有文件，包括隐藏文件、被 Git 忽略的文件和本地构建产物。
- 排除 `.git`、`node_modules` 目录及二进制或非 UTF-8 文件；不跟随符号链接。
- 按换行符 `LF` 统计行数；非空文件末尾没有换行符时，最后一行也计入。`CRLF` 视为一次换行。
- 筛选条件为严格大于 3000 行，结果按行数降序排列。
- 扫描时读取 4347 个文件，其中 3335 个文本文件、1012 个二进制或非 UTF-8 文件；本报告不计入扫描。

## 结果

共 **18** 个文件符合条件。

| 文件路径（相对于项目根目录） | 行数 |
| --- | ---: |
| [packages/excalidraw/dist/dev/index.js](packages/excalidraw/dist/dev/index.js) | 56832 |
| [packages/element/dist/dev/index.js](packages/element/dist/dev/index.js) | 26913 |
| [packages/excalidraw/tests/__snapshots__/history.test.tsx.snap](packages/excalidraw/tests/__snapshots__/history.test.tsx.snap) | 23652 |
| [packages/excalidraw/tests/__snapshots__/regressionTests.test.tsx.snap](packages/excalidraw/tests/__snapshots__/regressionTests.test.tsx.snap) | 15332 |
| [packages/excalidraw/fonts/ComicShanns/ComicShanns-Regular.sfd](packages/excalidraw/fonts/ComicShanns/ComicShanns-Regular.sfd) | 12221 |
| [yarn.lock](yarn.lock) | 10865 |
| [packages/excalidraw/tests/__snapshots__/contextmenu.test.tsx.snap](packages/excalidraw/tests/__snapshots__/contextmenu.test.tsx.snap) | 10442 |
| [dev-docs/yarn.lock](dev-docs/yarn.lock) | 9279 |
| [packages/excalidraw/dist/dev/index.css](packages/excalidraw/dist/dev/index.css) | 8379 |
| [docs/composite-shape/lark-examples-data.json](docs/composite-shape/lark-examples-data.json) | 6928 |
| [packages/excalidraw/dist/dev/chunk-OOGRPU6F.js](packages/excalidraw/dist/dev/chunk-OOGRPU6F.js) | 6279 |
| [packages/excalidraw/tests/history.test.tsx](packages/excalidraw/tests/history.test.tsx) | 5330 |
| [docs/mindmap-plan/samples/showcase-all-types.excalidraw](docs/mindmap-plan/samples/showcase-all-types.excalidraw) | 4906 |
| [docs/composite-shape/phase-3 · 28 个样本 : 文本区域填充.excalidraw](<docs/composite-shape/phase-3 · 28 个样本 : 文本区域填充.excalidraw>) | 4395 |
| [packages/excalidraw/dist/dev/chunk-6JJSWC4C.js](packages/excalidraw/dist/dev/chunk-6JJSWC4C.js) | 4132 |
| [packages/excalidraw/subset/woff2/woff2-bindings.ts](packages/excalidraw/subset/woff2/woff2-bindings.ts) | 4051 |
| [packages/common/dist/dev/index.js](packages/common/dist/dev/index.js) | 3894 |
| [packages/element/src/binding.ts](packages/element/src/binding.ts) | 3450 |
