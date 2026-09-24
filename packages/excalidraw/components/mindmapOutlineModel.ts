import {
  buildMindmapGraphIndex,
  getBoundTextElement,
  isMindmapNodeElement,
} from "@excalidraw/element";

import type {
  ExcalidrawMindmapNodeElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { t } from "../i18n";

export type MindmapOutlineGraph = {
  graphId: string;
  number: number;
  index: ReturnType<typeof buildMindmapGraphIndex>;
  labels: ReadonlyMap<string, string>;
  title: string;
};

export const getMindmapOutlines = (
  elements: readonly NonDeletedExcalidrawElement[],
): MindmapOutlineGraph[] => {
  const elementMap = new Map(elements.map((element) => [element.id, element]));
  const graphIds = new Set(
    elements.filter(isMindmapNodeElement).map((node) => node.graphId),
  );
  return [...graphIds].map((graphId, graphIndex) => {
    const index = buildMindmapGraphIndex(elements, graphId);
    const labels = new Map(
      [...index.nodes.values()].map((node) => [
        node.id,
        getBoundTextElement(node, elementMap)?.originalText ||
          t("labels.mindmapUntitled"),
      ]),
    );
    return {
      graphId,
      number: graphIndex + 1,
      index,
      labels,
      title: labels.get(index.rootId)!,
    };
  });
};

export const getMindmapPath = (
  graph: MindmapOutlineGraph,
  node: ExcalidrawMindmapNodeElement,
) => {
  const path: string[] = [];
  let current: ExcalidrawMindmapNodeElement | undefined = node;
  while (current) {
    path.push(graph.labels.get(current.id)!);
    current = current.parentId
      ? graph.index.nodes.get(current.parentId)
      : undefined;
  }
  return path.reverse();
};
