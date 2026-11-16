// Test doubles intentionally expose partial collaboration capabilities.
// @ts-nocheck
import { createCanvasExportTool, createCanvasScriptTools } from "../src";

import { rectangle, sessionFixture, withScene } from "./helpers";

const fixture = sessionFixture();
const { session } = fixture;
afterAll(() => fixture.dispose());
afterEach(() => vi.restoreAllMocks());
const canvasId = "00000000-0000-4000-8000-000000000001";
const port: any = {
  executor: {
    execute: async () => ({
      ok: true,
      status: "read",
      result: null,
      receipts: [],
    }),
  },
  sessionFactory: () => session,
};

test("script tools expose exactly four names without touching the DOM", async () => {
  const tools = createCanvasScriptTools(port);
  expect(tools.map((tool) => tool.name)).toEqual([
    "canvas_overview",
    "canvas_docs",
    "execute_code",
    "canvas_export",
  ]);
  const overview = await tools[0].execute({});
  for (const name of [
    "canvas_overview",
    "canvas_docs",
    "execute_code",
    "canvas_export",
  ]) {
    expect(overview.result.text).toContain(name);
  }
  expect(overview.result.text).toContain("canvas.apply");
  expect(overview.result.text).toContain("canvas.layout.apply");
  expect(overview.result.text).toContain("local_applied");
  expect(overview.result.text).toContain("tempId");
  expect(overview.result.text).toContain("rectangle");
  expect(overview.result.text).toContain("layered");
});

test("canvas_docs 按 action 查询 guide/topic 文档", async () => {
  const tool = createCanvasScriptTools(port)[1];
  const read = await tool.execute({
    action: "read",
    guide: "core",
    topic: "conventions",
  });
  expect(read.result.text).toContain("tempId");
  expect(read.result.docsVersion).toBeTruthy();
  expect(read.result.truncated).toBe(false);

  const index = await tool.execute({ action: "index" });
  expect(index.result.text).toContain("core");
  expect(index.result.text).toContain("shapes/catalog");

  const search = await tool.execute({ action: "search", query: "tempId" });
  expect(search.result.text).toContain("core/workflow");

  await expect(
    tool.execute({ action: "read", guide: "missing" }),
  ).rejects.toThrow();
  await expect(tool.execute({ member: "mutate" })).rejects.toThrow();
});

test("script and export validate strict envelopes and host JSON output", async () => {
  const tools = createCanvasScriptTools(port);
  expect(
    (await tools[2].execute({ canvasId, code: "return null", mode: "read" }))
      .ok,
  ).toBe(true);
  expect((await tools[3].execute({ canvasId, format: "json" })).ok).toBe(true);
  await expect(
    tools[2].execute({
      canvasId,
      code: "return null",
      mode: "read",
      token: "private",
    }),
  ).rejects.toThrow();
  await expect(
    tools[3].execute({ canvasId, filePath: "/tmp/a" }),
  ).rejects.toThrow();
  await expect(
    tools[3].execute({ canvasId, format: "webp" }),
  ).rejects.toThrow();
  const invalid = createCanvasScriptTools({
    ...port,
    executor: {
      execute: async () => ({ ok: true, status: "read", result: () => 1 }),
    },
  });
  await expect(
    invalid[2].execute({ canvasId, code: "return 1", mode: "read" }),
  ).rejects.toThrow();
});

test("export 返回一次快照副本并保留墓碑/绑定/资产元数据，不泄露敏感字段", async () => {
  const scene = {
    elements: [
      {
        ...rectangle(),
        id: "deleted",
        isDeleted: true,
        boundElements: [{ id: "arrow", type: "arrow" }],
      },
    ],
    assets: {
      file: { storageFileId: canvasId, mimeType: "image/png", size: 3 },
    },
  };
  const tool = createCanvasExportTool({
    sessionFactory: () => withScene(session, scene),
  });
  const result = await tool.execute({ canvasId });
  if (!result.ok) {
    throw new Error("导出应成功");
  }
  expect(result.result).toMatchObject({
    canvasId,
    schemaVersion: 2,
    elements: [
      {
        id: "deleted",
        isDeleted: true,
        boundElements: scene.elements[0].boundElements,
      },
    ],
    assets: scene.assets,
  });
  const snapshot = result.result;
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    !Array.isArray(snapshot.elements)
  ) {
    throw new Error("导出应包含场景元素");
  }
  const element = snapshot.elements[0];
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    throw new Error("导出应包含 canonical 元素");
  }
  expect(element.isDeleted).toBe(true);
  expect(JSON.stringify(result)).not.toContain("signedUrl");
  element.id = "changed";
  expect(scene.elements[0].id).toBe("deleted");
});

