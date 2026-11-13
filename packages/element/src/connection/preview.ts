import type { GlobalPoint } from "@excalidraw/math";
import type { AppClassProperties } from "@excalidraw/excalidraw/types";

import type { ConnectionHit } from "./types";

import type { ExcalidrawBindableElement, NonDeleted } from "../types";

type PointerFrame = NonNullable<
  ReturnType<AppClassProperties["pointer"]["getFrame"]>
>;

/**
 * Writes the connection landing preview onto the pointer frame (gesture
 * owner = selection), so the interactive renderer can draw the highlight
 * straight from `app.pointer.getFrame()` + scene.
 */
export const setConnectionPreviewFrame = (
  app: AppClassProperties,
  element: NonDeleted<ExcalidrawBindableElement>,
  hit: ConnectionHit,
  point: GlobalPoint,
): void => {
  const previous = app.pointer.getFrame();
  const next: PointerFrame = {
    phase: "gesture",
    owner: "selection",
    pointerType: previous?.pointerType ?? "mouse",
    ...(previous?.origin ? { origin: previous.origin } : {}),
    target: { kind: "connection", elementId: element.id, hit },
    point,
  };
  app.pointer.setFrame(next);
};

/**
 * Drops a connection preview while keeping the gesture frame's phase/owner
 * semantics (the pointer may still own the gesture, just not a landing).
 * Returns whether a connection target was actually cleared.
 */
export const clearConnectionPreviewFrame = (
  app: AppClassProperties,
): boolean => {
  const frame = app.pointer.getFrame();
  if (frame?.target.kind !== "connection") {
    return false;
  }
  app.pointer.setFrame(
    { ...frame, target: { kind: "canvas" } },
    { repaint: false },
  );
  return true;
};
