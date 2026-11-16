import { z } from "zod";

import { createCanvasSceneCommands } from "@excalidraw/yjs";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawSceneElement } from "@excalidraw/yjs";
import type { HocuspocusHeadlessSession } from "@excalidraw/yjs-hocuspocus-client";

import { createCanvasSceneReader } from "../collaboration.js";
import { createDocsApi } from "../docs/index.js";

import {
  createApplyApi,
  elementKind,
  elementLabel,
  summarizeElement,
} from "./apply.js";
import { CanvasSdkError, toCanvasSdkError } from "./errors.js";
import { createGenerateApi } from "./generate.js";
import { createLayoutApi } from "./layout.js";
import {
  CanvasApplyInputSchema,
  CanvasExportInputSchema,
  CanvasGenerateInputSchema,
  CanvasLayoutInputSchema,
  CanvasSceneElementsInputSchema,
  CanvasSceneGetInputSchema,
  CanvasSceneSearchInputSchema,
  CanvasSchemaTypeSchema,
  CanvasTextFitInputSchema,
  CanvasTextMeasureInputSchema,
  CanvasValidateInputSchema,
  parseInput,
} from "./schemas.js";
import { createTextApi, ensureHeadlessTextMetrics } from "./text.js";
import { createValidateApi } from "./validate.js";

import type { CanvasExecutionContext } from "../port.js";
import type {
  CanvasBounds,
  CanvasSceneApi,
  CanvasSdk,
  CanvasSchemaType,
} from "./types.js";

export { CanvasSdkError } from "./errors.js";

type Scene = {
  elements: readonly ExcalidrawSceneElement[];
  assets: Record<string, unknown>;
};

const asElements = (
  elements: readonly ExcalidrawSceneElement[],
): ExcalidrawElement[] => elements as unknown as ExcalidrawElement[];

const intersects = (
  element: ExcalidrawElement,
  region: CanvasBounds,
): boolean => {
  const width =
    Math.min(element.x + (element.width ?? 0), region.x + region.width) -
    Math.max(element.x, region.x);
  const height =
    Math.min(element.y + (element.height ?? 0), region.y + region.height) -
    Math.max(element.y, region.y);
  return width > 0 && height > 0;
};

const createSceneApi = (deps: {
  readScene: () => Scene;
  assertActive: () => void;
}): CanvasSceneApi => ({
  get: async (input) => {
    deps.assertActive();
    const parsed = parseInput(CanvasSceneGetInputSchema, input ?? {});
    try {
      const scene = deps.readScene();
      const all = asElements(scene.elements);
      let selected: ExcalidrawElement[];
      if (parsed.ids) {
        const known = new Set(scene.elements.map((element) => element.id));
        for (const id of parsed.ids) {
          if (!known.has(id)) {
            throw new CanvasSdkError("target_not_found", `元素不存在: ${id}`);
          }
        }
        const ids = new Set(parsed.ids);
        selected = all.filter((element) => ids.has(element.id));
      } else if (parsed.view === "full") {
        selected = all;
      } else {
        selected = all.filter((element) => !element.isDeleted);
      }
      if (parsed.region) {
        const region = parsed.region;
        selected = selected.filter((element) => intersects(element, region));
      }
      if (parsed.view === "full") {
        return {
          view: "full" as const,
          schemaVersion: 2 as const,
          elements: selected.map(
            (element) =>
              structuredClone(element) as unknown as Record<string, unknown>,
          ),
          assets: structuredClone(scene.assets),
        };
      }
      return {
        view: "summary" as const,
        elements: selected.map(summarizeElement),
        total: selected.length,
      };
    } catch (error) {
      throw toCanvasSdkError(error);
    }
  },
  search: async (input) => {
    deps.assertActive();
    const parsed = parseInput(CanvasSceneSearchInputSchema, input);
    try {
      const scene = deps.readScene();
      const query = parsed.query;
      let items = asElements(scene.elements).filter(
        (element) => !element.isDeleted,
      );
      if (parsed.types) {
        const types = new Set(parsed.types);
        items = items.filter(
          (element) =>
            types.has(element.type) ||
            (elementKind(element) !== undefined &&
              types.has(elementKind(element) as string)),
        );
      }
      if (query.length > 0) {
        items = items.filter((element) => {
          const label = elementLabel(element);
          return (
            (label !== undefined && label.includes(query)) ||
            JSON.stringify(element).includes(query)
          );
        });
      }
      const total = items.length;
      const offset = parsed.offset ?? 0;
      const limit = parsed.limit ?? 20;
      const page = items.slice(offset, offset + limit);
      return {
        items: page.map(summarizeElement),
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      };
    } catch (error) {
      throw toCanvasSdkError(error);
    }
  },
  getElements: async (ids) => {
    deps.assertActive();
    const parsed = parseInput(CanvasSceneElementsInputSchema, ids);
    try {
      const scene = deps.readScene();
      const byId = new Map(
        scene.elements.map((element) => [element.id, element]),
      );
      return parsed.map((id) => {
        const element = byId.get(id);
        if (!element) {
          throw new CanvasSdkError("target_not_found", `元素不存在: ${id}`);
        }
        return structuredClone(element) as unknown as Record<string, unknown>;
      });
    } catch (error) {
      throw toCanvasSdkError(error);
    }
  },
});

