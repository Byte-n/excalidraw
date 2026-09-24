import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildMindmapGraphIndex,
  isMindmapNodeElement,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";

describe("P10 scale samples", () => {
  for (const [name, count] of [
    ["medium", 500],
    ["wide", 2000],
    ["deep", 2000],
    ["folded", 2000],
  ] as const) {
    it(`restores ${name} without losing nodes`, () => {
      const sample = JSON.parse(
        readFileSync(
          resolve(`docs/plan/samples/p10-${name}.excalidraw`),
          "utf8",
        ),
      ) as { elements: ExcalidrawElement[] };
      const restored = restoreElements(sample.elements, null, {
        repairBindings: true,
      });
      expect(restored.filter(isMindmapNodeElement)).toHaveLength(count);
      const index = buildMindmapGraphIndex(restored, "p10-scale");
      expect(index.nodes.size).toBe(count - 2);
      if (name === "deep") {
        expect(index.depthById.get("scale-1997")).toBe(1997);
      }
    });
  }
});
