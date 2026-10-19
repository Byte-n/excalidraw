import { convertBoard } from "../src/index.js";

import {
  connectorNode,
  imageNode,
  lifelineNode,
  mindMapChildNode,
  mindMapRootNode,
  nestedSectionNode,
  paintNode,
  polylineConnectorNode,
  richTextNode,
  sectionNode,
  shapeNode,
  stickyNoteNode,
  straightConnectorNode,
  tableNode,
  textShapeNode,
  unknownNode,
} from "./fixtures/lark-nodes.js";

import type { BoardImportElement } from "../src/index.js";

// 场景元素契约只声明公共字段，模型专属字段经索引签名以 unknown 读取后再落断言。
function prop<T>(element: BoardImportElement, key: string): T {
  return element[key] as T;
}

function find(elements: BoardImportElement[], id: string): BoardImportElement {
  const element = elements.find((el) => el.id === id);
  if (!element) {
    throw new Error(`element ${id} not found`);
  }
  return element;
}

function pointsOf(
  element: BoardImportElement,
): ReadonlyArray<[number, number]> {
  return prop<ReadonlyArray<[number, number]>>(element, "points");
}

test("类型分派：已知类型产出元素，范围外 / 未知类型计入 droppedNodes", () => {
  const { elements, mapped, droppedNodes } = convertBoard([
    shapeNode(),
    textShapeNode(),
    connectorNode(),
    sectionNode(),
    tableNode(),
    mindMapRootNode(),
    stickyNoteNode(),
    paintNode(),
    imageNode(),
    lifelineNode(),
    unknownNode(),
  ]);
  expect(droppedNodes).toBe(2);
  expect(mapped).toBe(9);
  const ids = new Set(elements.map((el) => el.id));
  for (const id of [
    "shape1",
    "text1",
    "conn1",
    "section1",
    "table1",
    "mmRoot",
    "sticky1",
    "paint1",
    "img1",
  ]) {
    expect(ids.has(id)).toBe(true);
  }
  for (const id of ["ll1", "unk1"]) {
    expect(ids.has(id)).toBe(false);
  }
});

test("嵌套容器坐标累加（两层以上）", () => {
  const { elements } = convertBoard([
    sectionNode({ id: "root", x: 100, y: -1000, children: ["mid"] }),
    nestedSectionNode({
      id: "mid",
      parent_id: "root",
      x: 200,
      y: 50,
      children: ["leaf"],
    }),
    shapeNode({ id: "leaf", parent_id: "mid", x: 10, y: 20 }),
  ]);
  const leaf = find(elements, "leaf");
  // root(100,-1000) + mid(200,50) + leaf(10,20) = (310, -930)
  expect(leaf.x).toBeCloseTo(310, 6);
  expect(leaf.y).toBeCloseTo(-930, 6);
  const mid = find(elements, "mid");
  expect(mid.x).toBeCloseTo(300, 6);
  expect(mid.y).toBeCloseTo(-950, 6);
  const root = find(elements, "root");
  expect(root.x).toBe(100);
  expect(root.y).toBe(-1000);
});

test("嵌套画框逐层累加：父 y=-4382 / 子 y=360 场景", () => {
  const { elements } = convertBoard([
    sectionNode({ id: "t3", x: 93, y: -4382, children: ["t4"] }),
    nestedSectionNode({
      id: "t4",
      parent_id: "t3",
      x: 841,
      y: 360,
      children: [],
    }),
  ]);
  const t4 = find(elements, "t4");
  expect(t4.y).toBeCloseTo(-4382 + 360, 4);
  expect(t4.x).toBeCloseTo(93 + 841, 4);
});

test("子先于父出现仍能累加坐标", () => {
  const { elements } = convertBoard([
    shapeNode({ id: "leaf", parent_id: "p", x: 5, y: 7 }),
    sectionNode({ id: "p", x: 30, y: 40, children: ["leaf"] }),
  ]);
  const leaf = find(elements, "leaf");
  expect(leaf.x).toBe(35);
  expect(leaf.y).toBe(47);
});

