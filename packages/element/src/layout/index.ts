import { CanvasSceneError } from "../sceneOperations";

import {
  applyLayoutPositions,
  computeAlignPositions,
  computeColumnPositions,
  computeDistributePositions,
  computeGridPositions,
  computeRowPositions,
  computeStackPositions,
  getLayoutOrigin,
} from "./boxes";
import { layoutLayered } from "./layered";
import { layoutTree } from "./tree";

import type { ExcalidrawElement } from "../types";

import type {
  LayoutAlgorithmId,
  LayoutOptions,
  LayoutRequest,
  LayoutResult,
  LayoutWarning,
} from "./types";

export * from "./types";

const validateNonNegativeOption = (
  value: number | undefined,
  path: string,
) => {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new CanvasSceneError(
      "invalid_input",
      `${path} 必须是有限且不小于 0 的数值`,
    );
  }
};

const validateOptions = (options: LayoutOptions | undefined) => {
  if (!options) {
    return;
  }
  validateNonNegativeOption(options.rankGap, "options.rankGap");
  validateNonNegativeOption(options.nodeGap, "options.nodeGap");
  validateNonNegativeOption(options.gap, "options.gap");
  validateNonNegativeOption(options.columns, "options.columns");
  if (
    options.direction !== undefined &&
    options.direction !== "TB" &&
    options.direction !== "LR"
  ) {
    throw new CanvasSceneError("invalid_input", "options.direction 无效");
  }
  if (
    options.axis !== undefined &&
    options.axis !== "x" &&
    options.axis !== "y"
  ) {
    throw new CanvasSceneError("invalid_input", "options.axis 无效");
  }
  if (
    options.position !== undefined &&
    options.position !== "start" &&
    options.position !== "center" &&
    options.position !== "end"
  ) {
    throw new CanvasSceneError("invalid_input", "options.position 无效");
  }
};

const resolveTargets = (
  elements: readonly ExcalidrawElement[],
  ids: readonly string[],
): readonly ExcalidrawElement[] => {
  const unique = [...new Set(ids)];
  if (!unique.length) {
    throw new CanvasSceneError("invalid_input", "布局需要至少一个元素 id");
  }
  const elementsMap = new Map(elements.map((element) => [element.id, element]));
  return unique.map((id) => {
    const element = elementsMap.get(id);
    if (!element || element.isDeleted) {
      throw new CanvasSceneError("target_not_found", `布局目标不存在: ${id}`);
    }
    return element;
  });
};

const applyBoxAlgorithm = (
  elements: readonly ExcalidrawElement[],
  algorithm: LayoutAlgorithmId,
  selected: readonly ExcalidrawElement[],
  request: LayoutRequest,
): {
  elements: readonly ExcalidrawElement[];
  bounds: LayoutResult["bounds"];
  affectedElementIds: readonly string[];
  warnings: readonly LayoutWarning[];
} => {
  const options = request.options ?? {};
  const warnings: LayoutWarning[] = [];
  const origin = request.origin ?? getLayoutOrigin(selected);
  let positions: Map<string, { x: number; y: number }>;

  switch (algorithm) {
    case "layered":
      positions = layoutLayered(elements, selected, origin, options, warnings);
      break;
    case "grid":
      positions = computeGridPositions(selected, origin, options, warnings);
      break;
    case "row":
      positions = computeRowPositions(selected, origin, options);
      break;
    case "column":
      positions = computeColumnPositions(selected, origin, options);
      break;
    case "stack":
      positions = computeStackPositions(selected, origin, options);
      break;
    case "align":
      positions = computeAlignPositions(selected, options);
      break;
    case "distribute":
      positions = computeDistributePositions(selected, options);
      break;
    default:
      throw new CanvasSceneError("invalid_input", "不支持的布局算法");
  }

  const result = applyLayoutPositions(elements, positions, warnings);
  return {
    elements: result.elements,
    bounds: result.bounds,
    affectedElementIds: result.affectedElementIds,
    warnings,
  };
};

export const layoutElements = (
  elements: readonly ExcalidrawElement[],
  request: LayoutRequest,
): LayoutResult => {
  validateOptions(request.options);
  const selected = resolveTargets(elements, request.ids);

  if (request.algorithm === "align" && selected.length < 2) {
    throw new CanvasSceneError("invalid_input", "对齐至少需要两个元素");
  }
  if (request.algorithm === "distribute" && selected.length < 3) {
    throw new CanvasSceneError("invalid_input", "分布至少需要三个元素");
  }

  if (request.algorithm === "tree") {
    const warnings: LayoutWarning[] = [];
    const result = layoutTree(elements, selected, request.origin, warnings);
    return {
      elements: result.elements,
      bounds: result.bounds,
      warnings,
      affectedElementIds: result.affectedElementIds,
    };
  }

  const result = applyBoxAlgorithm(
    elements,
    request.algorithm,
    selected,
    request,
  );
  return {
    elements: result.elements,
    bounds: result.bounds,
    warnings: result.warnings,
    affectedElementIds: result.affectedElementIds,
  };
};
