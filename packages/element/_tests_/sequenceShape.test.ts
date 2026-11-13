import {
  DEFAULT_FONT_FAMILY,
  TABLE_CELL_TEXT_PADDING_X,
  TABLE_CELL_TEXT_PADDING_Y,
  getLineHeight,
  getVerticalOffset,
} from "@excalidraw/common";
import { lineSegment, pointFrom, pointRotateRads } from "@excalidraw/math";
import { RoughGenerator } from "roughjs/bin/generator";

import type { GlobalPoint, LocalPoint, Radians } from "@excalidraw/math";

import type { Zoom } from "@excalidraw/excalidraw/types";

import {
  BASIC_SHAPE_IDS,
  FLOWCHART_SHAPE_IDS,
  SEQUENCE_DEFAULT_POLE_LENGTH,
  SEQUENCE_HIT_HALF_WIDTH,
  SEQUENCE_LIFELINE_DEFAULT_WIDTHS,
  SEQUENCE_LIFELINE_HEAD_HEIGHTS,
  SEQUENCE_MIN_HEAD_HEIGHT,
  SEQUENCE_MIN_HEAD_WIDTH,
  SEQUENCE_MIN_POLE_LENGTH,
  SEQUENCE_SHAPE_IDS,
  SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT,
  SEQUENCE_FRAGMENT_HEADER_MIN_HEIGHT,
  SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT,
  SEQUENCE_FRAGMENT_ROW_DIVIDER_DASH,
  SEQUENCE_FRAGMENT_TAB_HEIGHT,
  SEQUENCE_FRAGMENT_TAB_WIDTH,
  SEQUENCE_FRAGMENT_TAB_MAX_RIGHT_INSET,
  createSequenceFragmentInitialRows,
  deleteSequenceFragmentRow,
  fitSequenceFragmentOperator,
  insertSequenceFragmentRow,
  moveSequenceFragmentRow,
  resizeSequenceFragmentRow,
  SHAPE_IDS,
  appendSequenceFragmentRow,
  assertShapeData,
  buildShapeData,
  clampSequenceLifelineHeight,
  drawSequenceLifeline,
  getActivationAnchor,
  getActivationAnchorAtSceneY,
  getCompositeShapeAnchors,
  getSequenceActivationAnchorLocalYs,
  getSequenceActivationAnchors,
  getCompositeShapeGeometry,
  getCompositeShapeSelectionFrame,
  getCompositeShapeTextBounds,
  getCompositeShapeTextFitMode,
  getSequenceElementBox,
  getSequenceLifelinePoleActivationPlacement,
  isActivationElement,
  isPointOnSequenceLifelinePole,
  SEQUENCE_ACTIVATION_HEIGHT,
  SEQUENCE_ACTIVATION_WIDTH,
  SEQUENCE_MIN_ACTIVATION_OFFSET,
  getSequenceFragmentResize,
  getSequenceFragmentRowLayout,
  getSequenceFragmentRowBounds,
  getSequenceFragmentRowBackgroundTextLayout,
  refitSequenceFragmentRowBackgroundTexts,
  fragmentRowContainerRef,
  getSequenceFragmentRowPaths,
  getSequenceFragmentTabPath,
  getSequenceFragmentTextBounds,
  getSequenceLifelineDefaultSize,
  getSequenceLifelineGeometry,
  getSequenceLifelineHitPaths,
  getSequenceLifelineTextBounds,
  getSequenceLifelineTextFit,
  getSequenceLifelineTextFitHeight,
  getSequencePoleLength,
  getSequencePolePath,
  hasCompositeShapeSelectionFrame,
  isPointInSequenceLifelineHead,
  isSequenceFragmentElement,
  isSequenceLifelineElement,
  isSequenceShapeId,
  isShapeElement,
  normalizeSequenceFragmentGeometry,
  normalizeSequenceLifelineGeometry,
  shapeElementType,
} from "../src/compositeShape";
import {
  flattenCompositeShapePath,
  getBaseRectangleOutline,
  getRoundedRectOutline,
  pathFromPoints,
} from "../src/compositeShape/outline";
import {
  getElementBounds,
  getElementLineSegments,
  getElementSelectionFrameCoords,
} from "../src/bounds";
import {
  resolveConnectionHitForArrowEndpoint,
  updateBoundElements,
} from "../src/binding";
import {
  intersectElementWithLineSegment,
  isPointInElement,
} from "../src/collision";
import { duplicateElement } from "../src/duplicate";
import { newElement, newArrowElement, newTextElement } from "../src/newElement";
import { Scene } from "../src/Scene";
import { getSequenceActivationDragPlacement } from "../src/sequenceActivation";
import { getTextVerticalOffset } from "../src/renderElement";
import {
  getSequenceActivationResize,
  getSequenceLifelineResize,
} from "../src/resizeElements";
import { generateRoughOptions } from "../src/shape";
import { isQuickCreateTargetElement } from "../src/quickCreate";
import { getLineHeightInPx } from "../src/textMeasurements";
import { isBindableElement } from "../src/typeChecks";
import { getTransformHandles } from "../src/transformHandles";
import { getTransformStatusReadout } from "../src/transformStatus";
import { convertToExcalidrawElements } from "../src/transform";

import type { SequenceLifelineId } from "../src/compositeShape";
import type {
  ElementsMap,
  ExcalidrawBindableElement,
  ExcalidrawShapeElement,
  SequenceFragmentData,
  SequenceShapeData,
} from "../src/types";
import type { NonDeleted, NonDeletedExcalidrawElement } from "../src/types";

const LIFELINE_IDS: readonly SequenceLifelineId[] = [
  "sc-lifeline-entity",
  "sc-lifeline-control",
  "sc-lifeline-boundary",
  "sc-lifeline-actor",
  "sc-lifeline-queue",
  "sc-lifeline-data-base",
  "sc-lifeline-object",
  "sc-lifeline-collection",
];

/** Measured label baselines of the sample (element-local y). */
const MEASURED_BASELINE: Partial<Record<SequenceLifelineId, number>> = {
  "sc-lifeline-queue": 36.095,
  "sc-lifeline-object": 36.095,
  "sc-lifeline-collection": 44.095,
  "sc-lifeline-data-base": 62.095,
};
const HEAD_BASELINE_GAP = 4.041;

const measuredBaseline = (id: SequenceLifelineId, headHeight: number) =>
  MEASURED_BASELINE[id] ?? headHeight - HEAD_BASELINE_GAP;

/** Default element size: head height plus the 360 dashed pole. */
const elementSize = (id: SequenceLifelineId, width: number) => ({
  width,
  height: SEQUENCE_LIFELINE_HEAD_HEIGHTS[id] + SEQUENCE_DEFAULT_POLE_LENGTH,
});

const makeElement = (
  id: SequenceLifelineId | "sc-activation" | "sc-fragment",
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
): ExcalidrawShapeElement => {
  const element = newElement({
    type: id,
    x: 0,
    y: 0,
    width,
    height,
    backgroundColor: "#f0f4fc",
    fillStyle: "solid",
    ...extra,
  });
  if (!isShapeElement(element)) {
    throw new Error("Expected a shape element");
  }
  return element;
};

/** Fragment element with persisted row data (or none for the legacy box). */
const makeFragmentElement = (
  width: number,
  height: number,
  fragment?: SequenceFragmentData,
): ExcalidrawShapeElement => {
  const shape: SequenceShapeData = {
    id: "sc-fragment",
    schemaVersion: 1,
    ...(fragment ? { fragment } : {}),
  };
  const element = newElement({
    type: "sequence",
    x: 0,
    y: 0,
    width,
    height,
    shape,
  });
  if (!isShapeElement(element)) {
    throw new Error("Expected a shape element");
  }
  return element;
};

/** Runs the id's registration `draw` without the shape-cache type map. */
const drawShape = (element: ExcalidrawShapeElement) => {
  const drawables = drawSequenceLifeline({
    generator: new RoughGenerator(),
    element,
    geometry: getCompositeShapeGeometry(element),
    options: (continuousPath) =>
      generateRoughOptions(element, continuousPath, false),
    shadeFill: (fill) => fill,
  });
  return Array.isArray(drawables) ? drawables : [drawables];
};

const elementsMapFor = (...elements: ExcalidrawShapeElement[]): ElementsMap =>
  new Map(elements.map((element) => [element.id, element])) as ElementsMap;

describe("sequence shape data", () => {
  it("maps every sequence id to the sequence element type", () => {
    expect(SEQUENCE_SHAPE_IDS).toHaveLength(10);
    expect(SHAPE_IDS).toHaveLength(53);
    for (const id of SEQUENCE_SHAPE_IDS) {
      expect(isSequenceShapeId(id)).toBe(true);
      expect(shapeElementType(id)).toBe("sequence");
    }
  });

  it("keeps the three families disjoint and exhaustive", () => {
    const overlap = (a: readonly string[], b: readonly string[]) =>
      a.filter((id) => b.includes(id));
    expect(overlap(BASIC_SHAPE_IDS, FLOWCHART_SHAPE_IDS)).toEqual([]);
    expect(overlap(BASIC_SHAPE_IDS, SEQUENCE_SHAPE_IDS)).toEqual([]);
    expect(overlap(FLOWCHART_SHAPE_IDS, SEQUENCE_SHAPE_IDS)).toEqual([]);
    expect([
      ...BASIC_SHAPE_IDS,
      ...FLOWCHART_SHAPE_IDS,
      ...SEQUENCE_SHAPE_IDS,
    ]).toEqual([...SHAPE_IDS]);
  });

  it("creates sequence elements from a bare shape id", () => {
    for (const id of SEQUENCE_SHAPE_IDS) {
      expect(makeElement(id, 64, 428.272)).toMatchObject({
        type: "sequence",
        shape: { id },
      });
    }
  });

  it("persists the sampled head height per lifeline id", () => {
    const expected: Record<SequenceLifelineId, number> = {
      "sc-lifeline-entity": 68.272,
      "sc-lifeline-control": 74.272,
      "sc-lifeline-boundary": 68.272,
      "sc-lifeline-actor": 118.272,
      "sc-lifeline-queue": 60,
      "sc-lifeline-data-base": 90,
      "sc-lifeline-object": 60,
      "sc-lifeline-collection": 68,
    };
    expect(SEQUENCE_LIFELINE_HEAD_HEIGHTS).toEqual(expected);
    for (const id of LIFELINE_IDS) {
      expect(buildShapeData(id)).toMatchObject({
        lifeline: { headHeight: expected[id] },
      });
    }
    // parameterless ids carry no persisted params
    expect(buildShapeData("sc-activation")).toEqual({
      id: "sc-activation",
      schemaVersion: 1,
    });
    expect(buildShapeData("sc-fragment")).toEqual({
      id: "sc-fragment",
      schemaVersion: 1,
    });
  });
});

