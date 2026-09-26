import type App from "../App";
import type { ExcalidrawImperativeAPI } from "../../types";

/** File and image operations are routed through this controller. */
export const addFiles = (
  app: App,
  files: Parameters<ExcalidrawImperativeAPI["addFiles"]>[0],
) => app.addFilesImpl(files);

export const handleAppOnDrop = (
  app: App,
  event: React.DragEvent<HTMLDivElement>,
) => app.handleAppOnDropImpl(event);

export const loadFileToCanvas = (
  app: App,
  file: File,
  fileHandle: FileSystemFileHandle | null,
) => app.loadFileToCanvasImpl(file, fileHandle);

export const initializeImage = (
  app: App,
  ...args: Parameters<App["initializeImageImpl"]>
) => app.initializeImageImpl(...args);

export const updateImageCache = (
  app: App,
  ...args: Parameters<App["updateImageCacheImpl"]>
) => app.updateImageCacheImpl(...args);

export const addNewImagesToImageCache = (
  app: App,
  ...args: Parameters<App["addNewImagesToImageCacheImpl"]>
) => app.addNewImagesToImageCacheImpl(...args);
