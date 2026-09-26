import { EVENT } from "@excalidraw/common";

import {
  withBatchedUpdates,
  withBatchedUpdatesThrottled,
} from "../../reactUtils";

import type React from "react";

import type { ScrollBars } from "../../scene/types";
import type { AppState, PointerDownState } from "../../types";

/** Mutable state for one mounted editor's pointer and transient input session. */
export type InteractionState = {
  didTapTwice: boolean;
  tappedTwiceTimer: ReturnType<Window["setTimeout"]> | 0;
  firstTapPosition: { x: number; y: number } | null;
  isDraggingScrollBar: boolean;
  currentScrollBars: ScrollBars;
  touchTimeout: ReturnType<Window["setTimeout"]> | 0;
  invalidateContextMenu: boolean;
  isPlainPaste: boolean;
  plainPasteTimer: ReturnType<Window["setTimeout"]> | 0;
  plainPasteToastShown: boolean;
  lastPointerUp: (() => void) | null;
};

export const createInteractionState = (): InteractionState => ({
  didTapTwice: false,
  tappedTwiceTimer: 0,
  firstTapPosition: null,
  isDraggingScrollBar: false,
  currentScrollBars: { horizontal: null, vertical: null },
  touchTimeout: 0,
  invalidateContextMenu: false,
  isPlainPaste: false,
  plainPasteTimer: 0,
  plainPasteToastShown: false,
  lastPointerUp: null,
});

export const resetTapTwice = (interactionState: InteractionState) => {
  interactionState.didTapTwice = false;
  interactionState.firstTapPosition = null;
};

export const resetInteractionState = (app: {
  interactionState: InteractionState;
  ownerWindow: Window & typeof globalThis;
}) => {
  const state = app.interactionState;
  state.isDraggingScrollBar = false;
  state.lastPointerUp = null;
  if (state.tappedTwiceTimer) {
    app.ownerWindow.clearTimeout(state.tappedTwiceTimer);
  }
  state.tappedTwiceTimer = 0;
  resetTapTwice(state);
  if (state.plainPasteTimer) {
    app.ownerWindow.clearTimeout(state.plainPasteTimer);
  }
  state.plainPasteTimer = 0;
  state.isPlainPaste = false;
  if (state.touchTimeout) {
    app.ownerWindow.clearTimeout(state.touchTimeout);
  }
  state.touchTimeout = 0;
  state.invalidateContextMenu = false;
};

/**
 * Owns window listeners used while a scrollbar is being dragged. Keeping the
 * teardown callback on the instance prevents one editor from cleaning up
 * another editor's pointer session.
 */
export const handleDraggingScrollBar = (
  app: any,
  event: React.PointerEvent<HTMLElement>,
  pointerDownState: PointerDownState,
): boolean => {
  if (!(pointerDownState.scrollbars.isOverEither && !app.state.multiElement)) {
    return false;
  }
  const interactionState = app.interactionState as InteractionState;
  interactionState.isDraggingScrollBar = true;
  pointerDownState.lastCoords.x = event.clientX;
  pointerDownState.lastCoords.y = event.clientY;
  const onPointerMove = withBatchedUpdatesThrottled(
    (moveEvent: PointerEvent) => {
      const target = moveEvent.target;
      if (!(target instanceof app.ownerWindow.HTMLElement)) {
        return;
      }
      app.handlePointerMoveOverScrollbars(moveEvent, pointerDownState);
    },
  );
  const onPointerUp = withBatchedUpdates(() => {
    interactionState.lastPointerUp = null;
    interactionState.isDraggingScrollBar = false;
    app.cursor.applyForTool();
    app.setState({ cursorButton: "up" });
    app.savePointer(event.clientX, event.clientY, "up");
    app.ownerWindow.removeEventListener(EVENT.POINTER_MOVE, onPointerMove);
    app.ownerWindow.removeEventListener(EVENT.POINTER_UP, onPointerUp);
    onPointerMove.flush();
  });

  interactionState.lastPointerUp = onPointerUp;
  app.ownerWindow.addEventListener(EVENT.POINTER_MOVE, onPointerMove);
  app.ownerWindow.addEventListener(EVENT.POINTER_UP, onPointerUp);
  return true;
};

export const cleanupAfterMissingPointerUp = (
  app: {
    pan: { end: () => void };
    interactionState: InteractionState;
    missingPointerEventCleanupEmitter: {
      trigger: (event: PointerEvent | null) => { clear: () => void };
    };
  },
  event: PointerEvent | null,
) => {
  app.pan.end();
  app.interactionState.lastPointerUp?.();
  app.missingPointerEventCleanupEmitter.trigger(event).clear();
};

export const resetContextMenuTimer = (app: {
  interactionState: InteractionState;
  ownerWindow: Window & typeof globalThis;
}) => {
  if (app.interactionState.touchTimeout) {
    app.ownerWindow.clearTimeout(app.interactionState.touchTimeout);
  }
  app.interactionState.touchTimeout = 0;
  app.interactionState.invalidateContextMenu = false;
};

/** Installs the window-level listeners for one pointer-down session and keeps
 * their callbacks on that session's state for deterministic teardown. */
export const attachPointerSessionListeners = (
  app: any,
  event: React.PointerEvent<HTMLElement>,
  pointerDownState: PointerDownState,
) => {
  const onPointerMove =
    app.onPointerMoveFromPointerDownHandler(pointerDownState);
  const onPointerUp = app.onPointerUpFromPointerDownHandler(pointerDownState);
  const onKeyDown = app.onKeyDownFromPointerDownHandler(pointerDownState);
  const onKeyUp = app.onKeyUpFromPointerDownHandler(pointerDownState);

  app.missingPointerEventCleanupEmitter.once(
    (cleanupEvent: PointerEvent | null) =>
      onPointerUp(cleanupEvent || event.nativeEvent),
  );

  if (!app.state.viewModeEnabled || app.isActiveToolPointerCapturing()) {
    app.ownerWindow.addEventListener(EVENT.POINTER_MOVE, onPointerMove);
    app.ownerWindow.addEventListener(EVENT.POINTER_UP, onPointerUp);
    app.ownerWindow.addEventListener(EVENT.KEYDOWN, onKeyDown);
    app.ownerWindow.addEventListener(EVENT.KEYUP, onKeyUp);
    pointerDownState.eventListeners.onMove = onPointerMove;
    pointerDownState.eventListeners.onUp = onPointerUp;
    pointerDownState.eventListeners.onKeyUp = onKeyUp;
    pointerDownState.eventListeners.onKeyDown = onKeyDown;
  }
};

export type PointerSessionApp = {
  state: AppState;
};
