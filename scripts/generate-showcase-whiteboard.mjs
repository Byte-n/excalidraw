import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(
  root,
  "docs/mindmap-plan/samples/showcase-all-types.excalidraw",
);
const elements = [];
const byId = new Map();
const colors = {
  ink: "#202124",
  muted: "#59636e",
  blue: "#dbeafe",
  green: "#d3f9d8",
  coral: "#ffe3e3",
  yellow: "#fff3bf",
  violet: "#e5dbff",
  teal: "#c3fae8",
};

function add(element) {
  if (byId.has(element.id)) {
    throw new Error(`Duplicate element id: ${element.id}`);
  }
  elements.push(element);
  byId.set(element.id, element);
  return element;
}

function base(id, type, x, y, width, height, extra = {}) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: colors.ink,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    created: 1,
    link: null,
    locked: false,
    ...extra,
  };
}

function text(id, value, x, y, width, height, options = {}) {
  const {
    containerId = null,
    fontSize = 20,
    color = colors.ink,
    align = "left",
    verticalAlign = "middle",
    frameId = null,
  } = options;
  return add({
    ...base(id, "text", x, y, width, height, {
      strokeColor: color,
      strokeWidth: 1,
      frameId,
    }),
    text: value,
    originalText: value,
    fontSize,
    baseFontSize: null,
    fontFamily: 2,
    textAlign: align,
    verticalAlign,
    containerId,
    autoResize: false,
    lineHeight: 1.25,
  });
}

function shape(id, shapeId, label, x, y, width, height, color, options = {}) {
  const labelId = `${id}-text`;
  const element = add({
    ...base(id, "composite_shape", x, y, width, height, {
      backgroundColor: color,
      roundness: shapeId === "rectangle" ? { type: 3 } : null,
      boundElements: [{ type: "text", id: labelId }],
      frameId: options.frameId ?? null,
    }),
    shape: { id: shapeId, schemaVersion: 1 },
  });
  text(labelId, label, x + 12, y + (height - 30) / 2, width - 24, 30, {
    containerId: id,
    fontSize: options.fontSize ?? 19,
    align: "center",
    frameId: options.frameId ?? null,
  });
  return element;
}

function mindmapNode(graphId, id, label, x, y, shapeId, color, config = {}) {
  const width = config.width ?? 188;
  const height = 62;
  const labelId = `${id}-text`;
  const node = add({
    ...base(id, "mindmap-node", x, y, width, height, {
      backgroundColor: color,
      roundness: { type: 3 },
      boundElements: [{ type: "text", id: labelId }],
    }),
    graphId,
    role: config.parentId ? "node" : "root",
    parentId: config.parentId ?? null,
    order: config.parentId ? config.order : null,
    collapsed: false,
    shape: { id: shapeId, schemaVersion: 1 },
    ...(config.direction
      ? {
          layoutDirection: config.direction,
          defaultNodeShape: "rectangle",
          defaultEdgeRouting: config.routing,
          defaultEdgeStrokeColor: colors.muted,
          defaultEdgeStrokeWidth: 2,
          defaultEdgeStrokeStyle: "solid",
        }
      : {}),
  });
  text(labelId, label, x + 12, y + 17, width - 24, 28, {
    containerId: id,
    align: "center",
    fontSize: 18,
  });
  return node;
}

function endpoints(parent, child, direction) {
  if (direction === "left-to-right") {
    return [
      [parent.x + parent.width, parent.y + parent.height / 2],
      [child.x, child.y + child.height / 2],
    ];
  }
  if (direction === "right-to-left") {
    return [
      [parent.x, parent.y + parent.height / 2],
      [child.x + child.width, child.y + child.height / 2],
    ];
  }
  if (direction === "top-to-bottom") {
    return [
      [parent.x + parent.width / 2, parent.y + parent.height],
      [child.x + child.width / 2, child.y],
    ];
  }
  return [
    [parent.x + parent.width / 2, parent.y],
    [child.x + child.width / 2, child.y + child.height],
  ];
}

