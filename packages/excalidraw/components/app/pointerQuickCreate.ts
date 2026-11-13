/**
 * sequence affordances: quick-create handle provider (PR4a).
 *
 * Pure read: it only performs hit-testing / blocking checks and returns the
 * target payload. All hover state is written by `applyPointerFrame`.
 */
import {
  getContainingFrame,
  getQuickCreateTargetElement,
  hitTestQuickCreateHandle,
  isFrameLikeElement,
  isLinearElement,
} from "@excalidraw/element";

import type {
  NonDeletedExcalidrawElement,
  PointerType,
} from "@excalidraw/element/types";

import { registerPointerTargetProvider } from "./pointerFrame";

import type { PointerFrameInput, ProviderFor } from "./pointerFrame";
import type App from "../App";

export type PointerApp = Pick<App, keyof App> & Record<string, any>;

export const resolvePointerType = (
  pointerType: string | undefined,
): PointerType =>
  pointerType === "touch" || pointerType === "pen" ? pointerType : "mouse";

/** Shared gate: sequence affordances only apply to the selection tool. */
export const canHoverSequenceAffordances = (app: PointerApp): boolean =>
  app.state.activeTool.type === "selection" &&
  !app.state.viewModeEnabled &&
  !app.state.editingTextElement &&
  app.isInteractionEnabled();

/**
 * Strictly topmost element under the pointer (locked elements included, since
 * they still occlude). `getElementAtPosition` falls back to the element below
 * when the strict re-test fails, which would let a pole preview appear under an
 * activation bar.
 */
export const getStrictTopmostElementAt = (
  app: PointerApp,
  sceneX: number,
  sceneY: number,
  ignoreIds?: ReadonlySet<string>,
): NonDeletedExcalidrawElement | null => {
  const hits = app.getElementsAtPosition(sceneX, sceneY, {
    includeLockedElements: true,
  });
  for (let index = hits.length - 1; index >= 0; index--) {
    if (!ignoreIds?.has(hits[index].id)) {
      return hits[index];
    }
  }
  return null;
};

/**
 * Whether another element sits under the pointer (quick-create handle yield
 * rule). Frames / containing frames / linear elements / bound elements and the
 * source itself do not count as blockers.
 */
export const isBlockedByElementAt = (
  app: PointerApp,
  sceneX: number,
  sceneY: number,
  source: NonDeletedExcalidrawElement,
): boolean => {
  const under = app.getElementAtPosition(sceneX, sceneY);
  if (!under || under.id === source.id || isLinearElement(under)) {
    return false;
  }
  if (source.boundElements?.some((bound) => bound.id === under.id)) {
    return false;
  }
  const containingFrame = getContainingFrame(
    source,
    app.scene.getNonDeletedElementsMap(),
  );
  return !isFrameLikeElement(under) && under.id !== containingFrame?.id;
};

const quickCreateHandleProvider: ProviderFor<"quickCreateHandle"> = {
  kind: "quickCreateHandle",
  resolve: (app, input: PointerFrameInput) => {
    if (input.mode !== "selection" || !canHoverSequenceAffordances(app)) {
      return null;
    }
    // modifier / pending-insert suppress the whole handle group
    if (app.quickCreate.isSuppressed()) {
      return null;
    }
    const target = getQuickCreateTargetElement(app);
    if (!target) {
      return null;
    }
    const [x, y] = input.point;
    const hit = hitTestQuickCreateHandle(
      app,
      x,
      y,
      resolvePointerType(input.pointerType),
      false,
      target,
    );
    if (!hit) {
      return null;
    }
    const source = app.scene.getNonDeletedElement(hit.elementId);
    if (!source) {
      return null;
    }
    if (isBlockedByElementAt(app, x, y, source)) {
      return null;
    }
    return {
      kind: "quickCreateHandle",
      elementId: hit.elementId,
      direction: hit.direction,
    };
  },
};

registerPointerTargetProvider(quickCreateHandleProvider);
