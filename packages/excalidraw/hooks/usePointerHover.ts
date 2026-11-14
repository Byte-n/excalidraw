import { useRef, useSyncExternalStore } from "react";

import type { PointerHoverSnapshot } from "../components/app/pointerSnapshot";
import type App from "../components/App";

/**
 * React projection of the pointer hover snapshot. Only fields consumed by
 * React/DOM (static-canvas hover and embed hover) trigger a re-render; cell,
 * link, arrow-text and transform readouts stay canvas-only. The cached
 * snapshot keeps a stable identity while those fields are unchanged.
 */
export const usePointerHover = (app: App) => {
  const cache = useRef<PointerHoverSnapshot | null>(null);

  const getUiSnapshot = (): PointerHoverSnapshot => {
    const hover = app.pointer.getHoverSnapshot();
    const previous = cache.current;
    if (
      previous &&
      previous.elementId === hover.elementId &&
      previous.elementIds === hover.elementIds &&
      previous.frameToHighlight === hover.frameToHighlight &&
      previous.embedElementId === hover.embedElementId
    ) {
      return previous;
    }
    cache.current = hover;
    return hover;
  };

  return useSyncExternalStore(
    app.pointer.subscribe,
    getUiSnapshot,
    getUiSnapshot,
  );
};
