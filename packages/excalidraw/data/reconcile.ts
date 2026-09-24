import throttle from "lodash.throttle";

import { arrayToMap, isDevEnv, isTestEnv } from "@excalidraw/common";

import {
  orderByFractionalIndex,
  buildMindmapGraphIndex,
  computeBoundTextPosition,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  layoutMindmap,
  repairMindmapElements,
  syncInvalidIndices,
  validateFractionalIndices,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElementWithContainer,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import type { MakeBrand } from "@excalidraw/common/utility-types";

import type { AppState } from "../types";

export type ReconciledExcalidrawElement = OrderedExcalidrawElement &
  MakeBrand<"ReconciledElement">;

export type RemoteExcalidrawElement = OrderedExcalidrawElement &
  MakeBrand<"RemoteExcalidrawElement">;

export type MindmapReconciliationConflict = {
  graphId: string;
  nodeIds: readonly string[];
};

export type MindmapReconciliationResult = {
  elements: ReconciledExcalidrawElement[];
  conflicts: readonly MindmapReconciliationConflict[];
};

export const shouldDiscardRemoteElement = (
  localAppState: AppState,
  local: OrderedExcalidrawElement | undefined,
  remote: RemoteExcalidrawElement,
): boolean => {
  if (
    local &&
    // local element is being edited
    (local.id === localAppState.editingTextElement?.id ||
      local.id === localAppState.resizingElement?.id ||
      local.id === localAppState.newElement?.id ||
      // local element is newer
      local.version > remote.version ||
      // resolve conflicting edits deterministically by taking the one with
      // the lowest versionNonce
      (local.version === remote.version &&
        local.versionNonce <= remote.versionNonce))
  ) {
    return true;
  }
  return false;
};

const validateIndicesThrottled = throttle(
  (
    orderedElements: readonly OrderedExcalidrawElement[],
    localElements: readonly OrderedExcalidrawElement[],
    remoteElements: readonly RemoteExcalidrawElement[],
  ) => {
    if (isDevEnv() || isTestEnv() || window?.DEBUG_FRACTIONAL_INDICES) {
      // create new instances due to the mutation
      const elements = syncInvalidIndices(
        orderedElements.map((x) => ({ ...x })),
      );

      validateFractionalIndices(elements, {
        // throw in dev & test only, to remain functional on `DEBUG_FRACTIONAL_INDICES`
        shouldThrow: isTestEnv() || isDevEnv(),
        includeBoundTextValidation: true,
        reconciliationContext: {
          localElements,
          remoteElements,
        },
      });
    }
  },
  1000 * 60,
  { leading: true, trailing: false },
);

export const reconcileElements = (
  localElements: readonly OrderedExcalidrawElement[],
  remoteElements: readonly RemoteExcalidrawElement[],
  localAppState: AppState,
): ReconciledExcalidrawElement[] => {
  const localElementsMap = arrayToMap(localElements);
  const reconciledElements: OrderedExcalidrawElement[] = [];
  const added = new Set<string>();

  // process remote elements
  for (const remoteElement of remoteElements) {
    if (!added.has(remoteElement.id)) {
      const localElement = localElementsMap.get(remoteElement.id);
      const discardRemoteElement = shouldDiscardRemoteElement(
        localAppState,
        localElement,
        remoteElement,
      );

      if (localElement && discardRemoteElement) {
        reconciledElements.push(localElement);
        added.add(localElement.id);
      } else {
        reconciledElements.push(remoteElement);
        added.add(remoteElement.id);
      }
    }
  }

  // process remaining local elements
  for (const localElement of localElements) {
    if (!added.has(localElement.id)) {
      reconciledElements.push(localElement);
      added.add(localElement.id);
    }
  }

  const orderedElements = orderByFractionalIndex(reconciledElements);

  validateIndicesThrottled(orderedElements, localElements, remoteElements);

  // de-duplicate indices
  syncInvalidIndices(orderedElements);

  return orderedElements as ReconciledExcalidrawElement[];
};

const hasMindmapStructureChanged = (
  before: ExcalidrawElement | undefined,
  after: ExcalidrawElement | undefined,
) => {
  if (!before || !after) {
    return false;
  }
  if (isMindmapNodeElement(before) && isMindmapNodeElement(after)) {
    return (
      before.graphId !== after.graphId ||
      before.role !== after.role ||
      before.parentId !== after.parentId ||
      before.order !== after.order ||
      before.isDeleted !== after.isDeleted
    );
  }
  if (isMindmapEdgeElement(before) && isMindmapEdgeElement(after)) {
    return (
      before.graphId !== after.graphId ||
      before.parentId !== after.parentId ||
      before.childId !== after.childId ||
      before.isDeleted !== after.isDeleted
    );
  }
  return false;
};

/**
 * Reconciles the complete Mindmap graphs touched by a remote update. Element
 * versions decide which fields win first; this pass then repairs the merged
 * graph and derives all edges, positions, and bound labels from that result.
 * It never mutates the scene or records history.
 */
export const reconcileMindmapElements = (
  elements: readonly OrderedExcalidrawElement[],
  graphIds: readonly string[] | ReadonlySet<string>,
): MindmapReconciliationResult => {
  const affectedGraphIds = new Set(graphIds);
  if (!affectedGraphIds.size) {
    return {
      elements: elements as ReconciledExcalidrawElement[],
      conflicts: [],
    };
  }

  const before = new Map(elements.map((element) => [element.id, element]));
  const repaired = repairMindmapElements(elements);
  const updated = new Map(repaired.map((element) => [element.id, element]));
  const conflicts: MindmapReconciliationConflict[] = [];

  for (const graphId of [...affectedGraphIds].sort()) {
    const graph = repaired.filter(
      (element) =>
        !element.isDeleted &&
        (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
        element.graphId === graphId,
    );
    const nodes = graph.filter(isMindmapNodeElement);
    if (!nodes.length) {
      continue;
    }

    const changedNodeIds = new Set<string>();
    for (const element of repaired) {
      if (
        (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
        element.graphId === graphId &&
        hasMindmapStructureChanged(before.get(element.id), element)
      ) {
        changedNodeIds.add(
          isMindmapNodeElement(element) ? element.id : element.childId,
        );
      }
    }

    try {
      const index = buildMindmapGraphIndex(graph, graphId);
      const layout = layoutMindmap(index);
      for (const element of [...layout.elements, ...layout.edges]) {
        updated.set(element.id, element);
      }

      for (const element of repaired) {
        if (
          !element.isDeleted &&
          element.type === "text" &&
          element.containerId
        ) {
          const container = updated.get(element.containerId);
          if (
            container &&
            isMindmapNodeElement(container) &&
            container.graphId === graphId
          ) {
            updated.set(element.id, {
              ...element,
              ...computeBoundTextPosition(
                container,
                element as ExcalidrawTextElementWithContainer,
                updated,
              ),
            });
          }
        }
      }
    } catch {
      // A malformed remote graph must not prevent unrelated remote changes
      // from being applied. The repaired elements remain the best available
      // deterministic state and are surfaced as a conflict below.
      nodes.forEach((node) => changedNodeIds.add(node.id));
    }

    if (changedNodeIds.size) {
      conflicts.push({
        graphId,
        nodeIds: [...changedNodeIds].sort(),
      });
    }
  }

  return {
    elements: repaired.map(
      (element) => updated.get(element.id) ?? element,
    ) as ReconciledExcalidrawElement[],
    conflicts,
  };
};
