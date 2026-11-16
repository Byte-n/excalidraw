import { hashString, layoutElements } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  CanvasSceneCommands,
  ExcalidrawSceneElement,
} from "@excalidraw/yjs";

import { toCanvasSdkError } from "./errors.js";
import { elementBounds, elementKind, elementLabel } from "./apply.js";
import { CanvasLayoutInputSchema, parseInput } from "./schemas.js";

import type { CanvasLayoutReceipt, CanvasSdk } from "./types.js";

export type LayoutDeps = {
  readScene: () => {
    elements: readonly ExcalidrawSceneElement[];
    assets: Record<string, unknown>;
  };
  commands: CanvasSceneCommands<unknown>;
  generation: number;
  assertActive: (write?: boolean) => void;
};

const asElements = (
  elements: readonly ExcalidrawSceneElement[],
): ExcalidrawElement[] => elements as unknown as ExcalidrawElement[];

export const createLayoutApi = (deps: LayoutDeps): CanvasSdk["layout"] => ({
  apply: async (input) => {
    deps.assertActive(true);
    const parsed = parseInput(CanvasLayoutInputSchema, input);
    try {
      const scene = deps.readScene();
      const result = layoutElements(asElements(scene.elements), {
        ids: parsed.ids,
        algorithm: parsed.algorithm,
        ...(parsed.origin ? { origin: parsed.origin } : {}),
        ...(parsed.options ? { options: parsed.options } : {}),
      });
      let elements: readonly ExcalidrawElement[] = result.elements;
      if (!parsed.dryRun) {
        const receipt = deps.commands.commit({
          elements: result.elements as unknown as ExcalidrawSceneElement[],
          generation: deps.generation,
        });
        elements = asElements(receipt.elements);
      }
      const elementsById = new Map(
        elements.map((element) => [element.id, element]),
      );
      const affected = result.affectedElementIds
        .map((id) => elementsById.get(id))
        .filter((element): element is ExcalidrawElement => !!element);
      const receiptElements = affected.map((element) => {
        const kind = elementKind(element);
        const label = elementLabel(element);
        return {
          id: element.id,
          type: element.type,
          ...(kind ? { kind } : {}),
          bounds: elementBounds(element),
          ...(label ? { label } : {}),
        };
      });
      const layoutToken = hashString(
        `${parsed.algorithm}:${[...parsed.ids]
          .sort()
          .join(",")}:${JSON.stringify(parsed.options ?? {})}`,
      ).toString(36);
      const receipt: CanvasLayoutReceipt = {
        elements: receiptElements,
        bounds: result.bounds,
        warnings: result.warnings.map((warning) => ({ ...warning })),
        affectedElementIds: [...result.affectedElementIds],
        layoutToken,
      };
      return receipt;
    } catch (error) {
      throw toCanvasSdkError(error);
    }
  },
});
