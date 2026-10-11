import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { restoreElements } from "../../data/restore";
import { isValidExcalidrawData } from "../../data/json";

type ShowcaseScene = {
  elements: ExcalidrawElement[];
  files: Record<string, { dataURL: string }>;
};

// Resolve the sample relative to this test file so the suite works whether it
// is launched from the repo root or from the package directory (the package's
// `test` script only changes the vitest project root, not `process.cwd()`).
const samplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/mindmap-plan/samples",
);

describe("showcase whiteboard sample", () => {
  it("restores its graphs, flowchart and embedded image", () => {
    const scene = JSON.parse(
      readFileSync(
        resolve(samplesDir, "showcase-all-types.excalidraw"),
        "utf8",
      ),
    ) as ShowcaseScene;
    expect(isValidExcalidrawData(scene)).toBe(true);
    const restored = restoreElements(scene.elements, null, {
      repairBindings: true,
    });

    expect(restored).toHaveLength(scene.elements.length);
    expect(new Set(restored.map((element) => element.id)).size).toBe(
      restored.length,
    );

    const roots = restored.filter(
      (element) => element.type === "mindmap-node" && element.role === "root",
    );
    expect(roots.map((root) => root.layoutDirection).sort()).toEqual([
      "bottom-to-top",
      "left-to-right",
      "right-to-left",
      "top-to-bottom",
    ]);
    expect(
      restored.filter((element) => element.type === "mindmap-edge"),
    ).toHaveLength(16);

    const arrow = restored.find((element) => element.id === "flow-yes");
    expect(arrow).toMatchObject({
      type: "arrow",
      startBinding: { elementId: "flow-review" },
      endBinding: { elementId: "flow-approve" },
    });
    expect(new Set(restored.map((element) => element.type))).toEqual(
      new Set([
        "arrow",
        "composite_shape",
        "embeddable",
        "frame",
        "freedraw",
        "iframe",
        "image",
        "line",
        "magicframe",
        "mindmap-edge",
        "mindmap-node",
        "stickynote",
        "text",
      ]),
    );
    expect(scene.files["showcase-image"].dataURL).toMatch(
      /^data:image\/png;base64,/,
    );
  });
});
