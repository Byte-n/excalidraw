import {
  convertBoard,
  importBoard,
  materializeAssets,
  projectScene,
} from "../src/index.js";

import {
  connectorNode,
  imageNode,
  mindMapChildNode,
  mindMapRootNode,
  paintNode,
  polylineConnectorNode,
  richTextNode,
  sectionNode,
  shapeNode,
  stickyNoteNode,
  straightConnectorNode,
  tableNode,
  textShapeNode,
} from "./fixtures/lark-nodes.js";

import type {
  BoardAssetRequest,
  BoardImageResolver,
  BoardImportElement,
  BoardImportStats,
  BoardSource,
  LarkBoardNode,
  ScenePolicy,
} from "../src/index.js";

// 测试自带的场景策略：与平台策略同形，包内不依赖任何平台常量。
const POLICY: ScenePolicy = {
  maxElements: 10_000,
  maxAssets: 2_000,
  maxElementBytes: 256 * 1024,
  maxSceneBytes: 16 * 1024 * 1024,
  maxTextBytes: 64 * 1024,
  maxAssetBytes: 20 * 1024 * 1024,
  assetMimeTypes: ["image/png", "image/jpeg"],
  forbiddenPersistentFields: [
    "dataURL",
    "blob",
    "signedUrl",
    "frameId",
    "files",
  ],
};

function render(nodes: LarkBoardNode[]) {
  return convertBoard(nodes);
}

function find(
  elements: BoardImportElement[],
  predicate: (el: BoardImportElement) => boolean,
): BoardImportElement {
  const element = elements.find(predicate);
  if (!element) {
    throw new Error("element not found");
  }
  return element;
}

// 场景元素契约只声明公共字段，模型专属字段经索引签名以 unknown 读取后再落断言。
function prop<T>(element: BoardImportElement, key: string): T {
  return element[key] as T;
}

function statsOf(elements: BoardImportElement[]): BoardImportStats {
  return {
    nodes: elements.length,
    mapped: elements.length,
    droppedNodes: 0,
    droppedAssets: 0,
    downgraded: 0,
    elements: elements.length,
    assetRequests: 0,
    richTextFlattened: 0,
  };
}

test("基础图形映射：代表性类型落到对应 shape.id", () => {
  const cases: Array<[string, string]> = [
    ["round_rect", "round-rect"],
    ["rect", "rectangle"],
    ["ellipse", "ellipse"],
    ["cloud", "cloud"],
    ["brace_reverse", "brace-reverse"],
    ["round_rect2", "pill"],
    ["step2", "right-pentagon"],
  ];
  for (const [larkType, expected] of cases) {
    const { elements } = render([
      shapeNode({ id: `s-${larkType}`, composite_shape: { type: larkType } }),
    ]);
    expect(prop<{ id: string }>(elements[0], "shape").id).toBe(expected);
  }
});

test("流程图图形映射到 flow 元素族", () => {
  const cases: Array<[string, string, string]> = [
    ["flow_chart_diamond", "fc-diamond", "flow"],
    ["flow_chart_round_rect2", "fc-terminator", "flow"],
    ["flow_chart_mq", "fc-circle", "flow"],
  ];
  for (const [larkType, expectedId, expectedType] of cases) {
    const { elements } = render([
      shapeNode({ id: `f-${larkType}`, composite_shape: { type: larkType } }),
    ]);
    expect(prop<{ id: string }>(elements[0], "shape").id).toBe(expectedId);
    expect(elements[0].type).toBe(expectedType);
  }
});

test("triangle / right_triangle 共用持久化 ID 靠 apexX 区分", () => {
  const { elements } = render([
    shapeNode({ id: "t1", composite_shape: { type: "triangle" } }),
    shapeNode({ id: "t2", composite_shape: { type: "right_triangle" } }),
  ]);
  const triangle = find(elements, (el) => el.id === "t1");
  const right = find(elements, (el) => el.id === "t2");
  const apexOf = (element: BoardImportElement) =>
    prop<{ triangle?: { apexX: number } }>(element, "shape").triangle?.apexX;
  expect(prop<{ id: string }>(triangle, "shape").id).toBe("triangle");
  expect(prop<{ id: string }>(right, "shape").id).toBe("triangle");
  expect(apexOf(triangle)).toBe(0.5);
  expect(apexOf(right)).toBe(0);
});

