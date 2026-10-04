import React from "react";

import {
  getIndexedTableCellChildren,
  getVisibleTableCell,
  isTableElement,
} from "@excalidraw/element";

import type { AppClassProperties, UIAppState } from "../types";

type Props = {
  app: AppClassProperties;
  appState: UIAppState;
};

export const TableAccessibility = ({ app, appState }: Props) => {
  const selection = appState.tableCellSelection;
  const tableId =
    selection?.tableId ??
    Object.keys(appState.selectedElementIds).find((id) =>
      isTableElement(app.scene.getNonDeletedElement(id)),
    );
  const element = tableId && app.scene.getNonDeletedElement(tableId);
  if (!element || !isTableElement(element)) {
    return null;
  }

  const cell = getVisibleTableCell(
    element.table,
    selection?.focusId ?? element.table.cells[0].id,
  );
  if (!cell) {
    return null;
  }
  const row =
    element.table.rows.findIndex((item) => item.id === cell.rowId) + 1;
  const column =
    element.table.columns.findIndex((item) => item.id === cell.columnId) + 1;
  const children = getIndexedTableCellChildren(
    app.scene.getNonDeletedElementsMap(),
    element.id,
    cell.id,
  );
  const backgroundText = children?.find(
    (child) =>
      child.type === "text" &&
      child.containerRef?.kind === "tableCell" &&
      child.containerRef.role === "backgroundText",
  );
  const contentCount =
    children?.filter(
      (child) =>
        child.containerRef?.kind === "tableCell" &&
        child.containerRef.role === "content",
    ).length ?? 0;
  const label = [
    `Table ${element.table.rows.length} rows, ${element.table.columns.length} columns`,
    `row ${row}, column ${column}`,
    (cell.rowSpan ?? 1) > 1 || (cell.columnSpan ?? 1) > 1
      ? `spans ${cell.rowSpan ?? 1} rows and ${cell.columnSpan ?? 1} columns`
      : null,
    backgroundText?.type === "text" && backgroundText.text
      ? backgroundText.text
      : "empty background text",
    `${contentCount} shapes`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className="table-accessibility-grid"
      role="grid"
      aria-label={label}
      aria-rowcount={element.table.rows.length}
      aria-colcount={element.table.columns.length}
      aria-activedescendant={`table-cell-accessibility-${element.id}`}
      tabIndex={0}
      onFocus={() => {
        if (!selection) {
          app.setState({
            selectedElementIds: {},
            tableCellSelection: {
              tableId: element.id,
              anchorId: cell.id,
              focusId: cell.id,
              mobileMode: false,
            },
          });
        }
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key === "Process") {
          return;
        }
        if (
          (event.key === "ArrowUp" ||
            event.key === "ArrowDown" ||
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight") &&
          app.moveTableCellSelectionFocus(event.key, event.shiftKey)
        ) {
          event.preventDefault();
          event.stopPropagation();
        } else if (
          event.key === "Enter" &&
          app.editSelectedTableCellBackgroundText()
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div role="row" aria-rowindex={row}>
        <div
          role="gridcell"
          id={`table-cell-accessibility-${element.id}`}
          aria-colindex={column}
          aria-rowspan={cell.rowSpan ?? 1}
          aria-colspan={cell.columnSpan ?? 1}
          aria-label={label}
          aria-selected={!!selection}
        />
      </div>
    </div>
  );
};
