import { getVerticalOffset } from "@excalidraw/common";
import { lineSegment, pointFrom } from "@excalidraw/math";
import { RoughGenerator } from "roughjs/bin/generator";

import type { GlobalPoint } from "@excalidraw/math";

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
  SHAPE_IDS,
  buildShapeData,
  clampSequenceLifelineHeight,
  drawSequenceLifeline,
  getCompositeShapeGeometry,
  getCompositeShapeSelectionFrame,
  getCompositeShapeTextBounds,
  getCompositeShapeTextFitMode,
  getSequenceElementBox,
  getSequenceFragmentTabPath,
  getSequenceFragmentTextBounds,
  getSequenceLifelineDefaultSize,
  getSequenceLifelineGeometry,
  getSequenceLifelineHitPaths,
  getSequenceLifelineTextBounds,
  getSequencePoleLength,
  getSequencePolePath,
  hasCompositeShapeSelectionFrame,
  isPointInSequenceLifelineHead,
  isSequenceShapeId,
  isShapeElement,
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
  intersectElementWithLineSegment,
  isPointInElement,
} from "../src/collision";
import { newElement } from "../src/newElement";
import { getTextVerticalOffset } from "../src/renderElement";
import { getSequenceLifelineResize } from "../src/resizeElements";
import { generateRoughOptions } from "../src/shape";
import { getLineHeightInPx } from "../src/textMeasurements";
import { getTransformHandles } from "../src/transformHandles";
import { getTransformStatusReadout } from "../src/transformStatus";
import { convertToExcalidrawElements } from "../src/transform";

import type { SequenceLifelineId } from "../src/compositeShape";
import type { ElementsMap, ExcalidrawShapeElement } from "../src/types";
import type { NonDeletedExcalidrawElement } from "../src/types";

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

  it("does not grow the pole for a long label (fixed text fit)", () => {
    const [element] = convertToExcalidrawElements([
      {
        type: "sc-lifeline-entity",
        x: 0,
        y: 0,
        label: {
          text: "一个非常非常长的生命线标签，用来验证固定适配不会撑高杆",
        },
      },
    ]);
    if (!isShapeElement(element)) {
      throw new Error("Expected a shape element");
    }
    expect(getCompositeShapeTextFitMode(element)).toBe("fixed");
    expect(element.height).toBeCloseTo(
      SEQUENCE_LIFELINE_HEAD_HEIGHTS["sc-lifeline-entity"] +
        SEQUENCE_DEFAULT_POLE_LENGTH,
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
    expect(Math.abs(baseline - 24.229)).toBeLessThan(1);
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
