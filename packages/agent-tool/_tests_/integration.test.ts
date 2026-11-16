import { createCanvasExecuteCodeTool } from "../src";

import { sessionFixture } from "./helpers";

const canvasId = "00000000-0000-4000-8000-000000000001";

type SceneBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type SceneShape = SceneBox & { label: string | null };
type SceneArrow = { id: string; start: string | null; end: string | null };
type MindmapNode = SceneBox & { text: string | null };

let fixture: ReturnType<typeof sessionFixture>;
let tool: ReturnType<typeof createCanvasExecuteCodeTool>;

beforeEach(() => {
  fixture = sessionFixture();
  tool = createCanvasExecuteCodeTool({
    sessionFactory: () => fixture.session,
  });
});

afterEach(async () => {
  await fixture.dispose();
});

const receiptMethods = (receipts: unknown[] | undefined) =>
  (receipts ?? []).map((entry) => (entry as { method: string }).method);

const sceneTotal = async () => {
  const result = await tool.execute({
    canvasId,
    mode: "read",
    code: "const scene = await canvas.scene.get({ view: 'summary' }); return scene.total;",
  });
  if (!result.ok) {
    throw new Error(`读取场景失败: ${result.error.code}`);
  }
  return result.result as unknown as number;
};

const overlapArea = (left: SceneBox, right: SceneBox) => {
  const width =
    Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x);
  const height =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  return width > 0 && height > 0 ? width * height : 0;
};

