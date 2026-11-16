import { BOUND_TEXT_PADDING } from "@excalidraw/common";

import {
  BASIC_SHAPE_IDS,
  DATAFLOW_SHAPE_IDS,
  FLOWCHART_SHAPE_IDS,
  LAYOUT_ALGORITHM_IDS,
  SEQUENCE_SHAPE_IDS,
  SHAPE_IDS,
} from "@excalidraw/element";

import { canvasApiDocumentation } from "../api-documentation.generated.js";
import { CANVAS_SDK_ERROR_CODES } from "../sdk/errors.js";

import type { CanvasDocsKind } from "../sdk/types.js";
import type { CanvasSdkErrorCode } from "../sdk/errors.js";

export type DocsTopic = {
  guide: string;
  id: string;
  title: string;
  summary: string;
  kind: CanvasDocsKind;
  body: string;
  example?: string;
};

export type DocsGuide = {
  id: string;
  title: string;
  summary: string;
  topics: DocsTopic[];
};

const codeBlock = (code: string) => `\`\`\`js\n${code}\n\`\`\``;

const shapeCatalogBody = [
  `shape kind 共 ${SHAPE_IDS.length} 个，按 family 展开；addShape/updateShape 只接受这些 id。`,
  `basic（${BASIC_SHAPE_IDS.length}）：${BASIC_SHAPE_IDS.join("、")}`,
  `flow（${FLOWCHART_SHAPE_IDS.length}）：${FLOWCHART_SHAPE_IDS.join("、")}`,
  `sequence（${SEQUENCE_SHAPE_IDS.length}）：${SEQUENCE_SHAPE_IDS.join("、")}`,
  `dataflow（${DATAFLOW_SHAPE_IDS.length}）：${DATAFLOW_SHAPE_IDS.join("、")}`,
  `全部 id：${SHAPE_IDS.join("、")}`,
].join("\n");

const LAYOUT_DESCRIPTIONS: Record<typeof LAYOUT_ALGORITHM_IDS[number], string> =
  {
    layered: "流程图/DAG 的分层布局，支持方向、层距与节点距。",
    tree: "脑图/组织树的 tidy tree 布局。",
    grid: "把卡片排成网格，按 columns 控制列数。",
    row: "把元素排成一行。",
    column: "把元素排成一列。",
    stack: "把元素沿一个方向堆叠。",
    align: "对齐已有元素（至少 2 个）。",
    distribute: "均匀分布已有元素（至少 3 个）。",
  };

const layoutAlgorithmsBody = [
  `layout 算法共 ${LAYOUT_ALGORITHM_IDS.length} 个：`,
  ...LAYOUT_ALGORITHM_IDS.map((id) => `- ${id}：${LAYOUT_DESCRIPTIONS[id]}`),
].join("\n");

const ERROR_DESCRIPTIONS: Record<
  CanvasSdkErrorCode,
  { message: string; retryable: boolean }
> = {
  execution_cancelled: { message: "脚本执行已取消", retryable: false },
  session_unavailable: { message: "协作会话未同步或不可用", retryable: true },
  not_editable: { message: "当前会话为只读，不能写入", retryable: false },
  invalid_input: {
    message: "入参不合法，details 含 issues/legalValues",
    retryable: false,
  },
  invalid_operation: { message: "操作与目标元素类型不匹配", retryable: false },
  invalid_scene: { message: "场景数据不合法", retryable: false },
  invalid_asset: { message: "资产数据不合法", retryable: false },
  scene_limit_exceeded: { message: "超出场景元素/资产配额", retryable: false },
  target_not_found: {
    message: "目标元素或文档 topic 不存在",
    retryable: false,
  },
  version_conflict: {
    message: "元素版本冲突，需要重读后重试",
    retryable: true,
  },
  unsupported_format: { message: "不支持的导出格式", retryable: false },
  internal_error: { message: "SDK 内部错误", retryable: true },
};