test("未知图形类型降级为矩形", () => {
  const { elements } = render([
    shapeNode({ id: "u", composite_shape: { type: "alien_shape" } }),
  ]);
  expect(prop<{ id: string }>(elements[0], "shape").id).toBe("rectangle");
});

test("形状内嵌文本挂到 containerId，容器登记 boundElements", () => {
  const { elements } = render([shapeNode({ id: "shape1" })]);
  const shape = find(elements, (el) => el.id === "shape1");
  const text = find(elements, (el) => el.type === "text");
  expect(prop<string | null>(text, "containerId")).toBe("shape1");
  expect(text.text).toBe("开始");
  const bound = shape.boundElements ?? [];
  expect(
    bound.some((entry) => entry.id === text.id && entry.type === "text"),
  ).toBe(true);
});

test("section → frame，嵌套成员写入 containerRef.frameLike", () => {
  const { elements } = render([
    sectionNode({
      id: "root",
      x: 0,
      y: 0,
      children: ["mid"],
      section: { title: "父画框" },
    }),
    sectionNode({
      id: "mid",
      parent_id: "root",
      x: 100,
      y: 50,
      children: ["leaf"],
      section: { title: "子画框" },
    }),
    shapeNode({ id: "leaf", parent_id: "mid", x: 10, y: 20 }),
  ]);
  const root = find(elements, (el) => el.id === "root");
  const mid = find(elements, (el) => el.id === "mid");
  const leaf = find(elements, (el) => el.id === "leaf");
  expect(root.type).toBe("frame");
  expect(mid.type).toBe("frame");
  expect(prop<string | null>(root, "name")).toBe("父画框");
  expect(prop<string | null>(mid, "name")).toBe("子画框");
  expect(leaf.containerRef).toEqual({ kind: "frameLike", elementId: "mid" });
  expect(mid.containerRef).toEqual({ kind: "frameLike", elementId: "root" });
});

test("表格：cells / 合并 / 单元格文本 containerRef", () => {
  const { elements } = render([
    tableNode({
      id: "table1",
      table: {
        title: "表格",
        meta: {
          col_num: 3,
          row_num: 2,
          col_sizes: [100, 100, 100],
          row_sizes: [50, 50],
          style: {
            border_color: "#000000",
            border_width: "extra_narrow",
            border_style: "solid",
          },
        },
        cells: [
          {
            col_index: 1,
            row_index: 1,
            merge_info: { col_span: 2, row_span: 1 },
            style: { fill_color: "#f5f5f5" },
            text: {
              text: "合并",
              horizontal_align: "center",
              vertical_align: "top",
            },
          },
          {
            col_index: 2,
            row_index: 2,
            style: {},
            text: {
              text: "A1",
              horizontal_align: "center",
              vertical_align: "top",
            },
          },
        ],
      },
    }),
  ]);
  const table = find(elements, (el) => el.type === "table");
  const data = prop<{
    rows: unknown[];
    columns: unknown[];
    cells: Array<{ id: string; mergedInto?: string; columnSpan?: number }>;
  }>(table, "table");
  expect(data.rows).toHaveLength(2);
  expect(data.columns).toHaveLength(3);
  expect(data.cells).toHaveLength(6);
  const anchor = data.cells.find((cell) => cell.columnSpan === 2);
  expect(anchor?.id).toBe("table1:cell:r0c0");
  const covered = data.cells.find((cell) => cell.mergedInto === anchor?.id);
  expect(covered?.id).toBe("table1:cell:r0c1");

  const cellText = find(
    elements,
    (el) => el.type === "text" && el.text === "A1",
  );
  expect(cellText.containerRef).toEqual({
    kind: "tableCell",
    elementId: "table1",
    cellId: "table1:cell:r1c1",
    role: "backgroundText",
  });
});

