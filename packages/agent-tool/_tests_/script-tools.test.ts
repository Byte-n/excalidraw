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

test("export 返回一次快照副本并保留墓碑/绑定/资产元数据，不泄露敏感字段", async () => {
  const scene = { canvasId, schemaVersion: 2, elements: [{ id: 'deleted', isDeleted: true, boundElements: [{ id: 'arrow', type: 'arrow' }] }], assets: { file: { storageFileId: canvasId, mimeType: 'image/png', size: 3 } } };
  const tool = createCanvasScriptTools({ ...port, exportScene: async () => ({ ok: true, status: 'read', result: structuredClone(scene) }) })[3];
  const result = await tool.execute({ canvasId });
  expect(result.result.elements[0].isDeleted).toBe(true);
  expect(result.result.assets.file.storageFileId).toBe(canvasId);
  expect(JSON.stringify(result)).not.toContain('signedUrl');
  result.result.elements[0].id = 'changed';
  expect(scene.elements[0].id).toBe('deleted');
});

test("失败结果保留此前实际提交回执，取消错误沿稳定协议返回", async () => {
  const tool = createCanvasScriptTools({
    ...port,
    executeCode: async () => ({ ok: false, error: { code: 'execution_cancelled', message: '脚本执行已取消' }, receipts: [{ method: 'mutate', receipt: { changedElementIds: ['a'], createdElementIds: ['a'], deletedElementIds: [], versions: { a: 1 } } }] }),
  })[2];
  const result = await tool.execute({ canvasId, code: 'return 1', mode: 'write' });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.receipts).toHaveLength(1);
});
