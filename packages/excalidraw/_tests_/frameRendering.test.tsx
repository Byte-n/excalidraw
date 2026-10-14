import rough from "roughjs/bin/rough";

import { arrayToMap, toBrandedType } from "@excalidraw/common";
import { Scene } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";

import { API } from "./helpers/api";

import type { RenderableElementsMap } from "../scene/types";
import type { NormalizedZoomValue, StaticCanvasAppState } from "../types";

type RecordedCall = { type: string; args: unknown[] };

/**
 * The fill a frame carries once the user paints its board. Values here must
 * not collide with the canvas background: painting it seeds `fillStyle` with
 * `COLOR_WHITE`, so a white board would be indistinguishable from it.
 */
const BOARD_FILL = "#ffec99";

/**
 * jsdom's canvas mock draws but doesn't reflect state back, so the tests
 * record the context calls through a proxy: the index of a fill call is the
 * order in which the canvas is painted, i.e. what covers what.
 */
const recordContextCalls = (canvas: HTMLCanvasElement) => {
  const calls: RecordedCall[] = [];
  const context = canvas.getContext("2d")!;
  const proxy: CanvasRenderingContext2D = new Proxy(context, {
    get(target, prop: string) {
      const value = (target as any)[prop];
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          calls.push({ type: prop, args });
          return value.apply(target, args);
        };
      }
      return value;
    },
    set(target, prop: string, value) {
      calls.push({ type: `set:${prop}`, args: [value] });
      (target as any)[prop] = value;
      return true;
    },
  });
  (canvas as any).getContext = () => proxy;
  return calls;
};

/** paint position of the first fill in the given color */
const fillIndexOf = (calls: RecordedCall[], color: string) =>
  calls.findIndex(
    (call) => call.type === "set:fillStyle" && call.args[0] === color,
  );

/** paint position of an element drawn from its cached bitmap — a frame paints
 * itself on the canvas, plain elements are blitted.
 */
const bitmapIndexOf = (calls: RecordedCall[]) =>
  calls.findIndex((call) => call.type === "drawImage");

/** every fill the scene paints, whatever color it used */
const fillCalls = (calls: RecordedCall[]) =>
  calls.filter((call) => call.type === "fill" || call.type === "fillRect");

/** Renders the given elements into a recording canvas, like the editor does. */
const draw = (elements: NonDeletedExcalidrawElement[]) => {
  const scene = new Scene(elements, { skipValidation: true });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 500;
  const calls = recordContextCalls(canvas);

  renderStaticScene({
    canvas,
    rc: rough.canvas(canvas),
    scale: 1,
    elementsMap: toBrandedType<RenderableElementsMap>(arrayToMap(elements)),
    allElementsMap: scene.getNonDeletedElementsMap(),
    visibleElements: elements,
    appState: {
      ...getDefaultAppState(),
      width: 500,
      height: 500,
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 as NormalizedZoomValue },
    } as StaticCanvasAppState,
    renderConfig: {
      imageCache: new Map(),
      renderGrid: false,
      isExporting: false,
      canvasBackgroundColor: "#fff",
      embedsValidationStatus: new Map(),
      elementsPendingErasure: new Set(),
      pendingFlowchartNodes: null,
      theme: "light",
    },
  });

  return calls;
};

const frameElement = (
  id: string,
  {
    width = 300,
    height = 300,
    backgroundColor = BOARD_FILL,
  }: { width?: number; height?: number; backgroundColor?: string } = {},
) =>
  API.createElement({
    id,
    type: "frame",
    x: 0,
    y: 0,
    width,
    height,
    backgroundColor,
  });

describe("frame canvas rendering", () => {
  it("paints the board below the elements it contains", () => {
    const frame = frameElement("frame");
    const child = API.createElement({
      id: "child",
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      backgroundColor: "#ffc9c9",
      containerRef: { kind: "frameLike", elementId: frame.id },
    });

    // stored the way `addElementsToFrame` and imported scenes can have it:
    // the frame sits after the element it contains
    const calls = draw([child, frame]);
    const board = fillIndexOf(calls, BOARD_FILL);
    const childPaint = bitmapIndexOf(calls);

    expect(board).toBeGreaterThan(-1);
    expect(childPaint).toBeGreaterThan(board);
  });

  it("keeps covering elements stored below the board", () => {
    const frame = frameElement("frame");
    const below = API.createElement({
      id: "below",
      x: 40,
      y: 40,
      width: 100,
      height: 100,
      backgroundColor: "#a5d8ff",
    });

    const calls = draw([below, frame]);
    const belowPaint = bitmapIndexOf(calls);

    expect(belowPaint).toBeGreaterThan(-1);
    expect(fillIndexOf(calls, BOARD_FILL)).toBeGreaterThan(belowPaint);
  });

  it("paints no board for a frame left transparent", () => {
    const child = API.createElement({
      id: "child",
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      backgroundColor: "#ffc9c9",
    });
    const frame = frameElement("frame", {
      backgroundColor: "transparent",
    });

    // the frame only strokes its border, so it contributes no fill at all —
    // measured against the same scene without it, which also rules out the
    // canvas background fill
    expect(fillCalls(draw([child, frame]))).toHaveLength(
      fillCalls(draw([child])).length,
    );
    expect(bitmapIndexOf(draw([child, frame]))).toBeGreaterThan(-1);
  });
});