test("思维导图：树关系落到 parentId 与 edge 元素", () => {
  const { elements } = render([
    sectionNode({ id: "sec", children: ["mmRoot", "mmL1"] }),
    mindMapRootNode({ id: "mmRoot", parent_id: "sec" }),
    mindMapChildNode({ id: "mmL1", parent_id: "sec" }),
  ]);
  const root = find(elements, (el) => el.id === "mmRoot");
  const child = find(elements, (el) => el.id === "mmL1");
  expect(prop<string>(root, "role")).toBe("root");
  expect(prop<string>(child, "role")).toBe("node");
  expect(prop<string | null>(child, "parentId")).toBe("mmRoot");
  expect(prop<string>(root, "graphId")).toBe(prop<string>(child, "graphId"));

  const edge = find(elements, (el) => el.id === "mmL1#edge");
  expect(edge.type).toBe("mindmap-edge");
  expect(prop<string>(edge, "parentId")).toBe("mmRoot");
  expect(prop<string>(edge, "childId")).toBe("mmL1");
});

test("便签：填充色与文本", () => {
  const { elements } = render([stickyNoteNode({ id: "sticky1" })]);
  const note = find(elements, (el) => el.type === "stickynote");
  expect(note.backgroundColor).toBe("#f6c8c8");
  const text = find(elements, (el) => el.type === "text");
  expect(prop<string | null>(text, "containerId")).toBe("sticky1");
  expect(text.text).toBe("便签文本");
});

test("自由书写：freedraw 点序列与颜色", () => {
  const { elements } = render([paintNode({ id: "paint1" })]);
  const draw = find(elements, (el) => el.type === "freedraw");
  expect(draw.strokeColor).toBe("#32a645");
  // 飞书笔宽原值直传（paint.width=24），显式等宽。
  expect(draw.strokeWidth).toBe(24);
  expect(prop<{ variability: string }>(draw, "strokeOptions").variability).toBe(
    "constant",
  );
  const points = prop<ReadonlyArray<[number, number]>>(draw, "points");
  expect(points).toHaveLength(4);
  expect([points[0][0], points[0][1]]).toEqual([0, 88]);
});

test("图片：确定性 fileId 与资产请求", () => {
  const { elements, assetRequests } = render([imageNode({ id: "img1" })]);
  const image = find(elements, (el) => el.type === "image");
  expect(image.fileId).toBe("lark-image:LRCNbkQxzo0c0zxz3zRcL93pnGe");
  expect(assetRequests).toHaveLength(1);
  expect(assetRequests[0].fileId).toBe(image.fileId);
  expect(assetRequests[0].token).toBe("LRCNbkQxzo0c0zxz3zRcL93pnGe");
});

test("图片翻转：h_flip / v_flip 落到 scale", () => {
  const { elements } = render([imageNode({ id: "img1" })]);
  const image = find(elements, (el) => el.type === "image");
  expect(prop<[number, number]>(image, "scale")).toEqual([-1, 1]);
});

test("连线三条路由：straight / polyline / curve 生成对应 points 与 roundness", () => {
  const { elements } = render([
    straightConnectorNode({ id: "c2" }),
    polylineConnectorNode({ id: "c3" }),
    connectorNode({ id: "cc" }),
  ]);
  const straight = find(elements, (el) => el.id === "c2");
  const polyline = find(elements, (el) => el.id === "c3");
  const curve = find(elements, (el) => el.id === "cc");
  expect(prop<unknown[]>(straight, "points")).toHaveLength(2);
  expect(prop<unknown[]>(polyline, "points")).toHaveLength(4);
  expect(prop<unknown[]>(curve, "points")).toHaveLength(3);
  expect(prop<unknown>(straight, "roundness")).toBeNull();
  expect(prop<{ type: number }>(curve, "roundness")).toEqual({ type: 2 });
});

