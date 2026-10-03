/* eslint-disable dot-notation -- App compatibility delegates remain private. */
import {
  POINTER_BUTTON,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import {
  LinearElementEditor,
  isLinearElement,
  selectGroupsForSelectedElements,
} from "@excalidraw/element";

import {
  actionAddToLibrary,
  actionBringForward,
  actionBringToFront,
  actionCopy,
  actionCopyAsPng,
  actionCopyAsSvg,
  copyText,
  actionCopyStyles,
  actionCut,
  actionDeleteSelected,
  actionDuplicateSelection,
  actionFlipHorizontal,
  actionFlipVertical,
  actionGroup,
  actionPasteStyles,
  actionSelectAll,
  actionSendBackward,
  actionSendToBack,
  actionToggleGridMode,
  actionToggleStats,
  actionToggleZenMode,
  actionUnbindText,
  actionBindText,
  actionUngroup,
  actionLink,
  actionToggleElementLock,
  actionToggleLinearEditor,
  actionToggleObjectsSnapMode,
  actionToggleArrowBinding,
  actionToggleMidpointSnapping,
  actionToggleCropEditor,
  actionMindmapCreateChild,
  actionMindmapCreateSibling,
  actionMindmapToggleCollapse,
  actionMindmapDeletePreservingChildren,
  actionMindmapPromote,
  actionSetCompositeShapeTextFitFixed,
  actionSetCompositeShapeTextFitAuto,
  actionTableClearContent,
  actionTableClearBackgroundText,
  actionTableClearStyle,
  actionTableCopyFormat,
  actionTablePasteFormat,
  actionTableCenterContent,
} from "../../actions";
import { actionWrapTextInContainer } from "../../actions/actionBoundText";
import { actionPaste } from "../../actions/actionClipboard";
import { actionCopyElementLink } from "../../actions/actionElementLink";
import { actionUnlockAllElements } from "../../actions/actionElementLock";
import {
  actionRemoveAllElementsFromFrame,
  actionSelectAllElementsInFrame,
  actionWrapSelectionInFrame,
} from "../../actions/actionFrame";
import { actionTextAutoResize } from "../../actions/actionTextAutoResize";
import { actionToggleViewMode } from "../../actions/actionToggleViewMode";
import { actionToggleShapeSwitch } from "../../actions/actionToggleShapeSwitch";
import { trackEvent } from "../../analytics";
import { CONTEXT_MENU_SEPARATOR } from "../ContextMenu";

import type React from "react";

import type App from "../App";
import type { ContextMenuItems } from "../ContextMenu";

export const handleCanvasContextMenu = (
  app: App,
  event: React.MouseEvent<HTMLElement | HTMLCanvasElement>,
) => {
  // Always suppress the native menu over the canvas.
  event.preventDefault();
  // a secondary-button press is a pan session: this event is not a click
  // when it comes with the press (macOS and Linux fire it on mousedown,
  // and the session opens the menu on release if no drag follows), nor
  // when it follows a release that was a drag
  if (app.pan.consumesContextMenuEvent()) {
    return;
  }
  app.openContextMenu({
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    pointerType:
      "pointerType" in event.nativeEvent
        ? (event.nativeEvent as PointerEvent).pointerType
        : undefined,
  });
};

export const openContextMenu = (
  app: App,
  pointer: {
    clientX: number;
    clientY: number;
    button?: number;
    pointerType?: string;
  },
) => {
  // In non-interactive mode there is no menu, so the native one cannot be
  // mistaken for Excalidraw's own.
  if (!app.isInteractionEnabled()) {
    return;
  }

  if (
    app["touchMindmapContextMenuAllowed"] === false &&
    (pointer.pointerType === "touch" ||
      (pointer.pointerType === undefined &&
        app.lastPointerDownEvent?.pointerType === "touch" &&
        app.gesture.pointers.size > 0))
  ) {
    return;
  }

  // a context menu during a press (touch long-press) means the user is
  // not committing a bucket click
  app.bucketFill.cancel();

  if (
    (pointer.pointerType === "touch" ||
      (pointer.pointerType === "pen" &&
        // always allow if user uses a pen secondary button
        pointer.button !== POINTER_BUTTON.SECONDARY)) &&
    app.state.activeTool.type !== app.state.preferredSelectionTool.type
  ) {
    return;
  }

  const { x, y } = viewportCoordsToSceneCoords(pointer, app.state);
  const element = app.getElementAtPosition(x, y, {
    preferSelected: true,
    includeLockedElements: true,
  });

  const selectedElements = app.scene.getSelectedElements(app.state);
  const isHittingCommonBoundBox = app[
    "isHittingCommonBoundingBoxOfSelectedElements"
  ]({ x, y }, selectedElements);

  const type = element || isHittingCommonBoundBox ? "element" : "canvas";

  const container = app.excalidrawContainerRef.current!;
  const { top: offsetTop, left: offsetLeft } =
    container.getBoundingClientRect();
  const left = pointer.clientX - offsetLeft;
  const top = pointer.clientY - offsetTop;

  trackEvent("contextMenu", "openContextMenu", type);

  app.setState(
    {
      ...(element && !app.state.selectedElementIds[element.id]
        ? {
            ...app.state,
            ...selectGroupsForSelectedElements(
              {
                editingGroupId: app.state.editingGroupId,
                selectedElementIds: { [element.id]: true },
              },
              app.scene.getNonDeletedElements(),
              app.state,
              app,
            ),
            selectedLinearElement: isLinearElement(element)
              ? new LinearElementEditor(
                  element,
                  app.scene.getNonDeletedElementsMap(),
                )
              : null,
          }
        : app.state),
      showHyperlinkPopup: false,
    },
    () => {
      app.setState({
        contextMenu: { top, left, items: app["getContextMenuItems"](type) },
      });
    },
  );
};

export const getContextMenuItems = (
  app: App,
  type: "canvas" | "element",
): ContextMenuItems => {
  const options: ContextMenuItems = [];

  options.push(actionCopyAsPng, actionCopyAsSvg);

  // canvas contextMenu
  // -------------------------------------------------------------------------

  if (type === "canvas") {
    if (app.state.viewModeEnabled) {
      return [
        ...options,
        actionToggleGridMode,
        actionToggleZenMode,
        actionToggleViewMode,
        actionToggleStats,
      ];
    }

    return [
      actionPaste,
      CONTEXT_MENU_SEPARATOR,
      actionCopyAsPng,
      actionCopyAsSvg,
      copyText,
      CONTEXT_MENU_SEPARATOR,
      actionSelectAll,
      actionUnlockAllElements,
      CONTEXT_MENU_SEPARATOR,
      actionToggleGridMode,
      actionToggleObjectsSnapMode,
      actionToggleArrowBinding,
      actionToggleMidpointSnapping,
      actionToggleZenMode,
      actionToggleViewMode,
      actionToggleStats,
    ];
  }

  // element contextMenu
  // -------------------------------------------------------------------------

  options.push(copyText);

  if (app.state.viewModeEnabled) {
    return [actionCopy, ...options];
  }

  if (app.mindmap.getSelectedNode()) {
    return [
      actionMindmapCreateChild,
      actionMindmapCreateSibling,
      actionMindmapToggleCollapse,
      actionMindmapPromote,
      actionToggleShapeSwitch,
      actionToggleElementLock,
      CONTEXT_MENU_SEPARATOR,
      { ...actionDeleteSelected, label: "labels.deleteMindmapSubtree" },
      actionMindmapDeletePreservingChildren,
    ];
  }

  const zIndexActions: ContextMenuItems =
    app.editorInterface.formFactor === "desktop"
      ? [
          CONTEXT_MENU_SEPARATOR,
          actionSendBackward,
          actionBringForward,
          actionSendToBack,
          actionBringToFront,
        ]
      : [];

  return [
    ...(app.state.tableCellSelection
      ? ([
          actionTableClearContent,
          actionTableClearBackgroundText,
          actionTableClearStyle,
          actionTableCopyFormat,
          actionTablePasteFormat,
          actionTableCenterContent,
          CONTEXT_MENU_SEPARATOR,
        ] as ContextMenuItems)
      : []),
    CONTEXT_MENU_SEPARATOR,
    actionCut,
    actionCopy,
    actionPaste,
    CONTEXT_MENU_SEPARATOR,
    actionSelectAllElementsInFrame,
    actionRemoveAllElementsFromFrame,
    actionWrapSelectionInFrame,
    CONTEXT_MENU_SEPARATOR,
    actionToggleCropEditor,
    CONTEXT_MENU_SEPARATOR,
    ...options,
    CONTEXT_MENU_SEPARATOR,
    actionCopyStyles,
    actionPasteStyles,
    CONTEXT_MENU_SEPARATOR,
    actionGroup,
    actionTextAutoResize,
    actionSetCompositeShapeTextFitAuto,
    actionSetCompositeShapeTextFitFixed,
    actionUnbindText,
    actionBindText,
    actionWrapTextInContainer,
    actionUngroup,
    CONTEXT_MENU_SEPARATOR,
    actionAddToLibrary,
    ...zIndexActions,
    CONTEXT_MENU_SEPARATOR,
    actionFlipHorizontal,
    actionFlipVertical,
    CONTEXT_MENU_SEPARATOR,
    actionToggleLinearEditor,
    CONTEXT_MENU_SEPARATOR,
    actionLink,
    actionCopyElementLink,
    CONTEXT_MENU_SEPARATOR,
    actionDuplicateSelection,
    actionToggleElementLock,
    CONTEXT_MENU_SEPARATOR,
    actionDeleteSelected,
  ];
};