describe("sequence outline envelope", () => {
  it.each(LIFELINE_IDS)(
    "%s declares the whole element box as its outline",
    (id) => {
      const { width, height } = elementSize(id, 80);
      const element = makeElement(id, width, height);
      const { outline } = getCompositeShapeGeometry(element);
      expect(outline).toEqual(getBaseRectangleOutline(width, height, 0));
      expect(outline.closed).toBe(true);
    },
  );

  it("gives the fragment the element box as its outline", () => {
    const element = makeElement("sc-fragment", 400, 240);
    const { outline, details, fillFaces } = getCompositeShapeGeometry(element);
    expect(outline).toEqual(getSequenceElementBox(400, 240));
    expect(details[0]).toEqual(getSequenceFragmentTabPath(400, 240));
    expect(fillFaces?.map(({ tone }) => tone)).toEqual(["base"]);
    expect(fillFaces?.[0].path).toEqual(getSequenceFragmentTabPath(400, 240));
  });

  it("gives activation a rounded-rect outline filling the box", () => {
    const element = makeElement("sc-activation", 30, 100);
    const { outline } = getCompositeShapeGeometry(element);
    expect(outline).toEqual(getRoundedRectOutline(30, 100, 5));
  });
});

describe("sequence lifeline pole", () => {
  it.each(LIFELINE_IDS)("%s starts the pole at the head bottom", (id) => {
    const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
    const { width, height } = elementSize(id, 80);
    const pole = getSequencePolePath(width, headHeight, height);
    expect(pole.start).toEqual([width / 2, headHeight]);
    expect(pole.commands).toEqual([{ type: "line", to: [width / 2, height] }]);
    expect(pole.closed).toBe(false);
  });

  it("derives the pole end from the element height", () => {
    const pole = getSequencePolePath(64, 68.272, 500);
    expect(pole.commands).toEqual([{ type: "line", to: [32, 500] }]);
  });

  it("clamps the derived pole length to the minimum", () => {
    expect(getSequencePoleLength(80, 68.272)).toBe(SEQUENCE_MIN_POLE_LENGTH);
    expect(getSequencePoleLength(500, 68.272)).toBeCloseTo(431.728);
  });

  it.each(LIFELINE_IDS)("%s draws a dashed, centered pole", (id) => {
    const { width, height } = elementSize(id, 80);
    const element = makeElement(id, width, height);
    const drawables = drawShape(element);
    const pole = drawables[drawables.length - 1];
    expect(pole.options.strokeLineDash).toEqual([4, 4]);
    expect(pole.options.disableMultiStroke).toBe(true);
  });

  it("keeps the pole out of the details paths", () => {
    const { width, height } = elementSize("sc-lifeline-entity", 64);
    const element = makeElement("sc-lifeline-entity", width, height);
    const { details } = getCompositeShapeGeometry(element);
    const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"];
    expect(details.some((path) => path.start[1] >= headHeight)).toBe(false);
  });
});

describe("sequence lifeline geometry invariants", () => {
  it("raises a too-short element to headHeight + MIN_POLE", () => {
    const element = makeElement("sc-lifeline-entity", 64, 80);
    const normalized = normalizeSequenceLifelineGeometry(element);
    expect(normalized.height).toBeCloseTo(
      SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"] +
        SEQUENCE_MIN_POLE_LENGTH,
    );
  });

  it("returns the same element when the invariant already holds", () => {
    const { width, height } = elementSize("sc-lifeline-entity", 64);
    const element = makeElement("sc-lifeline-entity", width, height);
    expect(normalizeSequenceLifelineGeometry(element)).toBe(element);
  });

  it("leaves activation and fragment untouched", () => {
    const activation = makeElement("sc-activation", 30, 10);
    const fragment = makeElement("sc-fragment", 400, 10);
    expect(normalizeSequenceLifelineGeometry(activation)).toBe(activation);
    expect(normalizeSequenceLifelineGeometry(fragment)).toBe(fragment);
  });

  it("provides the default size from the sampled constants", () => {
    for (const id of LIFELINE_IDS) {
      expect(getSequenceLifelineDefaultSize(id)).toEqual({
        width: SEQUENCE_LIFELINE_DEFAULT_WIDTHS[id],
        height:
          SEQUENCE_LIFELINE_HEAD_HEIGHTS[id] + SEQUENCE_DEFAULT_POLE_LENGTH,
      });
    }
  });
});

describe("sequence lifeline hit geometry", () => {
  const { width, height } = elementSize("sc-lifeline-entity", 64);
  const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"];
  const element = makeElement("sc-lifeline-entity", width, height);
  const elementsMap = elementsMapFor(element);

  it("declares the head rectangle plus the pole corridor", () => {
    const paths = getSequenceLifelineHitPaths(width, headHeight, height);
    expect(paths).toEqual([
      pathFromPoints(
        [
          [0, 0],
          [width, 0],
          [width, headHeight],
          [0, headHeight],
        ],
        true,
      ),
      pathFromPoints(
        [
          [width / 2 - SEQUENCE_HIT_HALF_WIDTH, headHeight],
          [width / 2 + SEQUENCE_HIT_HALF_WIDTH, headHeight],
          [width / 2 + SEQUENCE_HIT_HALF_WIDTH, height],
          [width / 2 - SEQUENCE_HIT_HALF_WIDTH, height],
        ],
        true,
      ),
    ]);
    expect(getCompositeShapeGeometry(element).hitPaths).toHaveLength(2);
  });

  it("keeps the whole element box as the outline and bounds", () => {
    expect(getCompositeShapeGeometry(element).outline).toEqual(
      getBaseRectangleOutline(width, height, 0),
    );
    expect(getElementBounds(element, elementsMap)).toEqual([
      0,
      0,
      width,
      height,
    ]);
  });

  it("hits the head and the pole but not the empty box", () => {
    const point = (x: number, y: number) => pointFrom<GlobalPoint>(x, y);
    expect(isPointInElement(point(width / 2, 30), element, elementsMap)).toBe(
      true,
    );
    expect(isPointInElement(point(width / 2, 200), element, elementsMap)).toBe(
      true,
    );
    expect(isPointInElement(point(5, 200), element, elementsMap)).toBe(false);
    expect(isPointInElement(point(5, 100), element, elementsMap)).toBe(false);
    expect(
      isPointInElement(
        point(width / 2 + SEQUENCE_HIT_HALF_WIDTH + 2, 200),
        element,
        elementsMap,
      ),
    ).toBe(false);
  });

  it("intersects the pole corridor for lasso/eraser segments", () => {
    const segment = lineSegment(
      pointFrom<GlobalPoint>(0, 200),
      pointFrom<GlobalPoint>(100, 200),
    );
    const hits = intersectElementWithLineSegment(element, elementsMap, segment);
    expect(hits).toHaveLength(2);
    expect(hits.map(([x]) => x).sort((a, b) => a - b)).toEqual([
      width / 2 - SEQUENCE_HIT_HALF_WIDTH,
      width / 2 + SEQUENCE_HIT_HALF_WIDTH,
    ]);
  });

  it("exposes both hit rectangles as line segments", () => {
    expect(getElementLineSegments(element, elementsMap)).toHaveLength(8);
  });
});

describe("sequence lifeline selection frame", () => {
  const { width, height } = elementSize("sc-lifeline-entity", 64);
  const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"];
  const element = makeElement("sc-lifeline-entity", width, height);
  const elementsMap = elementsMapFor(element);

  it("uses the head box instead of the full element box", () => {
    expect(getCompositeShapeSelectionFrame(element)).toEqual({
      x: 0,
      y: 0,
      width,
      height: headHeight,
    });
    expect(hasCompositeShapeSelectionFrame(element)).toBe(true);
    expect(getElementSelectionFrameCoords(element, elementsMap)).toEqual([
      0,
      0,
      width,
      headHeight,
      width / 2,
      height / 2,
    ]);
  });

  it("leaves activation and fragment on the full box", () => {
    const activation = makeElement("sc-activation", 30, 100);
    const fragment = makeElement("sc-fragment", 400, 240);
    expect(hasCompositeShapeSelectionFrame(activation)).toBe(false);
    expect(hasCompositeShapeSelectionFrame(fragment)).toBe(false);
    expect(getCompositeShapeSelectionFrame(activation)).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 100,
    });
  });

  it("puts resize handles on the head and omits rotation", () => {
    const handles = getTransformHandles(
      element,
      { value: 1 } as unknown as Zoom,
      elementsMap,
      "mouse",
      {},
    );
    expect(handles.rotation).toBeUndefined();
    expect(handles.n).toBeDefined();
    expect(handles.s).toBeDefined();
    expect(handles.e).toBeDefined();
    expect(handles.w).toBeDefined();
    // The south handle sits at the head bottom, not at the pole end.
    expect(handles.s![1]).toBeGreaterThan(headHeight - 10);
    expect(handles.s![1]).toBeLessThan(headHeight + 20);
    expect(handles.s![1]).toBeLessThan(height / 2);
  });

  it("reports head dimensions in the transform readout", () => {
    expect(
      getTransformStatusReadout({
        gesture: "scale",
        hoveredHandle: null,
        selectedElements: [element as NonDeletedExcalidrawElement],
        elementsMap,
      }),
    ).toEqual({ kind: "size", text: "64 × 68" });
  });
});

