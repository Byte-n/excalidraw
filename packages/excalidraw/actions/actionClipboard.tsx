import {
  deepCopyElement,
  getMindmapElementsForSelection,
  getTextFromElements,
  isFrameLikeElement,
  isTableElement,
  isTextElement,
} from "@excalidraw/element";

import {
  CODES,
  KEYS,
  MIME_TYPES,
  EXPORT_DATA_TYPES,
  isFirefox,
} from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import {
  copyTextToSystemClipboard,
  copyToClipboard,
  createPasteEvent,
  probablySupportsClipboardBlob,
  probablySupportsClipboardWriteText,
  readSystemClipboard,
} from "../clipboard";
import {
  createTableRangeClipboard,
  getSelectedTableRange,
  tableRangeToTSV,
} from "../components/app/tableClipboard";
import { DuplicateIcon, cutIcon, pngIcon, svgIcon } from "../components/icons";
import { exportCanvas, prepareElementsForExport } from "../data/index";
import { t } from "../i18n";

import { actionDeleteSelected } from "./actionDeleteSelected";
import { register } from "./register";

export const actionCopy = register<ClipboardEvent | null>({
  name: "copy",
  label: "labels.copy",
  icon: DuplicateIcon,
  trackEvent: { category: "element" },
  perform: async (elements, appState, event, app) => {
    const selectedTableId =
      appState.tableCellSelection?.tableId ??
      appState.tableRowColSelection?.tableId;
    const selectedTable =
      selectedTableId && app.scene.getNonDeletedElement(selectedTableId);
    if (selectedTable && isTableElement(selectedTable)) {
      try {
        const range = getSelectedTableRange(appState, selectedTable);
        if (range) {
          const snapshot = createTableRangeClipboard(
            selectedTable,
            range,
            app.scene.getNonDeletedElements(),
          );
          const selected = app.scene.getSelectedElements({
            selectedElementIds: appState.selectedElementIds,
            includeBoundTextElement: true,
            includeElementsInFrames: true,
          });
          const rangeIds = new Set([
            selectedTable.id,
            ...snapshot.elements.map((element) => element.id),
          ]);
          const extras = selected.filter(
            (element) => !rangeIds.has(element.id),
          );
          const copiedContainerIds = new Set([
            snapshot.table.id,
            ...extras
              .filter(
                (element) =>
                  isTableElement(element) || isFrameLikeElement(element),
              )
              .map((element) => element.id),
          ]);
          const copiedExtras = extras.map((element) =>
            element.containerRef &&
            !copiedContainerIds.has(element.containerRef.elementId)
              ? { ...deepCopyElement(element), containerRef: undefined }
              : element,
          );
          const json = JSON.stringify({
            type: EXPORT_DATA_TYPES.excalidrawClipboard,
            tableRange: true,
            mixedTableSelection: extras.length > 0,
            elements: [snapshot.table, ...snapshot.elements, ...copiedExtras],
            files: app.files,
          });
          const formats = {
            [MIME_TYPES.excalidrawClipboard]: json,
            [MIME_TYPES.text]: tableRangeToTSV(snapshot),
          };
          const ClipboardItemConstructor = (
            app.ownerWindow as typeof globalThis
          ).ClipboardItem;
          if (
            !event &&
            ClipboardItemConstructor &&
            app.ownerWindow.navigator.clipboard?.write
          ) {
            try {
              const BlobConstructor = (app.ownerWindow as typeof globalThis)
                .Blob;
              await app.ownerWindow.navigator.clipboard.write([
                new ClipboardItemConstructor(
                  Object.fromEntries(
                    Object.entries(formats).map(([type, value]) => [
                      type,
                      new BlobConstructor([value], { type }),
                    ]),
                  ),
                ),
              ]);
            } catch {
              await copyTextToSystemClipboard(formats);
            }
          } else {
            await copyTextToSystemClipboard(formats, event);
          }
          return { captureUpdate: CaptureUpdateAction.NEVER };
        }
      } catch (error: any) {
        return {
          captureUpdate: CaptureUpdateAction.NEVER,
          appState: { ...appState, errorMessage: error.message },
        };
      }
    }
    let elementsToCopy = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });
    const selectedNode = app.mindmap.getSelectedNode();
    if (
      selectedNode &&
      !elementsToCopy.some(({ id }) => id === selectedNode.id)
    ) {
      elementsToCopy = [...elementsToCopy, selectedNode];
    }
    elementsToCopy = getMindmapElementsForSelection(
      app.scene.getNonDeletedElements(),
      elementsToCopy,
    ) as typeof elementsToCopy;

    try {
      await copyToClipboard(elementsToCopy, app.files, event);
    } catch (error: any) {
      return {
        captureUpdate: CaptureUpdateAction.NEVER,
        appState: {
          ...appState,
          errorMessage: error.message,
        },
      };
    }

    return {
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  // don't supply a shortcut since we handle this conditionally via onCopy event
  keyTest: undefined,
});