function mindmapEdge(graphId, parent, child, direction, routing, id) {
  const [start, end] = endpoints(parent, child, direction);
  const horizontal =
    direction === "left-to-right" || direction === "right-to-left";
  const distance = horizontal ? end[0] - start[0] : end[1] - start[1];
  const absolutePoints =
    routing === "curved"
      ? horizontal
        ? [
            start,
            [start[0] + distance / 2, start[1]],
            [end[0] - distance / 2, end[1]],
            end,
          ]
        : [
            start,
            [start[0], start[1] + distance / 2],
            [end[0], end[1] - distance / 2],
            end,
          ]
      : horizontal
      ? [
          start,
          [start[0] + distance / 2, start[1]],
          [start[0] + distance / 2, end[1]],
          end,
        ]
      : [
          start,
          [start[0], start[1] + distance / 2],
          [end[0], start[1] + distance / 2],
          end,
        ];
  const x = Math.min(...absolutePoints.map((point) => point[0]));
  const y = Math.min(...absolutePoints.map((point) => point[1]));
  const width = Math.max(...absolutePoints.map((point) => point[0])) - x;
  const height = Math.max(...absolutePoints.map((point) => point[1])) - y;
  return add({
    ...base(id, "mindmap-edge", x, y, width, height, {
      strokeColor: colors.muted,
      strokeWidth: 2,
    }),
    graphId,
    parentId: parent.id,
    childId: child.id,
    points: absolutePoints.map((point) => [point[0] - x, point[1] - y]),
    routing,
  });
}

function addMindmap(prefix, direction, routing, positions, title) {
  const graphId = `showcase-${prefix}`;
  text(
    `${prefix}-heading`,
    title,
    positions.heading[0],
    positions.heading[1],
    890,
    38,
    {
      fontSize: 26,
    },
  );
  const nodes = [
    mindmapNode(
      graphId,
      `${prefix}-root`,
      "项目计划",
      ...positions.root,
      "pill",
      colors.violet,
      {
        direction,
        routing,
        width: 200,
      },
    ),
    mindmapNode(
      graphId,
      `${prefix}-idea`,
      "需求梳理",
      ...positions.idea,
      "rectangle",
      colors.blue,
      {
        parentId: `${prefix}-root`,
        order: "a0",
      },
    ),
    mindmapNode(
      graphId,
      `${prefix}-build`,
      "方案设计",
      ...positions.build,
      "ellipse",
      colors.green,
      {
        parentId: `${prefix}-root`,
        order: "a1",
      },
    ),
    mindmapNode(
      graphId,
      `${prefix}-ship`,
      "交付验收",
      ...positions.ship,
      "diamond",
      colors.yellow,
      {
        parentId: `${prefix}-root`,
        order: "a2",
      },
    ),
    mindmapNode(
      graphId,
      `${prefix}-leaf`,
      "用户访谈",
      ...positions.leaf,
      "pill",
      colors.teal,
      {
        parentId: `${prefix}-idea`,
        order: "a0",
      },
    ),
  ];
  for (const [parentIndex, childIndex] of [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 4],
  ]) {
    mindmapEdge(
      graphId,
      nodes[parentIndex],
      nodes[childIndex],
      direction,
      routing,
      `${prefix}-edge-${childIndex}`,
    );
  }
}

function arrow(id, start, end, options = {}) {
  const points = options.points ?? [start, end];
  const x = Math.min(...points.map((point) => point[0]));
  const y = Math.min(...points.map((point) => point[1]));
  const width = Math.max(...points.map((point) => point[0])) - x;
  const height = Math.max(...points.map((point) => point[1])) - y;
  const bind = (elementId, fixedPoint) => ({
    elementId,
    fixedPoint,
    mode: "orbit",
  });
  const element = add({
    ...base(id, "arrow", x, y, width, height, {
      strokeColor: options.color ?? colors.muted,
      strokeWidth: options.strokeWidth ?? 2,
      strokeStyle: options.strokeStyle ?? "solid",
    }),
    points: points.map((point) => [point[0] - x, point[1] - y]),
    startBinding: options.from ? bind(options.from, options.fromPoint) : null,
    endBinding: options.to ? bind(options.to, options.toPoint) : null,
    startArrowhead: null,
    endArrowhead: options.endArrowhead ?? "arrow",
    elbowed: false,
  });
  for (const shapeId of [options.from, options.to]) {
    if (shapeId) {
      byId.get(shapeId).boundElements.push({ type: "arrow", id });
    }
  }
  return element;
}

text("board-title", "白板元素与思维导图示例", 80, 50, 1540, 64, {
  fontSize: 42,
});
text(
  "board-subtitle",
  "四向导图 · 平台图形 · 普通图形流程图 · 其它元素类型",
  80,
  116,
  1800,
  32,
  {
    fontSize: 20,
    color: colors.muted,
  },
);

