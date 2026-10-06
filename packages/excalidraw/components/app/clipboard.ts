/* eslint-disable dot-notation -- App compatibility delegates remain private. */
import {
  DEFAULT_VERTICAL_ALIGN,
  DEFAULT_TEXT_ALIGN,
  normalizeLink,
  getLineHeight,
  getFontString,
  isWritableElement,
  viewportCoordsToSceneCoords,
  normalizeEOL,
  isSafari,
} from "@excalidraw/common";
import {
  newTextElement,
  isBoundToContainer,
  isTextElement,
  embeddableURLValidator,
  maybeParseEmbedSrc,
  getEmbedLink,
  getContainerElement,
  redrawTextBoundingBox,
  getVisibleSceneBounds,
  wrapText,
  normalizeText,
  measureText,
  getLineHeightInPx,
  excludeElementsInFramesFromSelection,
  getSelectionStateForElements,
  makeNextSelectedElementIds,
  convertToExcalidrawElements,
  type ExcalidrawElementSkeleton,
  isTableElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeleted,
  ExcalidrawEmbeddableElement,
} from "@excalidraw/element/types";

import { actionCopy, actionCut } from "../../actions";
import {
  parseClipboard,
  parseDataTransferEvent,
  type ParsedDataTransferFile,
} from "../../clipboard";
import { restoreElements } from "../../data/restore";
import { t } from "../../i18n";
import { ImageURLToFile, SVGStringToFile } from "../../data/blob";
import { Fonts } from "../../fonts";
import { editorJotaiStore } from "../../editor-jotai";
import { type SetViewportOptions } from "../../viewport";
import { isMaybeMermaidDefinition } from "../../mermaid";
import { getShortcutKey } from "../../shortcut";
import { tryParseSpreadsheet } from "../../charts";
import { isSidebarDockedAtom } from "../Sidebar/Sidebar";

import { pasteTableRangeIntoCell, pasteTSVIntoCell } from "./tableClipboard";

import type App from "../App";
import type { ClipboardData, PastedMixedContent } from "../../clipboard";
import type { BinaryFiles } from "../../types";

export const onCut = (app: App, event: ClipboardEvent) => {
  if (!app.isInteractionEnabled()) {
    return;
  }
  const isExcalidrawActive = app.excalidrawContainerRef.current?.contains(
    app.ownerDocument.activeElement,
  );
  if (!isExcalidrawActive || isWritableElement(event.target)) {
    return;
  }
  app.actionManager.executeAction(actionCut, "keyboard", event);
  event.preventDefault();
  event.stopPropagation();
};

export const onCopy = (app: App, event: ClipboardEvent) => {
  if (!app.isInteractionEnabled()) {
    return;
  }
  const isExcalidrawActive = app.excalidrawContainerRef.current?.contains(
    app.ownerDocument.activeElement,
  );
  if (!isExcalidrawActive || isWritableElement(event.target)) {
    return;
  }
  app.actionManager.executeAction(actionCopy, "keyboard", event);
  event.preventDefault();
  event.stopPropagation();
};

