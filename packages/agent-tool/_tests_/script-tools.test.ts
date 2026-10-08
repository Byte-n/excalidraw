import { createCanvasExportTool, createCanvasScriptTools } from "../src";

import { rectangle, sessionFixture, withScene } from "./helpers";

const fixture = sessionFixture();
const { session } = fixture;
afterAll(() => fixture.dispose());
afterEach(() => vi.restoreAllMocks());
const canvasId = "00000000-0000-4000-8000-000000000001";
const port = {
  executor: {
    execute: async () => ({
      ok: true,
      status: "read",
      result: null,
      receipts: [],
    }),
  },
  sessionFactory: () => session,
  collaborationFactory: () => ({ getScene: () => ({ elements: [] }) }),
};

test("script tools expose exactly four names and require no DOM or host runtime", async () => {
  expect(typeof document).toBe("undefined");
  const tools = createCanvasScriptTools(port);
  expect(tools.map((tool) => tool.name)).toEqual([
    "high_level_overview",
    "collaboration_api_info",
    "execute_code",
    "export",
  ]);
  const overview = await tools[0].execute({});
  expect(overview.result.text).toContain("local_applied");
});

test("collaboration docs cover every public promise method and member lookup", async () => {
  const tool = createCanvasScriptTools(port)[1];
  const all = await tool.execute({});
  for (const member of [
    "getScene",
    "getElements",
    "query",
    "createElement",
    "mutate",
    "execute",
  ]) {
    expect(all.result.text).toContain(`${member}(`);
    expect((await tool.execute({ member })).result.text).toContain("Promise<");
  }
  await expect(tool.execute({ member: "close" })).rejects.toThrow();
});

test("生成文档展开参数类型、返回字段和默认能力限制", async () => {
  const tool = createCanvasScriptTools(port)[1];
  const mutation = (await tool.execute({ member: "mutate" })).result.text;
  expect(mutation).toContain('type: "connect"');
  expect(mutation).toContain("fixedPoint: [number, number]");
  expect(mutation).toContain("changedElementIds: string[]");
  expect(mutation).toContain("1–1000");
  expect(mutation).not.toContain("仅 write 模式公开");
  expect(mutation).not.toContain("execute(");
  const execute = (await tool.execute({ member: "execute" })).result.text;
  expect(execute).toContain('action: "setCellText"');
  expect(execute).toContain("expectedVersion?: number");
  const query = (await tool.execute({ member: "query" })).result.text;
  expect(query).toContain("target_not_found");
  expect(query).toContain("ShapeQueryInput =");
  const scene = (await tool.execute({ member: "getScene" })).result.text;
  expect(scene).toContain("ExcalidrawSceneElement =");
  expect(scene).toContain("CanvasJsonValue =");
});

test("script and export validate strict envelopes and host JSON output", async () => {
  const tools = createCanvasScriptTools(port);
  expect(
    (await tools[2].execute({ canvasId, code: "return null", mode: "read" }))
      .ok,
  ).toBe(true);
  expect((await tools[3].execute({ canvasId })).ok).toBe(true);
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
    await expect(tool.execute({ canvasId })).rejects.toThrow(
      "session_unavailable",
    );
    f.binding.setGate({ synced: true });
    const controller = new AbortController();
    controller.abort();
    await expect(
      tool.execute({ canvasId }, { signal: controller.signal }),
    ).rejects.toThrow("execution_cancelled");
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
  ).rejects.toThrow("execution_cancelled");
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
  await expect(accessorTool.execute({ canvasId })).rejects.toThrow(
    "invalid_scene",
  );
  expect(getter).not.toHaveBeenCalled();
  const jsonTool = createCanvasExportTool({
    sessionFactory: () =>
      withScene(session, { elements: [], assets: { unsafe: { toJSON } } }),
  });
  await expect(jsonTool.execute({ canvasId })).rejects.toThrow("invalid_scene");
  expect(toJSON).not.toHaveBeenCalled();
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