test("导出拒绝未同步会话和取消，且不转移会话关闭职责", async () => {
  const f = sessionFixture();
  const close = vi.fn(f.session.close);
  const tool = createCanvasExportTool({
    sessionFactory: () => ({ ...f.session, close }),
  });
  try {
    f.binding.setGate({ synced: false });
    await expect(tool.execute({ canvasId })).rejects.toMatchObject({
      code: "session_unavailable",
    });
    f.binding.setGate({ synced: true });
    const controller = new AbortController();
    controller.abort();
    await expect(
      tool.execute({ canvasId }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "execution_cancelled" });
    await tool.execute({ canvasId });
    expect(close).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});

test("异步会话工厂等待期间取消后不读取场景", async () => {
  const controller = new AbortController();
  const getSceneSnapshot = vi.fn(session.getSceneSnapshot);
  const tool = createCanvasExportTool({
    sessionFactory: async () => {
      await Promise.resolve();
      controller.abort();
      return { ...session, getSceneSnapshot };
    },
  });
  await expect(
    tool.execute({ canvasId }, { signal: controller.signal }),
  ).rejects.toMatchObject({ code: "execution_cancelled" });
  expect(getSceneSnapshot).not.toHaveBeenCalled();
});

test("导出拒绝非法 canonical 和访问器，不调用 getter 或 toJSON", async () => {
  const malformed = createCanvasExportTool({
    sessionFactory: () =>
      withScene(session, {
        elements: [{ ...rectangle(), version: 0 }],
        assets: {},
      }),
  });
  await expect(malformed.execute({ canvasId })).rejects.toThrow();
  const getter = vi.fn(() => []);
  const toJSON = vi.fn(() => ({}));
  const unsafe = { elements: [], assets: {} };
  Object.defineProperty(unsafe, "elements", { enumerable: true, get: getter });
  const accessorTool = createCanvasExportTool({
    sessionFactory: () => withScene(session, unsafe),
  });
  await expect(accessorTool.execute({ canvasId })).rejects.toMatchObject({
    code: "invalid_scene",
  });
  expect(getter).not.toHaveBeenCalled();
  const jsonTool = createCanvasExportTool({
    sessionFactory: () =>
      withScene(session, { elements: [], assets: { unsafe: { toJSON } } }),
  });
  await expect(jsonTool.execute({ canvasId })).rejects.toMatchObject({
    code: "invalid_scene",
  });
  expect(toJSON).not.toHaveBeenCalled();
});

test("canvas_export 支持 svg/png", async () => {
  const tool = createCanvasExportTool({
    sessionFactory: () =>
      withScene(session, { elements: [rectangle()], assets: {} }),
  });
  const svg = await tool.execute({ canvasId, format: "svg" });
  if (!svg.ok) {
    throw new Error("SVG 导出应成功");
  }
  expect(svg.result).toMatchObject({ canvasId, format: "svg" });
  const svgResult = svg.result as { data: string; width: number };
  expect(svgResult.data).toContain("<svg");
  expect(svgResult.width).toBeGreaterThan(0);

  const png = await tool.execute({ canvasId, format: "png", scale: 2 });
  if (!png.ok) {
    throw new Error("PNG 导出应成功");
  }
  const pngResult = png.result as { data: string; width: number };
  expect(pngResult.width).toBeGreaterThan(0);
  expect(
    Buffer.from(pngResult.data, "base64")
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ).toBe(true);
});

test("失败结果保留此前实际提交回执，取消错误沿稳定协议返回", async () => {
  const tool = createCanvasScriptTools({
    ...port,
    executor: {
      execute: async () => ({
        ok: false,
        error: { code: "execution_cancelled", message: "脚本执行已取消" },
        receipts: [
          {
            method: "mutate",
            receipt: {
              changedElementIds: ["a"],
              createdElementIds: ["a"],
              deletedElementIds: [],
              versions: { a: 1 },
            },
          },
        ],
      }),
    },
  })[2];
  const result = await tool.execute({
    canvasId,
    code: "return 1",
    mode: "write",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.receipts).toHaveLength(1);
  }
});