export const insertClipboardContent = async (
  app: App,
  data: ClipboardData,
  dataTransferFiles: ParsedDataTransferFile[],
  isPlainPaste: boolean,
) => {
  const { x: sceneX, y: sceneY } = viewportCoordsToSceneCoords(
    {
      clientX: app.viewport.lastPosition.x,
      clientY: app.viewport.lastPosition.y,
    },
    app.state,
  );

  // ------------------- Error -------------------
  if (data.errorMessage) {
    app.setState({ errorMessage: data.errorMessage });
    return;
  }

  // ------------------- Mixed content with no files -------------------
  if (dataTransferFiles.length === 0 && !isPlainPaste && data.mixedContent) {
    await app["addElementsFromMixedContentPaste"](data.mixedContent, {
      isPlainPaste,
      sceneX,
      sceneY,
    });
    return;
  }

  // ------------------- Spreadsheet -------------------

  if (data.text && app.state.tableCellSelection && !data.elements) {
    try {
      pasteTSVIntoCell(
        app,
        data.text,
        app.state.tableCellSelection.tableId,
        app.state.tableCellSelection.anchorId,
      );
    } catch (error: any) {
      app.setState({ errorMessage: error.message });
    }
    return;
  }

  if (!isPlainPaste && data.text) {
    const result = tryParseSpreadsheet(data.text);
    if (result.ok) {
      app.setState({
        openDialog: {
          name: "charts",
          data: result.data,
          rawText: data.text,
        },
      });
      return;
    }
  }

  // ------------------- Images or SVG code -------------------
  const imageFiles = dataTransferFiles.map((data) => data.file);

  if (imageFiles.length === 0 && data.text && !isPlainPaste) {
    const trimmedText = data.text.trim();
    if (trimmedText.startsWith("<svg") && trimmedText.endsWith("</svg>")) {
      // ignore SVG validation/normalization which will be done during image
      // initialization
      imageFiles.push(SVGStringToFile(trimmedText));
    }
  }

  if (imageFiles.length > 0) {
    if (app.isToolSupported("image")) {
      await app["insertImages"](imageFiles, sceneX, sceneY);
    } else {
      app.setState({ errorMessage: t("errors.imageToolNotSupported") });
    }
    return;
  }

  // ------------------- Elements -------------------
  if (data.elements) {
    if (data.tableRange) {
      const sourceTable = data.elements.find(isTableElement);
      if (!sourceTable) {
        app.setState({ errorMessage: "Table clipboard data is incomplete" });
        return;
      }
      const targetSelection = app.state.tableCellSelection;
      const targetRowCol = app.state.tableRowColSelection;
      const targetTableId = targetSelection?.tableId ?? targetRowCol?.tableId;
      const targetTable =
        targetTableId && app.scene.getNonDeletedElement(targetTableId);
      const targetCellId =
        targetSelection?.anchorId ??
        (targetTable && isTableElement(targetTable) && targetRowCol
          ? targetTable.table.cells.find((cell) =>
              targetRowCol.kind === "row"
                ? cell.rowId === targetRowCol.id
                : cell.columnId === targetRowCol.id,
            )?.id
          : undefined);
      const hovered = app.getTableCellDropTargetAtSceneCoords({
        x: sceneX,
        y: sceneY,
      });
      const destination =
        targetTable && isTableElement(targetTable) && targetCellId
          ? { table: targetTable, cellId: targetCellId }
          : hovered;
      if (destination && data.mixedTableSelection) {
        app.setState({
          errorMessage:
            "Mixed table selections can only be pasted on the canvas",
        });
        return;
      }
      if (destination) {
        try {
          pasteTableRangeIntoCell(
            app,
            {
              table: sourceTable,
              elements: data.elements.filter(
                (element) => element.id !== sourceTable.id,
              ) as ExcalidrawElement[],
            },
            destination.table.id,
            destination.cellId,
          );
          if (data.files) {
            app.addFiles(Object.values(data.files));
          }
        } catch (error: any) {
          app.setState({ errorMessage: error.message });
        }
        return;
      }
    }
    const elements = (
      data.programmaticAPI
        ? convertToExcalidrawElements(
            data.elements as ExcalidrawElementSkeleton[],
          )
        : data.elements
    ) as readonly ExcalidrawElement[];
    // TODO: remove formatting from elements if isPlainPaste
    try {
      app.addElementsFromPasteOrLibrary({
        elements,
        files: data.files || null,
        position:
          app.editorInterface.formFactor === "desktop" ? "cursor" : "center",
        retainSeed: isPlainPaste,
        preserveFrameChildrenOrder: true,
      });
    } catch (error: any) {
      app.setState({ errorMessage: error.message });
    }
    return;
  }

  // ------------------- Only textual stuff remaining -------------------
  if (!data.text) {
    return;
  }

  // ------------------- Successful Mermaid -------------------
  if (!isPlainPaste && isMaybeMermaidDefinition(data.text)) {
    const api = await import("@excalidraw/mermaid-to-excalidraw");
    try {
      const { elements: skeletonElements, files = {} } =
        await api.parseMermaidToExcalidraw(data.text);

      const elements = convertToExcalidrawElements(skeletonElements, {
        regenerateIds: true,
      });

      app.addElementsFromPasteOrLibrary({
        elements,
        files,
        position:
          app.editorInterface.formFactor === "desktop" ? "cursor" : "center",
      });

      return;
    } catch (err: any) {
      console.warn(
        `parsing pasted text as mermaid definition failed: ${err.message}`,
      );
    }
  }

  // ------------------- Pure embeddable URLs -------------------
  const nonEmptyLines = normalizeEOL(data.text)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const embbeddableUrls = nonEmptyLines
    .map((str) => maybeParseEmbedSrc(str))
    .filter(
      (string) =>
        embeddableURLValidator(string, app.props.validateEmbeddable) &&
        (/^(http|https):\/\/[^\s/$.?#].[^\s]*$/.test(string) ||
          getEmbedLink(string)?.type === "video"),
    );

  if (
    !isPlainPaste &&
    embbeddableUrls.length > 0 &&
    embbeddableUrls.length === nonEmptyLines.length
  ) {
    const embeddables: NonDeleted<ExcalidrawEmbeddableElement>[] = [];
    for (const url of embbeddableUrls) {
      const prevEmbeddable: ExcalidrawEmbeddableElement | undefined =
        embeddables[embeddables.length - 1];
      const embeddable = app.insertEmbeddableElement({
        sceneX: prevEmbeddable
          ? prevEmbeddable.x + prevEmbeddable.width + 20
          : sceneX,
        sceneY,
        link: normalizeLink(url),
      });
      if (embeddable) {
        embeddables.push(embeddable);
      }
    }
    if (embeddables.length) {
      app.store.scheduleCapture();
      app.setState({
        selectedElementIds: Object.fromEntries(
          embeddables.map((embeddable) => [embeddable.id, true]),
        ),
      });
    }
    return;
  }

  // ------------------- Text -------------------
  app["addTextFromPaste"](data.text, isPlainPaste);
};

export const pasteFromClipboard = async (app: App, event: ClipboardEvent) => {
  if (!app.isInteractionEnabled()) {
    return;
  }

  const isPlainPaste = app.interactionState.isPlainPaste;

  // #686
  const target = app.ownerDocument.activeElement;
  const isExcalidrawActive =
    app.excalidrawContainerRef.current?.contains(target);
  if (event && !isExcalidrawActive) {
    return;
  }

  const elementUnderCursor = app.ownerDocument.elementFromPoint(
    app.viewport.lastPosition.x,
    app.viewport.lastPosition.y,
  );
  if (
    event &&
    (!(elementUnderCursor instanceof app.ownerWindow.HTMLCanvasElement) ||
      isWritableElement(target))
  ) {
    return;
  }

  // must be called in the same frame (thus before any awaits) as the paste
  // event else some browsers (FF...) will clear the clipboardData
  // (something something security)
  const dataTransferList = await parseDataTransferEvent(event);

  const filesList = dataTransferList.getFiles();

  const data = await parseClipboard(dataTransferList, isPlainPaste);

  if (app.props.onImport) {
    const prepared = data.elements
      ? {
          kind: "clipboard-elements" as const,
          source: "paste" as const,
          elements: data.elements,
          files: data.files,
          replace: false as const,
        }
      : filesList.length
      ? {
          kind: "image" as const,
          source: "paste" as const,
          files: filesList.map((item) => item.file),
          replace: false as const,
        }
      : null;
    if (prepared) {
      event?.preventDefault();
      try {
        await app.props.onImport(prepared, { source: "paste" });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          app.setState({
            errorMessage: error instanceof Error ? error.message : "导入失败",
          });
        }
      }
      return;
    }
  }

  if (app.props.onPaste) {
    try {
      if ((await app.props.onPaste(data, event)) === false) {
        return;
      }
    } catch (error: any) {
      console.error(error);
    }
  }

  await app["insertClipboardContent"](data, filesList, isPlainPaste);

  app.setActiveTool(
    { type: app.state.preferredSelectionTool.type },
    { keepSelection: true },
  );
  event?.preventDefault();
};