test("parent_id 成环安全终止并按根处理", () => {
  const { elements } = convertBoard([
    sectionNode({ id: "a", parent_id: "b", x: 1, y: 2, children: ["b"] }),
    sectionNode({ id: "b", parent_id: "a", x: 10, y: 20, children: ["a"] }),
  ]);
  // 不抛错、不无限递归即可；绝对坐标至少包含自身相对值。
  for (const id of ["a", "b"]) {
    const element = find(elements, id);
    expect(Number.isFinite(element.x)).toBe(true);
    expect(Number.isFinite(element.y)).toBe(true);
  }
});

test("角度由度数换算为弧度", () => {
  const { elements } = convertBoard([shapeNode({ id: "s", angle: -31.002 })]);
  expect(find(elements, "s").angle).toBeCloseTo((-31.002 * Math.PI) / 180, 9);
});

test("退化尺寸规整：浮点噪声 / 负值 / NaN 归零", () => {
  const { elements } = convertBoard([
    connectorNode({ id: "c1", height: 9.3e-15 }),
    shapeNode({ id: "c2", width: -5, height: Number.NaN }),
  ]);
  const conn = find(elements, "c1");
  expect(conn.height).toBe(0);
  expect(conn.width).toBeGreaterThan(0);
  const shape = find(elements, "c2");
  expect(shape.width).toBe(0);
  expect(shape.height).toBe(0);
});

test("z_index 决定 index 顺序：值大的排在更后", () => {
  const { elements } = convertBoard([
    shapeNode({ id: "low", z_index: 0 }),
    shapeNode({ id: "high", z_index: 9 }),
  ]);
  const low = find(elements, "low");
  const high = find(elements, "high");
  expect(typeof low.index).toBe("string");
  expect(low.index.length).toBeGreaterThan(0);
  expect(String(low.index) < String(high.index)).toBe(true);
});

test("z_index 缺失归零：排在显式非零之前", () => {
  const { elements } = convertBoard([
    shapeNode({ id: "noZ", z_index: undefined }),
    shapeNode({ id: "zero", z_index: 0 }),
    shapeNode({ id: "nine", z_index: 9 }),
  ]);
  expect(
    String(find(elements, "noZ").index) < String(find(elements, "nine").index),
  ).toBe(true);
  expect(
    String(find(elements, "zero").index) < String(find(elements, "nine").index),
  ).toBe(true);
});

test("扁平文本字段进入元素", () => {
  const { elements } = convertBoard([shapeNode({ id: "s" })]);
  const text = find(elements, "s#text");
  expect(text.type).toBe("text");
  expect(text.text).toBe("开始");
  expect(prop<number>(text, "fontSize")).toBe(14);
  expect(prop<string>(text, "textAlign")).toBe("center");
  expect(prop<string>(text, "verticalAlign")).toBe("middle");
  expect(prop<string | null>(text, "containerId")).toBe("s");
});

test("rich_text 按段落拼合为多行纯文本并计入 richTextFlattened", () => {
  const { elements, richTextFlattened } = convertBoard([
    richTextNode({ id: "r" }),
  ]);
  expect(find(elements, "r#text").text).toBe("第一行\n第二行");
  expect(richTextFlattened).toBe(1);
});

test("table 数据：cells / meta 归一，children 为 null 不报错", () => {
  const { elements } = convertBoard([tableNode({ id: "t", children: null })]);
  const table = find(elements, "t");
  expect(table.type).toBe("table");
  const data = prop<{
    rows: unknown[];
    columns: unknown[];
    cells: Array<{ id: string; mergedInto?: string; columnSpan?: number }>;
  }>(table, "table");
  expect(data.rows).toHaveLength(3);
  expect(data.columns).toHaveLength(2);
  expect(data.cells).toHaveLength(6);
  // 单元格索引 1 基 → 0 基：飞书 (col2,row2) 落到 r1c1。
  expect(data.cells.some((cell) => cell.id === "t:cell:r1c1")).toBe(true);
});

