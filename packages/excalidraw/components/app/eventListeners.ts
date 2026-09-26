/* eslint-disable dot-notation -- Stable private App callbacks are registered and removed here. */
import {
  addEventListener,
  EVENT,
  getNearestScrollableContainer,
} from "@excalidraw/common";
import { ShapeCache } from "@excalidraw/element";

import type App from "../App";

export const onBlur = (app: App) => {
  app.pan.setSpaceHeld(false);
  app.setState({
    isBindingEnabled: app.state.bindingPreference === "enabled",
  });
};

export const onUnload = (app: App) => app["onBlur"]();

export const disableEvent: EventListener = (event) => event.preventDefault();

export const onResize = (app: App) => {
  app.scene
    .getElementsIncludingDeleted()
    .forEach((element) => ShapeCache.delete(element));
  app.refreshEditorInterface();
  app["updateDOMRect"]();
  app.setState({});
};

export const onFullscreenChange = (app: App) => {
  if (
    !app.ownerDocument.fullscreenElement &&
    app.state.activeEmbeddable?.state === "active"
  ) {
    app.setState({ activeEmbeddable: null });
  }
};

export const onScroll = (app: App) => {
  const { offsetTop, offsetLeft } = app["getCanvasOffsets"]();
  app.setState((state) => {
    if (state.offsetLeft === offsetLeft && state.offsetTop === offsetTop) {
      return null;
    }
    return { offsetTop, offsetLeft };
  });
};

