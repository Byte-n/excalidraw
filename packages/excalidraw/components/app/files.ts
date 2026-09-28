/* eslint-disable dot-notation -- File helpers remain private on App. */
import {
  isInitializedImageElement,
  ShapeCache,
  normalizeSVG,
  newElementWith,
  updateImageCache as _updateImageCache,
  CaptureUpdateAction,
  getInitializedImageElements,
  positionElementsOnGrid,
  makeNextSelectedElementIds,
  duplicateElements,
  embeddableURLValidator,
  getEmbedLink,
  syncInvalidIndices,
} from "@excalidraw/element";

import {
  MIME_TYPES,
  viewportCoordsToSceneCoords,
  IMAGE_MIME_TYPES,
  updateActiveTool,
  arrayToMap,
  normalizeLink,
} from "@excalidraw/common";

import { KEYS, getGridPoint } from "@excalidraw/common";

import { newImageElement } from "@excalidraw/element";

import type {
  ExcalidrawImageElement,
  FileId,
  NonDeleted,
  InitializedExcalidrawImageElement,
} from "@excalidraw/element/types";

import {
  getDataURL_sync,
  dataURLToString,
  isSupportedImageFile,
  SVGStringToFile,
  generateIdFromFile,
  resizeImageFile,
  getDataURL,
  normalizeFile,
  parseLibraryJSON,
  loadSceneOrLibraryFromBlob,
} from "../../data/blob";

import { withBatchedUpdates } from "../../reactUtils";

import { t } from "../../i18n";
import { fileOpen } from "../../data/filesystem";
import { actionFinalize } from "../../actions";

import { parseDataTransferEvent } from "../../clipboard";
import { loadFromBlob } from "../../data";

import { distributeLibraryItemsOnSquareGrid } from "../../data/library";

import { ImageSceneDataError } from "../../errors";

import type { ExcalidrawLibraryIds } from "../../data/types";
import type React from "react";

import type {
  BinaryFiles,
  BinaryFileData,
  LibraryItems,
  ExcalidrawImperativeAPI,
} from "../../types";
import type App from "../App";

export function clearImageShapeCache(app: App, filesMap?: BinaryFiles) {
  const files = filesMap ?? app.files;
  app.scene.getNonDeletedElements().forEach((element) => {
    if (isInitializedImageElement(element) && files[element.fileId]) {
      app.imageCache.delete(element.fileId);
      ShapeCache.delete(element);
    }
  });
}

export const addFiles = (
  app: App,
  files: Parameters<ExcalidrawImperativeAPI["addFiles"]>[0],
) =>
  withBatchedUpdates(() => {
    const { addedFiles } = app["addMissingFiles"](files);

    app["clearImageShapeCache"](addedFiles);
    app.scene.triggerUpdate();

    app["addNewImagesToImageCache"]();
  })();

export const addMissingFiles = (
  app: App,
  files: BinaryFiles | BinaryFileData[],
  replace = false,
) => {
  const nextFiles = replace ? {} : { ...app.files };
  const addedFiles: BinaryFiles = {};

  const _files = Array.isArray(files) ? files : Object.values(files);

  for (const fileData of _files) {
    if (nextFiles[fileData.id]) {
      continue;
    }

    addedFiles[fileData.id] = fileData;
    nextFiles[fileData.id] = fileData;

    if (fileData.mimeType === MIME_TYPES.svg) {
      try {
        const restoredDataURL = getDataURL_sync(
          normalizeSVG(dataURLToString(fileData.dataURL)),
          MIME_TYPES.svg,
        );
        if (fileData.dataURL !== restoredDataURL) {
          // bump version so persistence layer can update the store
          fileData.version = (fileData.version ?? 1) + 1;
          fileData.dataURL = restoredDataURL;
        }
      } catch (error) {
        console.error(error);
      }
    }
  }

  app.files = nextFiles;

  return { addedFiles };
};