const errorCodesBody = [
  `错误码共 ${CANVAS_SDK_ERROR_CODES.length} 个（有序）：`,
  ...CANVAS_SDK_ERROR_CODES.map((code) => {
    const entry = ERROR_DESCRIPTIONS[code];
    return `- ${code}：${entry.message}；可重试：${
      entry.retryable ? "是" : "否"
    }`;
  }),
].join("\n");

const apiGroups: Array<{ label: string; matches: (path: string) => boolean }> =
  [
    { label: "scene.", matches: (path) => path.startsWith("scene.") },
    { label: "text.", matches: (path) => path.startsWith("text.") },
    { label: "apply", matches: (path) => path === "apply" },
    { label: "layout.", matches: (path) => path.startsWith("layout.") },
    { label: "validate", matches: (path) => path === "validate" },
    { label: "schema.", matches: (path) => path.startsWith("schema.") },
    { label: "export", matches: (path) => path === "export" },
    { label: "docs.", matches: (path) => path.startsWith("docs.") },
  ];

const apiBody = [
  "以下签名从 src/sdk/types.ts 的 CanvasSdk 自动生成。",
  ...apiGroups.map((group) => {
    const members = canvasApiDocumentation.members.filter((member) =>
      group.matches(member.path),
    );
    if (!members.length) {
      return "";
    }
    return [
      `## ${group.label}`,
      ...members.map((member) =>
        [member.signature, member.description]
          .filter((line) => line.length > 0)
          .join("\n"),
      ),
    ].join("\n");
  }),
  "## 类型",
  ...canvasApiDocumentation.types.map(
    (type) => `${type.name} = ${type.definition}`,
  ),
]
  .filter((section) => section.length > 0)
  .join("\n\n");

const flowchartExample = `const receipt = await canvas.apply({
  ops: [
    { op: "addShape", tempId: "start", kind: "fc-terminator", x: 0, y: 0, label: "开始" },
    { op: "addShape", tempId: "check", kind: "fc-diamond", x: 0, y: 160, label: "是否通过？" },
    { op: "addShape", tempId: "end", kind: "fc-terminator", x: 0, y: 320, label: "结束" },
    { op: "connect", from: "start", to: "check" },
    { op: "connect", from: "check", to: "end", label: "是" },
  ],
});
await canvas.layout.apply({
  ids: Object.values(receipt.tempIds),
  algorithm: "layered",
});
return receipt;`;

const mindmapExample = `const receipt = await canvas.apply({
  ops: [
    { op: "mindmap", action: "createRoot", tempId: "root", x: 0, y: 0, text: "产品" },
    { op: "mindmap", action: "addChild", tempId: "need", nodeId: "root", text: "需求" },
    { op: "mindmap", action: "addChild", tempId: "design", nodeId: "root", text: "设计" },
  ],
});
await canvas.layout.apply({
  ids: Object.values(receipt.tempIds),
  algorithm: "tree",
});
return receipt;`;

const updateExample = `const receipt = await canvas.apply({
  ops: [
    {
      op: "updateShape",
      id: "existing-shape-id",
      label: { text: "新标题", fit: "auto" },
    },
  ],
  expectedVersions: { "existing-shape-id": 3 },
});
return receipt;`;

const tableExample = `const receipt = await canvas.apply({
  ops: [
    {
      op: "table",
      action: "create",
      tempId: "table",
      position: { x: 0, y: 0 },
      rowCount: 2,
      columnCount: 2,
    },
    { op: "table", action: "setName", tableId: "table", name: "服务清单" },
  ],
});
return receipt;`;

