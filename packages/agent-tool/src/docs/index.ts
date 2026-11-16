import {
  LAYOUT_ALGORITHM_IDS,
  SHAPE_IDS,
  hashString,
} from "@excalidraw/element";

import { canvasApiDocumentation } from "../api-documentation.generated.js";
import { CANVAS_SDK_ERROR_CODES, CanvasSdkError } from "../sdk/errors.js";

import { DOCS_GUIDES, docsTopicText } from "./topics.js";

import type {
  CanvasDocsApi,
  CanvasDocsIndex,
  CanvasDocsKind,
  CanvasDocsReadInput,
  CanvasDocsReadResult,
  CanvasDocsSearchInput,
  CanvasDocsSearchResult,
} from "../sdk/types.js";
import type { DocsTopic } from "./topics.js";

const MAX_RESPONSE_LENGTH = 4000;
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;
const SNIPPET_LENGTH = 120;

const docsVersion = hashString(
  JSON.stringify({
    topics: DOCS_GUIDES.map((guide) => ({
      id: guide.id,
      title: guide.title,
      topics: guide.topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        body: topic.body,
        example: topic.example ?? null,
      })),
    })),
    api: canvasApiDocumentation,
  }),
).toString(36);

const allTopics: DocsTopic[] = DOCS_GUIDES.flatMap((guide) => guide.topics);

const codeBlock = (code: string) => `\`\`\`js\n${code}\n\`\`\``;

const readGuideText = (guideIndex: number): string => {
  const guide = DOCS_GUIDES[guideIndex];
  return [
    `${guide.id}（${guide.title}）`,
    guide.summary,
    "topics：",
    ...guide.topics.map(
      (topic) => `- ${topic.id}（${topic.title}）：${topic.summary}`,
    ),
    `读取正文：canvas.docs.read({ guide: "${guide.id}", topic: "<topic>" })。`,
  ].join("\n");
};

const readTopic = (
  guideIndex: number,
  topic: DocsTopic,
  includeExamples: boolean,
): CanvasDocsReadResult => {
  const guide = DOCS_GUIDES[guideIndex];
  const withExample = includeExamples || guide.id === "examples";
  const fullText = `# ${guide.id}/${topic.id} ${topic.title}\n\n${
    withExample ? docsTopicText(topic) : topic.body
  }`;
  if (fullText.length > MAX_RESPONSE_LENGTH) {
    const hint = [
      "",
      `[truncated] 正文共 ${fullText.length} 字符，超过单次返回上限 ${MAX_RESPONSE_LENGTH} 字符。`,
      '钻取：用 canvas.docs.search({ query }) 定位具体符号，或用 canvas.schema.get({ type: "apply" }) 获取 apply 的 JSON Schema。',
    ].join("\n");
    const head = fullText.slice(0, MAX_RESPONSE_LENGTH - hint.length);
    return {
      docsVersion,
      guide: guide.id,
      topic: topic.id,
      text: `${head}${hint}`,
      truncated: true,
      fullLength: fullText.length,
    };
  }
  return {
    docsVersion,
    guide: guide.id,
    topic: topic.id,
    text: fullText,
    truncated: false,
  };
};

const read = (input: CanvasDocsReadInput): CanvasDocsReadResult => {
  const guideIndex = DOCS_GUIDES.findIndex((guide) => guide.id === input.guide);
  if (guideIndex < 0) {
    throw new CanvasSdkError("target_not_found", `未知 guide: ${input.guide}`, {
      guide: input.guide,
      availableGuides: DOCS_GUIDES.map((guide) => guide.id),
    });
  }
  const guide = DOCS_GUIDES[guideIndex];
  if (!input.topic) {
    return {
      docsVersion,
      guide: guide.id,
      text: readGuideText(guideIndex),
      truncated: false,
    };
  }
  const topic = guide.topics.find((entry) => entry.id === input.topic);
  if (!topic) {
    throw new CanvasSdkError(
      "target_not_found",
      `未知 topic: ${guide.id}/${input.topic}`,
      {
        guide: guide.id,
        availableTopics: guide.topics.map((entry) => entry.id),
      },
    );
  }
  return readTopic(guideIndex, topic, Boolean(input.includeExamples));
};

const scoreTopic = (topic: DocsTopic, query: string): number => {
  let score = 0;
  if (topic.title.toLowerCase().includes(query)) {
    score += 3;
  }
  if (topic.summary.toLowerCase().includes(query)) {
    score += 2;
  }
  if (topic.body.toLowerCase().includes(query)) {
    score += 1;
  }
  return score;
};