test("箭头映射：15 种取值与 single_arrow 降级", () => {
  const { elements } = render([
    straightConnectorNode({ id: "line" }),
    connectorNode({ id: "multi" }),
    straightConnectorNode({
      id: "single",
      connector: {
        shape: "straight",
        start: { arrow_style: "none", position: { x: 0, y: 0 } },
        end: { arrow_style: "single_arrow", position: { x: 100, y: 0 } },
      },
    }),
    straightConnectorNode({
      id: "diamond",
      connector: {
        shape: "straight",
        start: { arrow_style: "empty_diamond_arrow", position: { x: 0, y: 0 } },
        end: { arrow_style: "x_arrow", position: { x: 100, y: 0 } },
      },
    }),
  ]);
  const line = find(elements, (el) => el.id === "line");
  expect(prop<string | null>(line, "startArrowhead")).toBeNull();
  expect(prop<string | null>(line, "endArrowhead")).toBe("arrow");
  const multi = find(elements, (el) => el.id === "multi");
  expect(prop<string | null>(multi, "endArrowhead")).toBe(
    "cardinality_one_or_many",
  );
  const single = find(elements, (el) => el.id === "single");
  expect(prop<string | null>(single, "endArrowhead")).toBe("arrow");
  const diamond = find(elements, (el) => el.id === "diamond");
  expect(prop<string | null>(diamond, "startArrowhead")).toBe(
    "diamond_outline",
  );
  expect(prop<string | null>(diamond, "endArrowhead")).toBe("x_arrow");
});

test("连线绑定：startBinding / endBinding 与目标 boundElements", () => {
  const { elements } = render([
    sectionNode({ id: "sec", children: ["shapeA", "shapeB"] }),
    shapeNode({ id: "shapeA", parent_id: "sec" }),
    shapeNode({ id: "shapeB", parent_id: "sec" }),
    connectorNode({ id: "conn1", parent_id: "sec" }),
  ]);
  const arrow = find(elements, (el) => el.id === "conn1");
  expect(arrow.startBinding?.elementId).toBe("shapeA");
  expect(arrow.startBinding?.attachPoint).toEqual([1, 0.5]);
  expect(arrow.endBinding?.elementId).toBe("shapeB");
  expect(arrow.endBinding?.attachPoint).toEqual([0, 0.5]);

  const shapeA = find(elements, (el) => el.id === "shapeA");
  expect(
    (shapeA.boundElements ?? []).some(
      (entry) => entry.id === "conn1" && entry.type === "arrow",
    ),
  ).toBe(true);
});

test("连线标签：映射为绑定到连线的文本元素", () => {
  const { elements } = render([
    sectionNode({ id: "sec", children: ["shapeA", "shapeB"] }),
    shapeNode({ id: "shapeA", parent_id: "sec" }),
    shapeNode({ id: "shapeB", parent_id: "sec" }),
    connectorNode({ id: "conn1", parent_id: "sec" }),
  ]);
  const caption = find(
    elements,
    (el) => el.type === "text" && el.text === "连接线标签文本",
  );
  expect(prop<string | null>(caption, "containerId")).toBe("conn1");
  const arrow = find(elements, (el) => el.id === "conn1");
  expect(
    (arrow.boundElements ?? []).some(
      (entry) => entry.id === caption.id && entry.type === "text",
    ),
  ).toBe(true);
});

test("index 由 zIndex 生成且互不相同", () => {
  const { elements } = render([
    shapeNode({ id: "low", z_index: 0 }),
    shapeNode({ id: "high", z_index: 9 }),
    textShapeNode({ id: "mid", z_index: 4 }),
  ]);
  const indexes = elements.map((el) => el.index);
  expect(new Set(indexes).size).toBe(indexes.length);
  for (const index of indexes) {
    expect(typeof index).toBe("string");
    expect(index.length).toBeGreaterThan(0);
  }
});

test("空场景不抛错", () => {
  const { elements, assetRequests } = render([]);
  expect(elements).toEqual([]);
  expect(assetRequests).toEqual([]);
});

test("materializeAssets：解析成功注入 assets，失败丢弃元素并计数", () => {
  const { elements, assetRequests } = render([
    imageNode({ id: "img1" }),
    shapeNode({ id: "shape1" }),
  ]);

  const dropped: BoardAssetRequest[] = [];
  const ok = materializeAssets(
    elements,
    assetRequests,
    new Map([
      [assetRequests[0].token, { storageFileId: "abc", mimeType: "image/png" }],
    ]),
    (request) => dropped.push(request),
  );
  expect(ok.dropped).toBe(0);
  expect(Object.keys(ok.assets)).toEqual([assetRequests[0].fileId]);
  expect(ok.elements.map((el) => el.id)).toContain("img1");

  const missing = materializeAssets(
    elements,
    assetRequests,
    new Map(),
    (request) => dropped.push(request),
  );
  expect(missing.dropped).toBe(1);
  expect(missing.assets).toEqual({});
  expect(missing.elements.map((el) => el.id)).not.toContain("img1");
  expect(missing.elements.map((el) => el.id)).toContain("shape1");
});