export const DOCS_GUIDES: DocsGuide[] = [
  {
    id: "core",
    title: "画布基础",
    summary: "坐标约定、写入流程、文本 fit 与 API 签名。",
    topics: [
      {
        guide: "core",
        id: "conventions",
        title: "画布约定",
        summary: "坐标单位、origin、服务端身份生成与 tempId。",
        kind: "guide",
        body: [
          "坐标单位为 px，原点在画布左上角，x 向右、y 向下；元素位置用左上角 (x, y) 表示。",
          "- origin 是布局起点，省略时取选中元素整体 bounds 的左上角。",
          "- z-order 由服务端 index 管理，不要写 index。",
          "- id、seed、index、version、versionNonce、updated 全部由服务端生成，skeleton 只写语义字段。",
          "- 同批引用用 tempId，回执的 tempIds 给出 tempId → id 映射。",
          "- 不要手写 canonical JSON；创建与修改都通过 canvas.apply 的语义操作完成。",
          "- 几何必须是有限数值，宽度/高度必须为正数。",
        ].join("\n"),
      },
      {
        guide: "core",
        id: "workflow",
        title: "写入流程",
        summary:
          "读 → apply → layout → 读回；dryRun、expectedVersions、幂等键。",
        kind: "guide",
        body: [
          "标准流程：读 → apply → layout → 读回。",
          '1. canvas.scene.get({ view: "summary" }) 读取现有元素与 id。',
          "2. canvas.apply({ ops, expectedVersions?, idempotencyKey?, dryRun? }) 提交语义操作；ops 是原子批，任一操作失败整批回滚。",
          "2.1 新建元素用 tempId 引用同批元素，回执 tempIds 给出映射。",
          "3. 新建元素需要布局时，用 canvas.layout.apply({ ids, algorithm, origin?, options? })；布局由发起写入的一方计算。",
          '也可以在同一次 apply 的 ops 末尾加 { op: "layout", algorithm }，不传 ids 时作用于本批创建的非连线元素。',
          "4. 用 canvas.scene.get 或 canvas.scene.getElements 读回，确认 bounds 与 version。",
          "- dryRun: true 只计算不提交，用于预演。",
          "- expectedVersions 用于乐观并发；版本不匹配报 version_conflict，重读后重试。",
          "- idempotencyKey 让同一批操作重试时返回相同回执。",
          "- 写操作要求 execute_code 的 mode 为 write 且会话可编辑，否则报 not_editable。",
        ].join("\n"),
      },
      {
        guide: "core",
        id: "text-fit",
        title: "文本度量与 fit",
        summary: "label 的 auto/fixed、文本度量与内边距常量。",
        kind: "guide",
        body: [
          "label 支持 auto/fixed 两种 fit：",
          "- auto：盒子随文本增长，文本宽度由度量结果决定；可用 minWidth/minHeight 设置下限。",
          "- fixed：不改变盒子大小，文本在盒内换行。",
          "- 字符串 label 等价于 { text }，会被纠正为对象并产生 input_corrected warning。",
          "文字宽度不由字符数估算，而是由 canvas.text.measure/fit 的度量决定：",
          "- canvas.text.measure({ text, style }) 返回 width/height/lineHeight/lines。",
          "- canvas.text.fit({ text, style, maxWidth, maxHeight? }) 返回换行后的文本、行列表与 truncated。",
          `- 常量：BOUND_TEXT_PADDING=${BOUND_TEXT_PADDING}（容器内边距），TEXT_GAP=2（形状文本安全区）。`,
        ].join("\n"),
      },
      {
        guide: "core",
        id: "api",
        title: "API 签名",
        summary: "CanvasSdk 全部方法签名与相关类型定义。",
        kind: "type",
        body: apiBody,
      },
      {
        guide: "core",
        id: "receipts",
        title: "写入回执",
        summary: "elements/bounds/warnings/tempIds 与 local_applied 语义。",
        kind: "guide",
        body: [
          "apply 回执字段：",
          "- elements：本次创建/修改且未删除的元素摘要（id/tempId/type/kind/bounds/label）。",
          "- bounds：可见回执元素的并集包围盒。",
          "- warnings：非阻断纠正与布局提示。",
          "- tempIds：tempId → 真实 id 映射。",
          "- changedElementIds / createdElementIds / deletedElementIds：变更 id 分类。",
          "- references：各操作的领域引用信息。",
          "layout 回执另含 affectedElementIds 与 layoutToken。",
          "local_applied 仅表示本地事务提交成功，不代表远端客户端已同步或服务端已持久化。",
        ].join("\n"),
      },
    ],
  },
  {
    id: "shapes",
    title: "图形",
    summary: "shape 目录、label 与几何/选项规则。",
    topics: [
      {
        guide: "shapes",
        id: "catalog",
        title: "shape 目录",
        summary: "4 个 family 与全部 60 个 shape id。",
        kind: "shape",
        body: shapeCatalogBody,
      },
      {
        guide: "shapes",
        id: "label",
        title: "图形标签",
        summary: "label 字符串/对象、内嵌 texts.body 与 fit 语义。",
        kind: "guide",
        body: [
          "label 可以是字符串，或以下对象：",
          "{ text, fontSize, fontFamily, textAlign, verticalAlign, color, fit, minWidth, minHeight }",
          '- textAlign: "left" | "center" | "right"；verticalAlign: "top" | "middle" | "bottom"。',
          '- fontFamily 可用枚举数字或字体名（如 "Virgil"），名称会被纠正为枚举值。',
          '- fit: "auto" 随文本增长盒子；"fixed" 不改变盒子，文本在盒内换行。',
          "- 标签内嵌在元素的 texts.body 中，不是独立的 text 元素；不要另外创建 text 元素。",
          '- 也可以用 textFit: { mode: "auto" | "fixed", minWidth?, minHeight? } 控制。',
        ].join("\n"),
      },
      {
        guide: "shapes",
        id: "geometry",
        title: "几何与 shapeOptions",
        summary: "必填几何、默认尺寸与按 kind 生效的 shapeOptions。",
        kind: "guide",
        body: [
          "addShape 必填 kind、x、y；width/height 默认 160/80。",
          "- 更新已有图形用 updateShape，定位用 id；几何补丁可只传 x/y/width/height/angle。",
          "- shapeOptions 只对以下 kind 生效：",
          "- triangle：{ apexX }。",
          "- trapezoid：{ narrowWidthRatio, narrowEdge }。",
          "- cube：{ controlPoint: { x, y } }。",
          "- pie / circular-ring：{ centralAngle, radius, sectorRatio, startRadialLineAngle }。",
          "- 其他 kind 传 shapeOptions 会被拒绝。",
          '- 圆形用 "ellipse"，不是 "circle"；"circle" 会被纠正并产生 warning。',
        ].join("\n"),
      },
    ],
  },
  {
    id: "connectors",
    title: "连接线",
    summary: "端点、绑定、routing 与编辑方式。",
    topics: [
      {
        guide: "connectors",
        id: "bindings",
        title: "端点与绑定",
        summary: "from/to 引用、routing、箭头与绑定互逆。",
        kind: "guide",
        body: [
          "connect 的 from/to 可以是元素 id、同批 tempId，或 { point: { x, y } }。",
          '- kind 默认 "arrow"，也可 "line"。',
          '- routing: "straight" | "curved" | "orthogonal"。',
          "- label、startArrowhead、endArrowhead 控制文本与箭头；箭头取值来自 ARROWHEAD_VALUES。",
          "- 端点绑定到图形时，图形与连线的绑定互逆记录；删除图形会自动清理对应连线绑定。",
          "- 同批 connect 引用新建图形时用 tempId。",
        ].join("\n"),
      },
      {
        guide: "connectors",
        id: "editing",
        title: "编辑与删除",
        summary: "updateConnector、delete 与重连策略。",
        kind: "guide",
        body: [
          "updateConnector 修改已有连线：routing、label、startArrowhead、endArrowhead、style、textStyle。",
          'disconnect 用 canvas.apply({ ops: [{ op: "delete", id }] })，连线被删除并自动清理绑定。',
          "重连（只改一端）本期没有单独操作：删除后重新 connect。",
        ].join("\n"),
      },
    ],
  },
  {
    id: "mindmap",
    title: "脑图",
    summary: "节点操作与 tree 布局。",
    topics: [
      {
        guide: "mindmap",
        id: "operations",
        title: "节点操作",
        summary:
          "createRoot/addChild/addSibling/rename/reparent/deleteSubtree。",
        kind: "guide",
        body: [
          '脑图操作都是 canvas.apply 的 op: "mindmap"：',
          "- createRoot：{ x, y, text, tempId? } 创建根节点。",
          "- addChild / addSibling：{ nodeId, text, tempId?, graphId? }。",
          "- rename：{ nodeId, text, graphId? }。",
          "- reparent：{ nodeId, parentNodeId, beforeNodeId?, graphId? }。",
          "- deleteSubtree：{ nodeId, graphId? } 删除节点及其子树。",
          "tempId 可引用同批新建的 root/child；graphId 可省略，会从节点推断。",
        ].join("\n"),
      },
      {
        guide: "mindmap",
        id: "layout",
        title: "脑图布局",
        summary: "tree 布局与文本变化后的整图重排。",
        kind: "layout",
        body: [
          '脑图用 canvas.layout.apply({ algorithm: "tree", ids: <节点 id 列表> }) 布局。',
          "- ids 传整棵图的节点 id（含根节点）。",
          "- 布局是强触发的：节点文本变化会整图重排，改完文本后重新调用 tree 布局。",
          "- 单个节点移动只是几何修改；需要整理结构时显式调用布局。",
        ].join("\n"),
      },
    ],
  },
  {
    id: "layout",
    title: "布局",
    summary: "算法清单与调用参数。",
    topics: [
      {
        guide: "layout",
        id: "algorithms",
        title: "算法清单",
        summary: "8 个 layout 算法及适用场景。",
        kind: "layout",
        body: layoutAlgorithmsBody,
      },
      {
        guide: "layout",
        id: "usage",
        title: "调用方式",
        summary: "ids/algorithm/origin/options/dryRun 与 layoutToken。",
        kind: "layout",
        body: [
          "canvas.layout.apply 输入：{ ids, algorithm, origin?, options?, dryRun? }。",
          "options 字段：",
          '- direction: "TB" | "LR"（layered/tree）。',
          "- rankGap、nodeGap（layered）。",
          "- gap（grid/row/column/stack）。",
          "- columns（grid）。",
          '- axis: "x" | "y"、position: "start" | "center" | "end"（align/distribute）。',
          "返回 elements、bounds、warnings、affectedElementIds、layoutToken。",
          "布局由发起写入的一方计算并随同一次事务提交；远端只应用结果。",
          "sequence 算法本期未提供，不要使用。",
        ].join("\n"),
      },
    ],
  },
  {
    id: "document",
    title: "文档与导出",
    summary: "docs 查询与 JSON 导出。",
    topics: [
      {
        guide: "document",
        id: "docs",
        title: "文档查询",
        summary: "index/read/search、字符上限与 docsVersion。",
        kind: "guide",
        body: [
          "docs 用于按需查询文档：",
          "- canvas.docs.index({ kind? })：返回 guide 与 topic 索引，kind 可过滤 guide/type/shape/layout/error。",
          "- canvas.docs.read({ guide, topic?, includeExamples? })：不传 topic 时只返回该 guide 的 topic 列表。",
          "- canvas.docs.search({ query, kind?, limit? })：标题/摘要/正文大小写不敏感搜索，limit 默认 8、最大 20。",
          "单次响应上限约 4000 字符；超出返回摘要与钻取提示，并标记 truncated。",
          "响应带 docsVersion，用于判断缓存是否过期。",
        ].join("\n"),
      },
      {
        guide: "document",
        id: "export",
        title: "导出",
        summary: "JSON 导出与不支持的 SVG/PNG。",
        kind: "guide",
        body: [
          'canvas.export({ format: "json", ids?, region? }) 返回 JSON 快照。',
          "canvas_export 工具同样只支持 JSON。",
          "SVG/PNG 本期不支持，传其他 format 报 unsupported_format。",
          "导出是只读操作，不会修改场景。",
        ].join("\n"),
      },
    ],
  },
  {
    id: "errors",
    title: "错误与校验",
    summary: "错误码、warnings 与结构校验。",
    topics: [
      {
        guide: "errors",
        id: "codes",
        title: "错误码",
        summary: "稳定错误码、含义与是否可重试。",
        kind: "error",
        body: errorCodesBody,
      },
      {
        guide: "errors",
        id: "warnings",
        title: "warnings",
        summary: "input_corrected 与 layout_* 非阻断提示。",
        kind: "error",
        body: [
          "layout 与 apply 的 warnings 不阻断提交：",
          '- input_corrected：输入被确定性纠正（如 "circle" → "ellipse"、字符串 label → { text }、字体名 → 枚举）。',
          "- layout_no_edges：layered 布局没有可用的边，只做节点排列。",
          "- layout_cycle_ignored：layered 遇到环，忽略环上的边继续布局。",
          "- layout_no_mindmap：tree 布局的 ids 中没有脑图节点。",
          "- layout_option_corrected：布局参数被纠正（如 columns 非正数）。",
          "按 warning.code 读取，不要依赖 message 文本。",
        ].join("\n"),
      },
      {
        guide: "errors",
        id: "validate",
        title: "结构校验",
        summary: "canvas.validate 的 overlap/overflow/bindings/dangling。",
        kind: "error",
        body: [
          "canvas.validate({ ids?, checks? }) 返回 { ok, issues }。",
          'checks 可选："overlap" | "overflow" | "bindings" | "dangling"。',
          "- overlap：元素之间重叠。",
          "- overflow：文本超出容器。",
          "- bindings：绑定关系不一致。",
          "- dangling：连线指向不存在或已删除的元素。",
          "issue 含 code、severity、elementIds、message；validate 只报告问题，不自动修复。",
        ].join("\n"),
      },
    ],
  },
  {
    id: "examples",
    title: "任务配方",
    summary: "可直接执行的流程图、脑图、更新与表格脚本。",
    topics: [
      {
        guide: "examples",
        id: "flowchart",
        title: "流程图",
        summary: "3 个 flowchart 图形 + 2 条连线 + layered 布局。",
        kind: "guide",
        body: "创建 fc-terminator/fc-diamond/fc-terminator，连接后做 layered 布局，返回 apply 回执。",
        example: flowchartExample,
      },
      {
        guide: "examples",
        id: "mindmap",
        title: "脑图",
        summary: "一次 apply 创建根与子节点，再 tree 布局。",
        kind: "guide",
        body: "在同一个 apply 内 createRoot(tempId) + addChild(tempId) + addChild，再用 tree 布局整理。",
        example: mindmapExample,
      },
      {
        guide: "examples",
        id: "update",
        title: "更新图形",
        summary: "updateShape 改 label 并带 expectedVersions。",
        kind: "guide",
        body: "用 updateShape 修改已有图形 label，并用 expectedVersions 做乐观并发保护。",
        example: updateExample,
      },
      {
        guide: "examples",
        id: "table",
        title: "表格",
        summary: "一次 apply 创建 table 并 setName。",
        kind: "guide",
        body: "在同一个 apply 内 table.create(tempId) + setName，tempId 可直接引用新建表格。",
        example: tableExample,
      },
    ],
  },
];

export const docsTopicText = (topic: DocsTopic) =>
  topic.example
    ? `${topic.body}\n\n示例：\n${codeBlock(topic.example)}`
    : topic.body;
