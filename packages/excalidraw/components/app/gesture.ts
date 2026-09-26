import { makeNextSelectedElementIds } from "@excalidraw/element";

import { pointDistance, pointFrom } from "@excalidraw/math";

import {
  DOUBLE_TAP_POSITION_THRESHOLD,
  isIOS,
  TAP_TWICE_TIMEOUT,
} from "@excalidraw/common";

import { getCenter, getDistance } from "../../gesture";
import { getNormalizedZoom } from "../../scene";

import { getViewportForZoomWithScrollConstraints } from "../../viewport";

import type { InteractionState } from "./pointerSession";

import type { AppState, GestureEvent } from "../../types";
import type App from "../App";

/* eslint-disable dot-notation -- App delegates remain private. */

/** The small part of App used by touch and Safari gesture handling. */
export type GestureApp = Pick<
  App,
  | "gesture"
  | "state"
  | "viewport"
  | "isNavigationEnabled"
  | "setState"
  | "resetShouldCacheIgnoreZoomDebounced"
>;

export const resetTapTwice = (interactionState: InteractionState) => {
  interactionState.didTapTwice = false;
  interactionState.firstTapPosition = null;
};

export const updateGestureOnPointerDown = (
  app: Pick<GestureApp, "gesture" | "state">,
  event: { pointerId: number; clientX: number; clientY: number },
) => {
  app.gesture.pointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
  });

  if (app.gesture.pointers.size === 2) {
    app.gesture.lastCenter = getCenter(app.gesture.pointers);
    app.gesture.initialScale = app.state.zoom.value;
    app.gesture.initialDistance = getDistance(
      Array.from(app.gesture.pointers.values()),
    );
  }
};

export const removeGesturePointer = (
  app: Pick<GestureApp, "gesture" | "state" | "viewport">,
  pointerId: number,
) => {
  const wasMultiTouchGesture = app.gesture.pointers.size >= 2;
  app.gesture.pointers.delete(pointerId);

  if (
    wasMultiTouchGesture &&
    app.gesture.pointers.size < 2 &&
    app.state.scrollConstraints
  ) {
    app.viewport.releaseOverscroll();
  }
};

/** Applies one frame of two-finger pan and pinch zoom. */
export const updateMultiTouchGesture = (
  app: GestureApp,
  event: { pointerId: number; clientX: number; clientY: number },
) => {
  if (app.gesture.pointers.has(event.pointerId)) {
    app.gesture.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
  }

  const initialScale = app.gesture.initialScale;
  if (
    app.gesture.pointers.size === 2 &&
    app.gesture.lastCenter &&
    initialScale &&
    app.gesture.initialDistance
  ) {
    const center = getCenter(app.gesture.pointers);
    const deltaX = center.x - app.gesture.lastCenter.x;
    const deltaY = center.y - app.gesture.lastCenter.y;
    app.gesture.lastCenter = center;

    const distance = getDistance(Array.from(app.gesture.pointers.values()));
    const scaleFactor =
      app.state.activeTool.type === "freedraw" && app.state.penMode
        ? 1
        : distance / app.gesture.initialDistance;

    const nextZoom = scaleFactor
      ? getNormalizedZoom(initialScale * scaleFactor)
      : app.state.zoom.value;

    app.setState((state: AppState) => {
      const zoomedViewport = getViewportForZoomWithScrollConstraints(
        {
          viewportX: center.x,
          viewportY: center.y,
          nextZoom,
        },
        state,
      );
      const zoomValue = zoomedViewport.zoom.value;

      app.viewport.translate(
        {
          zoom: zoomedViewport.zoom,
          scrollX: zoomedViewport.scrollX + (2 * deltaX) / zoomValue,
          scrollY: zoomedViewport.scrollY + (2 * deltaY) / zoomValue,
          shouldCacheIgnoreZoom: true,
        },
        { zoomPreConstrained: true },
      );

      return null;
    });
    if (!app.viewport.isLockedTransitionPending) {
      app.resetShouldCacheIgnoreZoomDebounced();
    }
  } else {
    app.gesture.lastCenter =
      app.gesture.initialDistance =
      app.gesture.initialScale =
        null;
  }
};

export const isTouchScreenMultiTouchGesture = (app: GestureApp) =>
  app.gesture.pointers.size >= 2;