describe("sequence lifeline custom resize", () => {
  const width = 64;
  const height =
    SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"] +
    SEQUENCE_DEFAULT_POLE_LENGTH;
  const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"];

  const resize = (
    handle: Parameters<typeof getSequenceLifelineResize>[1],
    x: number,
    y: number,
  ) => {
    const result = getSequenceLifelineResize(
      makeElement("sc-lifeline-entity", width, height),
      handle,
      x,
      y,
    );
    if (!result) {
      throw new Error("Expected a sequence lifeline resize result");
    }
    return result;
  };

  it("changes width only from the east handle", () => {
    const result = resize("e", width + 20, headHeight / 2);
    expect(result).toMatchObject({
      x: 0,
      y: 0,
      width: width + 20,
      height,
      headHeight,
    });
    // The pole remains centered on the resized head.
    const pole = getSequencePolePath(
      result.width,
      result.headHeight,
      result.height,
    );
    expect(pole.start[0]).toBeCloseTo(result.width / 2);
  });

  it("keeps the opposite edge fixed from the west handle", () => {
    const result = resize("w", -20, headHeight / 2);
    expect(result).toMatchObject({
      x: -20,
      y: 0,
      width: width + 20,
      height,
      headHeight,
    });
  });

  it("moves the head top without changing the pole length from n", () => {
    const result = resize("n", width / 2, 10);
    expect(result.x).toBe(0);
    expect(result.y).toBeCloseTo(10);
    expect(result.width).toBe(width);
    expect(result.headHeight).toBeCloseTo(headHeight - 10);
    expect(result.height).toBeCloseTo(height - 10);
  });

  it("moves the head bottom and shortens the pole from s", () => {
    const result = resize("s", width / 2, headHeight + 10);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(width);
    expect(result.headHeight).toBeCloseTo(headHeight + 10);
    expect(result.height).toBe(height);
  });

  it("clamps the s handle to keep the minimum pole", () => {
    const result = resize("s", width / 2, 500);
    expect(result.headHeight).toBeCloseTo(height - SEQUENCE_MIN_POLE_LENGTH);
    expect(result.height).toBe(height);
  });

  it("clamps the n handle to the minimum head height", () => {
    const result = resize("n", width / 2, headHeight + 100);
    expect(result.headHeight).toBe(SEQUENCE_MIN_HEAD_HEIGHT);
    expect(result.y).toBeCloseTo(headHeight - SEQUENCE_MIN_HEAD_HEIGHT);
    expect(result.height).toBeCloseTo(
      SEQUENCE_MIN_HEAD_HEIGHT + (height - headHeight),
    );
  });

  it("clamps the width to the minimum head width", () => {
    const result = resize("e", -100, headHeight / 2);
    expect(result.width).toBe(SEQUENCE_MIN_HEAD_WIDTH);
    expect(result.x).toBe(0);
  });

  it("combines width and head height on a corner", () => {
    const result = resize("se", width + 20, headHeight + 10);
    expect(result).toMatchObject({
      x: 0,
      y: 0,
      width: width + 20,
      height,
      headHeight: headHeight + 10,
    });
  });

  it("keeps the opposite head anchor fixed under rotation", () => {
    const angle = Math.PI / 2;
    const rotated = makeElement("sc-lifeline-entity", width, height, {
      x: 100,
      y: 100,
      angle,
    });
    const center = [100 + width / 2, 100 + height / 2];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const oldRel = [0 - width / 2, headHeight / 2 - height / 2];
    const oldAnchor = [
      center[0] + oldRel[0] * cos - oldRel[1] * sin,
      center[1] + oldRel[0] * sin + oldRel[1] * cos,
    ];
    const pointer = [
      oldAnchor[0] + (width + 20) * cos,
      oldAnchor[1] + (width + 20) * sin,
    ];
    const result = getSequenceLifelineResize(
      rotated,
      "e",
      pointer[0],
      pointer[1],
    );
    if (!result) {
      throw new Error("Expected a rotated lifeline resize result");
    }
    expect(result.width).toBeCloseTo(width + 20);
    const newCenter = [
      result.x + result.width / 2,
      result.y + result.height / 2,
    ];
    const newRel = [
      0 - result.width / 2,
      result.headHeight / 2 - result.height / 2,
    ];
    const newAnchor = [
      newCenter[0] + newRel[0] * cos - newRel[1] * sin,
      newCenter[1] + newRel[0] * sin + newRel[1] * cos,
    ];
    expect(newAnchor[0]).toBeCloseTo(oldAnchor[0]);
    expect(newAnchor[1]).toBeCloseTo(oldAnchor[1]);
  });
});

describe("sequence lifeline pole control", () => {
  it("clamps the element height to the minimum pole", () => {
    expect(
      clampSequenceLifelineHeight(
        SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"],
        10,
      ),
    ).toBe(
      SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"] +
        SEQUENCE_MIN_POLE_LENGTH,
    );
    expect(clampSequenceLifelineHeight(68.272, 500)).toBe(500);
  });

  it("only opens text editing inside the head", () => {
    const { width, height } = elementSize("sc-lifeline-entity", 64);
    const element = makeElement("sc-lifeline-entity", width, height);
    expect(isPointInSequenceLifelineHead(element, width / 2, 30)).toBe(true);
    expect(
      isPointInSequenceLifelineHead(
        element,
        width / 2,
        SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"] + 10,
      ),
    ).toBe(false);
  });
});

describe("sequence lifeline default creation", () => {
  it("uses the sampled size when dimensions are omitted", () => {
    const [element] = convertToExcalidrawElements([
      { type: "sc-lifeline-entity", x: 0, y: 0 },
    ]);
    if (element.type !== "sequence") {
      throw new Error("Expected a sequence element");
    }
    expect(element.width).toBe(
      SEQUENCE_LIFELINE_DEFAULT_WIDTHS["sc-lifeline-entity"],
    );
    expect(element.height).toBeCloseTo(
      SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"] +
        SEQUENCE_DEFAULT_POLE_LENGTH,
    );
  });

  it("grows the head upward for a long label while keeping the pole", () => {
    const [element] = convertToExcalidrawElements([
      {
        type: "sc-lifeline-entity",
        x: 0,
        y: 0,
        label: {
          text: "一个非常非常长的生命线标签，用来验证自动适配只撑高头部而不拉长杆",
        },
      },
    ]);
    if (!isSequenceLifelineElement(element)) {
      throw new Error("Expected a sequence lifeline");
    }
    const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"];
    expect(getCompositeShapeTextFitMode(element)).toBe("auto");
    expect(element.width).toBe(
      SEQUENCE_LIFELINE_DEFAULT_WIDTHS["sc-lifeline-entity"],
    );
    // The head grew...
    expect(element.shape.lifeline.headHeight).toBeGreaterThan(baseHeadHeight);
    // ...its bottom stayed where it was (height grew by the same amount)...
    expect(element.y + element.shape.lifeline.headHeight).toBeCloseTo(
      baseHeadHeight,
      6,
    );
    // ...and the pole length is unchanged.
    expect(element.height - element.shape.lifeline.headHeight).toBeCloseTo(
      SEQUENCE_DEFAULT_POLE_LENGTH,
      6,
    );
  });
});

describe("sequence lifeline head geometry", () => {
  it("draws the entity glyph centered with its underline", () => {
    const { head, attachments } = getSequenceLifelineGeometry(
      "sc-lifeline-entity",
      64,
      68.272,
    );
    expect(head).toHaveLength(1);
    expect(head[0].start).toEqual([51, 20]);
    expect(attachments[0].start).toEqual([12, 40]);
    expect(attachments[0].commands).toEqual([{ type: "line", to: [52, 40] }]);
  });

  it("centers the boundary glyph on a wider box", () => {
    const { head, attachments } = getSequenceLifelineGeometry(
      "sc-lifeline-boundary",
      120,
      68.272,
    );
    // circle center x = width / 2 + 6
    expect(head[0].start).toEqual([85, 20]);
    expect(attachments[0].start).toEqual([35, 2]);
    expect(attachments[1].start).toEqual([35, 20]);
  });

  it("scales the queue head box to the element width and head height", () => {
    const { head, attachments } = getSequenceLifelineGeometry(
      "sc-lifeline-queue",
      50,
      30,
    );
    expect(head[0].start).toEqual([42, 0]);
    expect(head[0].commands[2]).toEqual({ type: "line", to: [8, 30] });
    expect(attachments[0].start[0]).toBeCloseTo(42.5);
  });

  it("fills the object head box with a r7 rounded rect", () => {
    const { head, attachments } = getSequenceLifelineGeometry(
      "sc-lifeline-object",
      120,
      60,
    );
    expect(head[0]).toEqual(getRoundedRectOutline(120, 60, 7));
    expect(attachments).toEqual([]);
  });

  it("stacks the collection's two cards back to front", () => {
    const { head } = getSequenceLifelineGeometry(
      "sc-lifeline-collection",
      118,
      68,
    );
    expect(head).toHaveLength(2);
    expect(head[0].start).toEqual([12, 0]); // back card (offset 8,0; r4)
    expect(head[1].start).toEqual([4, 8]); // front card (offset 0,8; r4)
  });
});

