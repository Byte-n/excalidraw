import {
  getLocalTextRegionLayout,
  getTextRegion,
  isShapeElement,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawSceneElement } from "@excalidraw/yjs";

import { CanvasSdkError, toCanvasSdkError } from "./errors.js";
import {
  CanvasValidateChecks,
  CanvasValidateInputSchema,
  parseInput,
} from "./schemas.js";

import type {
  CanvasSdk,
  CanvasValidateIssue,
  CanvasValidateResult,
} from "./types.js";

export type ValidateDeps = {
  readScene: () => {
    elements: readonly ExcalidrawSceneElement[];
    assets: Record<string, unknown>;
  };
  assertActive: () => void;
};

const asElements = (
  elements: readonly ExcalidrawSceneElement[],
): ExcalidrawElement[] => elements as unknown as ExcalidrawElement[];

const boundsOf = (element: ExcalidrawElement) => ({
  x: element.x,
  y: element.y,
  width: element.width ?? 0,
  height: element.height ?? 0,
});

const overlapArea = (left: ExcalidrawElement, right: ExcalidrawElement) => {
  const a = boundsOf(left);
  const b = boundsOf(right);
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
};

const containerRefId = (element: ExcalidrawElement) => {
  const ref = (element as { containerRef?: { elementId?: unknown } })
    .containerRef;
  return typeof ref?.elementId === "string" ? ref.elementId : undefined;
};

const isBoundPair = (left: ExcalidrawElement, right: ExcalidrawElement) => {
  const boundElements = (element: ExcalidrawElement) =>
    (element as { boundElements?: readonly { id: string }[] }).boundElements ??
    [];
  if (boundElements(left).some((ref) => ref.id === right.id)) {
    return true;
  }
  if (boundElements(right).some((ref) => ref.id === left.id)) {
    return true;
  }
  const bindingTargets = (element: ExcalidrawElement) => {
    const source = element as {
      startBinding?: { elementId?: unknown } | null;
      endBinding?: { elementId?: unknown } | null;
    };
    return [source.startBinding?.elementId, source.endBinding?.elementId];
  };
  return (
    bindingTargets(left).includes(right.id) ||
    bindingTargets(right).includes(left.id)
  );
};

const detectOverlap = (elements: readonly ExcalidrawElement[]) => {
  const issues: CanvasValidateIssue[] = [];
  for (let leftIndex = 0; leftIndex < elements.length; leftIndex++) {
    const left = elements[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < elements.length;
      rightIndex++
    ) {
      const right = elements[rightIndex];
      const leftParent = containerRefId(left);
      const rightParent = containerRefId(right);
      if (leftParent === right.id || rightParent === left.id) {
        continue;
      }
      if (isBoundPair(left, right)) {
        continue;
      }
      if (overlapArea(left, right) <= 0) {
        continue;
      }
      issues.push({
        code: "overlap",
        severity: "warning",
        elementIds: [left.id, right.id],
        message: `元素 ${left.id} 与 ${right.id} 重叠`,
      });
    }
  }
  return issues;
};

const detectOverflow = (elements: readonly ExcalidrawElement[]) => {
  const issues: CanvasValidateIssue[] = [];
  for (const element of elements) {
    if (!isShapeElement(element) && element.type !== "mindmap-node") {
      continue;
    }
    const texts = (element as { texts?: { body?: { text?: unknown } } }).texts;
    const text = texts?.body?.text;
    if (typeof text !== "string" || text.length === 0) {
      continue;
    }
    const region = getTextRegion(element, "body");
    const layout = getLocalTextRegionLayout(element, "body");
    if (!region || !layout) {
      continue;
    }
    if (
      layout.width > region.bounds.width + 0.5 ||
      layout.height > region.bounds.height + 0.5
    ) {
      issues.push({
        code: "overflow",
        severity: "warning",
        elementIds: [element.id],
        message: `元素 ${element.id} 的正文超出文本安全区`,
      });
    }
  }
  return issues;
};