const schemaFor = (type: CanvasSchemaType) => {
  switch (type) {
    case "apply":
      return CanvasApplyInputSchema;
    case "layout":
      return CanvasLayoutInputSchema;
    case "generate":
      return CanvasGenerateInputSchema;
    case "text":
      return z.union([CanvasTextMeasureInputSchema, CanvasTextFitInputSchema]);
    case "validate":
      return CanvasValidateInputSchema;
    case "scene":
      return CanvasSceneGetInputSchema;
    case "export":
      return CanvasExportInputSchema;
  }
};

const createExportApi = (deps: {
  readScene: () => Scene;
  assertActive: () => void;
}): CanvasSdk["export"] => {
  return async (input) => {
    deps.assertActive();
    const format =
      input && typeof input === "object"
        ? (input as { format?: unknown }).format
        : undefined;
    if (format !== undefined && format !== "json") {
      throw new CanvasSdkError(
        "unsupported_format",
        `不支持的导出格式: ${String(format)}`,
        { legalValues: ["json"] },
      );
    }
    const parsed = parseInput(CanvasExportInputSchema, input ?? {});
    try {
      const scene = deps.readScene();
      let elements = asElements(scene.elements);
      if (parsed.ids) {
        const ids = new Set(parsed.ids);
        elements = elements.filter((element) => ids.has(element.id));
      }
      if (parsed.region) {
        const region = parsed.region;
        elements = elements.filter((element) => intersects(element, region));
      }
      return {
        schemaVersion: 2,
        elements: elements.map(
          (element) =>
            structuredClone(element) as unknown as Record<string, unknown>,
        ),
        assets: structuredClone(scene.assets),
      };
    } catch (error) {
      throw toCanvasSdkError(error);
    }
  };
};

export const createCanvasSdk = (
  session: HocuspocusHeadlessSession<ExcalidrawSceneElement, unknown>,
  context: CanvasExecutionContext,
): CanvasSdk => {
  ensureHeadlessTextMetrics();
  const generation = session.getState().generation;
  const readScene = createCanvasSceneReader(
    session,
    context,
    generation,
  ) as () => Scene;
  const commands = createCanvasSceneCommands({ binding: session.binding });
  const assertActive = (write = false) => {
    if (context.signal?.aborted) {
      throw new CanvasSdkError("execution_cancelled", "脚本执行已取消");
    }
    const gate = session.binding.getGate();
    if (
      !session.binding.isCurrent(generation) ||
      !gate.initialized ||
      !gate.synced
    ) {
      throw new CanvasSdkError("session_unavailable", "协作会话不可用");
    }
    if (write && (context.mode !== "write" || !gate.canEdit)) {
      throw new CanvasSdkError("not_editable", "当前会话不可编辑");
    }
  };
  const apply = createApplyApi({
    session,
    readScene,
    commands,
    generation,
    assertActive,
  });
  const generate = createGenerateApi({ apply });
  const layout = createLayoutApi({
    readScene,
    commands,
    generation,
    assertActive,
  });
  const validate = createValidateApi({
    readScene,
    assertActive: () => assertActive(),
  });
  const exportScene = createExportApi({
    readScene,
    assertActive: () => assertActive(),
  });
  return Object.freeze({
    scene: Object.freeze(
      createSceneApi({ readScene, assertActive: () => assertActive() }),
    ),
    text: Object.freeze(createTextApi()),
    apply,
    generate,
    layout: Object.freeze(layout),
    validate,
    schema: Object.freeze({
      get: async (input: { type: CanvasSchemaType }) => {
        const parsed = parseInput(CanvasSchemaTypeSchema, input);
        return z.toJSONSchema(schemaFor(parsed.type), {
          io: "input",
        }) as Record<string, unknown>;
      },
    }),
    export: exportScene,
    docs: Object.freeze(createDocsApi()),
  });
};

export type {
  CanvasApplyInput,
  CanvasApplyReceipt,
  CanvasBounds,
  CanvasDocsApi,
  CanvasDocsGuide,
  CanvasDocsIndex,
  CanvasDocsKind,
  CanvasDocsReadInput,
  CanvasDocsReadResult,
  CanvasDocsSearchInput,
  CanvasDocsSearchResult,
  CanvasDocsTopicSummary,
  CanvasDiagramEdgeInput,
  CanvasDiagramNodeInput,
  CanvasElementSummary,
  CanvasGenerateApi,
  CanvasGenerateDiagramInput,
  CanvasGenerateMindmapInput,
  CanvasGenerateSequenceInput,
  CanvasGenerateTableInput,
  CanvasLayoutInput,
  CanvasLayoutReceipt,
  CanvasMindmapDirection,
  CanvasMindmapNodeInput,
  CanvasPoint,
  CanvasSequenceFragmentInput,
  CanvasSequenceMessageInput,
  CanvasSequenceParticipantInput,
  CanvasSceneApi,
  CanvasSceneView,
  CanvasSchemaType,
  CanvasSdk,
  CanvasTextApi,
  CanvasTextStyleInput,
  CanvasValidateInput,
  CanvasValidateIssue,
  CanvasValidateResult,
  CanvasWarning,
} from "./types.js";