describe("sequence label text area", () => {
  it.each(LIFELINE_IDS)("%s keeps its text area inside the head box", (id) => {
    const { width } = elementSize(id, 80);
    const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
    const bounds = getSequenceLifelineTextBounds(id, width, headHeight);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1e-6);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(headHeight + 1e-6);
  });

  it.each(LIFELINE_IDS)(
    "%s keeps its text area inside a shrunken head",
    (id) => {
      const bounds = getSequenceLifelineTextBounds(
        id,
        64,
        SEQUENCE_MIN_HEAD_HEIGHT,
      );
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        SEQUENCE_MIN_HEAD_HEIGHT + 1e-6,
      );
    },
  );

  it.each(LIFELINE_IDS)(
    "%s renders its label baseline on the measured sample line",
    (id) => {
      const { width, height } = elementSize(id, 80);
      const [element, text] = convertToExcalidrawElements([
        {
          type: id,
          x: 0,
          y: 0,
          width,
          height,
          label: { text: "标签", fontSize: 14 },
        },
      ]);
      if (element.type !== "sequence" || !text || text.type !== "text") {
        throw new Error("Expected a bound-text sequence element");
      }
      const lineHeightPx = getLineHeightInPx(text.fontSize, text.lineHeight);
      const baseline =
        text.y -
        element.y +
        getTextVerticalOffset(
          text.verticalAlign,
          text.height,
          1,
          lineHeightPx,
        ) +
        getVerticalOffset(text.fontFamily, text.fontSize, lineHeightPx);
      const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      expect(
        Math.abs(baseline - measuredBaseline(id, headHeight)),
      ).toBeLessThan(1);
    },
  );

  it("exposes the lifeline band through the registry", () => {
    const { width, height } = elementSize("sc-lifeline-entity", 64);
    const element = makeElement("sc-lifeline-entity", width, height);
    expect(getCompositeShapeTextBounds(element)).toEqual(
      getSequenceLifelineTextBounds(
        "sc-lifeline-entity",
        width,
        SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"],
      ),
    );
  });
});

describe("sequence lifeline adaptive text fit", () => {
  const sampleLineHeight = getLineHeightInPx(
    14,
    getLineHeight(DEFAULT_FONT_FAMILY),
  );

  it.each(LIFELINE_IDS)(
    "%s extends the text band upward as the head grows",
    (id) => {
      const { width } = elementSize(id, 80);
      const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      const base = getSequenceLifelineTextBounds(id, width, baseHeadHeight);
      const grown = getSequenceLifelineTextBounds(
        id,
        width,
        baseHeadHeight + 30,
      );
      expect(grown.x).toBe(base.x);
      expect(grown.width).toBe(base.width);
      expect(grown.y).toBeCloseTo(base.y, 6);
      expect(grown.height).toBeCloseTo(base.height + 30, 6);
    },
  );

  it.each(LIFELINE_IDS)(
    "%s keeps the sampled head height for a single line",
    (id) => {
      const { width } = elementSize(id, 80);
      const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      const base = getSequenceLifelineTextBounds(id, width, baseHeadHeight);
      expect(
        getSequenceLifelineTextFitHeight(
          id,
          width,
          sampleLineHeight,
          baseHeadHeight,
        ),
      ).toBeCloseTo(baseHeadHeight, 6);
      // Two lines add exactly one more line box to the head...
      const twoLines = getSequenceLifelineTextFitHeight(
        id,
        width,
        sampleLineHeight * 2,
        baseHeadHeight,
      );
      expect(twoLines).toBeCloseTo(
        baseHeadHeight + sampleLineHeight * 2 - base.height,
        6,
      );
      // ...and the preserved minimum keeps it from shrinking back further.
      expect(
        getSequenceLifelineTextFitHeight(id, width, sampleLineHeight, twoLines),
      ).toBeCloseTo(twoLines, 6);
    },
  );

  it.each(LIFELINE_IDS)(
    "%s grows only the head, keeping the pole and head bottom fixed",
    (id) => {
      const { width, height } = elementSize(id, 80);
      const element = makeElement(id, width, height);
      if (!isSequenceLifelineElement(element)) {
        throw new Error("Expected a sequence lifeline");
      }
      const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      const fit = getSequenceLifelineTextFit(
        element,
        sampleLineHeight * 3,
        baseHeadHeight,
      );
      if (!fit) {
        throw new Error("Expected the label to grow the head");
      }
      expect(fit.headHeight).toBeGreaterThan(baseHeadHeight);
      expect(fit.height - fit.headHeight).toBeCloseTo(
        SEQUENCE_DEFAULT_POLE_LENGTH,
        6,
      );
      expect(fit.y + fit.headHeight).toBeCloseTo(element.y + baseHeadHeight, 6);
      expect(fit.x).toBeCloseTo(element.x, 6);
    },
  );

  it.each(LIFELINE_IDS)(
    "%s keeps the head-bottom anchor fixed when rotated",
    (id) => {
      const { width, height } = elementSize(id, 80);
      const angle = 0.7 as Radians;
      const element = makeElement(id, width, height, { angle });
      if (!isSequenceLifelineElement(element)) {
        throw new Error("Expected a sequence lifeline");
      }
      const baseHeadHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      const fit = getSequenceLifelineTextFit(
        element,
        sampleLineHeight * 3,
        baseHeadHeight,
      );
      if (!fit) {
        throw new Error("Expected the label to grow the head");
      }
      const oldCenter = pointFrom<GlobalPoint>(
        element.x + element.width / 2,
        element.y + element.height / 2,
      );
      const newCenter = pointFrom<GlobalPoint>(
        fit.x + element.width / 2,
        fit.y + fit.height / 2,
      );
      const oldAnchor = pointRotateRads(
        pointFrom<GlobalPoint>(
          element.x + element.width / 2,
          element.y + baseHeadHeight,
        ),
        oldCenter,
        angle,
      );
      const newAnchor = pointRotateRads(
        pointFrom<GlobalPoint>(
          fit.x + element.width / 2,
          fit.y + fit.headHeight,
        ),
        newCenter,
        angle,
      );
      expect(newAnchor[0]).toBeCloseTo(oldAnchor[0], 6);
      expect(newAnchor[1]).toBeCloseTo(oldAnchor[1], 6);
    },
  );
});

describe("sequence draw pipeline", () => {
  it("fills the fragment tab through the shaded-face drawing", () => {
    const element = makeElement("sc-fragment", 400, 240, {
      backgroundColor: "#f5f5f5",
    });
    const { fillFaces, details, outline } = getCompositeShapeGeometry(element);
    // the tab is the only filled face; the outer box stays stroke-only
    expect(fillFaces).toEqual([
      { path: getSequenceFragmentTabPath(400, 240), tone: "base" },
    ]);
    expect(fillFaces?.[0].path.closed).toBe(true);
    expect(details).toEqual([getSequenceFragmentTabPath(400, 240)]);
    expect(outline).toEqual(getSequenceElementBox(400, 240));
  });

  it("fills the lifeline head glyph with the element background", () => {
    const { width, height } = elementSize("sc-lifeline-entity", 64);
    const element = makeElement("sc-lifeline-entity", width, height);
    const drawables = drawShape(element);
    expect(drawables[0].options.fill).toBe("#f0f4fc");
  });
});