export const onGestureStart = (app: GestureApp, event: GestureEvent) => {
  if (!app.isNavigationEnabled()) {
    return;
  }
  event.preventDefault();

  if (isTouchScreenMultiTouchGesture(app)) {
    app.setState({
      selectedElementIds: makeNextSelectedElementIds({}, app.state),
      activeEmbeddable: null,
    });
  }
  app.gesture.initialScale = app.state.zoom.value;
};

export const onGestureChange = (app: GestureApp, event: GestureEvent) => {
  if (!app.isNavigationEnabled()) {
    return;
  }
  event.preventDefault();

  if (isTouchScreenMultiTouchGesture(app)) {
    return;
  }

  const initialScale = app.gesture.initialScale;
  if (initialScale) {
    app.viewport.translate(
      (state: AppState) => ({
        ...getViewportForZoomWithScrollConstraints(
          {
            viewportX: app.viewport.lastPosition.x,
            viewportY: app.viewport.lastPosition.y,
            nextZoom: getNormalizedZoom(initialScale * event.scale),
          },
          state,
        ),
      }),
      {
        zoomPreConstrained: true,
        preserveScrollConstraintsSnapBack: true,
      },
    );
  }
};

export const onGestureEnd = (app: GestureApp, event: GestureEvent) => {
  if (!app.isNavigationEnabled()) {
    return;
  }
  event.preventDefault();
  if (isTouchScreenMultiTouchGesture(app)) {
    app.setState({
      previousSelectedElementIds: {},
      selectedElementIds: makeNextSelectedElementIds(
        app.state.previousSelectedElementIds,
        app.state,
      ),
    });
  }
  app.gesture.initialScale = null;
};

export const onTouchStart = (app: App, event: TouchEvent) => {
  if (!app.isInteractionEnabled()) {
    return;
  }
  if (event.touches.length > 1) {
    app.mindmap.cancelTouchDrag();
  }

  // fix for Apple Pencil Scribble (do not prevent for other devices)
  if (isIOS) {
    event.preventDefault();
  }

  if (!app.interactionState.didTapTwice) {
    app.interactionState.didTapTwice = true;

    if (event.touches.length === 1) {
      app.interactionState.firstTapPosition = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      };
    }
    app.ownerWindow.clearTimeout(app.interactionState.tappedTwiceTimer);
    app.interactionState.tappedTwiceTimer = app.ownerWindow.setTimeout(
      () => resetTapTwice(app.interactionState),
      TAP_TWICE_TIMEOUT,
    );
    return;
  }

  // insert text only if we tapped twice with a single finger at approximately the same position
  // event.touches.length === 1 will also prevent inserting text when user's zooming
  if (
    app.interactionState.didTapTwice &&
    event.touches.length === 1 &&
    app.interactionState.firstTapPosition
  ) {
    const touch = event.touches[0];
    const distance = pointDistance(
      pointFrom(touch.clientX, touch.clientY),
      pointFrom(
        app.interactionState.firstTapPosition.x,
        app.interactionState.firstTapPosition.y,
      ),
    );

    // only create text if the second tap is within the threshold of the first tap
    // this prevents accidental text creation during dragging/selection
    if (distance <= DOUBLE_TAP_POSITION_THRESHOLD) {
      // end lasso trail and deselect elements just in case
      app.lassoTrail.endPath();
      app.deselectElements();

      app.handleCanvasDoubleClick({
        clientX: touch.clientX,
        clientY: touch.clientY,
        type: "touch",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      });
    }
    resetTapTwice(app.interactionState);
    app.ownerWindow.clearTimeout(app.interactionState.tappedTwiceTimer);
    app.interactionState.tappedTwiceTimer = 0;
  }

  if (event.touches.length === 2) {
    app.setState({
      selectedElementIds: makeNextSelectedElementIds({}, app.state),
      activeEmbeddable: null,
    });
  }
};

export const onTouchEnd = (app: App, event: TouchEvent) => {
  if (!app.isInteractionEnabled()) {
    return;
  }
  app["resetContextMenuTimer"]();
  if (event.touches.length > 0) {
    app.setState({
      previousSelectedElementIds: {},
      selectedElementIds: makeNextSelectedElementIds(
        app.state.previousSelectedElementIds,
        app.state,
      ),
    });
  } else {
    app.gesture.pointers.clear();
  }
};
