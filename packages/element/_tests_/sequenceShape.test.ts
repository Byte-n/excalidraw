import { getVerticalOffset } from "@excalidraw/common";
import { RoughGenerator } from "roughjs/bin/generator";

import {
  BASIC_SHAPE_IDS,
  FLOWCHART_SHAPE_IDS,
  SEQUENCE_LIFELINE_HEAD_HEIGHTS,
  SEQUENCE_POLE_LENGTH,
  SEQUENCE_SHAPE_IDS,
  SHAPE_IDS,
  buildShapeData,
  drawSequenceLifeline,
  getCompositeShapeGeometry,
  getCompositeShapeTextBounds,
  getSequenceElementBox,
  getSequenceFragmentTabPath,
  getSequenceFragmentTextBounds,
  getSequenceLifelineGeometry,
  getSequenceLifelineTextBounds,
  getSequencePolePath,
  isSequenceShapeId,
  isShapeElement,
  shapeElementType,
} from "../src/compositeShape";
import {
  flattenCompositeShapePath,
  getBaseRectangleOutline,
  getRoundedRectOutline,
  pathFromPoints,
} from "../src/compositeShape/outline";
import { newElement } from "../src/newElement";
import { getTextVerticalOffset } from "../src/renderElement";
import { generateRoughOptions } from "../src/shape";
import { getLineHeightInPx } from "../src/textMeasurements";
import { convertToExcalidrawElements } from "../src/transform";

import type { SequenceLifelineId } from "../src/compositeShape";
import type { ExcalidrawShapeElement } from "../src/types";

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
  height: SEQUENCE_LIFELINE_HEAD_HEIGHTS[id] + SEQUENCE_POLE_LENGTH,
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
    const { width } = elementSize(id, 80);
    const pole = getSequencePolePath(width, headHeight);
    expect(pole.start).toEqual([width / 2, headHeight]);
    expect(pole.commands).toEqual([
      { type: "line", to: [width / 2, headHeight + SEQUENCE_POLE_LENGTH] },
    ]);
    expect(pole.closed).toBe(false);
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
