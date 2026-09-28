import type { ElementsMapOrArray, ExcalidrawElement } from "./types";

type FrameChildrenIndex = Map<ExcalidrawElement["id"], ExcalidrawElement[]>;

const indexes = new WeakMap<object, FrameChildrenIndex>();
const collectionsByIndex = new WeakMap<
  FrameChildrenIndex,
  ElementsMapOrArray
>();
const indexesByElement = new WeakMap<
  ExcalidrawElement,
  Set<FrameChildrenIndex>
>();

const removeElementIndex = (
  element: ExcalidrawElement,
  index: FrameChildrenIndex,
) => {
  const indexes = indexesByElement.get(element);
  indexes?.delete(index);
  if (indexes?.size === 0) {
    indexesByElement.delete(element);
  }
};

export const unregisterFrameChildrenIndex = (
  ...collections: readonly ElementsMapOrArray[]
) => {
  for (const collection of collections) {
    const index = indexes.get(collection as object);
    if (!index) {
      continue;
    }
    for (const element of collection.values()) {
      removeElementIndex(element, index);
    }
    indexes.delete(collection as object);
    collectionsByIndex.delete(index);
  }
};

export const registerFrameChildrenIndex = (
  ...collections: readonly ElementsMapOrArray[]
) => {
  for (const collection of collections) {
    const frameChildrenById: FrameChildrenIndex = new Map();
    for (const element of collection.values()) {
      const elementIndexes = indexesByElement.get(element) || new Set();
      elementIndexes.add(frameChildrenById);
      indexesByElement.set(element, elementIndexes);

      const frameId = element.containerRef?.elementId;
      if (!frameId) {
        continue;
      }
      const children = frameChildrenById.get(frameId) || [];
      children.push(element);
      frameChildrenById.set(frameId, children);
    }
    indexes.set(collection as object, frameChildrenById);
    collectionsByIndex.set(frameChildrenById, collection);
  }
};

export const updateFrameChildrenIndex = (
  element: ExcalidrawElement,
  previousFrameId: string | undefined,
  nextFrameId: string | undefined,
) => {
  if (previousFrameId === nextFrameId) {
    return;
  }

  for (const index of indexesByElement.get(element) || []) {
    const previousChildren = previousFrameId
      ? index.get(previousFrameId)
      : undefined;
    if (previousFrameId && previousChildren) {
      const elementIndex = previousChildren.findIndex(
        (child) => child.id === element.id,
      );
      if (elementIndex !== -1) {
        previousChildren.splice(elementIndex, 1);
        if (!previousChildren.length) {
          index.delete(previousFrameId);
        }
      }
    }

    if (nextFrameId) {
      const nextChildren = index.get(nextFrameId) || [];
      if (!nextChildren.some((child) => child.id === element.id)) {
        let insertionIndex = 0;
        for (const candidate of collectionsByIndex.get(index)?.values() || []) {
          if (candidate.id === element.id) {
            break;
          }
          if (candidate.containerRef?.elementId === nextFrameId) {
            insertionIndex++;
          }
        }
        nextChildren.splice(insertionIndex, 0, element);
        index.set(nextFrameId, nextChildren);
      }
    }
  }
};

export const getIndexedFrameChildren = (
  elements: ElementsMapOrArray,
  frameId: string,
): ExcalidrawElement[] | null => {
  const index = indexes.get(elements as object);
  return index ? index.get(frameId)?.slice() ?? [] : null;
};
