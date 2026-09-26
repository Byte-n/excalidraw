import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const makeSample = (kind) => {
  const elements = [];
  const addNode = (id, parentId, order, title, collapsed = false) => {
    const isRoot = parentId === null;
    const graphId = id.startsWith("reference") ? "reference" : "p10-scale";
    const x = isRoot ? (graphId === "reference" ? 80 : 420) : 660;
    const y = graphId === "reference" ? 80 : 300;
    elements.push({
      id,
      type: "mindmap-node",
      x,
      y,
      width: isRoot ? 180 : 156,
      height: 48,
      graphId,
      role: isRoot ? "root" : "node",
      parentId,
      order,
      collapsed,
      shape: "pill",
      ...(isRoot ? { layoutDirection: "left-to-right" } : {}),
      backgroundColor: isRoot ? "#b2f2bb" : "#dbeafe",
      fillStyle: "solid",
      roughness: 0,
      boundElements: [{ type: "text", id: `${id}-text` }],
    });
    elements.push({
      id: `${id}-text`,
      type: "text",
      x: x + 12,
      y: y + 12,
      width: isRoot ? 156 : 132,
      height: 24,
      text: title,
      originalText: title,
      fontSize: 16,
      fontFamily: 2,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: id,
      lineHeight: 1.25,
    });
  };

  addNode("reference-root", null, null, "参考导图");
  addNode("reference-child", "reference-root", "a0", "独立分支");
  addNode("scale-root", null, null, "产品规划");

  if (kind === "deep") {
    let parentId = "scale-root";
    for (let i = 1; i < 1998; i++) {
      const id = `scale-${i}`;
      addNode(id, parentId, "a0", `层级 ${i}`, i === 8);
      parentId = id;
    }
  } else {
    const medium = kind === "medium";
    const branches = medium ? 19 : 49;
    for (let i = 0; i < branches; i++) {
      const branchId = `scale-branch-${i}`;
      addNode(
        branchId,
        "scale-root",
        `a${digits[i]}`,
        `分支 ${i + 1}`,
        kind === "folded" && i !== 0,
      );
      const leaves = medium ? (i < 3 ? 26 : 25) : i < 37 ? 40 : 39;
      for (let j = 0; j < leaves; j++) {
        addNode(
          `scale-leaf-${i}-${j}`,
          branchId,
          `a${digits[j]}`,
          `主题 ${i + 1}.${j + 1}`,
        );
      }
    }
  }

  elements.push({
    id: "ordinary-shape",
    type: "rectangle",
    x: 80,
    y: 250,
    width: 120,
    height: 64,
    backgroundColor: "#ffe8cc",
    fillStyle: "solid",
  });

  return {
    type: "excalidraw",
    version: 2,
    source: "https://github.com/excalidraw/excalidraw",
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 0.75 },
    },
    files: {},
  };
};

for (const kind of ["medium", "wide", "deep", "folded"]) {
  writeFileSync(
    join(directory, `p10-${kind}.excalidraw`),
    JSON.stringify(makeSample(kind)),
  );
}