test("projectScene：通过 assertScenePolicy（含图片 fileId 命中 assets）", () => {
  const { elements, assetRequests } = render([
    imageNode({ id: "img1" }),
    shapeNode({ id: "shape1" }),
  ]);
  const { elements: finalElements, assets } = materializeAssets(
    elements,
    assetRequests,
    new Map([
      [assetRequests[0].token, { storageFileId: "f", mimeType: "image/png" }],
    ]),
    () => {},
  );
  const result = projectScene(
    finalElements,
    assets,
    statsOf(finalElements),
    POLICY,
  );
  expect(result.elements).toHaveLength(finalElements.length);
});

test("projectScene：图片 fileId 未命中 assets 时抛错", () => {
  const { elements } = render([imageNode({ id: "img1" })]);
  expect(() => projectScene(elements, {}, statsOf(elements), POLICY)).toThrow();
});

test("projectScene：元素 id 重复时抛错", () => {
  const { elements } = render([shapeNode({ id: "dup" })]);
  const duplicated = [...elements, ...elements];
  expect(() =>
    projectScene(duplicated, {}, statsOf(duplicated), POLICY),
  ).toThrow();
});

test("downgraded：未知图形子类型计一次，已知类型为 0", () => {
  const unknown = render([
    shapeNode({ id: "u", composite_shape: { type: "alien_shape" } }),
  ]);
  expect(unknown.downgraded).toBe(1);
  const known = render([shapeNode({ id: "k" })]);
  expect(known.downgraded).toBe(0);
});

test("composite_shape 未知子类型降级为矩形且各计一次，不丢弃", () => {
  const types = [
    "star2",
    "data_store3",
    "component_shape2",
    "state_start",
    "flow_chart_connector",
  ];
  const nodes = types.map((type, i) =>
    shapeNode({ id: `u${i}`, composite_shape: { type }, text: undefined }),
  );
  const { elements, downgraded } = render(nodes);
  expect(elements).toHaveLength(types.length);
  for (const element of elements) {
    expect(prop<{ id: string }>(element, "shape").id).toBe("rectangle");
  }
  expect(downgraded).toBe(types.length);
});

test("连线路由：right_angled_polyline 走折线路径，忠实还原不计降级", () => {
  const { elements, downgraded } = render([
    straightConnectorNode({
      id: "ra",
      connector: {
        shape: "right_angled_polyline",
        start: { arrow_style: "none", position: { x: 0, y: 0 } },
        end: { arrow_style: "line_arrow", position: { x: 100, y: 100 } },
        turning_points: [{ x: 0, y: 100 }],
      },
    }),
  ]);
  const arrow = find(elements, (el) => el.id === "ra");
  expect(prop<unknown[]>(arrow, "points")).toHaveLength(3);
  expect(prop<unknown>(arrow, "roundness")).toBeNull();
  expect(downgraded).toBe(0);
});

test("连线路由：right_angled_polyline 缺折点时退化为直线并计一次降级", () => {
  const { elements, downgraded } = render([
    straightConnectorNode({
      id: "ra0",
      connector: {
        shape: "right_angled_polyline",
        start: { arrow_style: "none", position: { x: 0, y: 0 } },
        end: { arrow_style: "line_arrow", position: { x: 10, y: 0 } },
      },
    }),
  ]);
  expect(
    prop<unknown[]>(
      find(elements, (el) => el.id === "ra0"),
      "points",
    ),
  ).toHaveLength(2);
  expect(downgraded).toBe(1);
});

