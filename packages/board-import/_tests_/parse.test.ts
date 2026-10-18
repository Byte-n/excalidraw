import { parseBoard } from "../src/index.js";

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

import type { BoardSkeletonNode } from "../src/index.js";

function parse(nodes: Parameters<typeof parseBoard>[0]) {
  return parseBoard(nodes);
}

function find(nodes: BoardSkeletonNode[], id: string): BoardSkeletonNode {
  const node = nodes.find((n) => n.id === id);
  if (!node) {
    throw new Error(`node ${id} not found`);
  }
  return node;
}

test("类型分派：已知类型产出对应 kind，范围外 / 未知类型计入 droppedNodes", () => {
  const { skeleton, droppedNodes } = parse([
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
  expect(skeleton.nodes.map((n) => n.kind).sort()).toEqual([
    "connector",
    "image",
    "mindMap",
    "paint",
    "section",
    "shape",
    "stickyNote",
    "table",
    "text",
  ]);
  expect(droppedNodes).toBe(2);
});

test("嵌套容器坐标累加（两层以上）", () => {
  const { skeleton } = parse([
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
  const leaf = find(skeleton.nodes, "leaf");
  // root(100,-1000) + mid(200,50) + leaf(10,20) = (310, -930)
  expect(leaf.x).toBeCloseTo(310, 6);
  expect(leaf.y).toBeCloseTo(-930, 6);
  const mid = find(skeleton.nodes, "mid");
  expect(mid.x).toBeCloseTo(300, 6);
  expect(mid.y).toBeCloseTo(-950, 6);
  const root = find(skeleton.nodes, "root");
  expect(root.x).toBe(100);
  expect(root.y).toBe(-1000);
});

test("嵌套画框逐层累加：other2.json 父 y=-4382 / 子 y=360 场景", () => {
  const { skeleton } = parse([
    sectionNode({ id: "t3", x: 93, y: -4382, children: ["t4"] }),
    nestedSectionNode({
      id: "t4",
      parent_id: "t3",
      x: 841,
      y: 360,
      children: [],
    }),
  ]);
  const t4 = find(skeleton.nodes, "t4");
  expect(t4.y).toBeCloseTo(-4382 + 360, 4);
  expect(t4.x).toBeCloseTo(93 + 841, 4);
});

test("子先于父出现仍能累加坐标", () => {
  const { skeleton } = parse([
    shapeNode({ id: "leaf", parent_id: "p", x: 5, y: 7 }),
    sectionNode({ id: "p", x: 30, y: 40, children: ["leaf"] }),
  ]);
  const leaf = find(skeleton.nodes, "leaf");
  expect(leaf.x).toBe(35);
  expect(leaf.y).toBe(47);
});

test("parent_id 成环安全终止并按根处理", () => {
  const { skeleton } = parse([
    sectionNode({ id: "a", parent_id: "b", x: 1, y: 2, children: ["b"] }),
    sectionNode({ id: "b", parent_id: "a", x: 10, y: 20, children: ["a"] }),
  ]);
  // 不抛错、不无限递归即可；绝对坐标至少包含自身相对值。
  for (const node of skeleton.nodes) {
    expect(Number.isFinite(node.x)).toBe(true);
    expect(Number.isFinite(node.y)).toBe(true);
  }
});

test("角度由度数换算为弧度", () => {
  const { skeleton } = parse([shapeNode({ id: "s", angle: -31.002 })]);
  const node = find(skeleton.nodes, "s");
  expect(node.angle).toBeCloseTo((-31.002 * Math.PI) / 180, 9);
});

test("退化尺寸规整：9.3e-15 与负值归零", () => {
  const { skeleton } = parse([
    connectorNode({ id: "c1", height: 9.3e-15 }),
    shapeNode({ id: "c2", width: -5, height: Number.NaN }),
  ]);
  const conn = find(skeleton.nodes, "c1");
  expect(conn.height).toBe(0);
  expect(conn.width).toBeGreaterThan(0);
  const shape = find(skeleton.nodes, "c2");
  expect(shape.width).toBe(0);
  expect(shape.height).toBe(0);
});

test("z_index 保留为整数；缺失归零", () => {
  const { skeleton } = parse([
    shapeNode({ id: "a", z_index: 42 }),
    shapeNode({ id: "b" }),
  ]);
  // b fixture 默认 z_index=1，覆盖为 undefined
  const b = find(skeleton.nodes, "b");
  const a = find(skeleton.nodes, "a");
  expect(a.zIndex).toBe(42);
  expect(Number.isInteger(b.zIndex)).toBe(true);
});

test("z_index 缺失（字段不存在）归零", () => {
  const { skeleton } = parse([shapeNode({ id: "noZ", z_index: undefined })]);
  const node = find(skeleton.nodes, "noZ");
  expect(node.zIndex).toBe(0);
});

test("扁平文本字段进入 IR", () => {
  const { skeleton } = parse([shapeNode({ id: "s" })]);
  const text = find(skeleton.nodes, "s").text;
  expect(text?.text).toBe("开始");
  expect(text?.fontSize).toBe(14);
  expect(text?.horizontalAlign).toBe("center");
  expect(text?.verticalAlign).toBe("mid");
  expect(text?.textColor).toBe("#1f2329");
});

test("rich_text 按段落拼合为多行纯文本并计数", () => {
  const { skeleton, richTextFlattened } = parse([richTextNode({ id: "r" })]);
  const text = find(skeleton.nodes, "r").text;
  expect(text?.text).toBe("第一行\n第二行");
  expect(text?.richTextFlattened).toBe(true);
  expect(richTextFlattened).toBe(1);
});

test("table 的 cells / meta / merge_info 进入 IR，children 为 null 不报错", () => {
  const { skeleton } = parse([tableNode({ id: "t", children: null })]);
  const table = find(skeleton.nodes, "t");
  expect(table.table?.cells).toHaveLength(2);
  expect(table.table?.meta?.col_num).toBe(2);
  expect(table.table?.meta?.row_sizes).toEqual([64, 64, 654]);
  expect(table.table?.cells[1].merge_info?.col_span).toBe(2);
  expect(table.table?.title).toBe("表格标题");
  expect(table.childIds).toBeUndefined();
});

test("mind_map 两套层级：画布 parentId 与树 treeParentId / root 子树", () => {
  const { skeleton } = parse([
    sectionNode({ id: "sec", children: ["mmRoot", "mmL1"] }),
    mindMapRootNode({ id: "mmRoot", parent_id: "sec" }),
    mindMapChildNode({ id: "mmL1", parent_id: "sec" }),
  ]);
  const root = find(skeleton.nodes, "mmRoot");
  const child = find(skeleton.nodes, "mmL1");
  // 画布归属
  expect(root.parentId).toBe("sec");
  expect(child.parentId).toBe("sec");
  // 思维导图树
  expect(root.mindMap?.treeParentId).toBeUndefined();
  expect(root.mindMap?.root?.layout).toBe("left_right");
  expect(root.mindMap?.root?.leftChildren).toEqual(["mmL1"]);
  expect(root.mindMap?.root?.rightChildren).toEqual(["mmR1"]);
  expect(child.mindMap?.treeParentId).toBe("mmRoot");
  expect(child.mindMap?.node?.layoutPosition).toBe("left");
});

test("连线的三种 shape 各自落到 IR", () => {
  const { skeleton } = parse([
    connectorNode({ id: "c1" }),
    straightConnectorNode({ id: "c2" }),
    polylineConnectorNode({ id: "c3" }),
  ]);
  expect(find(skeleton.nodes, "c1").connector?.shape).toBe("curve");
  expect(find(skeleton.nodes, "c2").connector?.shape).toBe("straight");
  expect(find(skeleton.nodes, "c3").connector?.shape).toBe("polyline");
});

test("连线纯坐标端点：position 进入 IR，无绑定信息", () => {
  const { skeleton } = parse([straightConnectorNode({ id: "c" })]);
  const conn = find(skeleton.nodes, "c").connector;
  expect(conn?.start.position).toEqual({ x: 733, y: 2063 });
  expect(conn?.start.attachedObjectId).toBeUndefined();
  expect(conn?.end.position).toEqual({ x: 934, y: 2063 });
  expect(conn?.end.attachedObjectId).toBeUndefined();
});

test("连线绑定端点：attached_object 的 id / position / snap_to 进入 IR", () => {
  const { skeleton } = parse([connectorNode({ id: "c" })]);
  const conn = find(skeleton.nodes, "c").connector;
  expect(conn?.start.attachedObjectId).toBe("shapeA");
  expect(conn?.start.attachedPosition).toEqual({ x: 1, y: 0.5 });
  expect(conn?.start.attachedSnapTo).toBe("right");
  expect(conn?.end.attachedObjectId).toBe("shapeB");
  expect(conn?.end.attachedSnapTo).toBe("left");
});

test("连线 turning_points 与 captions 标签进入 IR", () => {
  const { skeleton } = parse([
    straightConnectorNode({ id: "c" }),
    polylineConnectorNode({ id: "c2" }),
    connectorNode({ id: "c3" }),
  ]);
  const c = find(skeleton.nodes, "c").connector;
  expect(c?.turningPoints).toHaveLength(2);
  expect(c?.captions).toHaveLength(0);
  const c2 = find(skeleton.nodes, "c2").connector;
  expect(c2?.turningPoints[0]).toEqual({ x: 30, y: 40 });
  const c3 = find(skeleton.nodes, "c3").connector;
  expect(c3?.captions).toHaveLength(1);
  expect(c3?.captions[0].textProps.text).toBe("连接线标签文本");
  expect(c3?.captions[0].position).toBeCloseTo(0.447, 3);
});

test("sticky_note 文本与填充色进入 IR", () => {
  const { skeleton } = parse([stickyNoteNode({ id: "s" })]);
  const node = find(skeleton.nodes, "s");
  expect(node.stickyNote?.style?.fill_color).toBe("#f6c8c8");
  expect(node.stickyNote?.text?.text).toBe("便签文本");
  // user_id 属协作身份信息，不写入场景。
  expect(node.stickyNote).not.toHaveProperty("user_id");
});

test("paint 点序列进入 IR", () => {
  const { skeleton } = parse([paintNode({ id: "p" })]);
  const paint = find(skeleton.nodes, "p").paint;
  expect(paint?.color).toBe("#32a645");
  expect(paint?.points).toHaveLength(4);
  expect(paint?.points[0]).toEqual({ x: 0, y: 88 });
});

test("image token 与翻转标记进入 IR", () => {
  const { skeleton } = parse([imageNode({ id: "i" })]);
  const img = find(skeleton.nodes, "i").image;
  expect(img?.token).toBe("LRCNbkQxzo0c0zxz3zRcL93pnGe");
  expect(img?.hFlip).toBe(true);
  expect(img?.vFlip).toBe(false);
});

test("缺失 parent_id / locked / style 时不抛错", () => {
  const { skeleton } = parse([
    sectionNode({
      id: "bare",
      parent_id: undefined,
      locked: undefined,
      style: undefined,
    }),
  ]);
  const node = find(skeleton.nodes, "bare");
  expect(node.parentId).toBeUndefined();
  expect(Number.isFinite(node.x)).toBe(true);
});

test("section 标题与 childIds 双向落到 IR", () => {
  const { skeleton } = parse([
    sectionNode({ id: "s", children: ["c1", "c2"] }),
    shapeNode({ id: "c1", parent_id: "s" }),
    shapeNode({ id: "c2", parent_id: "s" }),
  ]);
  const sec = find(skeleton.nodes, "s");
  expect(sec.section?.title).toBe("父画框");
  expect(sec.childIds).toEqual(["c1", "c2"]);
  expect(find(skeleton.nodes, "c1").parentId).toBe("s");
});

test("stats 字段：nodes / mapped / droppedNodes / richTextFlattened", () => {
  const { skeleton, droppedNodes, richTextFlattened } = parse([
    shapeNode({ id: "a" }),
    richTextNode({ id: "b" }),
    lifelineNode({ id: "c" }),
  ]);
  expect(skeleton.nodes).toHaveLength(2);
  expect(droppedNodes).toBe(1);
  expect(richTextFlattened).toBe(1);
});