addMindmap(
  "ltr",
  "left-to-right",
  "orthogonal",
  {
    heading: [80, 190],
    root: [130, 390],
    idea: [470, 255],
    build: [470, 390],
    ship: [470, 525],
    leaf: [790, 255],
  },
  "01  左 → 右 / 正交连接",
);
addMindmap(
  "rtl",
  "right-to-left",
  "curved",
  {
    heading: [1280, 190],
    root: [2160, 390],
    idea: [1840, 255],
    build: [1840, 390],
    ship: [1840, 525],
    leaf: [1520, 255],
  },
  "02  右 → 左 / 曲线连接",
);
addMindmap(
  "ttb",
  "top-to-bottom",
  "orthogonal",
  {
    heading: [80, 685],
    root: [525, 770],
    idea: [210, 975],
    build: [530, 975],
    ship: [850, 975],
    leaf: [210, 1160],
  },
  "03  上 → 下 / 正交连接",
);
addMindmap(
  "btt",
  "bottom-to-top",
  "curved",
  {
    heading: [1280, 685],
    root: [1710, 1160],
    idea: [1390, 970],
    build: [1710, 970],
    ship: [2030, 970],
    leaf: [1390, 785],
  },
  "04  下 → 上 / 曲线连接",
);

text("flow-heading", "05  普通图形流程图", 80, 1430, 1000, 42, {
  fontSize: 30,
});
text(
  "flow-subtitle",
  "使用椭圆、矩形、菱形和绑定箭头组成审批流程",
  80,
  1485,
  1700,
  30,
  {
    fontSize: 18,
    color: colors.muted,
  },
);
shape("flow-start", "ellipse", "开始", 130, 1640, 180, 86, colors.green);
shape("flow-submit", "rectangle", "提交申请", 440, 1640, 220, 86, colors.blue);
shape(
  "flow-review",
  "diamond",
  "材料齐全?",
  800,
  1625,
  230,
  116,
  colors.yellow,
);
shape(
  "flow-approve",
  "rectangle",
  "审核通过",
  1180,
  1640,
  220,
  86,
  colors.teal,
);
shape("flow-end", "ellipse", "结束", 1540, 1640, 180, 86, colors.green);
shape("flow-revise", "rectangle", "补充材料", 800, 1845, 230, 86, colors.coral);
arrow("flow-a1", [310, 1683], [440, 1683], {
  from: "flow-start",
  to: "flow-submit",
  fromPoint: [1, 0.5],
  toPoint: [0, 0.5],
});
arrow("flow-a2", [660, 1683], [800, 1683], {
  from: "flow-submit",
  to: "flow-review",
  fromPoint: [1, 0.5],
  toPoint: [0, 0.5],
});
arrow("flow-yes", [1030, 1683], [1180, 1683], {
  from: "flow-review",
  to: "flow-approve",
  fromPoint: [1, 0.5],
  toPoint: [0, 0.5],
});
arrow("flow-a4", [1400, 1683], [1540, 1683], {
  from: "flow-approve",
  to: "flow-end",
  fromPoint: [1, 0.5],
  toPoint: [0, 0.5],
});
arrow("flow-no", [915, 1741], [915, 1845], {
  from: "flow-review",
  to: "flow-revise",
  fromPoint: [0.5, 1],
  toPoint: [0.5, 0],
});
arrow("flow-return", [800, 1888], [550, 1726], {
  from: "flow-revise",
  to: "flow-submit",
  fromPoint: [0, 0.5],
  toPoint: [0.5, 1],
  points: [
    [800, 1888],
    [550, 1888],
    [550, 1726],
  ],
});
text("flow-yes-label", "是", 1072, 1637, 40, 28, {
  fontSize: 18,
  align: "center",
});
text("flow-no-label", "否", 935, 1770, 40, 28, {
  fontSize: 18,
  align: "center",
});

text("types-heading", "06  平台图形与其它 type", 80, 2110, 1100, 42, {
  fontSize: 30,
});
text(
  "types-subtitle",
  "shape.id 区分基础形状；下方还包含便签、手绘、图片、画框和嵌入元素",
  80,
  2165,
  2000,
  30,
  {
    fontSize: 18,
    color: colors.muted,
  },
);
shape(
  "gallery-rect",
  "rectangle",
  "rectangle",
  100,
  2260,
  260,
  110,
  colors.blue,
);
shape(
  "gallery-ellipse",
  "ellipse",
  "ellipse",
  430,
  2260,
  260,
  110,
  colors.green,
);
shape(
  "gallery-diamond",
  "diamond",
  "diamond",
  760,
  2250,
  270,
  130,
  colors.yellow,
);
const note = add(
  base("gallery-note", "stickynote", 1100, 2250, 240, 150, {
    backgroundColor: "#fff3bf",
    baseHeight: 150,
    boundElements: [{ type: "text", id: "gallery-note-text" }],
  }),
);
text(
  "gallery-note-text",
  "stickynote\n便签",
  note.x + 16,
  note.y + 42,
  208,
  60,
  {
    containerId: note.id,
    fontSize: 20,
    align: "center",
  },
);

