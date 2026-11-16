import {
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_FAMILY,
  DEFAULT_TEXT_ALIGN,
  CODES,
  KEYS,
  getLineHeight,
  arrayToMap,
} from "@excalidraw/common";

import {
  hasBackground,
  hasFillStyle,
  hasFrameBackground,
  newElementWith,
  syncStickyNoteInk,
} from "@excalidraw/element";

import {
  normalizeStickyNote,
  canApplyRoundnessTypeToElement,
  getDefaultRoundnessTypeForElement,
  isFrameLikeElement,
  isArrowElement,
  isExcalidrawElement,
  getColorUpdate,
  isNonDeletedElement,
  isStickyNoteElement,
  isTextElement,
  getTextElementStyle,
  relayoutStickyNotes,
  updateBoundElements,
} from "@excalidraw/element";

import {
} from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { paintIcon } from "../components/icons";

import { t } from "../i18n";
import { getSelectedElements } from "../scene";

import { register } from "./register";

// `copiedStyles` is exported only for tests.
export let copiedStyles: string = "{}";

export const actionCopyStyles = register({
  name: "copyStyles",
  label: "labels.copyStyles",
  icon: paintIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, formData, app) => {
    const elementsCopied = [];
    const element = elements.find((el) => appState.selectedElementIds[el.id]);
    elementsCopied.push(element);
    if (element) {
      copiedStyles = JSON.stringify(elementsCopied);
    }
    return {
      appState: {
        ...appState,
        toast: { message: t("toast.copyStyles") },
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  keyTest: (event) =>
    event[KEYS.CTRL_OR_CMD] && event.altKey && event.code === CODES.C,
});

export const actionPasteStyles = register({
  name: "pasteStyles",
  label: "labels.pasteStyles",
  icon: paintIcon,
  trackEvent: { category: "element" },
  perform: (elements, appState, formData, app) => {
    const elementsCopied = JSON.parse(copiedStyles);
    const pastedElement = elementsCopied[0];
    if (!isExcalidrawElement(pastedElement)) {
      return { elements, captureUpdate: CaptureUpdateAction.EVENTUALLY };
    }

    const selectedElements = getSelectedElements(elements, appState, {
    });
    const selectedElementIds = selectedElements.map((element) => element.id);
    const elementsMap = arrayToMap(elements);
    const nextElements = relayoutStickyNotes(
      // a restyled note and its label end up with one ink — the label's,
      // when the copied styles carry two colors
      syncStickyNoteInk(
        elements.map((element) => {
          if (selectedElementIds.includes(element.id)) {
            const elementStylesToCopyFrom = pastedElement;
            if (!elementStylesToCopyFrom) {
              return element;
            }
            let newElement = newElementWith(element, {
              // a frame's background is the user's, like any filled shape's
              backgroundColor:
                hasBackground(element) || hasFrameBackground(element.type)
                  ? elementStylesToCopyFrom.backgroundColor
                  : element.backgroundColor,
              strokeWidth: elementStylesToCopyFrom?.strokeWidth,
              strokeColor: elementStylesToCopyFrom?.strokeColor,
              strokeStyle: elementStylesToCopyFrom?.strokeStyle,
              fillStyle: hasFillStyle(element)
                ? elementStylesToCopyFrom.fillStyle
                : element.fillStyle,
              opacity: elementStylesToCopyFrom?.opacity,
              roundness: elementStylesToCopyFrom.roundness
                ? canApplyRoundnessTypeToElement(
                    elementStylesToCopyFrom.roundness.type,
                    element,
                  )
                  ? elementStylesToCopyFrom.roundness
                  : getDefaultRoundnessTypeForElement(element)
                : null,
            });

            if (isTextElement(newElement)) {
              const sourceText =
                elementStylesToCopyFrom as ExcalidrawTextElement;
              const sourceStyle = getTextElementStyle(sourceText);
              const fontSize = sourceStyle.fontSize || DEFAULT_FONT_SIZE;
              const fontFamily = sourceStyle.fontFamily || DEFAULT_FONT_FAMILY;
              const baseBody = newElement.texts.body;
              newElement = newElementWith(newElement, {
                texts: {
                  body: {
                    ...baseBody,
                    style: {
                      ...baseBody.style,
                      fontSize,
                      fontFamily,
                      textAlign: sourceStyle.textAlign || DEFAULT_TEXT_ALIGN,
                      lineHeight:
                        sourceStyle.lineHeight || getLineHeight(fontFamily),
                    },
                  },
                },
              });
            }

            if (
              newElement.type === "arrow" &&
              isArrowElement(elementStylesToCopyFrom)
            ) {
              newElement = newElementWith(newElement, {
                startArrowhead: elementStylesToCopyFrom.startArrowhead,
                endArrowhead: elementStylesToCopyFrom.endArrowhead,
              });
            }

            if (isFrameLikeElement(element)) {
              newElement = newElementWith(newElement, {
                // the board's corners are fixed chrome; its background comes
                // from the copied styles above, like any other filled shape
                roundness: null,
              });
            }

            if (isStickyNoteElement(newElement)) {
              newElement = normalizeStickyNote(newElement);
              // 便签正文的样式（字号上限/字体/行高/对齐）随样式一起粘贴
              const targetBody = newElement.texts?.body;
              const sourceBody = elementStylesToCopyFrom.texts?.body;
              if (targetBody && sourceBody) {
                newElement = newElementWith(newElement, {
                  texts: {
                    ...newElement.texts,
                    body: {
                      ...targetBody,
                      style: {
                        ...targetBody.style,
                        fontFamily: sourceBody.style.fontFamily,
                        fontSize: sourceBody.style.fontSize,
                        lineHeight: sourceBody.style.lineHeight,
                        textAlign: sourceBody.style.textAlign,
                      },
                    },
                  },
                });
              }
            }

            return newElement;
          }
          return element;
        }),
        elementsMap,
      ),
      new Set(selectedElementIds),
      { prevElementsMap: elementsMap },
    );

    // a restyled note may have grown or shrunk — arrows bound to it follow
    for (const element of nextElements) {
      const prev = elementsMap.get(element.id);
      if (
        isStickyNoteElement(element) &&
        isNonDeletedElement(element) &&
        prev &&
        (prev.height !== element.height ||
          prev.x !== element.x ||
          prev.y !== element.y)
      ) {
        updateBoundElements(element, app.scene);
      }
    }

    return {
      elements: nextElements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  keyTest: (event) =>
    event[KEYS.CTRL_OR_CMD] && event.altKey && event.code === CODES.V,
});