describe("sequence fragment rows", () => {
  const rows = (...heights: number[]) =>
    heights.map((height, index) => ({ id: `row-${index}`, height }));
  const normalizeFragment = (element: ExcalidrawShapeElement) =>
    normalizeSequenceFragmentGeometry(element) as ExcalidrawShapeElement & {
      shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
    };

  it("initializes a label-less fragment with a header row and one body row", () => {
    const element = makeElement("sc-fragment", 400, 240);
    expect(isSequenceFragmentElement(element)).toBe(true);
    expect(
      isSequenceFragmentElement(makeElement("sc-activation", 30, 100)),
    ).toBe(false);
    expect(getSequenceFragmentRowLayout(240, undefined)).toEqual({
      rows: [],
      separators: [],
    });
    expect(getSequenceFragmentRowPaths(400, 240, undefined)).toEqual([]);
    const normalized = normalizeFragment(element);
    expect(normalized).not.toBe(element);
    expect(normalized.textFitMode).toBe("fixed");
    expect(normalized.shape.fragment?.rows.map((row) => row.height)).toEqual([
      SEQUENCE_FRAGMENT_TAB_HEIGHT,
      240 - SEQUENCE_FRAGMENT_TAB_HEIGHT,
    ]);
    expect(
      normalized.shape.fragment?.rows.reduce((sum, row) => sum + row.height, 0),
    ).toBeCloseTo(240, 6);
    const appended = appendSequenceFragmentRow(element);
    expect(appended).toMatchObject({
      height: 240 + SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT,
    });
    expect(appended?.shape.fragment?.rows.map((row) => row.height)).toEqual([
      SEQUENCE_FRAGMENT_TAB_HEIGHT,
      240 - SEQUENCE_FRAGMENT_TAB_HEIGHT,
      SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT,
    ]);
  });

  it("seeds two body rows for the else preset", () => {
    const rows = createSequenceFragmentInitialRows(240, 2);
    expect(rows).toHaveLength(3);
    expect(rows[0].height).toBe(SEQUENCE_FRAGMENT_TAB_HEIGHT);
    const body = 240 - SEQUENCE_FRAGMENT_TAB_HEIGHT;
    expect(rows[1].height).toBeCloseTo(body / 2, 6);
    expect(rows[2].height).toBeCloseTo(body / 2, 6);
    expect(rows.reduce((sum, row) => sum + row.height, 0)).toBeCloseTo(240, 6);
  });

  it("inserts a condition row at a boundary with the header staying first", () => {
    const element = normalizeFragment(makeElement("sc-fragment", 400, 240));
    const before = element.shape.fragment?.rows ?? [];
    const update = insertSequenceFragmentRow(element, 1);
    if (!update) {
      throw new Error("Expected a fragment row insertion");
    }
    const rows = update.shape.fragment?.rows ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe(before[0].id);
    expect(rows[1].id).toBe(update.rowId);
    expect(rows[2].id).toBe(before[1].id);
    expect(rows[1].height).toBe(SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT);
    expect(update.height).toBe(240 + SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT);
    expect(rows.reduce((sum, row) => sum + row.height, 0)).toBeCloseTo(
      update.height,
      6,
    );
  });

  it("resizes a row and moves the fragment bottom with it", () => {
    const element = normalizeFragment(makeElement("sc-fragment", 400, 240));
    const body = element.shape.fragment?.rows[1];
    if (!body) {
      throw new Error("Expected a body row");
    }
    const update = resizeSequenceFragmentRow(
      element,
      body.id,
      body.height + 40,
    );
    if (!update) {
      throw new Error("Expected a fragment row resize");
    }
    expect(update.shape.fragment?.rows[1].height).toBeCloseTo(
      body.height + 40,
      6,
    );
    expect(update.height).toBeCloseTo(280, 6);
  });

  it("never resizes the header below the tab height", () => {
    const element = normalizeFragment(makeElement("sc-fragment", 400, 240));
    const header = element.shape.fragment?.rows[0];
    if (!header) {
      throw new Error("Expected a header row");
    }
    const update = resizeSequenceFragmentRow(element, header.id, 1);
    if (!update) {
      throw new Error("Expected a fragment row resize");
    }
    expect(update.shape.fragment?.rows[0].height).toBe(
      SEQUENCE_FRAGMENT_HEADER_MIN_HEIGHT,
    );
    expect(update.height).toBeCloseTo(
      240 - header.height + SEQUENCE_FRAGMENT_HEADER_MIN_HEIGHT,
      6,
    );
  });

  it("reorders body rows but never the header", () => {
    const element = normalizeFragment(makeElement("sc-fragment", 400, 240));
    const first = insertSequenceFragmentRow(element, 1);
    if (!first) {
      throw new Error("Expected a fragment row insertion");
    }
    const nextElement = {
      ...element,
      height: first.height,
      shape: first.shape,
    } as ExcalidrawShapeElement & {
      shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
    };
    const second = insertSequenceFragmentRow(nextElement, 2);
    if (!second) {
      throw new Error("Expected a second fragment row insertion");
    }
    const withTwo = {
      ...nextElement,
      height: second.height,
      shape: second.shape,
    } as ExcalidrawShapeElement & {
      shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
    };
    const rows = withTwo.shape.fragment?.rows ?? [];
    const moved = moveSequenceFragmentRow(withTwo, rows[rows.length - 1].id, 1);
    if (!moved) {
      throw new Error("Expected a fragment row move");
    }
    expect(moved.shape.fragment?.rows[0].id).toBe(rows[0].id);
    expect(moved.shape.fragment?.rows[1].id).toBe(rows[rows.length - 1].id);
    expect(moved.height).toBe(withTwo.height);
    expect(moveSequenceFragmentRow(withTwo, rows[0].id, 1)).toBeNull();
  });

  it("deletes body rows but not the header", () => {
    const element = normalizeFragment(makeElement("sc-fragment", 400, 240));
    const rows = element.shape.fragment?.rows ?? [];
    const update = deleteSequenceFragmentRow(element, rows[1].id);
    if (!update) {
      throw new Error("Expected a fragment row deletion");
    }
    expect(update.shape.fragment?.rows).toHaveLength(1);
    expect(update.height).toBeCloseTo(rows[0].height, 6);
    expect(deleteSequenceFragmentRow(element, rows[0].id)).toBeNull();
  });

  it("does not offer quick-create handles on any sequence shape", () => {
    expect(
      isQuickCreateTargetElement(makeElement("sc-fragment", 400, 240)),
    ).toBe(false);
    expect(
      isQuickCreateTargetElement(makeElement("sc-activation", 30, 100)),
    ).toBe(false);
    expect(
      isQuickCreateTargetElement(makeElement("sc-lifeline-entity", 64, 428)),
    ).toBe(false);
  });

  it("keeps the tab label to one line", () => {
    const bounds = getSequenceFragmentTextBounds(400, 240);
    // a 14px default-font line is ~17.5px; the band must not fit two lines
    expect(bounds.height).toBeLessThan(2 * 17.5);
  });

  it("grows the operator tab width before wrapping", () => {
    const fragment = normalizeFragment(makeElement("sc-fragment", 400, 240));
    const text = newTextElement({
      x: 0,
      y: 0,
      text: "Opt / Loop",
      fontSize: 14,
      fontFamily: DEFAULT_FONT_FAMILY,
    });
    const fit = fitSequenceFragmentOperator(fragment, text);
    if (!fit) {
      throw new Error("Expected an operator fit");
    }
    expect(fit.shape.fragment?.operatorWidth).toBeGreaterThanOrEqual(
      SEQUENCE_FRAGMENT_TAB_WIDTH,
    );
    // a short label stays on one line and keeps the sample tab height
    expect(fit.shape.fragment?.rows[0].height).toBeCloseTo(
      SEQUENCE_FRAGMENT_TAB_HEIGHT,
      6,
    );
    expect(fit.height).toBeCloseTo(240, 6);
  });

  it("wraps the operator once the tab reaches its max width", () => {
    const fragment = normalizeFragment(makeElement("sc-fragment", 400, 240));
    const text = newTextElement({
      x: 0,
      y: 0,
      text: "Opt / Loop".repeat(30),
      fontSize: 14,
      fontFamily: DEFAULT_FONT_FAMILY,
    });
    const fit = fitSequenceFragmentOperator(fragment, text);
    if (!fit) {
      throw new Error("Expected an operator fit");
    }
    const rows = fit.shape.fragment?.rows ?? [];
    expect(fit.shape.fragment?.operatorWidth).toBeCloseTo(
      400 - SEQUENCE_FRAGMENT_TAB_MAX_RIGHT_INSET,
      6,
    );
    expect(rows[0].height).toBeGreaterThan(SEQUENCE_FRAGMENT_TAB_HEIGHT + 10);
    expect(fit.height).toBeCloseTo(
      240 + rows[0].height - SEQUENCE_FRAGMENT_TAB_HEIGHT,
      6,
    );
  });

  it("hides the header divider and dashes the body dividers", () => {
    const fragment: SequenceFragmentData = { rows: rows(60, 60, 60) };
    const layout = getSequenceFragmentRowLayout(180, fragment);
    expect(layout.rows.map((row) => row.y)).toEqual([0, 60, 120]);
    expect(layout.rows.map((row) => row.height)).toEqual([60, 60, 60]);
    expect(layout.separators).toEqual([60, 120]);
    // The divider between the header (tab) row and the first body row is
    // transparent; later dividers are dashed.
    expect(getSequenceFragmentRowPaths(400, 180, fragment)).toEqual([
      {
        ...pathFromPoints(
          [
            [0, 120],
            [400, 120],
          ],
          false,
        ),
        strokeLineDash: SEQUENCE_FRAGMENT_ROW_DIVIDER_DASH,
      },
    ]);
  });

  it("draws no divider for a two-row fragment", () => {
    const fragment: SequenceFragmentData = { rows: rows(60, 60) };
    expect(getSequenceFragmentRowLayout(120, fragment).separators).toEqual([
      60,
    ]);
    expect(getSequenceFragmentRowPaths(400, 120, fragment)).toEqual([]);
  });

  it("keeps the tab row at least as tall as the tab", () => {
    const layout = getSequenceFragmentRowLayout(240, { rows: rows(20, 220) });
    expect(layout.rows[0].height).toBeCloseTo(SEQUENCE_FRAGMENT_TAB_HEIGHT);
    expect(layout.separators[0]).toBeCloseTo(SEQUENCE_FRAGMENT_TAB_HEIGHT);
    expect(layout.rows.reduce((sum, row) => sum + row.height, 0)).toBeCloseTo(
      240,
    );
  });

  it("normalizes persisted row heights to the element height", () => {
    const element = makeFragmentElement(400, 300, { rows: rows(100, 100) });
    const normalized = normalizeFragment(element);
    expect(normalized).not.toBe(element);
    if (!isSequenceFragmentElement(normalized)) {
      throw new Error("Expected a fragment");
    }
    // the tab row keeps its height; the remaining rows absorb the difference
    expect(normalized.shape.fragment?.rows.map((row) => row.height)).toEqual([
      100, 200,
    ]);
    expect(normalizeSequenceFragmentGeometry(normalized)).toBe(normalized);
  });

  it("appends a row and grows the element by the row height", () => {
    const element = makeFragmentElement(400, 120, { rows: rows(60, 60) });
    const next = appendSequenceFragmentRow(element);
    if (!next) {
      throw new Error("Expected an appended row");
    }
    expect(next.height).toBe(120 + SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT);
    expect(next.shape.fragment?.rows.map((row) => row.height)).toEqual([
      60,
      60,
      SEQUENCE_FRAGMENT_DEFAULT_ROW_HEIGHT,
    ]);
    const ids = next.shape.fragment?.rows.map((row) => row.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("grows only the last row from the bottom edge", () => {
    const element = makeFragmentElement(400, 120, { rows: rows(60, 60) });
    const next = getSequenceFragmentResize(element, "s", 160);
    if (!next) {
      throw new Error("Expected a fragment resize");
    }
    expect(next.height).toBe(160);
    expect(next.shape.fragment?.rows.map((row) => row.height)).toEqual([
      60, 100,
    ]);
    expect(
      next.shape.fragment?.rows.reduce((sum, row) => sum + row.height, 0),
    ).toBeCloseTo(160);
  });

  it("stops the bottom edge at the minimum row height", () => {
    const element = makeFragmentElement(400, 120, { rows: rows(60, 60) });
    const next = getSequenceFragmentResize(element, "s", 40);
    if (!next) {
      throw new Error("Expected a fragment resize");
    }
    expect(next.height).toBe(60 + SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT);
    expect(next.shape.fragment?.rows.map((row) => row.height)).toEqual([
      60,
      SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT,
    ]);
  });

  it("scales every row for non-bottom handles", () => {
    const element = makeFragmentElement(400, 120, { rows: rows(60, 60) });
    const next = getSequenceFragmentResize(element, "n", 240);
    if (!next) {
      throw new Error("Expected a fragment resize");
    }
    expect(next.height).toBe(240);
    expect(next.shape.fragment?.rows.map((row) => row.height)).toEqual([
      120, 120,
    ]);
  });

  it("validates persisted fragment data", () => {
    expect(() =>
      assertShapeData({ id: "sc-fragment", schemaVersion: 1 }),
    ).not.toThrow();
    expect(() =>
      assertShapeData({
        id: "sc-fragment",
        schemaVersion: 1,
        fragment: { rows: rows(10, 20) },
      }),
    ).not.toThrow();
    expect(() =>
      assertShapeData({
        id: "sc-fragment",
        schemaVersion: 1,
        fragment: { operator: "alt", rows: rows(10, 20) },
      }),
    ).not.toThrow();
    expect(() =>
      assertShapeData({
        id: "sc-fragment",
        schemaVersion: 1,
        fragment: { rows: [] },
      }),
    ).toThrow();
    expect(() =>
      assertShapeData({
        id: "sc-fragment",
        schemaVersion: 1,
        fragment: { rows: [{ id: "a", height: 0 }] },
      }),
    ).toThrow();
    expect(() =>
      assertShapeData({
        id: "sc-fragment",
        schemaVersion: 1,
        fragment: {
          rows: [
            { id: "a", height: 10 },
            { id: "a", height: 20 },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      assertShapeData({
        id: "sc-fragment",
        schemaVersion: 1,
        fragment: { rows: rows(10), extra: true },
      }),
    ).toThrow();
  });

  it("renders row dividers through the shape details", () => {
    const fragment: SequenceFragmentData = { rows: rows(60, 60, 60) };
    const element = makeFragmentElement(400, 180, fragment);
    const { details } = getCompositeShapeGeometry(element);
    expect(details[0]).toEqual(getSequenceFragmentTabPath(400, 180, fragment));
    expect(details.slice(1)).toEqual(
      getSequenceFragmentRowPaths(400, 180, fragment),
    );
  });

  it("keeps row dividers out of the hit geometry", () => {
    const fragment: SequenceFragmentData = { rows: rows(60, 60, 60) };
    const element = makeFragmentElement(400, 180, fragment);
    const { hitPaths, outline } = getCompositeShapeGeometry(element);
    expect(hitPaths).toEqual([]);
    expect(outline).toEqual(getSequenceElementBox(400, 180));
  });

  it("keeps row data through restore and duplication", () => {
    const fragment: SequenceFragmentData = {
      operator: "alt",
      rows: rows(100, 100),
    };
    const [element] = convertToExcalidrawElements([
      {
        type: "sequence",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        shape: {
          id: "sc-fragment",
          schemaVersion: 1,
          fragment,
        },
      },
    ]);
    if (element.type !== "sequence" || !isSequenceFragmentElement(element)) {
      throw new Error("Expected a fragment element");
    }
    expect(element.shape.fragment?.operator).toBe("alt");
    expect(
      element.shape.fragment?.rows.reduce((sum, row) => sum + row.height, 0),
    ).toBeCloseTo(300);
    const duplicate = duplicateElement(null, new Map(), element);
    expect(duplicate.shape.fragment).toEqual(element.shape.fragment);
  });
});

const ICON_IDS = [
  "sc-lifeline-entity",
  "sc-lifeline-control",
  "sc-lifeline-boundary",
  "sc-lifeline-actor",
] as const;

/** Default element width and the sample glyph extent per icon-headed id. */
const ICON_EXTENT: Record<
  typeof ICON_IDS[number],
  { width: number; glyphWidth: number; glyphHeight: number }
> = {
  "sc-lifeline-entity": { width: 64, glyphWidth: 40, glyphHeight: 39 },
  "sc-lifeline-control": { width: 64, glyphWidth: 38, glyphHeight: 44 },
  "sc-lifeline-boundary": { width: 76, glyphWidth: 50, glyphHeight: 38 },
  "sc-lifeline-actor": { width: 84, glyphWidth: 58, glyphHeight: 88 },
};

const glyphPoints = (
  id: SequenceLifelineId,
  width: number,
  headHeight: number,
) => {
  const { head, attachments } = getSequenceLifelineGeometry(
    id,
    width,
    headHeight,
  );
  return [...head, ...attachments].flatMap(flattenCompositeShapePath);
};

const expectInsideBox = (
  points: ReturnType<typeof flattenCompositeShapePath>,
  width: number,
  height: number,
) => {
  for (const [x, y] of points) {
    expect(x).toBeGreaterThanOrEqual(-1e-6);
    expect(x).toBeLessThanOrEqual(width + 1e-6);
    expect(y).toBeGreaterThanOrEqual(-1e-6);
    expect(y).toBeLessThanOrEqual(height + 1e-6);
  }
};

describe("sequence clamping to the element box", () => {
  it("matches the sample tab exactly at the default fragment size", () => {
    expect(getSequenceFragmentTabPath(400, 240)).toEqual(
      pathFromPoints(
        [
          [0, 0],
          [0, 36.272],
          [80, 36.272],
          [92, 24.272],
          [92, 0],
        ],
        true,
      ),
    );
  });

  it.each([
    [400, 240],
    [60, 20],
    [10, 8],
    [200, 9],
  ])("keeps the %sx%s fragment tab inside the element box", (w, h) => {
    expectInsideBox(
      flattenCompositeShapePath(getSequenceFragmentTabPath(w, h)),
      w,
      h,
    );
  });

  it("shrinks the fragment text area with the tab", () => {
    const wide = getSequenceFragmentTextBounds(400, 240);
    expect(wide.x).toBeGreaterThanOrEqual(0);
    // stays clear of the tab's beveled bottom edge
    expect(wide.x + wide.width).toBeLessThanOrEqual(80);
    expect(wide.y).toBeGreaterThanOrEqual(0);
    expect(wide.y + wide.height).toBeLessThanOrEqual(36.272);

    const narrow = getSequenceFragmentTextBounds(10, 20);
    expect(narrow.x).toBeGreaterThanOrEqual(0);
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(10 + 1e-6);
    expect(narrow.y).toBeGreaterThanOrEqual(0);
    expect(narrow.y + narrow.height).toBeLessThanOrEqual(20 + 1e-6);
  });

  it("renders the fragment tab label on the measured sample line", () => {
    const [element, text] = convertToExcalidrawElements([
      {
        type: "sc-fragment",
        x: 0,
        y: 0,
        width: 400,
        height: 240,
        label: { text: "Opt / Loop", fontSize: 14 },
      },
    ]);
    if (element.type !== "sequence" || !text || text.type !== "text") {
      throw new Error("Expected a bound-text fragment element");
    }
    const lineHeightPx = getLineHeightInPx(text.fontSize, text.lineHeight);
    const baseline =
      text.y -
      element.y +
      getTextVerticalOffset(text.verticalAlign, text.height, 1, lineHeightPx) +
      getVerticalOffset(text.fontFamily, text.fontSize, lineHeightPx);
    // the single line is vertically centered in the sample tab
    const expectedBaseline =
      (SEQUENCE_FRAGMENT_TAB_HEIGHT - lineHeightPx) / 2 +
      getVerticalOffset(text.fontFamily, text.fontSize, lineHeightPx);
    expect(Math.abs(baseline - expectedBaseline)).toBeLessThan(0.5);
  });

  it.each(ICON_IDS)("%s keeps s === 1 at the default size", (id) => {
    const { width, glyphWidth, glyphHeight } = ICON_EXTENT[id];
    const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
    const points = glyphPoints(id, width, headHeight);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(glyphWidth, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(glyphHeight, 6);
  });

  it.each(ICON_IDS)(
    "%s keeps every glyph point inside a shrunken box",
    (id) => {
      const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS[id];
      for (const [width, height] of [
        [12, headHeight],
        [80, 12],
        [18, 18],
      ]) {
        expectInsideBox(glyphPoints(id, width, height), width, height);
      }
    },
  );
});

describe("sequence activation geometry", () => {
  const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"];
  const poleEnd = headHeight + SEQUENCE_DEFAULT_POLE_LENGTH;
  const makeLifeline = (extra: Record<string, unknown> = {}) =>
    makeElement("sc-lifeline-entity", 64, poleEnd, extra);
  const lifeline = makeLifeline();
  const poleX = lifeline.width / 2;

  it("recognizes only sc-activation as an activation", () => {
    expect(isActivationElement(makeElement("sc-activation", 30, 100))).toBe(
      true,
    );
    expect(isActivationElement(lifeline)).toBe(false);
    expect(isActivationElement(makeElement("sc-fragment", 400, 240))).toBe(
      false,
    );
  });

  it("binds arrows to activations but not to lifelines", () => {
    expect(isBindableElement(makeElement("sc-activation", 30, 100))).toBe(true);
    expect(isBindableElement(lifeline)).toBe(false);
  });

  it("gives an activation multiple automatic anchors on its left/right edges only", () => {
    const activation = makeElement("sc-activation", 30, 100);
    const localYs = getSequenceActivationAnchorLocalYs(100);

    expect(localYs.length).toBeGreaterThan(2);
    // the vertical midpoint is always an anchor
    expect(localYs).toContain(50);
    // symmetric, and never on the top/bottom edges
    expect(localYs[0] + localYs[localYs.length - 1]).toBeCloseTo(100, 6);
    for (const y of localYs) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(100);
    }

    const anchors = getSequenceActivationAnchors(30, 100);
    expect(anchors).toHaveLength(localYs.length * 2);
    for (const [x, y] of anchors) {
      expect([0, 30]).toContain(x);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(100);
    }

    // registry-level anchors mirror the helper set. The interactive connection
    // point is dynamic now, so these are no longer drawn as a fixed dot set.
    const globalAnchors = getCompositeShapeAnchors(activation);
    expect(globalAnchors).toHaveLength(anchors.length);
    for (const [x, y] of globalAnchors) {
      expect([0, 30]).toContain(x);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(100);
    }
  });

  it("snaps activation endpoints to the pointer y on a left/right edge, never top/bottom", () => {
    const activation = makeElement("sc-activation", 30, 100);
    const activationTarget =
      activation as unknown as NonDeleted<ExcalidrawBindableElement>;
    const arrow = newArrowElement({ type: "arrow", x: 200, y: 30 });
    const elementsMap = elementsMapFor(activation);
    const resolveEnd = (point: GlobalPoint, isMidpointSnappingEnabled = true) =>
      resolveConnectionHitForArrowEndpoint(
        arrow,
        activationTarget,
        "end",
        point,
        elementsMap,
        { zoom: 1, isMidpointSnappingEnabled, angleLocked: false },
      )!;

    // 动态连接点：y 取指针位置，不再吸到固定锚点
    const pointer = pointFrom<GlobalPoint>(31, 30);
    const snapped = resolveEnd(pointer);
    expect(snapped).not.toBeNull();
    expect(snapped.point[0]).toBeGreaterThan(30);
    expect(snapped.point[1]).toBeCloseTo(30, 6);

    // 激活条没有固定中点锚点：关掉中点吸附落到同一个动态点
    const withoutMidpointSnapping = resolveEnd(pointer, false);
    expect(withoutMidpointSnapping).not.toBeNull();
    expect(withoutMidpointSnapping.point[0]).toBeCloseTo(snapped.point[0], 6);
    expect(withoutMidpointSnapping.point[1]).toBeCloseTo(snapped.point[1], 6);

    // 上 / 下象限同样归到左 / 右竖边，y 夹进可连接的边内
    const nearTop = resolveEnd(pointFrom<GlobalPoint>(31, -50));
    expect(nearTop.point[0]).toBeGreaterThan(30);
    expect(nearTop.point[1]).toBeCloseTo(5, 6);
    const nearBottom = resolveEnd(pointFrom<GlobalPoint>(31, 500));
    expect(nearBottom.point[0]).toBeGreaterThan(30);
    expect(nearBottom.point[1]).toBeCloseTo(95, 6);
    const fromLeft = resolveEnd(pointFrom<GlobalPoint>(-10, 40));
    expect(fromLeft.point[0]).toBeLessThan(0);
    expect(fromLeft.point[1]).toBeCloseTo(40, 6);
  });

  it("picks the activation edge facing the arrow's other end", () => {
    const activation = makeElement("sc-activation", 30, 100);
    const activationTarget =
      activation as unknown as NonDeleted<ExcalidrawBindableElement>;
    const elementsMap = elementsMapFor(activation);
    // 指针压在条的正中心：自己的 x 分不出左右
    const pointer = pointFrom<GlobalPoint>(15, 50);

    const arrowToRight = newArrowElement({
      type: "arrow",
      x: 15,
      y: 50,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(185, 0)],
    });
    const arrowToLeft = newArrowElement({
      type: "arrow",
      x: 15,
      y: 50,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(-185, 0)],
    });

    const resolveEnd = (
      arrow: Parameters<typeof resolveConnectionHitForArrowEndpoint>[0],
      reference: GlobalPoint,
    ) =>
      resolveConnectionHitForArrowEndpoint(
        arrow,
        activationTarget,
        "end",
        pointer,
        elementsMap,
        {
          zoom: 1,
          isMidpointSnappingEnabled: true,
          angleLocked: false,
          reference,
        },
      )!;

    const right = resolveEnd(arrowToRight, pointFrom<GlobalPoint>(200, 50));
    expect(right).not.toBeNull();
    expect(right.point[0]).toBeGreaterThan(30);
    expect(right.point[1]).toBeCloseTo(50, 6);

    const left = resolveEnd(arrowToLeft, pointFrom<GlobalPoint>(-200, 50));
    expect(left).not.toBeNull();
    expect(left.point[0]).toBeLessThan(0);
    expect(left.point[1]).toBeCloseTo(50, 6);
  });

  it("hits the pole corridor but not the head or the blank area", () => {
    expect(
      isPointOnSequenceLifelinePole(lifeline, poleX, headHeight + 10),
    ).toBe(true);
    // 头部
    expect(isPointOnSequenceLifelinePole(lifeline, poleX, 10)).toBe(false);
    // 杆两侧空白
    expect(
      isPointOnSequenceLifelinePole(
        lifeline,
        poleX + SEQUENCE_HIT_HALF_WIDTH + 1,
        headHeight + 10,
      ),
    ).toBe(false);
    // 杆末端之下
    expect(isPointOnSequenceLifelinePole(lifeline, poleX, poleEnd + 1)).toBe(
      false,
    );
  });

  it("puts the pole activation's top at the pointer and clamps its center", () => {
    const middle = getSequenceLifelinePoleActivationPlacement(
      lifeline,
      poleX,
      headHeight + 150,
    )!;
    expect(middle.center.x).toBeCloseTo(poleX, 6);
    // 顶部落在指针处，激活条向下展开：中心 = 指针 y + 高度 / 2
    expect(middle.center.y).toBeCloseTo(
      headHeight + 150 + SEQUENCE_ACTIVATION_HEIGHT / 2,
      6,
    );
    expect(middle.angle).toBe(lifeline.angle);

    const top = getSequenceLifelinePoleActivationPlacement(
      lifeline,
      poleX,
      headHeight + 1,
    )!;
    expect(top.center.y).toBeCloseTo(
      headHeight +
        SEQUENCE_MIN_ACTIVATION_OFFSET +
        SEQUENCE_ACTIVATION_HEIGHT / 2,
      6,
    );

    const bottom = getSequenceLifelinePoleActivationPlacement(
      lifeline,
      poleX,
      poleEnd - 1,
    )!;
    expect(bottom.center.y).toBeCloseTo(
      poleEnd - SEQUENCE_MIN_ACTIVATION_OFFSET - SEQUENCE_ACTIVATION_HEIGHT / 2,
      6,
    );

    // 头部 / 杆外不给落点
    expect(
      getSequenceLifelinePoleActivationPlacement(lifeline, poleX, 10),
    ).toBeNull();
    expect(
      getSequenceLifelinePoleActivationPlacement(lifeline, poleX + 20, 200),
    ).toBeNull();
  });

  it("keeps the placement centered when the pole is shorter than the bar", () => {
    const short = makeElement("sc-lifeline-entity", 64, headHeight + 60);
    const placement = getSequenceLifelinePoleActivationPlacement(
      short,
      poleX,
      headHeight + 30,
    )!;
    expect(placement.center.y).toBeCloseTo(headHeight + 30, 6);
  });

  it("anchors messages on the left / right edge and clamps the scene y", () => {
    const activation = makeElement(
      "sc-activation",
      SEQUENCE_ACTIVATION_WIDTH,
      SEQUENCE_ACTIVATION_HEIGHT,
      {
        x: 100,
        y: 50,
      },
    );
    expect(getActivationAnchor(activation, "left")).toEqual([100, 100]);
    expect(getActivationAnchor(activation, "right")).toEqual([
      100 + SEQUENCE_ACTIVATION_WIDTH,
      100,
    ]);
    expect(getActivationAnchorAtSceneY(activation, "right", 60)).toEqual([
      100 + SEQUENCE_ACTIVATION_WIDTH,
      60,
    ]);
    // 夹进竖向范围（留 1px 余量）
    expect(getActivationAnchorAtSceneY(activation, "right", 10)).toEqual([
      100 + SEQUENCE_ACTIVATION_WIDTH,
      51,
    ]);
    expect(getActivationAnchorAtSceneY(activation, "left", 500)).toEqual([
      100, 149,
    ]);
  });
});

describe("activation lifeline binding", () => {
  const headHeight = SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"];
  const poleLength = SEQUENCE_DEFAULT_POLE_LENGTH;

  const makeLifelineWith = (
    boundElements: ExcalidrawShapeElement["boundElements"],
  ) =>
    makeElement("sc-lifeline-entity", 64, headHeight + poleLength, {
      x: 100,
      y: 0,
      boundElements,
    });

  const makeLinkedActivation = (
    lifelineId: string,
    localY: number,
    extra: Record<string, unknown> = {},
  ) => {
    const element = makeElement("sc-activation", 30, 100, {
      x: 117,
      y: 150,
      ...extra,
    });
    return {
      ...element,
      shape: {
        id: "sc-activation" as const,
        schemaVersion: 1 as const,
        link: { lifelineId, localY },
      },
    } as ExcalidrawShapeElement;
  };

  it("moves attached activations when the lifeline moves", () => {
    const base = makeLifelineWith(null);
    const activation = makeLinkedActivation(base.id, 200);
    const lifeline = {
      ...base,
      boundElements: [{ id: activation.id, type: "activation" as const }],
    } as ExcalidrawShapeElement;
    const scene = new Scene([lifeline, activation], { skipValidation: true });

    const latest = scene.getNonDeletedElement(lifeline.id)!;
    scene.mutateElement(latest, { x: 200, y: 50 });
    updateBoundElements(scene.getNonDeletedElement(lifeline.id)!, scene);

    const moved = scene.getNonDeletedElement(activation.id)!;
    // 中心 = 生命线本地 (width/2, localY) → 全球中心 (232, 250)
    expect(moved.x + moved.width / 2).toBeCloseTo(232, 6);
    expect(moved.y + moved.height / 2).toBeCloseTo(250, 6);
  });

  it("clamps attached activations when the pole shrinks", () => {
    const base = makeLifelineWith(null);
    const activation = makeLinkedActivation(base.id, 400);
    const lifeline = {
      ...base,
      boundElements: [{ id: activation.id, type: "activation" as const }],
    } as ExcalidrawShapeElement;
    const scene = new Scene([lifeline, activation], { skipValidation: true });

    // 杆缩到 130：400 的本地 y 已超出杆底，应被夹回
    scene.mutateElement(scene.getNonDeletedElement(lifeline.id)!, {
      height: headHeight + 130,
    });
    updateBoundElements(scene.getNonDeletedElement(lifeline.id)!, scene);

    const moved = scene.getNonDeletedElement(activation.id)!;
    const poleEnd = headHeight + 130;
    expect(moved.y + moved.height / 2).toBeCloseTo(
      poleEnd - SEQUENCE_MIN_ACTIVATION_OFFSET - 50,
      6,
    );
    const latest = scene.getNonDeletedElement(activation.id)!;
    expect(
      isActivationElement(latest) && latest.shape.link?.localY,
    ).toBeCloseTo(poleEnd - SEQUENCE_MIN_ACTIVATION_OFFSET - 50, 6);
  });

  it("snaps a dragged activation to the nearest pole", () => {
    const lifeline = makeLifelineWith(null);
    const elementsMap = elementsMapFor(lifeline);

    // 杆中心 x = 100 + 64 / 2 = 132
    const near = getSequenceActivationDragPlacement(elementsMap, 140, 200, 100);
    expect(near.snap?.lifeline.id).toBe(lifeline.id);
    expect(near.center.x).toBeCloseTo(132, 6);
    expect(near.center.y).toBeCloseTo(200, 6);

    const far = getSequenceActivationDragPlacement(elementsMap, 300, 200, 100);
    expect(far.snap).toBeNull();
    expect(far.center).toEqual({ x: 300, y: 200 });
  });

  it("resizes height only and never the width", () => {
    const activation = makeElement("sc-activation", 30, 100, {
      x: 100,
      y: 100,
    });

    const fromTop = getSequenceActivationResize(activation, "n", 100, 150);
    expect(fromTop).toEqual({ x: 100, y: 150, height: 50 });

    const fromBottom = getSequenceActivationResize(activation, "s", 100, 250);
    expect(fromBottom).toEqual({ x: 100, y: 100, height: 150 });

    // 角点只取 n / s 分量，宽度仍然不变
    const corner = getSequenceActivationResize(activation, "se", 100, 260);
    expect(corner).toEqual({ x: 100, y: 100, height: 160 });

    // 纯 e / w 不产生任何变化
    expect(getSequenceActivationResize(activation, "e", 400, 150)).toBeNull();
    expect(getSequenceActivationResize(activation, "w", -400, 150)).toBeNull();
  });

  it("offers only vertical resize handles", () => {
    const activation = makeElement("sc-activation", 30, 100, {
      x: 100,
      y: 100,
    });
    const handles = getTransformHandles(
      activation,
      { value: 1 } as Zoom,
      elementsMapFor(activation),
      "mouse",
      {},
    );
    expect(handles.n).toBeTruthy();
    expect(handles.s).toBeTruthy();
    expect(handles.e).toBeUndefined();
    expect(handles.w).toBeUndefined();
    // 角点是比例缩放（同时暗示改宽），与宽度锁定冲突
    expect(handles.nw).toBeUndefined();
    expect(handles.ne).toBeUndefined();
    expect(handles.sw).toBeUndefined();
    expect(handles.se).toBeUndefined();
    expect(handles.rotation).toBeUndefined();
  });
});

describe("sequence fragment row background texts", () => {
  const HEADER = 36.272;
  const BODY_A = 90;
  const BODY_B = 240 - HEADER - BODY_A;
  const normalizeFragment = (element: ExcalidrawShapeElement) =>
    normalizeSequenceFragmentGeometry(element) as ExcalidrawShapeElement & {
      shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
    };
  const makeFragment = () =>
    normalizeFragment(
      makeFragmentElement(400, 240, {
        rows: [
          { id: "header", height: HEADER },
          { id: "row-a", height: BODY_A },
          { id: "row-b", height: BODY_B },
        ],
      }),
    ) as ExcalidrawShapeElement & {
      shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
    };
  const makeRowText = (
    fragment: ExcalidrawShapeElement,
    rowId: string,
    text: string,
    verticalAlign: "top" | "middle" = "top",
  ) =>
    newTextElement({
      x: fragment.x,
      y: fragment.y,
      text,
      fontSize: 13,
      fontFamily: DEFAULT_FONT_FAMILY,
      lineHeight: getLineHeight(DEFAULT_FONT_FAMILY),
      textAlign: "left",
      verticalAlign,
      autoResize: false,
      containerRef: fragmentRowContainerRef(fragment.id, rowId),
    });

  it("derives a single-column cell bounds per row", () => {
    const fragment = makeFragment();
    expect(
      getSequenceFragmentRowBounds(
        fragment.width,
        fragment.height,
        fragment.shape.fragment,
        "row-a",
      ),
    ).toEqual({ x: 0, y: HEADER, width: 400, height: BODY_A });
    expect(
      getSequenceFragmentRowBounds(
        fragment.width,
        fragment.height,
        fragment.shape.fragment,
        "missing",
      ),
    ).toBeNull();
  });

  it("lays the text out with table cell padding, fixed top-left", () => {
    const fragment = makeFragment();
    const text = {
      ...makeRowText(fragment, "row-a", "hello"),
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
    };
    const bounds = getSequenceFragmentRowBounds(
      fragment.width,
      fragment.height,
      fragment.shape.fragment,
      "row-a",
    )!;
    const layout = getSequenceFragmentRowBackgroundTextLayout(
      text,
      fragment,
      bounds,
    );
    expect(layout.text).toBe("hello");
    // alignment is owned by the fragment: top-left regardless of the text
    expect(layout.textAlign).toBe("left");
    expect(layout.verticalAlign).toBe("top");
    expect(layout.x).toBe(fragment.x + TABLE_CELL_TEXT_PADDING_X);
    expect(layout.y).toBe(fragment.y + HEADER + TABLE_CELL_TEXT_PADDING_Y);
    expect(layout.width).toBeLessThanOrEqual(
      400 - TABLE_CELL_TEXT_PADDING_X * 2,
    );
    expect(layout.angle).toBe(0);
  });

  it("grows the wrapped row, the fragment, and shifts the lower row text", () => {
    const fragment = makeFragment();
    const longText = makeRowText(
      fragment,
      "row-a",
      "A condition label that wraps onto many lines inside the row width ".repeat(
        6,
      ),
    );
    const lowerText = makeRowText(fragment, "row-b", "lower");
    const lowerBefore = getSequenceFragmentRowBackgroundTextLayout(
      lowerText,
      fragment,
      getSequenceFragmentRowBounds(
        fragment.width,
        fragment.height,
        fragment.shape.fragment,
        "row-b",
      )!,
    );
    const scene = new Scene([fragment, longText, lowerText]);

    refitSequenceFragmentRowBackgroundTexts(scene, fragment, { grow: true });

    const live = scene.getNonDeletedElement(fragment.id) as typeof fragment;
    expect(live.height).toBeGreaterThan(240);
    const rows = live.shape.fragment!.rows;
    expect(rows[1].height).toBeGreaterThan(BODY_A);
    expect(rows[2].height).toBeCloseTo(BODY_B, 6);
    expect(rows.reduce((sum, row) => sum + row.height, 0)).toBeCloseTo(
      live.height,
      6,
    );
    const liveLower = scene.getNonDeletedElement(lowerText.id)!;
    expect(liveLower.y).toBeCloseTo(lowerBefore.y + (live.height - 240), 6);
    const liveText = scene.getNonDeletedElement(longText.id)!;
    expect(liveText.height).toBeLessThanOrEqual(rows[1].height);
  });

  it("does not grow rows when grow is off, only re-lays the text", () => {
    const fragment = makeFragment();
    const text = {
      ...makeRowText(fragment, "row-a", "hello"),
      y: fragment.y,
    };
    const scene = new Scene([fragment, text]);
    refitSequenceFragmentRowBackgroundTexts(scene, fragment, { grow: false });
    const live = scene.getNonDeletedElement(fragment.id)!;
    expect(live.height).toBe(240);
    const liveText = scene.getNonDeletedElement(text.id)!;
    expect(liveText.y).toBe(fragment.y + HEADER + TABLE_CELL_TEXT_PADDING_Y);
  });

  it("rotates with its fragment", () => {
    const baseFragment = makeFragment();
    const fragment = {
      ...baseFragment,
      angle: (Math.PI / 2) as Radians,
    };
    const text = makeRowText(fragment, "row-a", "hello");
    const bounds = getSequenceFragmentRowBounds(
      fragment.width,
      fragment.height,
      fragment.shape.fragment,
      "row-a",
    )!;
    const layout = getSequenceFragmentRowBackgroundTextLayout(
      text,
      fragment,
      bounds,
    );
    expect(layout.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(Number.isFinite(layout.x) && Number.isFinite(layout.y)).toBe(true);
  });
});
