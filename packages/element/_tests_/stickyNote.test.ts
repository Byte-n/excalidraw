import {
  DEFAULT_STICKY_NOTE_SIZE,
  STICKY_NOTE_BODY_INSET_Y,
  STICKY_NOTE_CORNER_RADIUS,
  STICKY_NOTE_FOOTER,
  STICKY_NOTE_INK,
  STICKY_NOTE_FALLBACK_FONT_SIZE,
  STICKY_NOTE_MAX_FONT_SIZE,
  STICKY_NOTE_MIN_FONT_SIZE,
  STICKY_NOTE_MIN_SIZE,
  STICKY_NOTE_PADDING,
  DEFAULT_STICKY_NOTE_BG,
  STICKY_NOTE_YELLOW_INK,
  MIN_FONT_SIZE,
  arrayToMap,
  getLineHeight,
} from "@excalidraw/common";

import { Scene } from "../src/Scene";
import { newStickyNoteElement } from "../src/newElement";
import {
  getStickyNoteBodyLayout,
  getStickyNoteCornerRadius,
  getStickyNoteCreationInk,
  getStickyNoteDateLabel,
  getStickyNoteFooter,
  getStickyNoteMinSize,
  getStickyNoteTextFit,
  normalizeStickyNoteFontSize,
  syncStickyNoteInk,
  updateStickyNoteLayout,
} from "../src/stickyNote";
import { withTextBlock } from "../src/text/ops";
import { getTextElementStyle } from "../src/text/elementText";

import type { TextBlockStyle } from "../src/text/types";
import type {
  ExcalidrawElement,
  ExcalidrawStickyNoteElement,
  FractionalIndex,
  NonDeleted,
} from "../src/types";

const STICKY_FONT_SIZE = 28;

const bodyStyle = (overrides: Partial<TextBlockStyle> = {}): TextBlockStyle => ({
  fontFamily: 1,
  fontSize: STICKY_FONT_SIZE,
  lineHeight: getLineHeight(1),
  textAlign: "center",
  verticalAlign: "middle",
  ...overrides,
});

const createNote = (text = "", style: TextBlockStyle = bodyStyle()) => {
  const note = newStickyNoteElement({
    type: "stickynote",
    x: 100,
    y: 100,
    width: DEFAULT_STICKY_NOTE_SIZE,
    height: DEFAULT_STICKY_NOTE_SIZE,
    baseHeight: DEFAULT_STICKY_NOTE_SIZE,
    roundness: { type: 3 },
  });
  return text
    ? {
        ...note,
        texts: withTextBlock(undefined, "body", { text, style }),
      }
    : note;
};

const getSticky = (scene: Scene, id: string) =>
  scene.getNonDeletedElement(id) as NonDeleted<ExcalidrawStickyNoteElement>;

describe("sticky note paper", () => {
  it("rounds a round note's corners at the fixed paper radius", () => {
    const sticky = createNote();
    expect(getStickyNoteCornerRadius(sticky)).toBe(STICKY_NOTE_CORNER_RADIUS);
  });

  it("has square corners when sharp", () => {
    const sticky = createNote();
    expect(
      getStickyNoteCornerRadius({ ...sticky, roundness: null }),
    ).toBe(0);
  });
});

describe("sticky note body layout", () => {
  it("downscales the font to fit the base size before growing", () => {
    const sticky = createNote("one two three four five six seven eight nine");
    const layout = getStickyNoteBodyLayout(sticky)!;
    expect(layout.container.height).toBe(DEFAULT_STICKY_NOTE_SIZE);
  });

  it("grows downward once the text overflows at the minimum font", () => {
    const sticky = createNote("word ".repeat(200));
    const layout = getStickyNoteBodyLayout(sticky)!;
    expect(layout.container.height).toBeGreaterThan(DEFAULT_STICKY_NOTE_SIZE);
  });

  it("sits at the base height without a body", () => {
    const sticky = { ...createNote(), index: "a0" as FractionalIndex };
    expect(getStickyNoteBodyLayout(sticky)).toBeNull();
    const scene = new Scene([sticky]);
    const layout = updateStickyNoteLayout(sticky, scene);
    expect(layout.container.height).toBe(DEFAULT_STICKY_NOTE_SIZE);
  });

  it("honors an explicit base height and anchor", () => {
    const sticky = createNote("word ".repeat(200));
    const layout = getStickyNoteBodyLayout(sticky, {
      baseHeight: DEFAULT_STICKY_NOTE_SIZE * 2,
      anchor: "bottom",
    })!;
    expect(layout.container.height).toBeGreaterThanOrEqual(
      DEFAULT_STICKY_NOTE_SIZE * 2,
    );
    expect(layout.container.y).toBeLessThan(100);
  });

  it("keeps odd and fractional ceilings on the ceiling-anchored grid", () => {
    const style = bodyStyle({ fontSize: STICKY_FONT_SIZE + 0.5 });
    const sticky = createNote("one two three four five six", style);
    const layout = getStickyNoteBodyLayout(sticky)!;
    expect(layout.container.height).toBeGreaterThanOrEqual(
      DEFAULT_STICKY_NOTE_SIZE,
    );
  });
});