test("连线路由：未知 shape 降级而非丢弃，计一次降级", () => {
  const withBends = render([
    straightConnectorNode({
      id: "ub",
      connector: {
        shape: "arc",
        start: { arrow_style: "none", position: { x: 0, y: 0 } },
        end: { arrow_style: "line_arrow", position: { x: 100, y: 100 } },
        turning_points: [{ x: 50, y: 20 }],
      },
    }),
  ]);
  expect(
    prop<unknown[]>(
      find(withBends.elements, (el) => el.id === "ub"),
      "points",
    ),
  ).toHaveLength(3);
  expect(withBends.downgraded).toBe(1);

  const withoutBends = render([
    straightConnectorNode({
      id: "us",
      connector: {
        shape: "arc",
        start: { arrow_style: "none", position: { x: 0, y: 0 } },
        end: { arrow_style: "line_arrow", position: { x: 10, y: 0 } },
      },
    }),
  ]);
  expect(
    prop<unknown[]>(
      find(withoutBends.elements, (el) => el.id === "us"),
      "points",
    ),
  ).toHaveLength(2);
  expect(withoutBends.downgraded).toBe(1);
});

test("downgraded：single_arrow 回落计一次", () => {
  const { downgraded, elements } = render([
    straightConnectorNode({
      id: "s",
      connector: {
        shape: "straight",
        start: { arrow_style: "none", position: { x: 0, y: 0 } },
        end: { arrow_style: "single_arrow", position: { x: 100, y: 0 } },
      },
    }),
  ]);
  expect(downgraded).toBe(1);
  expect(
    prop<string | null>(
      find(elements, (el) => el.id === "s"),
      "endArrowhead",
    ),
  ).toBe("arrow");
});

test("importBoard：rich_text 拼行同时计入 richTextFlattened 与 downgraded", async () => {
  const source: BoardSource = {
    fetch: async () => ({
      nodes: [
        richTextNode({ id: "r1" }),
        shapeNode({ id: "u1", composite_shape: { type: "alien_shape" } }),
      ],
    }),
  };
  const images: BoardImageResolver = {
    resolve: async () => ({ status: "dropped", reason: "n/a" }),
  };
  const result = await importBoard({
    whiteboardId: "wb",
    source,
    images,
    scenePolicy: POLICY,
  });
  expect(result.stats.richTextFlattened).toBe(1);
  // rich_text 压平 1 次 + 未知图形子类型 1 次
  expect(result.stats.downgraded).toBe(2);
});

// 三类绑定分布：[两端绑定, 仅一端绑定, 自由]。
function bindingDistribution(elements: BoardImportElement[]): number[] {
  const arrows = elements.filter((el) => el.type === "arrow");
  const both = arrows.filter((el) => el.startBinding && el.endBinding).length;
  const single = arrows.filter(
    (el) =>
      (el.startBinding && !el.endBinding) ||
      (!el.startBinding && el.endBinding),
  ).length;
  const free = arrows.filter((el) => !el.startBinding && !el.endBinding).length;
  return [both, single, free];
}

// 连线先出现、目标图形与父容器后出现：绑定与 boundElements 不受返回顺序影响。
function bindingGraph(): {
  connectors: LarkBoardNode[];
  targets: LarkBoardNode[];
} {
  return {
    connectors: [
      // 两端绑定
      connectorNode({ id: "two", parent_id: "sec" }),
      // 仅 start 绑定（end 为自由坐标端点）
      straightConnectorNode({
        id: "one",
        parent_id: "sec",
        connector: {
          shape: "straight",
          start: {
            arrow_style: "none",
            attached_object: {
              id: "shapeA",
              position: { x: 1, y: 0.5 },
              snap_to: "right",
            },
          },
          end: { arrow_style: "line_arrow", position: { x: 999, y: 999 } },
        },
      }),
      // 自由（两端坐标）
      straightConnectorNode({
        id: "free",
        parent_id: "sec",
        connector: {
          shape: "straight",
          start: { arrow_style: "none", position: { x: 0, y: 0 } },
          end: { arrow_style: "line_arrow", position: { x: 50, y: 0 } },
        },
      }),
    ],
    targets: [
      shapeNode({ id: "shapeA", parent_id: "sec" }),
      shapeNode({ id: "shapeB", parent_id: "sec" }),
      sectionNode({ id: "sec", children: ["shapeA", "shapeB"] }),
    ],
  };
}