export const actionPaste = register({
  name: "paste",
  label: "labels.paste",
  trackEvent: { category: "element" },
  perform: async (elements, appState, data, app) => {
    let types;
    try {
      types = await readSystemClipboard();
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "NotAllowedError") {
        // user probably aborted the action. Though not 100% sure, it's best
        // to not annoy them with an error message.
        return false;
      }

      console.error(`actionPaste ${error.name}: ${error.message}`);

      if (isFirefox) {
        return {
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
          appState: {
            ...appState,
            errorMessage: t("hints.firefox_clipboard_write"),
          },
        };
      }

      return {
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
        appState: {
          ...appState,
          errorMessage: t("errors.asyncPasteFailedOnRead"),
        },
      };
    }

    try {
      app.pasteFromClipboard(createPasteEvent({ types }));
    } catch (error: any) {
      console.error(error);
      return {
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
        appState: {
          ...appState,
          errorMessage: t("errors.asyncPasteFailedOnParse"),
        },
      };
    }

    return {
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  // don't supply a shortcut since we handle this conditionally via onCopy event
  keyTest: undefined,
});

export const actionCut = register<ClipboardEvent | null>({
  name: "cut",
  label: "labels.cut",
  icon: cutIcon,
  trackEvent: { category: "element" },
  perform: async (elements, appState, event, app) => {
    if (
      appState.tableCellSelection ||
      appState.tableRowColSelection ||
      app.scene
        .getSelectedElements({
          selectedElementIds: appState.selectedElementIds,
        })
        .some(isTableElement)
    ) {
      return false;
    }
    const copied = await actionCopy.perform(elements, appState, event, app);
    if (
      copied === false ||
      copied?.captureUpdate === CaptureUpdateAction.NEVER
    ) {
      return copied;
    }
    return actionDeleteSelected.perform(elements, appState, null, app);
  },
  keyTest: (event) => event[KEYS.CTRL_OR_CMD] && event.key === KEYS.X,
});

export const actionCopyAsSvg = register({
  name: "copyAsSvg",
  label: "labels.copyAsSvg",
  icon: svgIcon,
  trackEvent: { category: "element" },
  perform: async (elements, appState, _data, app) => {
    if (!app.canvas) {
      return {
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }

    const { exportedElements, exportingFrame } = prepareElementsForExport(
      elements,
      appState,
      true,
    );

    try {
      await exportCanvas(
        "clipboard-svg",
        exportedElements,
        appState,
        app.files,
        {
          ...appState,
          exportingFrame,
          name: app.getName(),
        },
      );

      const selectedElements = app.scene.getSelectedElements({
        selectedElementIds: appState.selectedElementIds,
        includeBoundTextElement: true,
        includeElementsInFrames: true,
      });

      return {
        appState: {
          toast: {
            message: t("toast.copyToClipboardAsSvg", {
              exportSelection: selectedElements.length
                ? t("toast.selection")
                : t("toast.canvas"),
              exportColorScheme: appState.exportWithDarkMode
                ? t("buttons.darkMode")
                : t("buttons.lightMode"),
            }),
          },
        },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    } catch (error: any) {
      console.error(error);
      return {
        appState: {
          errorMessage: error.message,
        },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }
  },
  predicate: (elements) => {
    return probablySupportsClipboardWriteText && elements.length > 0;
  },
  keywords: ["svg", "clipboard", "copy"],
});

export const actionCopyAsPng = register({
  name: "copyAsPng",
  label: "labels.copyAsPng",
  icon: pngIcon,
  trackEvent: { category: "element" },
  perform: async (elements, appState, _data, app) => {
    if (!app.canvas) {
      return {
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }
    const selectedElements = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });

    const { exportedElements, exportingFrame } = prepareElementsForExport(
      elements,
      appState,
      true,
    );
    try {
      await exportCanvas("clipboard", exportedElements, appState, app.files, {
        ...appState,
        exportingFrame,
        name: app.getName(),
      });
      return {
        appState: {
          ...appState,
          toast: {
            message: t("toast.copyToClipboardAsPng", {
              exportSelection: selectedElements.length
                ? t("toast.selection")
                : t("toast.canvas"),
              exportColorScheme: appState.exportWithDarkMode
                ? t("buttons.darkMode")
                : t("buttons.lightMode"),
            }),
          },
        },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    } catch (error: any) {
      console.error(error);
      return {
        appState: {
          ...appState,
          errorMessage: error.message,
        },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }
  },
  predicate: (elements) => {
    return probablySupportsClipboardBlob && elements.length > 0;
  },
  keyTest: (event) => event.code === CODES.C && event.altKey && event.shiftKey,
  keywords: ["png", "clipboard", "copy"],
});

export const copyText = register({
  name: "copyText",
  label: "labels.copyText",
  trackEvent: { category: "element" },
  perform: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
    });

    try {
      copyTextToSystemClipboard(getTextFromElements(selectedElements));
    } catch (e) {
      throw new Error(t("errors.copyToSystemClipboardFailed"));
    }
    return {
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  predicate: (elements, appState, _, app) => {
    return (
      probablySupportsClipboardWriteText &&
      app.scene
        .getSelectedElements({
          selectedElementIds: appState.selectedElementIds,
          includeBoundTextElement: true,
        })
        .some(isTextElement)
    );
  },
  keywords: ["text", "clipboard", "copy"],
});
