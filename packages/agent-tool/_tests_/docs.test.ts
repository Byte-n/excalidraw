import { LAYOUT_ALGORITHM_IDS, SHAPE_IDS } from "@excalidraw/element";

import { buildCanvasOverviewText, createDocsApi } from "../src/docs/index";

const docs = createDocsApi();

test("canvas_overview 一页文本小于 4000 字符", () => {
  const text = buildCanvasOverviewText();
  expect(text.length).toBeLessThan(4000);
  expect(text).toContain("canvas.apply");
  expect(text).toContain("tempId");
});

test("index 返回 9 个 guide，并在允许时按 kind 过滤 topic", async () => {
  const index = await docs.index();
  expect(index.guides.map((guide) => guide.id)).toEqual([
    "core",
    "shapes",
    "connectors",
    "mindmap",
    "sequence",
    "generate",
    "runtime",
    "layout",
    "document",
    "errors",
    "examples",
  ]);
  expect(index.docsVersion.length).toBeGreaterThan(0);
  const shapes = await docs.index({ kind: "shape" });
  expect(shapes.guides.flatMap((guide) => guide.topics)).toEqual([
    {
      id: "catalog",
      title: "shape 目录",
      summary: expect.any(String),
      kind: "shape",
    },
  ]);
});

test("shapes/catalog 列出全部 60 个 shape id", async () => {
  const result = await docs.read({ guide: "shapes", topic: "catalog" });
  expect(SHAPE_IDS).toHaveLength(60);
  for (const id of SHAPE_IDS) {
    expect(result.text).toContain(id);
  }
});

test("layout/algorithms 列出全部 9 个算法", async () => {
  const result = await docs.read({ guide: "layout", topic: "algorithms" });
  expect(LAYOUT_ALGORITHM_IDS).toHaveLength(9);
  for (const id of LAYOUT_ALGORITHM_IDS) {
    expect(result.text).toContain(id);
  }
});

test("sequence guide 说明参与者、消息、片段与时序布局", async () => {
  const participants = await docs.read({
    guide: "sequence",
    topic: "participants",
  });
  expect(participants.text).toContain("addParticipant");
  const messages = await docs.read({ guide: "sequence", topic: "messages" });
  expect(messages.text).toContain("activationId");
  const fragments = await docs.read({ guide: "sequence", topic: "fragments" });
  expect(fragments.text).toContain("insertRowAt");
  const layout = await docs.read({ guide: "sequence", topic: "layout" });
  expect(layout.text).toContain("rankGap");
});

test("generate guide 覆盖 diagram/sequence/mindmap/table", async () => {
  const index = await docs.index();
  expect(
    index.guides
      .find((guide) => guide.id === "generate")
      ?.topics.map((topic) => topic.id),
  ).toEqual(["diagram", "sequence", "mindmap", "table"]);
  const diagram = await docs.read({ guide: "generate", topic: "diagram" });
  expect(diagram.text).toContain("unsupported_format");
  const sequence = await docs.read({ guide: "generate", topic: "sequence" });
  expect(sequence.text).toContain("participants");
  const mindmap = await docs.read({ guide: "generate", topic: "mindmap" });
  expect(mindmap.text).toContain("top-to-bottom");
  const table = await docs.read({ guide: "generate", topic: "table" });
  expect(table.text).toContain("maxWidth");
});

test("runtime guide 说明沙箱、超时与配额", async () => {
  const index = await docs.index();
  expect(
    index.guides
      .find((guide) => guide.id === "runtime")
      ?.topics.map((topic) => topic.id),
  ).toEqual(["sandbox", "quotas"]);
  const sandbox = await docs.read({ guide: "runtime", topic: "sandbox" });
  expect(sandbox.text).toContain("不是安全边界");
  const quotas = await docs.read({ guide: "runtime", topic: "quotas" });
  expect(quotas.text).toContain("execution_timeout");
  expect(quotas.text).toContain("quota_exceeded");
});

test("document/export 说明 SVG/PNG 与尺寸上限", async () => {
  const result = await docs.read({ guide: "document", topic: "export" });
  expect(result.text).toContain("svg");
  expect(result.text).toContain("png");
  expect(result.text).toContain("8192");
});

test("errors/codes 含 version_conflict 与可重试说明", async () => {
  const result = await docs.read({ guide: "errors", topic: "codes" });
  expect(result.text).toContain("version_conflict");
  expect(result.text).toContain("可重试");
});

test("core/conventions 说明 tempId 与禁止手写 canonical JSON", async () => {
  const result = await docs.read({ guide: "core", topic: "conventions" });
  expect(result.text).toContain("tempId");
  expect(result.text).toContain("不要手写 canonical JSON");
  expect(result.truncated).toBe(false);
});

test("core/api 含自动生成的签名与 docsVersion", async () => {
  const result = await docs.read({ guide: "core", topic: "api" });
  expect(result.text).toContain("scene.get(");
  expect(result.text).toContain("apply(");
  expect(result.docsVersion.length).toBeGreaterThan(0);
});

test("超过 4000 字符的 read 返回截断摘要与 fullLength", async () => {
  const result = await docs.read({ guide: "core", topic: "api" });
  expect(result.truncated).toBe(true);
  expect(result.fullLength ?? 0).toBeGreaterThan(4000);
});

const readError = async (input: { guide: string; topic?: string }) => {
  try {
    await docs.read(input);
  } catch (error) {
    return error as { code?: string; details?: Record<string, unknown> };
  }
  throw new Error("读取应当失败");
};

test("未知 guide 抛 target_not_found 并附可用 guide", async () => {
  const error = await readError({ guide: "missing" });
  expect(error.code).toBe("target_not_found");
  expect(error.details?.availableGuides).toEqual(
    expect.arrayContaining(["core"]),
  );
});

test("未知 topic 抛 target_not_found 并附可用 topic", async () => {
  const error = await readError({ guide: "core", topic: "missing" });
  expect(error.code).toBe("target_not_found");
  expect(error.details?.guide).toBe("core");
  expect(error.details?.availableTopics).toEqual(
    expect.arrayContaining(["conventions", "workflow"]),
  );
});

test("search 命中 core/workflow 且无结果返回空 items", async () => {
  const result = await docs.search({ query: "tempId" });
  expect(result.total).toBeGreaterThan(0);
  expect(result.items.map((item) => `${item.guide}/${item.topic}`)).toContain(
    "core/workflow",
  );
  const empty = await docs.search({ query: "no-such-doc-term" });
  expect(empty.items).toEqual([]);
  expect(empty.total).toBe(0);
});
