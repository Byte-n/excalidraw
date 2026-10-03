import {
  DEFAULT_FONT_SIZE,
  TABLE_STRUCTURE_RAIL_OFFSET,
} from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type App from "../App";

export const getTableTitle = (
  elements: readonly ExcalidrawElement[],
  tableId: string,
): NonDeleted<ExcalidrawTextElement> | undefined =>
  elements.find(
    (element): element is NonDeleted<ExcalidrawTextElement> =>
      !element.isDeleted &&
      element.type === "text" &&
      element.containerRef?.kind === "tableTitle" &&
      element.containerRef.elementId === tableId,
  );

export const getTableTitleBar = (
  table: ExcalidrawTableElement,
  title: ExcalidrawTextElement | undefined,
  zoom: number,
  fontSize: number,
) => {
  const lineHeight = title?.height ?? fontSize * 1.25;
  const gap = table.table.style?.title?.gap ?? 2;
  const y =
    table.y - (TABLE_STRUCTURE_RAIL_OFFSET + 9 + gap) / zoom - lineHeight;
  const align = table.table.style?.title?.align ?? "start";
  const width = title?.width ?? Math.min(table.width, 100 / zoom);
  const x =
    align === "center"
      ? table.x + (table.width - width) / 2
      : align === "end"
      ? table.x + table.width - width
      : table.x;
  const gripSize = 20 / zoom;
  return {
    x,
    y,
    width,
    height: lineHeight,
    grip: {
      x: x - gripSize - 4 / zoom,
      y: y + (lineHeight - gripSize) / 2,
      width: gripSize,
      height: gripSize,
    },
  };
};

export const isInTableTitleBar = (
  point: { x: number; y: number },
  bar: ReturnType<typeof getTableTitleBar>,
) =>
  point.x >= bar.grip.x &&
  point.x <= bar.x + bar.width &&
  point.y >= bar.y &&
  point.y <= bar.y + bar.height;

export const isInTableTitleGrip = (
  point: { x: number; y: number },
  bar: ReturnType<typeof getTableTitleBar>,
) =>
  point.x >= bar.grip.x &&
  point.x <= bar.grip.x + bar.grip.width &&
  point.y >= bar.grip.y &&
  point.y <= bar.grip.y + bar.grip.height;

export const startTableTitleEditing = (
  app: App,
  table: ExcalidrawTableElement,
) => {
  const existing = getTableTitle(app.scene.getNonDeletedElements(), table.id);
  let title = existing;
  if (!title) {
    const fontSize = DEFAULT_FONT_SIZE;
    const bar = getTableTitleBar(
      table,
      undefined,
      app.state.zoom.value,
      fontSize,
    );
    const created = newTextElement({
      x: bar.x,
      y: bar.y,
      text: "Title",
      fontSize,
      fontFamily: app.state.currentItemFontFamily,
      containerRef: { kind: "tableTitle", elementId: table.id },
      locked: false,
    });
    const positioned = getTableTitleBar(
      table,
      created,
      app.state.zoom.value,
      fontSize,
    );
    title = { ...created, x: positioned.x, y: positioned.y };
    app.store.scheduleCapture();
    app.scene.insertElementsAtIndex(
      [title],
      app.scene.getElementIndex(table.id) + 1,
    );
    app.scene.triggerUpdate();
  }
  app.setState({ editingTextElement: title });
  app.handleTextWysiwyg(title, { isExistingElement: !!existing });
};