const bindingTarget = (element: ExcalidrawElement, end: "start" | "end") => {
  const binding = (
    element as {
      startBinding?: { elementId?: unknown } | null;
      endBinding?: { elementId?: unknown } | null;
    }
  )[`${end}Binding`];
  return typeof binding?.elementId === "string" ? binding.elementId : undefined;
};

const isConnector = (element: ExcalidrawElement) =>
  element.type === "arrow" || element.type === "line";

const detectBindings = (elements: readonly ExcalidrawElement[]) => {
  const issues: CanvasValidateIssue[] = [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.isDeleted || !isConnector(element)) {
      continue;
    }
    for (const end of ["start", "end"] as const) {
      const targetId = bindingTarget(element, end);
      if (!targetId) {
        continue;
      }
      const target = byId.get(targetId);
      if (!target || target.isDeleted) {
        issues.push({
          code: "bindings",
          severity: "warning",
          elementIds: [element.id],
          message: `连线 ${element.id} 的 ${end} 端点目标不存在`,
        });
        continue;
      }
      const reciprocal =
        (target as { boundElements?: readonly { id: string }[] })
          .boundElements ?? [];
      if (!reciprocal.some((ref) => ref.id === element.id)) {
        issues.push({
          code: "bindings",
          severity: "warning",
          elementIds: [element.id, target.id],
          message: `连线 ${element.id} 与目标 ${target.id} 的绑定不互逆`,
        });
      }
    }
  }
  return issues;
};

const detectDangling = (elements: readonly ExcalidrawElement[]) => {
  const issues: CanvasValidateIssue[] = [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }
    if (isConnector(element)) {
      for (const end of ["start", "end"] as const) {
        const targetId = bindingTarget(element, end);
        if (!targetId) {
          continue;
        }
        const target = byId.get(targetId);
        if (!target || target.isDeleted) {
          issues.push({
            code: "dangling",
            severity: "warning",
            elementIds: [element.id],
            message: `连线 ${element.id} 的 ${end} 端点悬空`,
          });
        }
      }
      continue;
    }
    const boundElements =
      (element as { boundElements?: readonly { id: string }[] })
        .boundElements ?? [];
    for (const ref of boundElements) {
      const connector = byId.get(ref.id);
      if (!connector || connector.isDeleted || !isConnector(connector)) {
        continue;
      }
      if (
        bindingTarget(connector, "start") !== element.id &&
        bindingTarget(connector, "end") !== element.id
      ) {
        issues.push({
          code: "dangling",
          severity: "warning",
          elementIds: [element.id, connector.id],
          message: `元素 ${element.id} 与连线 ${connector.id} 的绑定丢失`,
        });
      }
    }
  }
  return issues;
};

export const createValidateApi = (
  deps: ValidateDeps,
): CanvasSdk["validate"] => {
  return async (input) => {
    deps.assertActive();
    const parsed = parseInput(CanvasValidateInputSchema, input ?? {});
    const checks = new Set<string>(parsed.checks ?? CanvasValidateChecks);
    try {
      const scene = deps.readScene();
      const all = asElements(scene.elements);
      let selected: ExcalidrawElement[];
      if (parsed.ids) {
        const byId = new Map(all.map((element) => [element.id, element]));
        selected = parsed.ids.map((id) => {
          const element = byId.get(id);
          if (!element) {
            throw new CanvasSdkError(
              "target_not_found",
              `校验目标不存在: ${id}`,
            );
          }
          return element;
        });
      } else {
        selected = all;
      }
      selected = selected.filter((element) => !element.isDeleted);
      const issues: CanvasValidateIssue[] = [];
      if (checks.has("overlap")) {
        issues.push(...detectOverlap(selected));
      }
      if (checks.has("overflow")) {
        issues.push(...detectOverflow(selected));
      }
      if (checks.has("bindings")) {
        issues.push(...detectBindings(all));
      }
      if (checks.has("dangling")) {
        issues.push(...detectDangling(all));
      }
      const result: CanvasValidateResult = { ok: issues.length === 0, issues };
      return result;
    } catch (error) {
      throw toCanvasSdkError(error);
    }
  };
};
