import { makeNextSelectedElementIds } from "@excalidraw/element";

import { getCenter, getDistance } from "../../gesture";
import { getNormalizedZoom } from "../../scene";

import { getViewportForZoomWithScrollConstraints } from "../../viewport";

import type { AppState, GestureEvent } from "../../types";
import type App from "../App";

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