export const addElementsFromPasteOrLibrary = (
  app: App,
  opts: {
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles | null;
    position: { clientX: number; clientY: number } | "cursor" | "center";
    retainSeed?: boolean;
    fit?: SetViewportOptions["fit"];
    preserveFrameChildrenOrder?: boolean;
  },
) => {
  const elements = restoreElements(opts.elements, null, {
    deleteInvisibleElements: true,
  });
  const clientX =
    typeof opts.position === "object"
      ? opts.position.clientX
      : opts.position === "cursor"
      ? app.viewport.lastPosition.x
      : app.state.width / 2 + app.state.offsetLeft;
  const clientY =
    typeof opts.position === "object"
      ? opts.position.clientY
      : opts.position === "cursor"
      ? app.viewport.lastPosition.y
      : app.state.height / 2 + app.state.offsetTop;

  const duplication = app.duplicate.duplicateAtSceneCoords(
    elements,
    viewportCoordsToSceneCoords({ clientX, clientY }, app.state),
    {
      retainSeed: opts.retainSeed,
      preserveFrameChildrenOrder: opts.preserveFrameChildrenOrder,
    },
  );

  if (!duplication) {
    return;
  }

  const { nextElements, duplicatedElements } = duplication;

  app.scene.replaceAllElements(nextElements);

  duplicatedElements.forEach((newElement) => {
    if (isTextElement(newElement) && isBoundToContainer(newElement)) {
      const container = getContainerElement(
        newElement,
        app.scene.getElementsMapIncludingDeleted(),
      );
      redrawTextBoundingBox(newElement, container, app.scene);
    }
  });

  // paste event may not fire FontFace loadingdone event in Safari, hence loading font faces manually
  if (isSafari) {
    Fonts.loadElementsFonts(duplicatedElements, app.ownerDocument).then(
      (fontFaces) => {
        app.fonts.onLoaded(fontFaces);
      },
    );
  }

  if (opts.files) {
    app["addMissingFiles"](opts.files);
  }

  const nextElementsToSelect =
    excludeElementsInFramesFromSelection(duplicatedElements);

  app.store.scheduleCapture();
  app.setState(
    {
      ...app.state,
      // keep sidebar (presumably the library) open if it's docked and
      // can fit.
      //
      // Note, we should close the sidebar only if we're dropping items
      // from library, not when pasting from clipboard. Alas.
      openSidebar:
        app.state.openSidebar &&
        app.editorInterface.canFitSidebar &&
        editorJotaiStore.get(isSidebarDockedAtom)
          ? app.state.openSidebar
          : null,
      ...getSelectionStateForElements(
        nextElementsToSelect,
        app.scene.getNonDeletedElements(),
        app.state,
      ),
    },
    () => {
      if (opts.files) {
        app["addNewImagesToImageCache"]();
      }
    },
  );
  app.setActiveTool(
    { type: app.state.preferredSelectionTool.type },
    { keepSelection: true },
  );

  if (opts.fit) {
    app.viewport.setViewport({
      target: duplicatedElements,
      fit: opts.fit,
      animation: false,
      offsets: { ui: true },
    });
  }
};

