# Phase 01 — 画布搜索与定位 API

> 状态：已完成｜关联 ADR：无（跨仓边界见 docs-platform ADR-0007）｜规格影响：无（vendor 不维护业务规格）
>
> 执行空间：`vendor/excalidraw` 在 `master` 分支直接实施，不新建 worktree。

## 背景与目标

- 要解决的问题：
  - SearchMenu 是纯 UI 实现，搜索词与焦点是模块内部 atom；外部无法复用搜索能力，也无法展示宿主提供的多元素候选。
  - 搜索只覆盖 text 元素、画框/表格名称与脑图节点正文，与平台按元素全部文本区域派生的检索范围不一致。
  - 没有公开的按 elementId 定位并选中的 API；宿主需要自行拼装 viewport 与 appState。
- 本期目标：
  - 抽出单一搜索核心，暴露 `searchScene`，返回去重后的元素级结果。
  - 搜索覆盖元素全部文本区域与元素标题；支持字符串/多词、any/all、limit 与隐藏脑图节点选项。
  - 暴露 `revealElement`：按 ID 定位并选中，只改视图态。
  - 将 SearchMenu 重构为单一面板，支持 search/locate 两种结果源；暴露 `openSearchPanel` 与 `closeSearchPanel`。
  - Ctrl+F 行为保持；面板单例；宿主与用户的所有权清晰。
- 明确不做：
  - 不提供异步搜索、分页、正则、分词或 FTS。
  - 不在公开结果中暴露命中行几何；词语级高亮只由面板内部使用。
  - 不提供颜色高亮 API；定位高亮使用选中态。
  - 不把宿主资源、权限、RAG 或全局搜索语义放入 vendor。
  - 不保留 `openSearch`/`openLocatePanel` 等独立入口；统一为 `openSearchPanel`。
  - 不支持多面板共存或 DOM 驱动输入框。
  - 不为旧 SearchMenu 内部状态提供兼容层；项目无历史数据。

## 架构决策

### D1 单一搜索核心

- 决策：把搜索计算从 SearchMenu 抽成纯模块，`searchScene` 与面板 search 模式共用。
- 取舍：SearchMenu 需要重构；换取数据与 UI 结果一致。
- 适用边界：场景内文本搜索；不涉及平台 FTS。

### D2 搜索覆盖全部文本区域

- 决策：搜索读取元素标题与全部文本区域，而不只筛选 text 元素；已删除元素排除。
- 取舍：单次搜索需要遍历更多元素与区域；通过场景 nonce 缓存控制重复扫描。
- 适用边界：元素级搜索结果；词语级高亮仍按现有可计算几何的类型处理，其余区域回退到元素级定位。

### D3 单面板与所有权

- 决策：同一时刻只有一个搜索面板；`openSearchPanel` 按 mode 替换内容；宿主打开时记录宿主所有权，Ctrl+F 切回搜索时释放。
- 决策：search 模式接受字符串或多词查询与 `match` 选项；输入框显示词串，用户编辑后退化为单字符串字面查询。
- 取舍：不支持面板共存；换取状态机与关闭语义简单。
- 适用边界：search/locate 两种模式；用户手动搜索不受宿主关闭影响。

### D4 revealElement 只改视图态

- 决策：按 ID 查找未删除元素，使用 `setViewport` 与本地 `selectedElementIds` 定位选中；不写场景、不产生撤销记录、不触发协作发布。
- 决策：隐藏脑图节点视为不可定位，返回 `false`；定位不自动展开或改变折叠状态。
- 取舍：高亮是选中框而非词语级色块。
- 适用边界：单元素精确定位；多元素由面板选择。

### D5 结果只暴露元素级数据

- 决策：`searchScene` 返回元素级结果与展示字段；命中行几何保持内部。
- 决策：结果按场景顺序返回；宿主可自行按 `matchedTermCount` 或 `matchCount` 排序；面板沿用现有分组与顺序。
- 取舍：宿主不能直接驱动词语级高亮；换取契约稳定、实现细节不泄漏。
- 适用边界：外部数据搜索；面板内部可自行计算几何。