test("连线绑定：连线先于目标图形仍建绑定，三类分布正确", () => {
  const { connectors, targets } = bindingGraph();
  const { elements } = render([...connectors, ...targets]);

  expect(
    (find(elements, (el) => el.id === "two") as { startBinding?: unknown })
      .startBinding,
  ).toEqual({ elementId: "shapeA", attachPoint: [1, 0.5] });
  expect(
    (find(elements, (el) => el.id === "two") as { endBinding?: unknown })
      .endBinding,
  ).toEqual({ elementId: "shapeB", attachPoint: [0, 0.5] });

  const one = find(elements, (el) => el.id === "one");
  expect(one.startBinding).toEqual({
    elementId: "shapeA",
    attachPoint: [1, 0.5],
  });
  expect(one.endBinding).toBeNull();

  const free = find(elements, (el) => el.id === "free");
  expect(free.startBinding).toBeNull();
  expect(free.endBinding).toBeNull();

  // 目标元素登记 boundElements（两端的 two + 一端的 one）
  const shapeA = find(elements, (el) => el.id === "shapeA");
  expect(
    (shapeA.boundElements ?? [])
      .filter((entry) => entry.type === "arrow")
      .map((entry) => entry.id)
      .sort(),
  ).toEqual(["one", "two"]);
  const shapeB = find(elements, (el) => el.id === "shapeB");
  expect(
    (shapeB.boundElements ?? [])
      .filter((entry) => entry.type === "arrow")
      .map((entry) => entry.id),
  ).toEqual(["two"]);

  expect(bindingDistribution(elements)).toEqual([1, 1, 1]);
});

test("连线绑定：返回顺序颠倒，绑定分布不变", () => {
  const { connectors, targets } = bindingGraph();
  const connectorsFirst = render([...connectors, ...targets]);
  const connectorsLast = render([...targets, ...connectors]);
  expect(bindingDistribution(connectorsFirst.elements)).toEqual([1, 1, 1]);
  expect(bindingDistribution(connectorsLast.elements)).toEqual(
    bindingDistribution(connectorsFirst.elements),
  );
  // 目标在容器内、父容器后置：containerRef 仍建立
  const leaf = find(connectorsFirst.elements, (el) => el.id === "shapeA");
  expect(leaf.containerRef).toEqual({ kind: "frameLike", elementId: "sec" });
});

test("表格 1 基索引归一：全部单元格文本落地，行列无位移", () => {
  const cells = [];
  const expectedTexts: string[] = [];
  const expectedCellIds: string[] = [];
  for (let row = 1; row <= 3; row++) {
    for (let col = 1; col <= 2; col++) {
      const label = `R${row}C${col}`;
      cells.push({
        col_index: col,
        row_index: row,
        style: {},
        text: { text: label },
      });
      expectedTexts.push(label);
      expectedCellIds.push(`t:cell:r${row - 1}c${col - 1}`);
    }
  }
  const { elements } = render([
    tableNode({
      id: "t",
      table: {
        meta: {
          col_num: 2,
          row_num: 3,
          col_sizes: [100, 100],
          row_sizes: [50, 50, 50],
        },
        cells,
      },
    }),
  ]);

  const textElements = elements.filter((el) => el.type === "text");
  expect(textElements).toHaveLength(6);
  expect(new Set(textElements.map((el) => el.text))).toEqual(
    new Set(expectedTexts),
  );
  const cellIds = textElements
    .map((el) =>
      el.containerRef?.kind === "tableCell" ? el.containerRef.cellId : null,
    )
    .sort();
  // 首行首列 r0c0 与末行末列 r2c1 都在，无位移
  expect(cellIds).toEqual([...expectedCellIds].sort());
});