export const initializeImage = async (
  app: App,
  placeholderImageElement: ExcalidrawImageElement,
  imageFile: File,
) => {
  // at this point this should be guaranteed image file, but we do this check
  // to satisfy TS down the line
  if (!isSupportedImageFile(imageFile)) {
    throw new Error(t("errors.unsupportedFileType"));
  }
  const mimeType = imageFile.type;

  app.cursor.set("wait");

  if (mimeType === MIME_TYPES.svg) {
    try {
      imageFile = SVGStringToFile(
        normalizeSVG(await imageFile.text()),
        imageFile.name,
      );
    } catch (error: any) {
      console.warn(error);
      throw new Error(t("errors.svgImageInsertError"));
    }
  }

  // generate image id (by default the file digest) before any
  // resizing/compression takes place to keep it more portable
  const fileId = await ((app.props.generateIdForFile?.(
    imageFile,
  ) as Promise<FileId>) || generateIdFromFile(imageFile));

  if (!fileId) {
    console.warn(
      "Couldn't generate file id or the supplied `generateIdForFile` didn't resolve to one.",
    );
    throw new Error(t("errors.imageInsertError"));
  }

  const existingFileData = app.files[fileId];
  if (!existingFileData?.dataURL) {
    const { maxWidthOrHeight, maxFileSizeBytes } = app.props.imageOptions;

    try {
      imageFile = await resizeImageFile(imageFile, {
        maxWidthOrHeight,
      });
    } catch (error: any) {
      console.error("Error trying to resizing image file on insertion", error);
    }

    if (imageFile.size > maxFileSizeBytes) {
      throw new Error(
        t("errors.fileTooBig", {
          maxSize: `${Math.trunc(maxFileSizeBytes / 1024 / 1024)}MB`,
        }),
      );
    }
  }

  const dataURL = app.files[fileId]?.dataURL || (await getDataURL(imageFile));

  return new Promise<NonDeleted<InitializedExcalidrawImageElement>>(
    async (resolve, reject) => {
      try {
        let initializedImageElement = app["getLatestInitializedImageElement"](
          placeholderImageElement,
          fileId,
        );

        app["addMissingFiles"]([
          {
            mimeType,
            id: fileId,
            dataURL,
            created: Date.now(),
            lastRetrieved: Date.now(),
          },
        ]);

        if (!app.imageCache.get(fileId)) {
          app["addNewImagesToImageCache"]();

          const { erroredFiles } = await app["updateImageCache"]([
            initializedImageElement,
          ]);

          if (erroredFiles.size) {
            throw new Error("Image cache update resulted with an error.");
          }
        }

        const imageHTML = await app.imageCache.get(fileId)?.image;

        if (
          imageHTML &&
          app.state.newElement?.id !== initializedImageElement.id
        ) {
          initializedImageElement = app["getLatestInitializedImageElement"](
            placeholderImageElement,
            fileId,
          );

          const naturalDimensions = app["getImageNaturalDimensions"](
            initializedImageElement,
            imageHTML,
          );

          // no need to create a new instance anymore, just assign the natural dimensions
          Object.assign(initializedImageElement, naturalDimensions);
        }

        resolve(initializedImageElement);
      } catch (error: any) {
        console.error(error);
        reject(new Error(t("errors.imageInsertError")));
      }
    },
  );
};

export const getLatestInitializedImageElement = (
  app: App,
  imagePlaceholder: ExcalidrawImageElement,
  fileId: FileId,
) => {
  const latestImageElement =
    app.scene.getElement(imagePlaceholder.id) ?? imagePlaceholder;

  return newElementWith(
    latestImageElement as NonDeleted<InitializedExcalidrawImageElement>,
    {
      fileId,
    },
  );
};

export const onImageToolbarButtonClick = async (app: App) => {
  try {
    const clientX = app.state.width / 2 + app.state.offsetLeft;
    const clientY = app.state.height / 2 + app.state.offsetTop;

    const { x, y } = viewportCoordsToSceneCoords(
      { clientX, clientY },
      app.state,
    );

    const imageFiles = await fileOpen({
      description: "Image",
      extensions: Object.keys(
        IMAGE_MIME_TYPES,
      ) as (keyof typeof IMAGE_MIME_TYPES)[],
      multiple: true,
    });

    app["insertImages"](imageFiles, x, y);
  } catch (error: any) {
    if (error.name !== "AbortError") {
      console.error(error);
    } else {
      console.warn(error);
    }
    app.setState(
      {
        newElement: null,
        activeTool: updateActiveTool(app.state, {
          type: app.state.preferredSelectionTool.type,
        }),
      },
      () => {
        app.actionManager.executeAction(actionFinalize);
      },
    );
  }
};

