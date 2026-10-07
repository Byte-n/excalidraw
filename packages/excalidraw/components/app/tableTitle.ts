import { TABLE_STRUCTURE_RAIL_OFFSET } from "@excalidraw/common";
import {
  getTableSceneTitle,
  getTableSceneTitlePosition,
  setTableSceneTitle,
} from "@excalidraw/element/tableScene";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import type App from "../App";

export const getTableTitle = getTableSceneTitle;

export const getTableTitleBar = (
  table: ExcalidrawTableElement,
  title: ExcalidrawTextElement | undefined,
  zoom: number,
  fontSize: number,
) => {
  const lineHeight = title?.height ?? fontSize * 1.25;
  const gap = table.table.style?.title?.gap ?? 2;
  const y = title
    ? getTableSceneTitlePosition(table, title).y
    : table.y - (TABLE_STRUCTURE_RAIL_OFFSET + 9 + gap) / zoom - lineHeight;
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
    app.store.scheduleCapture();
    title = setTableSceneTitle(app.scene, table, "Title", {
      fontFamily: app.state.currentItemFontFamily,
    });
    app.scene.triggerUpdate();
  }
  app.setState({ editingTextElement: title });
  app.handleTextWysiwyg(title, { isExistingElement: !!existing });
};