### D6 API 只在公共入口暴露

- 决策：方法加在 `ExcalidrawImperativeAPI`，类型从包根导出；不新增深层导入路径。
- 取舍：公共 API 面增加；换取宿主稳定接入。
- 适用边界：`searchScene`、`revealElement`、`openSearchPanel`、`closeSearchPanel`。

## API 契约

```ts
export type SceneSearchQuery = string | readonly string[];

export interface SearchSceneOptions {
  /** 多词匹配模式，默认 'any'；单字符串时忽略。 */
  match?: "any" | "all";
  /** 最多返回的元素数，默认 100。 */
  limit?: number;
  /** 是否包含折叠/隐藏的脑图节点，默认 false。 */
  includeHidden?: boolean;
}

export interface SceneSearchResult {
  elementId: string;
  elementType: string;
  title: string;
  preview: string;
  matchedTermCount: number;
  matchCount: number;
  matchedTerms: readonly string[];
  group: "frame" | "table" | "text" | "mindmap" | "other";
  breadcrumb: readonly string[];
  hidden?: boolean;
}

export interface RevealElementOptions {
  /** 默认 true；只写本地 appState。 */
  select?: boolean;
  /** 默认 'scale-down'。 */
  fit?: "scale-down" | "contain" | "none";
  /** 默认 { duration: 300 }。 */
  animation?: boolean | { duration?: number };
  /** 默认 { ui: true }。 */
  offsets?: ViewportOffsets;
}

export interface SearchPanelItem {
  elementId: string;
  label: string;
  preview?: string;
  detail?: string;
  group?: string;
  disabled?: boolean;
}

export type SearchPanelOptions =
  | {
      mode: "search";
      title?: string;
      query?: SceneSearchQuery;
      match?: "any" | "all";
      focusFirst?: boolean;
    }
  | {
      mode: "locate";
      title?: string;
      items: readonly SearchPanelItem[];
      activeElementId?: string;
      focusFirst?: boolean;
      filterable?: boolean;
    };

export interface ExcalidrawImperativeAPI {
  searchScene(
    query: SceneSearchQuery,
    options?: SearchSceneOptions,
  ): SceneSearchResult[];
  revealElement(elementId: string, options?: RevealElementOptions): boolean;
  openSearchPanel(options: SearchPanelOptions): boolean;
  closeSearchPanel(): void;
}
```

## 数据流

```text
宿主 API 调用
  → App 方法
  → 搜索核心（元素 + 查询词）/ 视口与 appState / 面板状态（mode、items、active、owner）
  → SearchMenu UI / renderer searchMatches
  → locate 条目选择 → revealElement
```

## 规格与决策影响

| 类型 | 内容 | 落点 | 处理时机 |
| --- | --- | --- | --- |
| 规格变更 | 无 vendor 业务规格；行为由本计划、类型与测试固化 | 本计划、测试 | 收口确认 |
| 新 ADR | 无；跨仓边界由 docs-platform ADR-0007 记录 | docs-platform ADR-0007（其他仓库） | 宿主计划 |
| 局部决策 | 搜索结果字段、limit、any/all、隐藏脑图选项 | 本计划、执行账本 | 本期有效 |
| 局部决策 | 面板所有权与 close 语义 | 本计划、执行账本 | 本期有效 |
| 局部决策 | 文本区域全覆盖，词语级高亮按现有几何能力回退 | 本计划、执行账本 | 本期有效 |

## 任务