export const getImageNaturalDimensions = (
  app: App,
  imageElement: ExcalidrawImageElement,
  imageHTML: HTMLImageElement,
) => {
  const minHeight = Math.max(app.state.height - 120, 160);
  // max 65% of canvas height, clamped to <300px, vh - 120px>
  const maxHeight = Math.min(
    minHeight,
    Math.floor(app.state.height * 0.5) / app.state.zoom.value,
  );

  const height = Math.min(imageHTML.naturalHeight, maxHeight);
  const width = height * (imageHTML.naturalWidth / imageHTML.naturalHeight);

  // add current imageElement width/height to account for previous centering
  // of the placeholder image
  const x = imageElement.x + imageElement.width / 2 - width / 2;
  const y = imageElement.y + imageElement.height / 2 - height / 2;

  return {
    x,
    y,
    width,
    height,
    crop: null,
  };
};

export const updateImageCache = async (
  app: App,
  elements: readonly InitializedExcalidrawImageElement[],
  files = app.files,
) => {
  const { updatedFiles, erroredFiles } = await _updateImageCache({
    imageCache: app.imageCache,
    fileIds: elements.map((element) => element.fileId),
    files,
  });

  if (erroredFiles.size) {
    app.store.scheduleAction(CaptureUpdateAction.NEVER);
    app.scene.replaceAllElements(
      app.scene.getElementsIncludingDeleted().map((element) => {
        if (
          isInitializedImageElement(element) &&
          erroredFiles.has(element.fileId)
        ) {
          return newElementWith(element, {
            status: "error",
          });
        }
        return element;
      }),
    );
  }

  return { updatedFiles, erroredFiles };
};

export const addNewImagesToImageCache = async (
  app: App,
  imageElements: InitializedExcalidrawImageElement[] = getInitializedImageElements(
    app.scene.getNonDeletedElements(),
  ),
  files: BinaryFiles = app.files,
) => {
  const uncachedImageElements = imageElements.filter(
    (element) => !element.isDeleted && !app.imageCache.has(element.fileId),
  );

  if (uncachedImageElements.length) {
    const { updatedFiles } = await app["updateImageCache"](
      uncachedImageElements,
      files,
    );

    if (updatedFiles.size) {
      for (const element of uncachedImageElements) {
        if (updatedFiles.has(element.fileId)) {
          ShapeCache.delete(element);
        }
      }
    }

    if (updatedFiles.size) {
      app.scene.triggerUpdate();
    }
  }
};

