import clsx from "clsx";
import {
  CaptureUpdateAction,
  getSelectedElements,
  isTableElement,
} from "@excalidraw/element";
import { CODES, KEYS } from "@excalidraw/common";

import type { TableSizingMode } from "@excalidraw/element/types";

import { t } from "../i18n";

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

const isKey = (
  event: { key: string; code?: string },
  key: string,
  code?: string,
) => event.key === key || (!!code && event.code === code);

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

const isSingleTableSelection = (
  elements: readonly { type: string; table?: unknown }[],
): boolean => elements.length === 1 && elements[0].type === "table";

/**
 * The selected table's sizing mode (phase-1.1): a segmented control for
 * "fixed" vs "fit content". Switching in initializes the manual minima from
 * the current sizes and runs one content-driven expansion in the same
 * commit; switching out keeps the geometry verbatim.
 */
export const actionTableSizingMode = register<{ mode: TableSizingMode }>({
  name: "tableSizingMode",
  label: "labels.tableSizingMode",
  trackEvent: { category: "element" },
  perform: (_elements, appState, formData, app) => {
    if (!formData?.mode || !app.setTableSizingMode(formData.mode)) {
      return false;
    }
    return tableActionResult(app, appState);
  },
  keyTest: (event, appState, elements) =>
    isKey(event, KEYS.M, CODES.M) &&
    event[KEYS.CTRL_OR_CMD] &&
    event.shiftKey &&
    isSingleTableSelection(elements as never),
  PanelComponent: ({ elements, appState, updateData }) => {
    const selected = getSelectedElements(elements, appState);
    if (selected.length !== 1 || !isTableElement(selected[0])) {
      return null;
    }
    const table = selected[0];
    const mode: TableSizingMode = table.table.sizingMode ?? "fixed";

    return (
      <fieldset>
        <legend>{t("labels.tableSizingMode")}</legend>
        <div className="buttonList">
          {(["fixed", "fitContent"] as const).map((value) => (
            <button
              key={value}
              type="button"
              data-testid={`table-sizing-${value}`}
              className={clsx("excalidraw-button", {
                active: mode === value,
              })}
              onClick={() => updateData({ mode: value })}
            >
              {t(
                value === "fixed"
                  ? "labels.tableSizingFixed"
                  : "labels.tableSizingFitContent",
              )}
            </button>
          ))}
        </div>
      </fieldset>
    );
  },
});

/**
 * Reset command (phase-1.1): available while a `fitContent` table is
 * selected — restores the product's minimum row/column sizes as the manual
 * minima and re-expands from the content once, in a single undo entry.
 */
export const actionTableResetMinSizes = register({
  name: "tableResetMinSizes",
  label: "labels.tableResetMinSizes",
  trackEvent: { category: "element" },
  perform: (_elements, appState, _formData, app) => {
    if (!app.resetTableManualMinSizes()) {
      return false;
    }
    return tableActionResult(app, appState);
  },
  keyTest: (event, appState, elements) =>
    isKey(event, KEYS.M, CODES.M) &&
    event[KEYS.CTRL_OR_CMD] &&
    event.altKey &&
    elements.length === 1 &&
    isTableElement(elements[0]) &&
    (elements[0].table.sizingMode ?? "fixed") === "fitContent",
  PanelComponent: ({ elements, appState, updateData }) => {
    const selected = getSelectedElements(elements, appState);
    if (
      selected.length !== 1 ||
      !isTableElement(selected[0]) ||
      (selected[0].table.sizingMode ?? "fixed") !== "fitContent"
    ) {
      return null;
    }

    return (
      <div className="buttonList">
        <button
          type="button"
          className="excalidraw-button"
          data-testid="table-reset-min-sizes"
          onClick={() => updateData(null)}
        >
          {t("labels.tableResetMinSizes")}
        </button>
      </div>
    );
  },
});
