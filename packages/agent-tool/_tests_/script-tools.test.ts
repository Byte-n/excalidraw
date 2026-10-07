import { createCanvasScriptTools } from "../src";

const canvasId = "00000000-0000-4000-8000-000000000001";
const port = {
  executeCode: async () => ({ ok: true, status: "read", result: null, receipts: [] }),
  exportScene: async () => ({ ok: true, status: "read", result: { canvasId, schemaVersion: 2, elements: [], assets: {} } }),
};

test("script tools expose exactly four names and require no DOM or host runtime", async () => {
  expect(typeof document).toBe("undefined");
  const tools = createCanvasScriptTools(port);
  expect(tools.map((tool) => tool.name)).toEqual(["high_level_overview", "collaboration_api_info", "execute_code", "export"]);
  const overview = await tools[0].execute({});
  expect(overview.result.text).toContain("local_applied");
});

test("collaboration docs cover every public promise method and member lookup", async () => {
  const tool = createCanvasScriptTools(port)[1];
  const all = await tool.execute({});
  for (const member of ["getScene", "getElements", "query", "createElement", "mutate", "execute"]) {
    expect(all.result.text).toContain(`${member}(`);
    expect((await tool.execute({ member })).result.text).toContain("Promise<");
  }
  await expect(tool.execute({ member: "close" })).rejects.toThrow();
});

test("script and export validate strict envelopes and host JSON output", async () => {
  const tools = createCanvasScriptTools(port);
  expect((await tools[2].execute({ canvasId, code: "return null", mode: "read" })).ok).toBe(true);
  expect((await tools[3].execute({ canvasId })).ok).toBe(true);
  await expect(tools[2].execute({ canvasId, code: "return null", mode: "read", token: "private" })).rejects.toThrow();
  await expect(tools[3].execute({ canvasId, filePath: "/tmp/a" })).rejects.toThrow();
  const invalid = createCanvasScriptTools({ ...port, executeCode: async () => ({ ok: true, status: "read", result: () => 1 }) });
  await expect(invalid[2].execute({ canvasId, code: "return 1", mode: "read" })).rejects.toThrow();
});