const imageId = "showcase-image";
add({
  ...base("gallery-image", "image", 1440, 2250, 116, 156, {
    backgroundColor: "transparent",
    strokeWidth: 0,
  }),
  fileId: imageId,
  status: "saved",
  scale: [1, 1],
  crop: null,
});
text("gallery-image-caption", "image · 内嵌 PNG", 1590, 2305, 270, 35, {
  fontSize: 19,
});

add({
  ...base("gallery-line", "line", 100, 2550, 260, 80, {
    strokeColor: "#1971c2",
    strokeWidth: 3,
  }),
  points: [
    [0, 60],
    [80, 0],
    [160, 55],
    [260, 10],
  ],
  polygon: false,
  startBinding: null,
  endBinding: null,
  startArrowhead: null,
  endArrowhead: null,
});
text("gallery-line-caption", "line · 折线", 100, 2650, 260, 28, {
  fontSize: 18,
});
arrow("gallery-arrow", [430, 2600], [690, 2600], {
  color: "#e03131",
  endArrowhead: "triangle",
});
text("gallery-arrow-caption", "arrow · 箭头", 430, 2650, 260, 28, {
  fontSize: 18,
});
add({
  ...base("gallery-freedraw", "freedraw", 760, 2550, 260, 75, {
    strokeColor: "#2b8a3e",
    strokeWidth: 4,
  }),
  points: [
    [0, 50],
    [40, 10],
    [80, 45],
    [120, 5],
    [170, 60],
    [220, 15],
    [260, 40],
  ],
  pressures: [0.4, 0.7, 0.6, 0.8, 0.5, 0.7, 0.4],
  simulatePressure: false,
  strokeOptions: { variability: "variable", streamline: 0 },
});
text("gallery-freedraw-caption", "freedraw · 手绘", 760, 2650, 280, 28, {
  fontSize: 18,
});

add(
  base("gallery-frame", "frame", 1080, 2505, 290, 180, {
    name: "frame · 普通画框",
    strokeColor: "#1971c2",
  }),
);
shape(
  "gallery-frame-child",
  "ellipse",
  "画框内容",
  1130,
  2565,
  190,
  70,
  colors.blue,
  {
    frameId: "gallery-frame",
    fontSize: 17,
  },
);
add(
  base("gallery-magicframe", "magicframe", 1440, 2505, 290, 180, {
    name: "magicframe · AI 画框",
    strokeColor: "#6741d9",
  }),
);
shape(
  "gallery-magicframe-child",
  "rectangle",
  "画框内容",
  1490,
  2565,
  190,
  70,
  colors.violet,
  {
    frameId: "gallery-magicframe",
    fontSize: 17,
  },
);

add(
  base("gallery-embeddable", "embeddable", 1800, 2515, 260, 150, {
    backgroundColor: colors.blue,
    link: "https://example.com",
  }),
);
text("gallery-embeddable-caption", "embeddable · 网页", 1800, 2680, 280, 28, {
  fontSize: 17,
});
add(
  base("gallery-iframe", "iframe", 2140, 2515, 260, 150, {
    backgroundColor: colors.violet,
    customData: {
      generationData: {
        status: "done",
        html: "<div style='font:20px sans-serif;padding:36px;background:#e5dbff'>AI 生成预览示例</div>",
      },
    },
  }),
);
text("gallery-iframe-caption", "iframe · AI 生成预览", 2140, 2680, 280, 28, {
  fontSize: 17,
});

for (const element of elements) {
  if (
    element.type === "text" &&
    element.containerId &&
    !byId.has(element.containerId)
  ) {
    throw new Error(`Missing text container: ${element.id}`);
  }
  if (
    element.type === "mindmap-edge" &&
    (!byId.has(element.parentId) || !byId.has(element.childId))
  ) {
    throw new Error(`Missing mindmap edge endpoint: ${element.id}`);
  }
}

const png = readFileSync(
  resolve(root, "packages/excalidraw/tests/fixtures/smiley.png"),
);
const scene = {
  type: "excalidraw",
  version: 3,
  source: "https://github.com/excalidraw/excalidraw",
  elements,
  appState: {
    viewBackgroundColor: "#ffffff",
    scrollX: 30,
    scrollY: 10,
    zoom: { value: 0.8 },
  },
  files: {
    [imageId]: {
      id: imageId,
      dataURL: `data:image/png;base64,${png.toString("base64")}`,
      mimeType: "image/png",
      created: 1,
      lastRetrieved: 1,
    },
  },
};

writeFileSync(output, `${JSON.stringify(scene, null, 2)}\n`);
process.stdout.write(`Wrote ${output} (${elements.length} elements)\n`);
