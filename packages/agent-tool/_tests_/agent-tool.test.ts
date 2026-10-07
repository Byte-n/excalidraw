import {
  ARROWHEAD_VALUES,
  BASE_SHAPE_IDS,
  YjsSceneError,
} from "@excalidraw/yjs";

import type { CanvasSceneOperation, CanvasLocalReceipt } from "@excalidraw/yjs";

import {
  CanvasToolResultSchema,
  ConnectorEditInputSchema,
  ShapeEditInputSchema,
  TableEditInputSchema,
  createCanvasAgentTools,
} from "../src";

import type { CanvasAgentPort } from "../src";

const queryResult = (domain: "shape" | "connector" | "mindmap" | "table") => ({
  domain,
  items: [{ id: "item-1", summary: "摘要" }],
  total: 1,
  offset: 0,
  limit: 50,
  hasMore: false,
});

const receipt = (operation: CanvasSceneOperation): CanvasLocalReceipt => {
  const action = operation.operation.action;
  const references = operation.domain === "mindmap"
    ? { domain: "mindmap" as const, action: operation.operation.action, graphId: "graph-1", nodeId: "node-1", rootNodeId: null }
    : operation.domain === "table"
    ? { domain: "table" as const, action: operation.operation.action, tableId: "table-1" }
    : operation.domain === "shape"
    ? { domain: "shape" as const, action: operation.operation.action, elementId: "element-1" }
    : { domain: "connector" as const, action: operation.operation.action, elementId: "element-1" };
  return {
    changedElementIds: ["element-1"],
    createdElementIds:
      action === "create" || action === "createRoot" ? ["element-1"] : [],
    deletedElementIds:
      action === "delete" || action === "deleteSubtree" ? ["element-1"] : [],
    result: {
      elements: [],
      changedElementIds: ["element-1"],
      createdElementIds: [],
      deletedElementIds: [],
      references,
    },
  };
};

const makePort = (
  overrides: Partial<CanvasAgentPort> = {},
): CanvasAgentPort => ({
  query: ({ domain }) => queryResult(domain),
  execute: (operation) => receipt(operation),
  ...overrides,
});

test("can import and consume tools in node without DOM globals", async () => {
  expect(typeof document).toBe("undefined");
  const tools = createCanvasAgentTools(makePort());
  expect(tools).toHaveLength(8);
  expect(
    CanvasToolResultSchema.safeParse(tools[0]!.execute({ action: "list" }))
      .success,
  ).toBe(true);
});

test("accepts every exported base shape kind", () => {
  expect(BASE_SHAPE_IDS).toHaveLength(27);
  for (const kind of BASE_SHAPE_IDS) {
    expect(
      ShapeEditInputSchema.safeParse({
        action: "create",
        kind,
        geometry: { x: 0, y: 0, width: 20, height: 20 },
      }).success,
    ).toBe(true);
  }
});

test("rejects internal scene fields at the tool boundary", () => {
  expect(
    ShapeEditInputSchema.safeParse({
      action: "create",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 20, height: 20 },
      id: "internal",
      version: 1,
      versionNonce: 1,
      index: "a",
      binding: null,
      containerRef: null,
    }).success,
  ).toBe(false);
  expect(
    TableEditInputSchema.safeParse({
      action: "create",
      position: { x: 0, y: 0 },
      rowCount: 2,
      columnCount: 2,
      cells: [],
    }).success,
  ).toBe(false);
  expect(
    ConnectorEditInputSchema.safeParse({
      action: "create",
      kind: "arrow",
      start: { point: { x: 0, y: 0 } },
      end: { point: { x: 20, y: 20 } },
      id: "internal",
    }).success,
  ).toBe(false);
});

test("dispatches all semantic domains and returns stable statuses", () => {
  const calls: CanvasSceneOperation[] = [];
  const port = makePort({
    execute: (operation) => {
      calls.push(operation);
      return receipt(operation);
    },
  });
  const tools = Object.fromEntries(
    createCanvasAgentTools(port).map((tool) => [tool.name, tool]),
  );

  expect(tools.queryShapes!.execute({ action: "list" })).toMatchObject({
    ok: true,
    status: "read",
  });
  expect(
    tools.queryConnectors!.execute({ action: "get", elementId: "connector-1" }),
  ).toMatchObject({ ok: true, status: "read" });
  expect(tools.queryMindmap!.execute({ action: "list" })).toMatchObject({
    ok: true,
    status: "read",
  });
  expect(
    tools.queryTable!.execute({ action: "get", tableId: "table-1" }),
  ).toMatchObject({ ok: true, status: "read" });

  expect(
    tools.editShapes!.execute({
      action: "create",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 20, height: 20 },
    }),
  ).toMatchObject({ ok: true, status: "local_applied" });
  expect(
    tools.editConnectors!.execute({
      action: "create",
      kind: "arrow",
      start: { point: { x: 0, y: 0 } },
      end: { point: { x: 20, y: 20 } },
      endArrowhead: ARROWHEAD_VALUES[0],
    }),
  ).toMatchObject({ ok: true, status: "local_applied" });
  expect(
    tools.editMindmap!.execute({
      action: "createRoot",
      position: { x: 0, y: 0 },
      text: "根",
    }),
  ).toMatchObject({ ok: true, status: "local_applied" });
  expect(
    tools.editTable!.execute({
      action: "create",
      position: { x: 0, y: 0 },
      rowCount: 2,
      columnCount: 2,
    }),
  ).toMatchObject({ ok: true, status: "local_applied" });
  expect(calls.map(({ domain }) => domain)).toEqual([
    "shape",
    "connector",
    "mindmap",
    "table",
  ]);
});

test("maps domain errors and malformed host output to stable errors", () => {
  const denied = createCanvasAgentTools(
    makePort({
      execute: () => {
        throw new YjsSceneError("version_conflict", "版本冲突");
      },
    }),
  )[1]!;
  expect(
    denied.execute({
      action: "create",
      kind: "rectangle",
      geometry: { x: 0, y: 0, width: 20, height: 20 },
    }),
  ).toEqual({
    ok: false,
    error: { code: "version_conflict", message: "版本冲突" },
  });

  const malformed = createCanvasAgentTools(
    makePort({
      query: () => ({
        domain: "shape",
        items: [],
        total: -1,
        offset: 0,
        limit: 50,
        hasMore: false,
      }),
    }),
  )[0]!;
  expect(malformed.execute({ action: "list" })).toEqual({
    ok: false,
    error: { code: "internal_error", message: "工具输出无效" },
  });
});