export const insertImages = async (
  app: App,
  imageFiles: File[],
  sceneX: number,
  sceneY: number,
) => {
  const gridPadding = 50 / app.state.zoom.value;
  // Create, position, and insert placeholders
  const placeholders = positionElementsOnGrid(
    imageFiles.map(() => app["newImagePlaceholder"]({ sceneX, sceneY })),
    sceneX,
    sceneY,
    gridPadding,
  );
  app.insertNewElements(placeholders);

  // Create, position, insert and select initialized (replacing placeholders)
  const initialized = await Promise.all(
    placeholders.map(async (placeholder, i) => {
      try {
        return await app["initializeImage"](
          placeholder,
          await normalizeFile(imageFiles[i]),
        );
      } catch (error: any) {
        app.setState({
          errorMessage: error.message || t("errors.imageInsertError"),
        });
        return newElementWith(placeholder as ExcalidrawImageElement, {
          isDeleted: true,
        });
      }
    }),
  );
  const initializedMap = arrayToMap(initialized);

  const positioned = positionElementsOnGrid(
    initialized.filter((el) => !el.isDeleted),
    sceneX,
    sceneY,
    gridPadding,
  );
  const positionedMap = arrayToMap(positioned);

  const nextElements = app.scene
    .getElementsIncludingDeleted()
    .map((el) => positionedMap.get(el.id) ?? initializedMap.get(el.id) ?? el);

  app.updateScene({
    appState: {
      selectedElementIds: makeNextSelectedElementIds(
        Object.fromEntries(positioned.map((el) => [el.id, true])),
        app.state,
      ),
    },
    elements: nextElements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  app.setState({}, () => {
    // actionFinalize after all state values have been updated
    app.actionManager.executeAction(actionFinalize);
  });
};

export const handleAppOnDrop = async (
  app: App,
  event: React.DragEvent<HTMLDivElement>,
) => {
  // NOTE no preventDefault so the host page can handle the drop itself
  if (!app.isInteractionEnabled()) {
    return;
  }
  const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
    event,
    app.state,
  );
  const dataTransferList = await parseDataTransferEvent(event);

  // must be retrieved first, in the same frame
  const fileItems = dataTransferList.getFiles();

  if (fileItems.length === 1) {
    const { file, fileHandle } = fileItems[0];

    if (
      file &&
      (file.type === MIME_TYPES.png || file.type === MIME_TYPES.svg)
    ) {
      try {
        const scene = await loadFromBlob(
          file,
          app.state,
          app.scene.getElementsIncludingDeleted(),
          fileHandle,
        );
        app.syncActionResult({
          ...scene,
          appState: {
            ...(scene.appState || app.state),
            isLoading: false,
          },
          replaceFiles: true,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return;
      } catch (error: any) {
        if (error.name !== "EncodingError") {
          throw new Error(t("alerts.couldNotLoadInvalidFile"));
        }
        // if EncodingError, fall through to insert as regular image
      }
    }
  }

  const imageFiles = fileItems
    .map((data) => data.file)
    .filter((file) => isSupportedImageFile(file));

  if (imageFiles.length > 0 && app.isToolSupported("image")) {
    return app["insertImages"](imageFiles, sceneX, sceneY);
  }
  const excalidrawLibrary_ids = dataTransferList.getData(
    MIME_TYPES.excalidrawlibIds,
  );
  const excalidrawLibrary_data = dataTransferList.getData(
    MIME_TYPES.excalidrawlib,
  );
  if (excalidrawLibrary_ids || excalidrawLibrary_data) {
    try {
      let libraryItems: LibraryItems | null = null;
      if (excalidrawLibrary_ids) {
        const { itemIds } = JSON.parse(
          excalidrawLibrary_ids,
        ) as ExcalidrawLibraryIds;
        const allLibraryItems = await app.library.getLatestLibrary();
        libraryItems = allLibraryItems.filter((item) =>
          itemIds.includes(item.id),
        );
        // legacy library dataTransfer format
      } else if (excalidrawLibrary_data) {
        libraryItems = parseLibraryJSON(excalidrawLibrary_data);
      }
      if (libraryItems?.length) {
        libraryItems = libraryItems.map((item) => ({
          ...item,
          // #6465
          elements: duplicateElements({
            type: "everything",
            elements: item.elements,
            randomizeSeed: true,
            preserveFrameChildrenOrder: true,
          }).duplicatedElements,
        }));

        app.addElementsFromPasteOrLibrary({
          elements: distributeLibraryItemsOnSquareGrid(libraryItems),
          position: event,
          files: null,
        });
      }
    } catch (error: any) {
      app.setState({ errorMessage: error.message });
    }
    return;
  }

  if (fileItems.length > 0) {
    const { file, fileHandle } = fileItems[0];
    if (file) {
      // Attempt to parse an excalidraw/excalidrawlib file
      await app.loadFileToCanvas(file, fileHandle);
    }
  }

  const textItem = dataTransferList.findByType(MIME_TYPES.text);

  if (textItem) {
    const text = textItem.value;
    if (
      text &&
      embeddableURLValidator(text, app.props.validateEmbeddable) &&
      (/^(http|https):\/\/[^\s/$.?#].[^\s]*$/.test(text) ||
        getEmbedLink(text)?.type === "video")
    ) {
      const embeddable = app.insertEmbeddableElement({
        sceneX,
        sceneY,
        link: normalizeLink(text),
      });
      if (embeddable) {
        app.store.scheduleCapture();
        app.setState({ selectedElementIds: { [embeddable.id]: true } });
      }
    }
  }
};

export const loadFileToCanvas = async (
  app: App,
  file: File,
  fileHandle: FileSystemFileHandle | null,
) => {
  file = await normalizeFile(file);
  try {
    const elements = app.scene.getElementsIncludingDeleted();
    let ret;
    try {
      ret = await loadSceneOrLibraryFromBlob(
        file,
        app.state,
        elements,
        fileHandle,
      );
    } catch (error: any) {
      console.error("load file to canvas", error);
      const imageSceneDataError = error instanceof ImageSceneDataError;
      if (
        imageSceneDataError &&
        error.code === "IMAGE_NOT_CONTAINS_SCENE_DATA" &&
        !app.isToolSupported("image")
      ) {
        app.setState({
          isLoading: false,
          errorMessage: t("errors.imageToolNotSupported"),
        });
        return;
      }
      const errorMessage = imageSceneDataError
        ? t("alerts.cannotRestoreFromImage")
        : t("alerts.couldNotLoadInvalidFile");
      app.setState({
        isLoading: false,
        errorMessage,
      });
    }
    if (!ret) {
      return;
    }

    if (ret.type === MIME_TYPES.excalidraw) {
      // restore the fractional indices by mutating elements
      syncInvalidIndices(elements.concat(ret.data.elements));

      // don't capture and only update the store snapshot for old elements,
      // otherwise we would end up with duplicated fractional indices on undo
      app.store.scheduleMicroAction({
        action: CaptureUpdateAction.NEVER,
        elements,
        appState: undefined,
      });

      app.setState({ isLoading: true });
      app.syncActionResult({
        ...ret.data,
        appState: {
          ...(ret.data.appState || app.state),
          isLoading: false,
        },
        replaceFiles: true,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    } else if (ret.type === MIME_TYPES.excalidrawlib) {
      await app.library
        .updateLibrary({
          libraryItems: file,
          merge: true,
          openLibraryMenu: true,
        })
        .catch((error) => {
          console.error(error);
          app.setState({ errorMessage: t("errors.importLibraryError") });
        });
    }
  } catch (error: any) {
    app.setState({ isLoading: false, errorMessage: error.message });
  }
};

export const newImagePlaceholder = (
  app: App,
  {
    sceneX,
    sceneY,
    addToFrameUnderCursor = true,
  }: {
    sceneX: number;
    sceneY: number;
    addToFrameUnderCursor?: boolean;
  },
) => {
  const [gridX, gridY] = getGridPoint(
    sceneX,
    sceneY,
    app.lastPointerDownEvent?.[KEYS.CTRL_OR_CMD]
      ? null
      : app.getEffectiveGridSize(),
  );

  const topLayerFrame = addToFrameUnderCursor
    ? app.getTopLayerFrameAtSceneCoords({
        x: gridX,
        y: gridY,
      })
    : null;

  const placeholderSize = 100 / app.state.zoom.value;

  return newImageElement({
    type: "image",
    strokeColor: app.state.currentItemStrokeColor,
    backgroundColor: app.state.currentItemBackgroundColor,
    fillStyle: app.state.currentItemFillStyle,
    strokeWidth: app.getCurrentItemStrokeWidth("image"),
    strokeStyle: app.state.currentItemStrokeStyle,
    roughness: app.state.currentItemRoughness,
    roundness: null,
    opacity: app.state.currentItemOpacity,
    locked: false,
    containerRef: topLayerFrame
      ? { kind: "frameLike", elementId: topLayerFrame.id }
      : undefined,
    x: gridX - placeholderSize / 2,
    y: gridY - placeholderSize / 2,
    width: placeholderSize,
    height: placeholderSize,
  });
};
