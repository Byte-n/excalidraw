import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawTitledElement,
} from "./types";

const DEFAULT_FRAME_NAME = "Frame";
const DEFAULT_AI_FRAME_NAME = "AI Frame";
export const DEFAULT_TABLE_NAME = "Table";

export const isTitledElement = (
  element: ExcalidrawElement,
): element is ExcalidrawTitledElement =>
  element.type === "frame" ||
  element.type === "magicframe" ||
  element.type === "table";

export const getDefaultFrameName = (element: ExcalidrawFrameLikeElement) => {
  return element.type === "frame" ? DEFAULT_FRAME_NAME : DEFAULT_AI_FRAME_NAME;
};

export const getElementTitle = (element: ExcalidrawTitledElement) => {
  if (element.name !== null) {
    return element.name;
  }
  return element.type === "table"
    ? DEFAULT_TABLE_NAME
    : getDefaultFrameName(element);
};