describe("sticky note font size", () => {
  it("normalizes non-finite and out-of-range ceilings", () => {
    expect(normalizeStickyNoteFontSize(Number.NaN)).toBe(
      STICKY_NOTE_FALLBACK_FONT_SIZE,
    );
    expect(normalizeStickyNoteFontSize(0)).toBe(MIN_FONT_SIZE);
    expect(normalizeStickyNoteFontSize(1e9)).toBe(STICKY_NOTE_MAX_FONT_SIZE);
  });

  it("fits a pure text block inside a box", () => {
    const fit = getStickyNoteTextFit("hello world", bodyStyle(), 120, 40);
    expect(fit.lines.length).toBeGreaterThan(0);
    expect(fit.fontSize).toBeGreaterThan(STICKY_NOTE_MIN_FONT_SIZE);
  });

  it("sizes the minimum note to fit one line at the ceiling", () => {
    const size = getStickyNoteMinSize({
      fontSize: STICKY_FONT_SIZE,
      fontFamily: 1,
    });
    expect(size.height).toBeGreaterThan(STICKY_NOTE_MIN_SIZE);
  });

  it("applies the minimum to a flipped size's magnitude", () => {
    const size = getStickyNoteMinSize({
      fontSize: STICKY_FONT_SIZE,
      fontFamily: 1,
    });
    expect(Math.max(-size.width, size.width)).toBe(size.width);
  });
});

describe("sticky note creation date", () => {
  it("formats an absolute date, short while the year is the current one", () => {
    const now = new Date(2025, 9, 11).getTime();
    expect(getStickyNoteDateLabel(now, { short: true, now })).toBe("10月11日");
    expect(
      getStickyNoteDateLabel(new Date(2024, 9, 11).getTime(), { short: true, now }),
    ).toBe("10月11日");
    expect(
      getStickyNoteDateLabel(new Date(2024, 9, 11).getTime(), {
        short: false,
        now,
      }),
    ).toBe("2024年10月11日");
  });

  it("picks the footer form by width bucket", () => {
    const now = new Date(2025, 9, 11).getTime();
    const wide = getStickyNoteFooter(
      { created: now, width: 300, height: 300 },
      now,
    );
    expect(wide?.text).toBe("10月11日");
    expect(wide?.x).toBe(300 - STICKY_NOTE_PADDING);
  });

  it("reserves the footer below the label body", () => {
    expect(STICKY_NOTE_BODY_INSET_Y).toBeGreaterThan(
      STICKY_NOTE_FOOTER.baselineFromBottom,
    );
  });
});

describe("sticky note embedded body", () => {
  it("writes the proportional ceiling back to texts.body and keeps the fit height", () => {
    const sticky = createNote("hello");
    const scene = new Scene([sticky]);
    const layout = updateStickyNoteLayout(getSticky(scene, sticky.id), scene, {
      baseFontSize: STICKY_FONT_SIZE * 2,
    });
    const latest = getSticky(scene, sticky.id);
    expect(getTextElementStyle({ ...latest, texts: latest.texts } as any));
    expect(latest.texts?.body?.style.fontSize).toBe(
      normalizeStickyNoteFontSize(STICKY_FONT_SIZE * 2),
    );
    expect(latest.height).toBe(layout.container.height);
  });

  it("fits the note from texts.body without creating a text element", () => {
    const sticky = createNote("hello world");
    const scene = new Scene([sticky]);
    expect(scene.getNonDeletedElements()).toHaveLength(1);
    const layout = getStickyNoteBodyLayout(getSticky(scene, sticky.id))!;
    expect(layout.container.height).toBeGreaterThanOrEqual(
      DEFAULT_STICKY_NOTE_SIZE,
    );
  });
});

describe("sticky note ink", () => {
  it("is a no-op when nothing changed", () => {
    const elements: ExcalidrawElement[] = [createNote()];
    expect(syncStickyNoteInk(elements, arrayToMap(elements))).toBe(elements);
  });

  it("forces the yellow ink when the paper becomes the default yellow", () => {
    const note = { ...createNote(), backgroundColor: "#ffffff" };
    const recolored = {
      ...note,
      backgroundColor: DEFAULT_STICKY_NOTE_BG,
    };
    const prev = arrayToMap([note]);
    expect(
      syncStickyNoteInk([recolored], prev).map((el) => el.strokeColor),
    ).toEqual([STICKY_NOTE_YELLOW_INK]);
  });

  it("releases an untouched yellow ink back to the default when leaving yellow", () => {
    const yellow = {
      ...createNote(),
      backgroundColor: DEFAULT_STICKY_NOTE_BG,
      strokeColor: STICKY_NOTE_YELLOW_INK,
    };
    const plain = { ...yellow, backgroundColor: "#ffffff" };
    const prev = arrayToMap([yellow]);
    expect(
      syncStickyNoteInk([plain], prev).map((el) => el.strokeColor),
    ).toEqual([STICKY_NOTE_INK]);
  });

  it("keeps a custom ink when leaving yellow", () => {
    const yellow = {
      ...createNote(),
      backgroundColor: DEFAULT_STICKY_NOTE_BG,
      strokeColor: "#ff0000",
    };
    const plain = { ...yellow, backgroundColor: "#ffffff" };
    const prev = arrayToMap([yellow]);
    expect(syncStickyNoteInk([plain], prev)[0]).toBe(plain);
  });

  it("respects an explicit ink pick on a yellow note", () => {
    const yellow = {
      ...createNote(),
      backgroundColor: DEFAULT_STICKY_NOTE_BG,
      strokeColor: STICKY_NOTE_YELLOW_INK,
    };
    const picked = { ...yellow, strokeColor: "#ff0000" };
    const prev = arrayToMap([yellow]);
    expect(syncStickyNoteInk([picked], prev)[0]).toBe(picked);
  });
});

describe("sticky note presets", () => {
  it("inks a default note by the creation rule", () => {
    expect(getStickyNoteCreationInk(DEFAULT_STICKY_NOTE_BG, STICKY_NOTE_INK)).toBe(STICKY_NOTE_YELLOW_INK);
    expect(getStickyNoteCreationInk("#ffffff", STICKY_NOTE_INK)).toBe(STICKY_NOTE_INK);
  });
});
