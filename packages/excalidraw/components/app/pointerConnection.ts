/**
 * `connection` pointer target provider (03-connection-integration.md §4.2).
 *
 * Applicability is intentionally narrow: only the arrow / line tools, only while
 * binding is enabled, and never for elbow arrows (3b). Hovering a new arrow has
 * no arrow element yet, so the ray tier is unavailable and only tiers ① / ②
 * produce a preview.
 */
import {
  isBindingEnabled,
  pickConnectionTargetForPoint,
} from "@excalidraw/element";

import { registerPointerTargetProvider } from "./pointerFrame";

import type { PointerFrameInput, ProviderFor } from "./pointerFrame";
import type { NullableGridSize } from "../../types";
import type App from "../App";

type PointerApp = Pick<App, keyof App> & Record<string, any>;

const isConnectionHoverApplicable = (
  app: PointerApp,
  input: PointerFrameInput,
): boolean =>
  input.mode === "arrow" &&
  isBindingEnabled(app.state) &&
  !app.state.newElement &&
  !app.state.editingTextElement &&
  !app.state.viewModeEnabled &&
  app.state.currentItemArrowType !== "elbow";

export const connectionProvider: ProviderFor<"connection"> = {
  kind: "connection",
  resolve: (app, input) => {
    if (!isConnectionHoverApplicable(app, input)) {
      return null;
    }
    const picked = pickConnectionTargetForPoint(
      input.point,
      app.scene.getNonDeletedElements(),
      {
        // Hovering a new arrow: no other end, and the arrow does not exist yet.
        arrow: { elbowed: false },
        zoom: app.state.zoom.value,
        isMidpointSnappingEnabled: app.state.isMidpointSnappingEnabled,
        gridSize: app.state.gridModeEnabled
          ? (app.state.gridSize as NullableGridSize)
          : undefined,
        angleLocked: Boolean(input.shiftKey),
        elementsMap: app.scene.getNonDeletedElementsMap(),
        startOrEnd: "start",
      },
      // No real arrow yet -> tiers ③ (ray) are unavailable while hovering.
      () => null,
    );
    return picked
      ? {
          kind: "connection",
          elementId: picked.element.id,
          hit: picked.hit,
        }
      : null;
  },
};

registerPointerTargetProvider(connectionProvider);