export const addElementsFromMixedContentPaste = async (
  app: App,
  mixedContent: PastedMixedContent,
  {
    isPlainPaste,
    sceneX,
    sceneY,
  }: { isPlainPaste: boolean; sceneX: number; sceneY: number },
) => {
  if (
    !isPlainPaste &&
    mixedContent.some((node) => node.type === "imageUrl") &&
    app.isToolSupported("image")
  ) {
    const imageURLs = mixedContent
      .filter((node) => node.type === "imageUrl")
      .map((node) => node.value);
    const responses = await Promise.all(
      imageURLs.map(async (url) => {
        try {
          return { file: await ImageURLToFile(url) };
        } catch (error: any) {
          let errorMessage = error.message;
          if (error.cause === "FETCH_ERROR") {
            errorMessage = t("errors.failedToFetchImage");
          } else if (error.cause === "UNSUPPORTED") {
            errorMessage = t("errors.unsupportedFileType");
          }
          return { errorMessage };
        }
      }),
    );

    const imageFiles = responses
      .filter((response): response is { file: File } => !!response.file)
      .map((response) => response.file);
    await app["insertImages"](imageFiles, sceneX, sceneY);
    const error = responses.find((response) => !!response.errorMessage);
    if (error && error.errorMessage) {
      app.setState({ errorMessage: error.errorMessage });
    }
  } else {
    const textNodes = mixedContent.filter((node) => node.type === "text");
    if (textNodes.length) {
      app["addTextFromPaste"](
        textNodes.map((node) => node.value).join("\n\n"),
        isPlainPaste,
      );
    }
  }
};