| ID | 实施内容 | 验证要求 | 依赖 |
| --- | --- | --- | --- |
| T1 | 搜索核心与 `searchScene`：抽取 SearchMenu 搜索逻辑；覆盖标题与全部文本区域；实现字符串/多词、any/all、limit、隐藏脑图与元素级结果；接入 App/API/types/index；补单测 | `yarn workspace @excalidraw/excalidraw test`、`yarn workspace @excalidraw/excalidraw typecheck`；覆盖形状正文、便签、表格单元格、画框/表格标题、脑图正文、分段行；删除元素排除；limit/any/all/隐藏选项 | 无 |
| T2 | `revealElement`：按 ID 查找未删除元素；`setViewport` + 本地选中；缺失返回 false；接入 App/API/types/index；补单测 | 同上测试命令；缺失/删除返回 false；有效元素触发 viewport 与选中；场景元素与 nonce 不变 | T1 |
| T3 | 单面板与 `openSearchPanel`/`closeSearchPanel`：抽出面板状态；search/locate 两种来源；search 支持多词查询与 `match`，locate 使用宿主 items；共用列表、计数、键盘与滚动；所有权与 Ctrl+F 切换；补面板测试 | 既有 `search.test.tsx` 全部通过；locate 模式列表、筛选、点击定位；search 模式多词查询与编辑退化；单面板替换；用户 Ctrl+F 释放宿主所有权；空 items 或全部失效/隐藏返回 false | T1、T2 |
| T4 | 公共导出与总体验收：包根类型导出、API 文档注释、全量测试/类型检查；提供宿主接入提交 | `yarn workspace @excalidraw/excalidraw test`、`typecheck`；如改动 element 辅助则执行 `yarn workspace @excalidraw/element test`、`typecheck`；无深层导入 | T3 |

## 涉及位置

| 位置 | 改动 |
| --- | --- |
| `packages/excalidraw/components/SearchMenu.tsx` | 拆分搜索核心与结果面板；search/locate 两种来源 |
| `packages/excalidraw/search/`（新增） | 搜索核心、结果类型、命中几何内部实现 |
| `packages/excalidraw/components/DefaultSidebar.tsx` | 保持搜索 tab，接入面板模式 |
| `packages/excalidraw/actions/actionToggleSearchMenu.ts` | Ctrl+F 切换到 search 模式并释放宿主所有权 |
| `packages/excalidraw/components/App.tsx` | `searchScene`、`revealElement`、`openSearchPanel`、`closeSearchPanel` |
| `packages/excalidraw/types.ts` | API 与结果/选项类型 |
| `packages/excalidraw/index.tsx` | 包根类型导出 |
| `packages/element/src/text/regions.ts`、`packages/element/src/index.ts` | 如需，导出文本区域读取能力 |
| `packages/excalidraw/_tests_/search.test.tsx`、新增搜索/定位测试 | 覆盖 search/locate、reveal、所有权 |

## 验收标准

- `searchScene` 返回去重后的元素级结果，覆盖元素标题与全部文本区域，删除元素不返回。
- `searchScene` 支持字符串/多词、`any`/`all`、`limit` 与隐藏脑图选项。
- `revealElement` 能定位并选中有效元素，缺失或删除返回 `false`，不写场景。
- `openSearchPanel` 支持 `search` 与 `locate` 两种模式；同一时刻只有一个面板；`closeSearchPanel` 只关闭宿主打开的面板。
- Ctrl+F 行为不回归；搜索面板的词语级高亮在可计算几何的类型上保持。
- 相关测试与 TypeScript 检查通过；宿主可以获得可用的提交哈希。

## 风险与开放项

- SearchMenu 体量大，拆分可能引入 Ctrl+F 行为回归；以现有搜索测试为基线。
- 全部文本区域扫描可能影响大场景性能；需要按场景 nonce 缓存并设置结果上限。
- 新覆盖区域暂不保证词语级几何高亮，回退到元素级定位；是否补齐区域级高亮留待后续专项。
- vendor 仓库当前存在未提交文档改动，实施前需确认工作区与分支状态。
- 公共结果类型一旦发布，字段变更成本较高；本期只暴露元素级稳定字段。
