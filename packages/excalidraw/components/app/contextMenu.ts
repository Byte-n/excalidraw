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
import {
  CONTEXT_MENU_SEPARATOR,
  type ContextMenuItems,
  type ContextMenuSubmenu,
} from "../ContextMenu";

import type React from "react";

import type App from "../App";

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

export const buildContextMenuSubmenu = (
  label: ContextMenuSubmenu["label"],
  items: ContextMenuItems,
): ContextMenuSubmenu => ({ type: "submenu", label, items });

/**
 * 子菜单构建器：右键菜单（getContextMenuItems）与浮动栏「更多」菜单
 * （toolbar/ToolbarMoreMenu.tsx）同源共用，改动一处两端一致。
 */
export const getCopyAsSubmenu = (): ContextMenuSubmenu =>
  buildContextMenuSubmenu("labels.contextMenuCopyAs", [
    actionCopyAsPng,
    actionCopyAsSvg,
    copyText,
  ]);

export const getStyleSubmenu = (): ContextMenuSubmenu =>
  buildContextMenuSubmenu("labels.contextMenuStyle", [
    actionCopyStyles,
    actionPasteStyles,
  ]);

export const getLinkSubmenu = (): ContextMenuSubmenu =>
  buildContextMenuSubmenu("labels.contextMenuLink", [
    actionLink,
    actionCopyElementLink,
  ]);

export const getEditSubmenu = (): ContextMenuSubmenu =>
  buildContextMenuSubmenu("labels.contextMenuEdit", [
    actionToggleCropEditor,
    actionToggleLinearEditor,
    actionToggleShapeSwitch,
    actionAddToLibrary,
  ]);

export const getTextSubmenu = (): ContextMenuSubmenu =>
  buildContextMenuSubmenu("labels.contextMenuText", [
    actionTextAutoResize,
    actionSetCompositeShapeTextFitAuto,
    actionSetCompositeShapeTextFitFixed,
    actionUnbindText,
    actionBindText,
    actionWrapTextInContainer,
  ]);

export const getTableSubmenu = (): ContextMenuSubmenu =>
  buildContextMenuSubmenu("labels.contextMenuTable", [
    actionTableClearContent,
    actionTableClearBackgroundText,
    actionTableClearStyle,
    actionTableCopyFormat,
    actionTablePasteFormat,
    actionTableCenterContent,
  ]);

/** 画框相关动作：右键菜单平铺、「更多」菜单收进「画框›」子菜单（同序） */
export const getFrameSubmenuItems = (): ContextMenuItems => [
  actionSelectAllElementsInFrame,
  actionRemoveAllElementsFromFrame,
  actionWrapSelectionInFrame,
];

/** 翻转动作：右键菜单平铺、「更多」菜单收进「翻转›」子菜单 */
export const getFlipSubmenuItems = (): ContextMenuItems => [
  actionFlipHorizontal,
  actionFlipVertical,
];

export const getContextMenuItems = (
  app: App,
  type: "canvas" | "element",
): ContextMenuItems => {
  const submenu = buildContextMenuSubmenu;

  const copyAsSubmenu = getCopyAsSubmenu();
  const viewSubmenu = submenu("labels.contextMenuView", [
    actionToggleGridMode,
    actionToggleZenMode,
    actionToggleViewMode,
    actionToggleStats,
  ]);
  const snappingSubmenu = submenu("labels.contextMenuSnapping", [
    actionToggleObjectsSnapMode,
    actionToggleArrowBinding,
    actionToggleMidpointSnapping,
  ]);

  // canvas contextMenu
  // -------------------------------------------------------------------------

  if (type === "canvas") {
    if (app.state.viewModeEnabled) {
      return [copyAsSubmenu, viewSubmenu];
    }

    return [
      actionPaste,
      CONTEXT_MENU_SEPARATOR,
      copyAsSubmenu,
      CONTEXT_MENU_SEPARATOR,
      actionSelectAll,
      actionUnlockAllElements,
      CONTEXT_MENU_SEPARATOR,
      snappingSubmenu,
      viewSubmenu,
    ];
  }

  if (app.state.viewModeEnabled) {
    return [actionCopy, copyAsSubmenu];
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

  if (app.mindmap.getSelectedNode()) {
    return [
      actionCopy,
      copyAsSubmenu,
      CONTEXT_MENU_SEPARATOR,
      actionMindmapCreateChild,
      actionMindmapCreateSibling,
      actionMindmapToggleCollapse,
      actionMindmapPromote,
      actionToggleShapeSwitch,
      actionToggleElementLock,
      ...zIndexActions,
      CONTEXT_MENU_SEPARATOR,
      { ...actionDeleteSelected, label: "labels.deleteMindmapSubtree" },
      actionMindmapDeletePreservingChildren,
    ];
  }

  return [
    ...(app.state.tableCellSelection
      ? ([getTableSubmenu(), CONTEXT_MENU_SEPARATOR] as ContextMenuItems)
      : []),
    actionCut,
    actionCopy,
    actionPaste,
    actionDuplicateSelection,
    CONTEXT_MENU_SEPARATOR,
    copyAsSubmenu,
    CONTEXT_MENU_SEPARATOR,
    actionGroup,
    actionUngroup,
    actionToggleElementLock,
    ...zIndexActions,
    actionFlipHorizontal,
    actionFlipVertical,
    CONTEXT_MENU_SEPARATOR,
    getEditSubmenu(),
    CONTEXT_MENU_SEPARATOR,
    getTextSubmenu(),
    CONTEXT_MENU_SEPARATOR,
    ...getFrameSubmenuItems(),
    CONTEXT_MENU_SEPARATOR,
    getStyleSubmenu(),
    CONTEXT_MENU_SEPARATOR,
    getLinkSubmenu(),
    CONTEXT_MENU_SEPARATOR,
    actionDeleteSelected,
  ];
};
