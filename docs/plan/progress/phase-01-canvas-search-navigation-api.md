# Phase 01 执行账本

- 计划：`docs/plan/phase-01-canvas-search-navigation-api.md`
- 总体状态：已完成
- Worktree：`/Users/byte/Desktop/docs-platform/vendor/excalidraw`
- 分支：`master`
- 执行空间：当前分支直接实施，不创建 worktree、不切换分支
- 基线提交：`d236cc2cf691c437e5b9fe68c456493fde96eb50`
- 当前 HEAD：压缩为单个 vendor 交付提交（本账本所在提交）；任务表与断点中的哈希为压缩前执行记录
- 工作区：干净
- 当前任务：无
- 最近更新：2026-11-18 09:20 +0800

## 任务

| ID | 任务 | 状态 | 实现结果 | 验证结果 | 提交 |
| --- | --- | --- | --- | --- | --- |
| T1 | 搜索核心与 `searchScene` | 已完成 | 新增 `search/` 核心：标题+全部文本区域、字符串/多词、any/all、limit、includeHidden、元素级去重、分组与面包屑；SearchMenu 改用单一核心，无词语几何的区域回退到元素级视口；App/API/types 接入 `searchScene` | typecheck 通过；全量 149 文件 2465 通过、11 skipped | `f622727f` |
| T2 | `revealElement` | 已完成 | 新增 `RevealElementOptions` 与 API：未删除校验、隐藏脑图返回 false、本地选中与视口定位，不写场景；SearchMenu 无几何回退改为复用该 API | typecheck 通过；全量 150 文件 2471 通过、11 skipped | `99e2e918` |
| T3 | 单面板与 `openSearchPanel`/`closeSearchPanel` | 已完成 | 抽出面板状态 atom：search/locate 互斥、宿主所有权、requestId 重置；locate 过滤失效/隐藏项并按 group/筛选展示，点击/Enter 调 `revealElement`；Ctrl+F 接管并释放所有权；卸载清理宿主所有权；修复切 locate 时在途 debounce 回写高亮；修复宿主替换查询时旧 debounce 覆盖新结果（`f84bb790`） | typecheck 通过；全量 151 文件 2480 通过、11 skipped | `11d2be4a`、`f84bb790` |
| T4 | 公共导出与总体验收 | 已完成 | 包根导出六个公共类型与 API TSDoc；确认无 `search/`、内部 atom 或深层路径导出；宿主可仅从包根导入。收口后补齐 `ExcalidrawImperativeAPI` 包根导出（`f2339eb8`），供宿主类型化 API | typecheck 通过；全量 151 文件 2479 通过、11 skipped；补充导出后 typecheck 与构建通过 | `3001ead0`、`f2339eb8` |

> 本轮任务级提交已压缩为单个 vendor 交付提交；表中哈希为压缩前执行记录。

## 决策去向

| 决策 | 类型 | 落点 | 状态 |
| --- | --- | --- | --- |
| D1 单一搜索核心，`searchScene` 与面板共用 | 局部决策 | 本计划 D1、`search/searchScene.ts` 与测试 | 已落地 |
| D2 搜索覆盖标题与全部文本区域，词级高亮按几何能力回退 | 局部决策 | 本计划 D2、`SearchMenu.tsx` 与测试 | 已落地 |
| D3 单面板、search/locate 互斥、宿主所有权与 Ctrl+F 释放 | 局部决策 | 本计划 D3、`search/searchPanel.ts`、面板测试 | 已落地 |
| D4 `revealElement` 只改视口与本地选中 | 局部决策 | 本计划 D4、`App.tsx`、定位测试 | 已落地 |
| D5 结果只暴露元素级数据，面板保留命中级展示 | 局部决策 | 本计划 D5、`types.ts`、`searchScene` 测试 | 已落地 |
| D6 四个 API 只在包根暴露 | 局部决策 | 本计划 D6、`index.tsx` | 已落地 |
| 跨仓 vendor/宿主边界 | ADR | docs-platform ADR-0007（宿主 Phase 82 T1 创建） | 已登记 |

## 当前断点

- 已完成到：四个 API 与公共类型可用并完成总体验收；本轮任务级提交已压缩为单个 vendor 交付提交。
- 下一步：无，本期冻结。
- 未提交文件：无。
- 阻塞事项：无。

## 总体验收

- [x] 相关测试通过
- [x] TypeScript 类型检查通过
- [x] 公共 API 与包根导出完成
- [x] 宿主接入提交已提供（单个 vendor 交付提交）
- [x] 计划索引已更新
- [x] 决策去向已登记

## 遗留限制

- 新增覆盖区域（形状正文、便签、线性标签、分段行）只做元素级定位，词语级几何高亮仍限于文字元素、画框/表格标题与脑图正文。
- 搜索为同步字面量匹配，不提供正则、分词、分页或异步检索。
- 面板 locate 模式只按元素存在性、删除与隐藏脑图过滤，不校验宿主条目的业务有效性。
- 公共结果类型的字段一旦发布变更成本较高，本期只暴露元素级稳定字段。