test("execute_code 一次脚本完成整图创建、布局、文档查询并读回场景", async () => {
  const result = await tool.execute({
    canvasId,
    mode: "write",
    code: `
      const receipt = await canvas.apply({
        ops: [
          { op: "addShape", tempId: "start", kind: "fc-terminator", x: 0, y: 0, label: "开始" },
          { op: "addShape", tempId: "check", kind: "fc-diamond", x: 0, y: 200, label: "是否通过？" },
          { op: "addShape", tempId: "end", kind: "fc-terminator", x: 0, y: 400, label: "结束" },
          { op: "connect", from: "start", to: "check" },
          { op: "connect", from: "check", to: "end", label: "是" },
        ],
      });
      const layout = await canvas.layout.apply({
        ids: [receipt.tempIds.start, receipt.tempIds.check, receipt.tempIds.end],
        algorithm: "layered",
        origin: { x: 0, y: 0 },
      });
      const docs = await canvas.docs.read({ guide: "core", topic: "conventions" });
      const scene = await canvas.scene.get({ view: "summary" });
      const elements = await canvas.scene.getElements(receipt.createdElementIds);
      const shapes = elements.filter((element) => element.type !== "arrow");
      const arrows = elements.filter((element) => element.type === "arrow");
      return {
        tempIds: receipt.tempIds,
        layoutToken: layout.layoutToken,
        docsVersion: docs.docsVersion,
        total: scene.total,
        shapes: shapes.map((element) => ({
          id: element.id,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          label:
            element.texts && element.texts.body
              ? element.texts.body.text
              : null,
        })),
        arrows: arrows.map((element) => ({
          id: element.id,
          start: element.startBinding ? element.startBinding.elementId : null,
          end: element.endBinding ? element.endBinding.elementId : null,
        })),
      };
    `,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.status).toBe("local_applied");
  expect(receiptMethods(result.receipts)).toEqual(
    expect.arrayContaining(["apply", "layout.apply"]),
  );
  expect(result.receipts?.length ?? 0).toBeGreaterThanOrEqual(2);

  const payload = result.result as unknown as {
    tempIds: Record<string, string>;
    layoutToken: string;
    docsVersion: string;
    total: number;
    shapes: SceneShape[];
    arrows: SceneArrow[];
  };
  expect(Object.keys(payload.tempIds)).toHaveLength(3);
  expect(payload.layoutToken).toBeTruthy();
  expect(payload.docsVersion).toBeTruthy();
  expect(payload.total).toBe(5);

  const shapeIds = new Set(Object.values(payload.tempIds));
  expect(payload.shapes).toHaveLength(3);
  expect(payload.shapes.map((shape) => shape.label).sort()).toEqual(
    ["开始", "是否通过？", "结束"].sort(),
  );

  expect(payload.arrows).toHaveLength(2);
  for (const arrow of payload.arrows) {
    expect(shapeIds.has(arrow.start ?? "")).toBe(true);
    expect(shapeIds.has(arrow.end ?? "")).toBe(true);
  }
  expect(payload.arrows).toEqual(
    expect.arrayContaining([
      {
        id: expect.any(String),
        start: payload.tempIds.start,
        end: payload.tempIds.check,
      },
      {
        id: expect.any(String),
        start: payload.tempIds.check,
        end: payload.tempIds.end,
      },
    ]),
  );

  for (let left = 0; left < payload.shapes.length; left++) {
    for (let right = left + 1; right < payload.shapes.length; right++) {
      expect(overlapArea(payload.shapes[left], payload.shapes[right])).toBe(0);
    }
  }
});

test("脑图节点改名触发整图重排并更新正文", async () => {
  const created = await tool.execute({
    canvasId,
    mode: "write",
    code: `
      const receipt = await canvas.apply({
        ops: [
          { op: "mindmap", action: "createRoot", tempId: "root", x: 0, y: 0, text: "产品" },
          { op: "mindmap", action: "addChild", tempId: "left", nodeId: "root", text: "需求" },
          { op: "mindmap", action: "addChild", tempId: "right", nodeId: "root", text: "设计" },
        ],
      });
      const elements = await canvas.scene.getElements([
        receipt.tempIds.left,
        receipt.tempIds.right,
      ]);
      return {
        tempIds: receipt.tempIds,
        nodes: elements.map((element) => ({
          id: element.id,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          text:
            element.texts && element.texts.body
              ? element.texts.body.text
              : null,
        })),
      };
    `,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) {
    return;
  }
  const before = created.result as unknown as {
    tempIds: Record<string, string>;
    nodes: MindmapNode[];
  };
  expect(Object.keys(before.tempIds)).toHaveLength(3);
  expect(before.nodes).toHaveLength(2);
  expect(before.nodes.map((node) => node.text).sort()).toEqual(
    ["需求", "设计"].sort(),
  );

  const renamedId = before.tempIds.left;
  const siblingId = before.tempIds.right;
  const renamed = await tool.execute({
    canvasId,
    mode: "write",
    code: `
      await canvas.apply({
        ops: [
          {
            op: "mindmap",
            action: "rename",
            nodeId: ${JSON.stringify(renamedId)},
            text: "一个明显更长的节点标题文本",
          },
        ],
      });
      const elements = await canvas.scene.getElements([
        ${JSON.stringify(renamedId)},
        ${JSON.stringify(siblingId)},
      ]);
      return elements.map((element) => ({
        id: element.id,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        text:
          element.texts && element.texts.body ? element.texts.body.text : null,
      }));
    `,
  });
  expect(renamed.ok).toBe(true);
  if (!renamed.ok) {
    return;
  }
  const after = renamed.result as unknown as MindmapNode[];
  const renamedBefore = before.nodes.find((node) => node.id === renamedId)!;
  const siblingBefore = before.nodes.find((node) => node.id === siblingId)!;
  const renamedAfter = after.find((node) => node.id === renamedId)!;
  const siblingAfter = after.find((node) => node.id === siblingId)!;

  expect(renamedAfter.text).toBe("一个明显更长的节点标题文本");
  expect(siblingAfter.text).toBe(siblingBefore.text);
  expect(
    renamedAfter.width > renamedBefore.width ||
      siblingAfter.x !== siblingBefore.x ||
      siblingAfter.y !== siblingBefore.y,
  ).toBe(true);
});

test("read 模式拒绝写入且不改变场景元素数量", async () => {
  const before = await sceneTotal();

  const attempt = await tool.execute({
    canvasId,
    mode: "read",
    code: `
      return await canvas.apply({
        ops: [{ op: "addShape", kind: "rectangle", x: 0, y: 0 }],
      });
    `,
  });
  expect(attempt.ok).toBe(false);
  if (attempt.ok) {
    return;
  }
  expect(attempt.error.code).toBe("not_editable");
  expect(attempt.receipts ?? []).toHaveLength(0);

  expect(await sceneTotal()).toBe(before);
});