export const addTextFromPaste = (
  app: App,
  text: string,
  isPlainPaste = false,
) => {
  const { x, y } = viewportCoordsToSceneCoords(
    {
      clientX: app.viewport.lastPosition.x,
      clientY: app.viewport.lastPosition.y,
    },
    app.state,
  );

  const textElementProps = {
    x,
    y,
    strokeColor: app.state.currentItemStrokeColor,
    backgroundColor: app.state.currentItemBackgroundColor,
    fillStyle: app.state.currentItemFillStyle,
    strokeWidth: app.getCurrentItemStrokeWidth("text"),
    strokeStyle: app.state.currentItemStrokeStyle,
    roundness: null,
    roughness: app.state.currentItemRoughness,
    opacity: app.state.currentItemOpacity,
    text,
    fontSize: app.state.currentItemFontSize,
    fontFamily: app.state.currentItemFontFamily,
    textAlign: DEFAULT_TEXT_ALIGN,
    verticalAlign: DEFAULT_VERTICAL_ALIGN,
    locked: false,
  };
  const fontString = getFontString({
    fontSize: textElementProps.fontSize,
    fontFamily: textElementProps.fontFamily,
  });
  const lineHeight = getLineHeight(textElementProps.fontFamily);
  const [x1, , x2] = getVisibleSceneBounds(app.state);
  // long texts should not go beyond 800 pixels in width nor should it go below 200 px
  const maxTextWidth = Math.max(Math.min((x2 - x1) * 0.5, 800), 200);
  const LINE_GAP = 10;
  let currentY = y;

  const lines = isPlainPaste ? [text] : text.split("\n");
  const textElements = lines.reduce(
    (acc: ExcalidrawTextElement[], line, idx) => {
      const originalText = normalizeText(line).trim();
      if (originalText.length) {
        const containerRef = app.getContainerRefForDropAt({
          x,
          y: currentY,
        });

        let metrics = measureText(originalText, fontString, lineHeight);
        const isTextUnwrapped = metrics.width > maxTextWidth;

        const text = isTextUnwrapped
          ? wrapText(originalText, fontString, maxTextWidth)
          : originalText;

        metrics = isTextUnwrapped
          ? measureText(text, fontString, lineHeight)
          : metrics;

        const startX = x - metrics.width / 2;
        const startY = currentY - metrics.height / 2;

        const element = newTextElement({
          ...textElementProps,
          x: startX,
          y: startY,
          text,
          originalText,
          lineHeight,
          autoResize: !isTextUnwrapped,
          containerRef,
        });
        acc.push(element);
        currentY += element.height + LINE_GAP;
      } else {
        const prevLine = lines[idx - 1]?.trim();
        // add paragraph only if previous line was not empty, IOW don't add
        // more than one empty line
        if (prevLine) {
          currentY +=
            getLineHeightInPx(textElementProps.fontSize, lineHeight) + LINE_GAP;
        }
      }

      return acc;
    },
    [],
  );

  if (textElements.length === 0) {
    return;
  }

  app.insertNewElements(textElements);
  app.store.scheduleCapture();
  app.setState({
    selectedElementIds: makeNextSelectedElementIds(
      Object.fromEntries(textElements.map((el) => [el.id, true])),
      app.state,
    ),
  });

  if (
    !isPlainPaste &&
    textElements.length > 1 &&
    app.interactionState.plainPasteToastShown === false &&
    app.editorInterface.formFactor !== "phone"
  ) {
    app.setToast({
      message: t("toast.pasteAsSingleElement", {
        shortcut: getShortcutKey("CtrlOrCmd+Shift+V"),
      }),
      duration: 5000,
    });
    app.interactionState.plainPasteToastShown = true;
  }
};
