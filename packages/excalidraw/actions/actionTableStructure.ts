import { CaptureUpdateAction } from "@excalidraw/element";
import { CODES, KEYS } from "@excalidraw/common";

import { register } from "./register";

import type { ActionResult } from "./types";
import type { AppClassProperties, AppState } from "../types";

const tableActionResult = (
  app: AppClassProperties,
  _appState: AppState,
): ActionResult => {
  return {
    elements: app.scene.getElementsIncludingDeleted(),
    appState: app.state,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
};

const isKey = (event: { key: string; code?: string }, key: string, code?: string) =>
  event.key === key || (!!code && event.code === code);

export const actionTableInsertRow = register({
  name: "tableInsertRow",
  label: "labels.tableInsertRow",
  trackEvent: { category: "element" },
  keyPriority: 1,
  perform: (_elements, appState, _formData, app) => {
    if (!appState.tableRowColSelection || !app.insertTableRowCol("insertRow")) {
      return false;
    }
    return tableActionResult(app, appState);
  },
  keyTest: (event, appState) =>
    isKey(event, KEYS.R, CODES.R) &&
    event[KEYS.CTRL_OR_CMD] &&
    event.shiftKey &&
    !!appState.tableRowColSelection,
});

export const actionTableInsertColumn = register({
  name: "tableInsertColumn",
  label: "labels.tableInsertColumn",
  trackEvent: { category: "element" },
  keyPriority: 1,
  perform: (_elements, appState, _formData, app) => {
    if (
      !appState.tableRowColSelection ||
      !app.insertTableRowCol("insertColumn")
    ) {
      return false;
    }
    return tableActionResult(app, appState);
  },
  keyTest: (event, appState) =>
    isKey(event, KEYS.C, CODES.C) &&
    event[KEYS.CTRL_OR_CMD] &&
    event.shiftKey &&
    !!appState.tableRowColSelection,
});

export const actionTableMoveRowUp = register({
  name: "tableMoveRowUp",
  label: "labels.tableMoveRowUp",
  trackEvent: { category: "element" },
  keyPriority: 1,
  perform: (_elements, appState, _formData, app) => {
    if (!appState.tableRowColSelection || !app.moveSelectedTableRowCol(-1)) {
      return false;
    }
    return tableActionResult(app, appState);
  },
  keyTest: (event, appState) =>
    event.key === KEYS.ARROW_UP &&
    event[KEYS.CTRL_OR_CMD] &&
    event.shiftKey &&
    !!appState.tableRowColSelection,
});

export const actionTableMoveRowDown = register({
  name: "tableMoveRowDown",
  label: "labels.tableMoveRowDown",
  trackEvent: { category: "element" },
  keyPriority: 1,
  perform: (_elements, appState, _formData, app) => {
    if (!appState.tableRowColSelection || !app.moveSelectedTableRowCol(1)) {
      return false;
    }
    return tableActionResult(app, appState);
  },
  keyTest: (event, appState) =>
    event.key === KEYS.ARROW_DOWN &&
    event[KEYS.CTRL_OR_CMD] &&
    event.shiftKey &&
    !!appState.tableRowColSelection,
});

export const actionTableMoveColumnLeft = register({
  name: "tableMoveColumnLeft",
  label: "labels.tableMoveColumnLeft",
  trackEvent: { category: "element" },
  keyPriority: 1,
  perform: (_elements, appState, _formData, app) => {
    if (!appState.tableRowColSelection || !app.moveSelectedTableRowCol(-1)) {
      return false;
    }
    return tableActionResult(app, appState);
  },
  keyTest: (event, appState) =>
    event.key === KEYS.ARROW_LEFT &&
    event[KEYS.CTRL_OR_CMD] &&
    event.shiftKey &&
    !!appState.tableRowColSelection,
});

export const actionTableMoveColumnRight = register({
  name: "tableMoveColumnRight",
  label: "labels.tableMoveColumnRight",
  trackEvent: { category: "element" },
  keyPriority: 1,
  perform: (_elements, appState, _formData, app) => {
    if (!appState.tableRowColSelection || !app.moveSelectedTableRowCol(1)) {
      return false;
    }
    return tableActionResult(app, appState);
  },
  keyTest: (event, appState) =>
    event.key === KEYS.ARROW_RIGHT &&
    event[KEYS.CTRL_OR_CMD] &&
    event.shiftKey &&
    !!appState.tableRowColSelection,
});
