import {
  isBindableElement,
  isBindingElement,
  isBoundToContainer,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  mutateElement,
  newElementWith,
} from "@excalidraw/element";

/** Adds the current pointer location to the eraser trail and publishes the
 * pending ids for the renderer. */
export const handleEraser = (
  app: any,
  event: PointerEvent,
  scenePointer: { x: number; y: number },
) => {
  const elementsToErase = app.eraserTrail.addPointToPath(
    scenePointer.x,
    scenePointer.y,
    event.altKey,
  );
  app.elementsPendingErasure = new Set(elementsToErase);
  app.triggerRender();
};

export const restoreReadyToEraseElements = (app: any) => {
  app.elementsPendingErasure = new Set();
  app.triggerRender();
};

/** Deletes the trail's elements and repairs binding references in the same
 * transaction as the original pointer eraser implementation. */
export const eraseElements = (app: any) => {
  let didChange = false;
  const protectedIds = new Set<string>();
  for (const id of app.elementsPendingErasure) {
    const element = app.scene.getElement(id);
    const container =
      element?.type === "text" && element.containerId
        ? app.scene.getElement(element.containerId)
        : null;
    if (
      isMindmapNodeElement(element) ||
      isMindmapEdgeElement(element) ||
      isMindmapNodeElement(container)
    ) {
      protectedIds.add(id);
    }
  }
  if (protectedIds.size) {
    app.mindmap.notifyUnsupportedOperation();
    app.elementsPendingErasure = new Set(
      [...app.elementsPendingErasure].filter(
        (id: string) => !protectedIds.has(id),
      ),
    );
  }

  app.elementsPendingErasure.forEach((id: string) => {
    const element = app.scene.getElement(id);
    if (isBindingElement(element)) {
      if (element.startBinding) {
        const bindable = app.scene.getElement(element.startBinding.elementId)!;
        mutateElement(bindable, app.scene.getElementsMapIncludingDeleted(), {
          boundElements: bindable.boundElements!.filter(
            (boundElement: { id: string }) => boundElement.id !== element.id,
          ),
        });
      }
      if (element.endBinding) {
        const bindable = app.scene.getElement(element.endBinding.elementId)!;
        mutateElement(bindable, app.scene.getElementsMapIncludingDeleted(), {
          boundElements: bindable.boundElements!.filter(
            (boundElement: { id: string }) => boundElement.id !== element.id,
          ),
        });
      }
    } else if (isBindableElement(element as any)) {
      const bindableElement = element as any;
      bindableElement.boundElements?.forEach(
        (boundElement: { id: string; type: string }) => {
          if (boundElement.type !== "arrow") {
            return;
          }
          const arrow = app.scene.getElement(boundElement.id);
          if (!arrow) {
            return;
          }
          if (arrow.startBinding?.elementId === bindableElement.id) {
            mutateElement(arrow, app.scene.getElementsMapIncludingDeleted(), {
              startBinding: null,
            });
          }
          if (arrow.endBinding?.elementId === bindableElement.id) {
            mutateElement(arrow, app.scene.getElementsMapIncludingDeleted(), {
              endBinding: null,
            });
          }
        },
      );
    }
  });

  const elements = app.scene
    .getElementsIncludingDeleted()
    .map((element: any) => {
      if (
        app.elementsPendingErasure.has(element.id) ||
        (element.frameId && app.elementsPendingErasure.has(element.frameId)) ||
        (isBoundToContainer(element) &&
          app.elementsPendingErasure.has(element.containerId))
      ) {
        didChange = true;
        return newElementWith(element, { isDeleted: true });
      }
      return element;
    });

  app.elementsPendingErasure = new Set();
  if (didChange) {
    app.store.scheduleCapture();
    app.scene.replaceAllElements(elements);
  }
};
