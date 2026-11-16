import { layoutMindmapScene } from "../mindmapScene";
import { isMindmapEdgeElement, isMindmapNodeElement } from "../typeChecks";

import {
  elementGeometryChanged,
  getLayoutBounds,
  translateLayoutElements,
} from "./boxes";

import type { ExcalidrawElement } from "../types";

import type { LayoutBounds, LayoutPosition, LayoutWarning } from "./types";

export const layoutTree = (
  elements: readonly ExcalidrawElement[],
  selected: readonly ExcalidrawElement[],
  origin: LayoutPosition | undefined,
  warnings: LayoutWarning[],
): {
  elements: readonly ExcalidrawElement[];
  bounds: LayoutBounds;
  affectedElementIds: readonly string[];
} => {
  const graphIds: string[] = [];
  for (const element of selected) {
    if (
      (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
      !graphIds.includes(element.graphId)
    ) {
      graphIds.push(element.graphId);
    }
  }
  if (!graphIds.length) {
    warnings.push({
      code: "layout_no_mindmap",
      message: "选中元素中没有脑图节点或连线，未做几何调整",
    });
    return {
      elements,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      affectedElementIds: [],
    };
  }

  const graphIdSet = new Set(graphIds);
  const graphElementIds = new Set(
    elements
      .filter(
        (element) =>
          !element.isDeleted &&
          (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
          graphIdSet.has(element.graphId),
      )
      .map((element) => element.id),
  );
  const inputById = new Map(elements.map((element) => [element.id, element]));
  const laidOut = layoutMindmapScene(elements, graphIds);
  const changedIds = new Set(
    laidOut
      .filter((element) =>
        elementGeometryChanged(inputById.get(element.id), element),
      )
      .map((element) => element.id),
  );

  let nextElements = laidOut;
  const affected = new Set(changedIds);
  if (origin && graphElementIds.size) {
    const graphElements = laidOut.filter(
      (element) => graphElementIds.has(element.id) && !element.isDeleted,
    );
    const bounds = getLayoutBounds(graphElements);
    nextElements = translateLayoutElements(laidOut, graphElementIds, {
      x: origin.x - bounds.x,
      y: origin.y - bounds.y,
    });
    for (const id of graphElementIds) {
      affected.add(id);
    }
  }

  return {
    elements: nextElements,
    bounds: getLayoutBounds(
      nextElements.filter(
        (element) => affected.has(element.id) && !element.isDeleted,
      ),
    ),
    affectedElementIds: [...affected],
  };
};