test("表格 1 基索引：合并 span 保持原值（合并生效）", () => {
  const { elements } = render([
    tableNode({
      id: "m",
      table: {
        meta: {
          col_num: 3,
          row_num: 2,
          col_sizes: [50, 50, 50],
          row_sizes: [40, 40],
        },
        cells: [
          {
            col_index: 1,
            row_index: 1,
            merge_info: { col_span: 2, row_span: 1 },
            style: {},
            text: { text: "M" },
          },
        ],
      },
    }),
  ]);
  const data = prop<{
    cells: Array<{ id: string; columnSpan?: number; mergedInto?: string }>;
  }>(
    find(elements, (el) => el.type === "table"),
    "table",
  );
  const anchor = data.cells.find((cell) => cell.id === "m:cell:r0c0");
  expect(anchor?.columnSpan).toBe(2);
  expect(data.cells.find((cell) => cell.mergedInto === "m:cell:r0c0")?.id).toBe(
    "m:cell:r0c1",
  );
});

test("表格 1 基索引：越界 span 仍收敛到网格内", () => {
  const { elements } = render([
    tableNode({
      id: "m",
      table: {
        meta: {
          col_num: 3,
          row_num: 2,
          col_sizes: [50, 50, 50],
          row_sizes: [40, 40],
        },
        cells: [
          {
            col_index: 2,
            row_index: 1,
            merge_info: { col_span: 4, row_span: 1 },
            style: {},
            text: { text: "M" },
          },
        ],
      },
    }),
  ]);
  const data = prop<{
    cells: Array<{ id: string; columnSpan?: number; mergedInto?: string }>;
  }>(
    find(elements, (el) => el.type === "table"),
    "table",
  );
  const anchor = data.cells.find((cell) => cell.columnSpan !== undefined);
  // col_index 2 → 归一 1；3 列下最多跨到列 2，故 span 4 收敛为 2
  expect(anchor?.id).toBe("m:cell:r0c1");
  expect(anchor?.columnSpan).toBe(2);
  expect(
    data.cells.filter((cell) => cell.mergedInto === "m:cell:r0c1"),
  ).toHaveLength(1);
});

// 覆盖格（mergedInto）带文本的三种情形：任何合法输入都不得让整板导入抛错。
function mergedTable(anchorText: string, coveredText: string) {
  return tableNode({
    id: "t",
    table: {
      meta: {
        col_num: 3,
        row_num: 2,
        col_sizes: [50, 50, 50],
        row_sizes: [40, 40],
      },
      cells: [
        {
          col_index: 1,
          row_index: 1,
          merge_info: { col_span: 2, row_span: 1 },
          style: {},
          text: { text: anchorText },
        },
        {
          col_index: 2,
          row_index: 1,
          style: {},
          text: { text: coveredText },
        },
      ],
    },
  });
}

test("表格覆盖格带文本①：锚点优先，覆盖格文本丢弃并计数，不抛错", () => {
  const { elements, downgraded } = render([
    mergedTable("锚点文本", "覆盖文本"),
  ]);
  expect(() =>
    projectScene(elements, {}, statsOf(elements), POLICY),
  ).not.toThrow();
  const texts = elements.filter((el) => el.type === "text");
  expect(texts).toHaveLength(1);
  expect(texts[0].text).toBe("锚点文本");
  expect(downgraded).toBe(1);
});

test("表格覆盖格带文本②：锚点为空则取覆盖格文本落到锚点，不丢内容", () => {
  const { elements, downgraded } = render([mergedTable("", "覆盖文本")]);
  expect(() =>
    projectScene(elements, {}, statsOf(elements), POLICY),
  ).not.toThrow();
  const texts = elements.filter((el) => el.type === "text");
  expect(texts).toHaveLength(1);
  expect(texts[0].text).toBe("覆盖文本");
  expect(texts[0].containerRef).toEqual({
    kind: "tableCell",
    elementId: "t",
    cellId: "t:cell:r0c0",
    role: "backgroundText",
  });
  expect(downgraded).toBe(1);
});

test("表格覆盖格带文本③：锚点与覆盖格都空则无文本元素、不计降级", () => {
  const { elements, downgraded } = render([mergedTable("", "")]);
  expect(() =>
    projectScene(elements, {}, statsOf(elements), POLICY),
  ).not.toThrow();
  expect(elements.filter((el) => el.type === "text")).toHaveLength(0);
  expect(downgraded).toBe(0);
});
