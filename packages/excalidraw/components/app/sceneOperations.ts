import { newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { CanvasElementOperationResult, Scene } from "@excalidraw/element";

// 共享纯操作只负责候选，editor 在既有撤销/store边界一次性生成版本。
export const commitCanvasElementOperation = (
  scene: Scene,
  result: CanvasElementOperationResult,
) => {
  const previous = scene.getElementsMapIncludingDeleted();
  const changed = new Set(result.changedElementIds);
  scene.replaceAllElements(
    result.elements.map((candidate) => {
      const old = previous.get(candidate.id);
      if (!old || !changed.has(candidate.id)) {
        return candidate;
      }
      const { id, created, updated, version, versionNonce, ...updates } =
        candidate;
      return newElementWith<ExcalidrawElement>(old, updates);
    }),
  );
};
