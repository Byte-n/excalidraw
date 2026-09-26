/* eslint-disable dot-notation -- App compatibility delegates remain private. */
import { muteFSAbortError, type EXPORT_IMAGE_TYPES } from "@excalidraw/common";

import type {
  NonDeleted,
  ExcalidrawFrameLikeElement,
} from "@excalidraw/element/types";

import { trackEvent } from "../../analytics";
import { exportCanvas } from "../../data";
import { isImageFileHandle } from "../../data/blob";

import type App from "../App";
import type { ExportedElements } from "../../data";

export const onExportImage = async (
  app: App,
  type: keyof typeof EXPORT_IMAGE_TYPES,
  elements: ExportedElements,
  opts: { exportingFrame: NonDeleted<ExcalidrawFrameLikeElement> | null },
) => {
  trackEvent("export", type, "ui");
  const fileHandle = await exportCanvas(type, elements, app.state, app.files, {
    exportBackground: app.state.exportBackground,
    name: app.getName(),
    viewBackgroundColor: app.state.viewBackgroundColor,
    exportingFrame: opts.exportingFrame,
  })
    .catch(muteFSAbortError)
    .catch((error) => {
      console.error(error);
      app.setState({ errorMessage: error.message });
    });

  if (
    app.state.exportEmbedScene &&
    fileHandle &&
    isImageFileHandle(fileHandle)
  ) {
    app.setState({ fileHandle });
  }
};