export function addEventListeners(app: App) {
  // remove first as we can add event listeners multiple times
  app.removeEventListeners();

  // -------------------------------------------------------------------------
  //          listeners active even when the editor is non-interactive
  // -------------------------------------------------------------------------

  app.onRemoveEventListenersEmitter.once(
    addEventListener(
      app.ownerWindow,
      EVENT.MESSAGE,
      app["onWindowMessage"],
      false,
    ),
    addEventListener(app.ownerDocument, EVENT.POINTER_UP, app.removePointer, {
      passive: false,
    }), // #3553
    // rerender text elements on font load to fix #637 && #1553
    addEventListener(
      app.ownerDocument.fonts,
      "loadingdone",
      (event) => {
        const fontFaces = (event as FontFaceSetLoadEvent).fontfaces;
        app.fonts.onLoaded(fontFaces);
      },
      { passive: false },
    ),
    addEventListener(
      app.ownerWindow,
      EVENT.FOCUS,
      () => {
        app.maybeCleanupAfterMissingPointerUp(null);
        // browsers (chrome?) tend to free up memory a lot, which results
        // in canvas context being cleared. Thus re-render on focus.
        app.triggerRender(true);
      },
      { passive: false },
    ),
  );

  if (!app.isInteractionEnabled()) {
    // NOTE by not attaching the wheel/touch/gesture listeners below (which
    // preventDefault), the browser default behavior — such as scrolling the
    // page over the editor — is retained while non-interactive
    if (app.isNavigationEnabled()) {
      // wheel pan/zoom & pinch — the editor consumes these again, so the
      // page no longer scrolls over the editor
      app.onRemoveEventListenersEmitter.once(
        addEventListener(
          app.excalidrawContainerRef.current,
          EVENT.WHEEL,
          app.wheel.handle,
          { passive: false },
        ),
        // navigation action shortcuts (canvas zoom & zoom-to-fit)
        addEventListener(
          app.props.handleKeyboardGlobally
            ? app.ownerDocument
            : app.excalidrawContainerRef.current,
          EVENT.KEYDOWN,
          app["handleNavigationModeKeyDown"] as EventListener,
          false,
        ),
        // wheel zoom is anchored on `viewport.lastPosition`
        addEventListener(
          app.ownerDocument,
          EVENT.POINTER_MOVE,
          app["updateCurrentCursorPosition"],
          { passive: false },
        ),
        // Safari-only desktop pinch
        addEventListener(
          app.ownerDocument,
          EVENT.GESTURE_START,
          app["onGestureStart"] as any,
          false,
        ),
        addEventListener(
          app.ownerDocument,
          EVENT.GESTURE_CHANGE,
          app["onGestureChange"] as any,
          false,
        ),
        addEventListener(
          app.ownerDocument,
          EVENT.GESTURE_END,
          app["onGestureEnd"] as any,
          false,
        ),
      );
    }
    if (!app.isBrowserZoomEnabled()) {
      // the browser's own zoom is prevented over the editor by default,
      // mirroring the interactive editor (opt out via
      // `interaction: { enabled: { browserZoom: true } }`)
      if (!app.isNavigationEnabled()) {
        // with navigation enabled, wheel & pinch are consumed by the
        // editor's own handlers above instead
        app.onRemoveEventListenersEmitter.once(
          addEventListener(
            app.excalidrawContainerRef.current,
            EVENT.WHEEL,
            app.wheel.preventBrowserZoom,
            { passive: false },
          ),
          // Safari-only desktop pinch
          addEventListener(
            app.excalidrawContainerRef.current,
            EVENT.GESTURE_START as any,
            app["disableEvent"],
            false,
          ),
          addEventListener(
            app.excalidrawContainerRef.current,
            EVENT.GESTURE_CHANGE as any,
            app["disableEvent"],
            false,
          ),
          addEventListener(
            app.excalidrawContainerRef.current,
            EVENT.GESTURE_END as any,
            app["disableEvent"],
            false,
          ),
        );
      }
      app.onRemoveEventListenersEmitter.once(
        addEventListener(
          app.props.handleKeyboardGlobally
            ? app.ownerDocument
            : app.excalidrawContainerRef.current,
          EVENT.KEYDOWN,
          app["preventBrowserZoomKeyDown"] as EventListener,
          false,
        ),
      );
    }
    return;
  }

  // -------------------------------------------------------------------------
  //                        view+edit mode listeners
  // -------------------------------------------------------------------------

  if (app.props.handleKeyboardGlobally) {
    app.onRemoveEventListenersEmitter.once(
      addEventListener(app.ownerDocument, EVENT.KEYDOWN, app.onKeyDown, false),
    );
  }

  app.onRemoveEventListenersEmitter.once(
    addEventListener(
      app.excalidrawContainerRef.current,
      EVENT.WHEEL,
      app.wheel.handle,
      { passive: false },
    ),
    addEventListener(app.ownerDocument, EVENT.COPY, app["onCopy"], {
      passive: false,
    }),
    addEventListener(app.ownerDocument, EVENT.KEYUP, app["onKeyUp"], {
      passive: true,
    }),
    addEventListener(
      app.ownerDocument,
      EVENT.POINTER_MOVE,
      app["updateCurrentCursorPosition"],
      { passive: false },
    ),
    // Safari-only desktop pinch zoom
    addEventListener(
      app.ownerDocument,
      EVENT.GESTURE_START,
      app["onGestureStart"] as any,
      false,
    ),
    addEventListener(
      app.ownerDocument,
      EVENT.GESTURE_CHANGE,
      app["onGestureChange"] as any,
      false,
    ),
    addEventListener(
      app.ownerDocument,
      EVENT.GESTURE_END,
      app["onGestureEnd"] as any,
      false,
    ),
  );

  if (app.state.viewModeEnabled) {
    return;
  }

  // -------------------------------------------------------------------------
  //                        edit-mode listeners only
  // -------------------------------------------------------------------------

  app.onRemoveEventListenersEmitter.once(
    addEventListener(
      app.ownerDocument,
      EVENT.FULLSCREENCHANGE,
      app["onFullscreenChange"],
      { passive: false },
    ),
    addEventListener(app.ownerDocument, EVENT.PASTE, app.pasteFromClipboard, {
      passive: false,
    }),
    addEventListener(app.ownerDocument, EVENT.CUT, app["onCut"], {
      passive: false,
    }),
    addEventListener(app.ownerWindow, EVENT.RESIZE, app["onResize"], false),
    addEventListener(app.ownerWindow, EVENT.UNLOAD, app["onUnload"], false),
    addEventListener(app.ownerWindow, EVENT.BLUR, app["onBlur"], false),
    addEventListener(
      app.excalidrawContainerRef.current,
      EVENT.WHEEL,
      app.wheel.handle,
      { passive: false },
    ),
    addEventListener(
      app.excalidrawContainerRef.current,
      EVENT.DRAG_OVER,
      app["disableEvent"],
      false,
    ),
    addEventListener(
      app.excalidrawContainerRef.current,
      EVENT.DROP,
      app["disableEvent"],
      false,
    ),
  );

  if (app.props.detectScroll) {
    app.onRemoveEventListenersEmitter.once(
      addEventListener(
        getNearestScrollableContainer(app.excalidrawContainerRef.current!),
        EVENT.SCROLL,
        app["onScroll"],
        { passive: false },
      ),
    );
  }
}

export function removeEventListeners(app: App) {
  app.onRemoveEventListenersEmitter.trigger();
}
