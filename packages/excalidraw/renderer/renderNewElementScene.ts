import { throttleRAF } from "@excalidraw/common";

import {
  getBoundTextElement,
  getTargetFrame,
  isInvisiblySmallElement,
  isTextElement,
  renderElement,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";

import { frameClip } from "./staticScene";

import type { RenderableElementsMap } from "../scene/types";
import type { NewElementSceneRenderConfig } from "../scene/types";

const _renderNewElementScene = ({
  canvas,
  rc,
  newElement,
  previewElements,
  elementsMap,
  allElementsMap,
  scale,
  appState: unsnappedAppState,
  renderConfig,
}: NewElementSceneRenderConfig) => {
  if (canvas) {
    // the same whole-device-pixel scroll the static scene draws at
    const appState = snapScrollToDevicePixels(unsnappedAppState, scale);
    const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
      canvas,
      scale,
    );

    const context = bootstrapCanvas({
      canvas,
      scale,
      normalizedWidth,
      normalizedHeight,
    });

    context.save();

    // Apply zoom
    context.scale(appState.zoom.value, appState.zoom.value);

    if (newElement && newElement.type !== "selection") {
      // e.g. when creating arrows and we're still below the arrow drag distance
      // threshold
      // (for now we skip render only with elements while we're creating to be
      // safe)
      if (isInvisiblySmallElement(newElement)) {
        return;
      }

      const frameId =
        newElement.containerRef?.elementId || appState.frameToHighlight?.id;

      if (
        frameId &&
        appState.frameRendering.enabled &&
        appState.frameRendering.clip
      ) {
        const frame = getTargetFrame(newElement, elementsMap, appState);

        if (
          frame &&
          shouldApplyFrameClip(newElement, frame, appState, elementsMap)
        ) {
          frameClip(frame, context, renderConfig, appState);
        }
      }

      const renderTargetElement = newElement;

      renderElement(
        renderTargetElement,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
      );
    } else if (!previewElements?.length) {
      context.clearRect(0, 0, normalizedWidth, normalizedHeight);
    }

    if (previewElements?.length) {
      renderPreviewElements(previewElements, {
        rc,
        context,
        elementsMap,
        allElementsMap,
        renderConfig,
        appState,
      });
    }

    context.restore();
  }
};

/**
 * Paints the off-scene creation previews. They are not in the scene, so they
 * are merged into local copies of the element maps `renderElement` reads —
 * that is also how a preview's bound text (a mindmap node's label) resolves
 * its container. Painted in the static scene's order: skip a text whose
 * container is present, then draw the container followed by its bound text.
 */
const renderPreviewElements = (
  elements: readonly NonDeletedExcalidrawElement[],
  {
    rc,
    context,
    elementsMap,
    allElementsMap,
    renderConfig,
    appState,
  }: {
    rc: NewElementSceneRenderConfig["rc"];
    context: CanvasRenderingContext2D;
    elementsMap: RenderableElementsMap;
    allElementsMap: NonDeletedSceneElementsMap;
    renderConfig: NewElementSceneRenderConfig["renderConfig"];
    appState: NewElementSceneRenderConfig["appState"];
  },
) => {
  const previewMap = new Map<string, NonDeletedExcalidrawElement>(
    elements.map((element) => [element.id, element]),
  );
  const mergedElementsMap = new Map([
    ...allElementsMap,
    ...previewMap,
  ]) as RenderableElementsMap;
  const mergedAllElementsMap = new Map([
    ...allElementsMap,
    ...previewMap,
  ]) as NonDeletedSceneElementsMap;
  // scene elements keep their own map entry (the preview copies win for the
  // ids they override, which are freshly generated and never collide)
  void elementsMap;

  for (const element of elements) {
    if (isPreviewBoundText(element, previewMap)) {
      // rendered with its container
      continue;
    }
    context.save();
    renderElement(
      element,
      mergedElementsMap,
      mergedAllElementsMap,
      rc,
      context,
      renderConfig,
      appState,
    );
    const boundText = getBoundTextElement(element, mergedElementsMap);
    if (boundText) {
      renderElement(
        boundText,
        mergedElementsMap,
        mergedAllElementsMap,
        rc,
        context,
        renderConfig,
        appState,
      );
    }
    context.restore();
  }
};

/** a preview text bound to a preview container — drawn with it, not on its own */
const isPreviewBoundText = (
  element: ExcalidrawElement,
  previewMap: ReadonlyMap<string, NonDeletedExcalidrawElement>,
) =>
  isTextElement(element) &&
  !!element.containerId &&
  previewMap.has(element.containerId);

export const renderNewElementSceneThrottled = throttleRAF(
  (config: NewElementSceneRenderConfig) => {
    _renderNewElementScene(config);
  },
);

export const renderNewElementScene = (
  renderConfig: NewElementSceneRenderConfig,
  throttle?: boolean,
) => {
  if (throttle) {
    renderNewElementSceneThrottled(renderConfig);
    return;
  }

  _renderNewElementScene(renderConfig);
};