test("表格 1 基索引归一：合并 span 落在 0 基网格", () => {
  const { elements } = convertBoard([
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
  }>(find(elements, "m"), "table");
  const anchor = data.cells.find((cell) => cell.id === "m:cell:r0c0");
  expect(anchor?.columnSpan).toBe(2);
  expect(data.cells.find((cell) => cell.mergedInto === "m:cell:r0c0")?.id).toBe(
    "m:cell:r0c1",
  );
});

test("mind_map 两套层级：画布 parentId 与树 edge", () => {
  const { elements } = convertBoard([
    sectionNode({ id: "sec", children: ["mmRoot", "mmL1"] }),
    mindMapRootNode({ id: "mmRoot", parent_id: "sec" }),
    mindMapChildNode({ id: "mmL1", parent_id: "sec" }),
  ]);
  const root = find(elements, "mmRoot");
  const child = find(elements, "mmL1");
  // 画布归属
  expect(prop<string>(root, "role")).toBe("root");
  expect(prop<string>(child, "role")).toBe("node");
  expect(prop<string | null>(child, "parentId")).toBe("mmRoot");
  expect(prop<string>(root, "graphId")).toBe(prop<string>(child, "graphId"));
  // 思维导图树
  expect(child.containerRef).toEqual({ kind: "frameLike", elementId: "sec" });
  const edge = find(elements, "mmL1#edge");
  expect(edge.type).toBe("mindmap-edge");
  expect(prop<string>(edge, "parentId")).toBe("mmRoot");
  expect(prop<string>(edge, "childId")).toBe("mmL1");
});

test("连线的三种 shape 生成对应 points 与 roundness", () => {
  const { elements } = convertBoard([
    connectorNode({ id: "c1" }),
    straightConnectorNode({ id: "c2" }),
    polylineConnectorNode({ id: "c3" }),
  ]);
  expect(pointsOf(find(elements, "c1"))).toHaveLength(3);
  expect(pointsOf(find(elements, "c2"))).toHaveLength(2);
  expect(pointsOf(find(elements, "c3"))).toHaveLength(4);
  expect(prop<{ type: number }>(find(elements, "c1"), "roundness")).toEqual({
    type: 2,
  });
  expect(prop<unknown>(find(elements, "c2"), "roundness")).toBeNull();
});

test("连线纯坐标端点：points 等于端点减原始原点，无绑定信息", () => {
  const { elements } = convertBoard([straightConnectorNode({ id: "c" })]);
  const conn = find(elements, "c");
  const points = pointsOf(conn);
  expect(points).toHaveLength(2);
  expect(points[0]).toEqual([0, 0]);
  expect(points[1]).toEqual([201, 0]);
  expect(conn.startBinding).toBeNull();
  expect(conn.endBinding).toBeNull();
});

test("连线绑定端点：startBinding / endBinding 与目标 boundElements", () => {
  const { elements } = convertBoard([
    sectionNode({ id: "sec", children: ["shapeA", "shapeB"] }),
    shapeNode({ id: "shapeA", parent_id: "sec" }),
    shapeNode({ id: "shapeB", parent_id: "sec" }),
    connectorNode({ id: "c", parent_id: "sec" }),
  ]);
  const arrow = find(elements, "c");
  expect(arrow.startBinding).toEqual({
    elementId: "shapeA",
    attachPoint: [1, 0.5],
  });
  expect(arrow.endBinding).toEqual({
    elementId: "shapeB",
    attachPoint: [0, 0.5],
  });
  const shapeA = find(elements, "shapeA");
  expect(
    (shapeA.boundElements ?? []).some(
      (entry) => entry.id === "c" && entry.type === "arrow",
    ),
  ).toBe(true);
});

test("连线 turning_points 与 captions 标签进入元素", () => {
  const { elements } = convertBoard([
    polylineConnectorNode({ id: "c2" }),
    connectorNode({ id: "c3" }),
  ]);
  // 折点相对连线节点原点，原样进 points。
  expect(pointsOf(find(elements, "c2"))).toEqual([
    [0, 0],
    [30, 40],
    [70, 40],
    [100, 0],
  ]);
  const caption = elements.find(
    (el) => el.type === "text" && el.text === "连接线标签文本",
  );
  if (!caption) {
    throw new Error("caption not found");
  }
  expect(prop<string | null>(caption, "containerId")).toBe("c3");
  expect(prop<number>(caption, "labelPosition")).toBeCloseTo(0.447, 3);
});

test("sticky_note 填充色与文本，不携带协作身份", () => {
  const { elements } = convertBoard([stickyNoteNode({ id: "s" })]);
  const note = find(elements, "s");
  expect(note.type).toBe("stickynote");
  expect(note.backgroundColor).toBe("#f6c8c8");
  // user_id 属协作身份信息，不写入场景。
  expect(note).not.toHaveProperty("user_id");
  expect(find(elements, "s#text").text).toBe("便签文本");
});

test("paint 点序列进入元素", () => {
  const { elements } = convertBoard([paintNode({ id: "p" })]);
  const draw = find(elements, "p");
  expect(draw.type).toBe("freedraw");
  expect(draw.strokeColor).toBe("#32a645");
  // 飞书笔宽原值直传（paint.width=24），与像素笔宽同量纲。
  expect(draw.strokeWidth).toBe(24);
  // 飞书笔迹无压力信息，显式等宽。
  expect(prop<{ variability: string }>(draw, "strokeOptions").variability).toBe(
    "constant",
  );
  const points = pointsOf(draw);
  expect(points).toHaveLength(4);
  expect([points[0][0], points[0][1]]).toEqual([0, 88]);
});

test("image token 与翻转标记落到元素与资产请求", () => {
  const { elements, assetRequests } = convertBoard([imageNode({ id: "i" })]);
  const image = find(elements, "i");
  expect(image.type).toBe("image");
  expect(image.fileId).toBe("lark-image:LRCNbkQxzo0c0zxz3zRcL93pnGe");
  expect(prop<[number, number]>(image, "scale")).toEqual([-1, 1]);
  expect(assetRequests).toHaveLength(1);
  expect(assetRequests[0].token).toBe("LRCNbkQxzo0c0zxz3zRcL93pnGe");
});

test("缺失 parent_id / locked / style 时不抛错", () => {
  const { elements } = convertBoard([
    sectionNode({
      id: "bare",
      parent_id: undefined,
      locked: undefined,
      style: undefined,
    }),
  ]);
  const element = find(elements, "bare");
  expect(element.type).toBe("frame");
  expect(Number.isFinite(element.x)).toBe(true);
});

test("section 标题与子元素归属落到元素", () => {
  const { elements } = convertBoard([
    sectionNode({ id: "s", children: ["c1", "c2"] }),
    shapeNode({ id: "c1", parent_id: "s" }),
    shapeNode({ id: "c2", parent_id: "s" }),
  ]);
  const sec = find(elements, "s");
  expect(prop<string | null>(sec, "name")).toBe("父画框");
  expect(find(elements, "c1").containerRef).toEqual({
    kind: "frameLike",
    elementId: "s",
  });
});

test("统计增量：mapped / droppedNodes / richTextFlattened", () => {
  const { mapped, droppedNodes, richTextFlattened } = convertBoard([
    shapeNode({ id: "a" }),
    richTextNode({ id: "b" }),
    lifelineNode({ id: "c" }),
  ]);
  expect(mapped).toBe(2);
  expect(droppedNodes).toBe(1);
  expect(richTextFlattened).toBe(1);
});
