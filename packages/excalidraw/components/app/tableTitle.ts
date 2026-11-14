import { getFontString, getLineHeight } from "@excalidraw/common";
import { measureText } from "@excalidraw/element";
import {
  getTableSceneTitle,
  getTableSceneTitlePosition,
  positionTableSceneTitle,
  setTableSceneTitle,
} from "@excalidraw/element/tableScene";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  FontFamilyValues,
} from "@excalidraw/element/types";

import type App from "../App";

/** Design spec (phase-6): table titles use 12px / weight 500. */
export const TABLE_TITLE_FONT_SIZE = 12;
export const TABLE_TITLE_FONT_WEIGHT = 500;
export const TABLE_TITLE_PLACEHOLDER = "Title";

/** The title font string, shared by created titles and the empty placeholder. */
export const getTableTitleFont = (fontFamily: FontFamilyValues) =>
  getFontString({
    fontFamily,
    fontSize: TABLE_TITLE_FONT_SIZE,
    fontWeight: TABLE_TITLE_FONT_WEIGHT,
  });

/** The single-line height a title with `fontFamily` gets once it is created. */
export const getTableTitleLineHeight = (fontFamily: FontFamilyValues) =>
  TABLE_TITLE_FONT_SIZE * getLineHeight(fontFamily);

export const getTableTitle = getTableSceneTitle;

export const getTableTitleBar = (
  table: ExcalidrawTableElement,
  title: ExcalidrawTextElement | undefined,
  zoom: number,
  fontFamily: FontFamilyValues,
) => {
  // an empty table reserves exactly the box its first title will occupy, so
  // the placeholder, the hover target and the created title share one geometry
  const width = title?.width ?? Math.min(table.width, 100 / zoom);
  const height = title?.height ?? getTableTitleLineHeight(fontFamily);
  const { x, y } = getTableSceneTitlePosition(table, { width, height });
  const gripSize = 20 / zoom;
  return {
    x,
    y,
    width,
    height,
    grip: {
      x: x - gripSize - 4 / zoom,
      y: y + (height - gripSize) / 2,
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
    title = setTableSceneTitle(app.scene, table, TABLE_TITLE_PLACEHOLDER, {
      fontFamily: app.state.currentItemFontFamily,
    });
    // setTableSceneTitle only takes a fontFamily option; the design-spec
    // 12px/500 title look is applied here and the title re-positioned for
    // its new measured height
    app.scene.mutateElement(title, {
      fontSize: TABLE_TITLE_FONT_SIZE,
      fontWeight: TABLE_TITLE_FONT_WEIGHT,
      ...measureText(
        title.text,
        getTableTitleFont(title.fontFamily),
        title.lineHeight,
      ),
    });
    positionTableSceneTitle(app.scene, table);
    app.scene.triggerUpdate();
  }
  app.setState({ editingTextElement: title });
  app.handleTextWysiwyg(title, { isExistingElement: !!existing });
};
