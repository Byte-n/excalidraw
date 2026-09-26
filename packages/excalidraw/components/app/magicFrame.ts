/* eslint-disable dot-notation -- App compatibility delegates remain private. */
import { FRAME_STYLE, TOOL_TYPE } from "@excalidraw/common";
import {
  getCommonBounds,
  newMagicFrameElement,
  isFrameLikeElement,
  isMagicFrameElement,
  getElementsOverlappingFrame,
} from "@excalidraw/element";

import type {
  NonDeleted,
  ExcalidrawMagicFrameElement,
  ExcalidrawIframeElement,
  MagicGenerationData,
} from "@excalidraw/element/types";

import { trackEvent } from "../../analytics";
import { copyTextToSystemClipboard } from "../../clipboard";

import type App from "../App";

export const updateMagicGeneration = (
  app: App,
  {
    frameElement,
    data,
  }: {
    frameElement: ExcalidrawIframeElement;
    data: MagicGenerationData;
  },
) => {
  if (data.status === "pending") {
    // We don't wanna persist pending state to storage. It should be in-app
    // state only.
    // Thus reset so that we prefer local cache (if there was some
    // generationData set previously)
    app.scene.mutateElement(
      frameElement,
      {
        customData: { generationData: undefined },
      },
      { informMutation: false, isDragging: false },
    );
  } else {
    app.scene.mutateElement(
      frameElement,
      {
        customData: { generationData: data },
      },
      { informMutation: false, isDragging: false },
    );
  }
  app.magicGenerations.set(frameElement.id, data);
  app.triggerRender();
};

export const onMagicFrameGenerate = async (
  app: App,
  magicFrame: Readonly<NonDeleted<ExcalidrawMagicFrameElement>>,
  source: "button" | "upstream",
) => {
  const generateDiagramToCode = app.plugins.diagramToCode?.generate;

  if (!generateDiagramToCode) {
    app.setState({
      errorMessage: "No diagram to code plugin found",
    });
    return;
  }

  const magicFrameChildren = getElementsOverlappingFrame(
    app.scene.getNonDeletedElements(),
    magicFrame,
    app.scene.getNonDeletedElementsMap(),
  ).filter((el) => !isMagicFrameElement(el));

  if (!magicFrameChildren.length) {
    if (source === "button") {
      app.setState({ errorMessage: "Cannot generate from an empty frame" });
      trackEvent("ai", "generate (no-children)", "d2c");
    } else {
      app.setActiveTool({ type: "magicframe" });
    }
    return;
  }

  const frameElement = app.insertIframeElement({
    sceneX: magicFrame.x + magicFrame.width + 30,
    sceneY: magicFrame.y,
    width: magicFrame.width,
    height: magicFrame.height,
  });

  if (!frameElement) {
    return;
  }

  app["updateMagicGeneration"]({
    frameElement,
    data: { status: "pending" },
  });

  app.setState({
    selectedElementIds: { [frameElement.id]: true },
  });

  trackEvent("ai", "generate (start)", "d2c");
  try {
    const { html } = await generateDiagramToCode({
      frame: magicFrame,
      children: magicFrameChildren,
      onPartial: (partialResponse) => {
        // only stream into the frame while this generation is still pending
        if (app.magicGenerations.get(frameElement.id)?.status !== "pending") {
          return;
        }
        const htmlStartIndex = partialResponse.search(
          /<!doctype html|<html[\s>]/i,
        );
        if (htmlStartIndex === -1) {
          return;
        }
        // the pending iframe document renders the partial html itself
        // (see the streaming shell in `renderEmbeddables`) — we only feed
        // it snapshots of the html received so far
        app.getHTMLIFrameElement(frameElement)?.contentWindow?.postMessage(
          {
            type: "excalidraw:diagramToCode:partial",
            html: partialResponse.slice(htmlStartIndex),
          },
          "*",
        );
      },
    });

    trackEvent("ai", "generate (success)", "d2c");

    if (!html.trim()) {
      app["updateMagicGeneration"]({
        frameElement,
        data: {
          status: "error",
          code: "ERR_OAI",
          message: "Nothing genereated :(",
        },
      });
      return;
    }

    const parsedHtml =
      html.includes("<!DOCTYPE html>") && html.includes("</html>")
        ? html.slice(
            html.indexOf("<!DOCTYPE html>"),
            html.indexOf("</html>") + "</html>".length,
          )
        : html;

    app["updateMagicGeneration"]({
      frameElement,
      data: { status: "done", html: parsedHtml },
    });
  } catch (error: any) {
    trackEvent("ai", "generate (failed)", "d2c");
    app["updateMagicGeneration"]({
      frameElement,
      data: {
        status: "error",
        code: "ERR_OAI",
        message: error.message || "Unknown error during generation",
      },
    });
  }
};

export const onIframeSrcCopy = (app: App, element: ExcalidrawIframeElement) => {
  if (element.customData?.generationData?.status === "done") {
    copyTextToSystemClipboard(element.customData.generationData.html);
    app.setToast({
      message: "copied to clipboard",
      closable: false,
      duration: 1500,
    });
  }
};

export const onMagicframeToolSelect = (app: App) => {
  const selectedElements = app.scene.getSelectedElements({
    selectedElementIds: app.state.selectedElementIds,
  });

  if (selectedElements.length === 0) {
    app.setActiveTool({ type: TOOL_TYPE.magicframe });
    trackEvent("ai", "tool-select (empty-selection)", "d2c");
  } else {
    const selectedMagicFrame: NonDeleted<ExcalidrawMagicFrameElement> | false =
      selectedElements.length === 1 &&
      isMagicFrameElement(selectedElements[0]) &&
      selectedElements[0];

    // case: user selected elements containing frame-like(s) or are frame
    // members, we don't want to wrap into another magicframe
    // (unless the only selected element is a magic frame which we reuse)
    if (
      !selectedMagicFrame &&
      selectedElements.some((el) => isFrameLikeElement(el) || el.frameId)
    ) {
      app.setActiveTool({ type: TOOL_TYPE.magicframe });
      return;
    }

    trackEvent("ai", "tool-select (existing selection)", "d2c");

    let frame: NonDeleted<ExcalidrawMagicFrameElement>;
    if (selectedMagicFrame) {
      // a single magicframe already selected -> use it
      frame = selectedMagicFrame;
    } else {
      // selected elements aren't wrapped in magic frame yet -> wrap now

      const [minX, minY, maxX, maxY] = getCommonBounds(selectedElements);
      const padding = 50;

      frame = newMagicFrameElement({
        ...FRAME_STYLE,
        x: minX - padding,
        y: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
        opacity: 100,
        locked: false,
      });

      app.insertNewElement(frame);

      for (const child of selectedElements) {
        app.scene.mutateElement(child, { frameId: frame.id });
      }

      app.setState({
        selectedElementIds: { [frame.id]: true },
      });
    }

    app.onMagicFrameGenerate(frame, "upstream");
  }
};
