import type { ExcalidrawElement } from "./types";

const defragmentGroups = (elements: readonly ExcalidrawElement[]) => {
  const groupIdAtLevel = (element: ExcalidrawElement, level: number) => {
    return element.groupIds[element.groupIds.length - level - 1];
  };

  const orderLevel = (
    levelElements: readonly ExcalidrawElement[],
    level: number,
  ): ExcalidrawElement[] => {
    const buckets = new Map<string, ExcalidrawElement[]>();
    // Slots preserve first-occurrence order: a groupId reserves its slot
    // the first time one of its members is seen; loose elements occupy
    // their own slot. Groups are then expanded (and recursed into) in place.
    const slots: (ExcalidrawElement | string)[] = [];

    for (const element of levelElements) {
      const groupId = groupIdAtLevel(element, level);
      if (groupId === undefined) {
        slots.push(element);
        continue;
      }
      let bucket = buckets.get(groupId);
      if (!bucket) {
        bucket = [];
        buckets.set(groupId, bucket);
        slots.push(groupId);
      }
      bucket.push(element);
    }

    return slots.flatMap((slot) =>
      typeof slot === "string"
        ? orderLevel(buckets.get(slot)!, level + 1)
        : [slot],
    );
  };

  // `groupIds` is stored innermost-first, so the outermost group is the
  // last entry. We recurse from level 0 (outermost) inward.
  const sortedElements = orderLevel(elements, 0);

  // if there's a bug which resulted in losing some of the elements, return
  // original instead as that's better than losing data
  if (sortedElements.length !== elements.length) {
    console.error("defragmentGroups: lost some elements... bailing!");
    return elements;
  }

  return sortedElements;
};

export const normalizeElementOrder = (
  elements: readonly ExcalidrawElement[],
) => {
  return defragmentGroups(elements);
};