const snippetOf = (topic: DocsTopic, query: string): string => {
  const content = `${topic.title}\n${topic.summary}\n${topic.body}`;
  const index = content.toLowerCase().indexOf(query);
  if (index < 0) {
    return topic.summary.slice(0, SNIPPET_LENGTH);
  }
  const start = Math.max(0, index - Math.floor(SNIPPET_LENGTH / 3));
  const end = Math.min(content.length, start + SNIPPET_LENGTH);
  const snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${snippet}${end < content.length ? "…" : ""}`;
};

const search = (input: CanvasDocsSearchInput): CanvasDocsSearchResult => {
  const query = input.query.trim().toLowerCase();
  if (!query) {
    return { docsVersion, items: [], total: 0 };
  }
  const limit = Math.min(
    Math.max(1, input.limit ?? DEFAULT_SEARCH_LIMIT),
    MAX_SEARCH_LIMIT,
  );
  const matches = allTopics
    .map((topic, order) => ({ topic, order, score: scoreTopic(topic, query) }))
    .filter(
      (entry) =>
        entry.score > 0 && (!input.kind || entry.topic.kind === input.kind),
    )
    .sort(
      (left, right) => right.score - left.score || left.order - right.order,
    );
  return {
    docsVersion,
    items: matches.slice(0, limit).map(({ topic }) => ({
      guide: topic.guide,
      topic: topic.id,
      title: topic.title,
      snippet: snippetOf(topic, query),
    })),
    total: matches.length,
  };
};

const index = (input?: { kind?: CanvasDocsKind }): CanvasDocsIndex => ({
  docsVersion,
  guides: DOCS_GUIDES.map((guide) => ({
    id: guide.id,
    title: guide.title,
    summary: guide.summary,
    topics: guide.topics
      .filter((topic) => !input?.kind || topic.kind === input.kind)
      .map((topic) => ({
        id: topic.id,
        title: topic.title,
        summary: topic.summary,
        kind: topic.kind,
      })),
  })),
});

export const createDocsApi = (): CanvasDocsApi =>
  Object.freeze({
    index: async (input) => index(input),
    read: async (input) => read(input),
    search: async (input) => search(input),
  });

export const buildCanvasOverviewText = (): string =>
  [
    "# Excalidraw Canvas SDK",
    "工具：",
    "- canvas_overview：本页规则与索引（只读）。",
    '- canvas_docs：{ action: "index" | "read" | "search" } 查询文档（只读）。',
    "- execute_code：执行 JS，注入 canvas SDK（读/写）。",
    "- canvas_export：导出 JSON 快照（只读）。",
    "硬规则：",
    "- 不要手写 canonical JSON；用 canvas.apply 的语义操作创建/修改元素，服务端生成 id/seed/index/version。",
    "- 同批引用用 tempId，回执 tempIds 给出映射。",
    "- apply 是原子批：任一操作失败整批回滚。",
    "- 布局由发起写入的一方计算：新建后用 canvas.layout.apply。",
    "- canvas.generate 可从结构化 spec 一次生成 diagram/sequence/mindmap/table，并在同一事务内完成布局。",
    '- 时序图用 op: "sequence" 的 addParticipant/addMessage/addFragment；布局用 algorithm: "sequence"。',
    "- 默认在 worker_threads + vm 中执行：默认 30s 超时、256MB、10000 次调用、4MB 结果上限；vm 不是安全边界。",
    "- canvas.export 支持 json/svg/png；PNG 在 Node 端光栅化。",
    "- local_applied 仅表示本地提交成功，不代表远端持久化。",
    "- 写入要求 execute_code 的 mode 为 write 且会话可编辑。",
    "示例：",
    codeBlock(
      `const r = await canvas.apply({ ops: [...] });\nawait canvas.layout.apply({ ids: Object.values(r.tempIds), algorithm: "layered" });`,
    ),
    "文档索引：",
    ...DOCS_GUIDES.map(
      (guide) =>
        `- ${guide.id}（${guide.title}，${guide.topics.length} 个 topic）`,
    ),
    '读取正文：canvas_docs({ action: "read", guide: "core", topic: "conventions" })。',
    `shape kind（${SHAPE_IDS.length}）：${SHAPE_IDS.join("、")}`,
    `layout 算法（${LAYOUT_ALGORITHM_IDS.length}）：${LAYOUT_ALGORITHM_IDS.join(
      "、",
    )}`,
    `错误码：${CANVAS_SDK_ERROR_CODES.join("、")}`,
  ].join("\n\n");
