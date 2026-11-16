import {
  DEFAULT_STICKY_NOTE_BG,
  MIN_FONT_SIZE,
  arrayToMap,
  STICKY_NOTE_BACKGROUND_PICKS,
  STICKY_NOTE_BODY_INSET_Y,
  STICKY_NOTE_CORNER_RADIUS,
  STICKY_NOTE_FALLBACK_FONT_SIZE,
  STICKY_NOTE_FOOTER,
  STICKY_NOTE_FONT_STEP,
  STICKY_NOTE_INK,
  STICKY_NOTE_MAX_FONT_SIZE,
  STICKY_NOTE_MIN_SIZE,
  STICKY_NOTE_MIN_FONT_SIZE,
  STICKY_NOTE_PADDING,
  STICKY_NOTE_YELLOW_INK,
  getFontString,
  getLineHeight,
  isTransparent,
} from "@excalidraw/common";

import { clamp } from "@excalidraw/math";

import { updateBoundElements } from "./binding";
import { newElementWith } from "./mutateElement";
import { getPositionAfterHeightChange } from "./sizeHelpers";
import { withTextBlock } from "./text/ops";
import { getLineHeightInPx, measureText } from "./textMeasurements";
import { wrapText } from "./textWrapping";
import { isStickyNoteElement } from "./typeChecks";

import type { Scene } from "./Scene";
import type { TextBlockStyle } from "./text/types";
import type { VerticalResizeAnchor } from "./sizeHelpers";
import type { TransformHandleDirection } from "./transformHandles";
import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawStickyNoteElement,
  NonDeletedExcalidrawElement,
} from "./types";

export type StickyNoteRenderPoint = {
  x: number;
  y: number;
};

export type StickyNotePathCommand =
  | {
      type: "move";
      point: StickyNoteRenderPoint;
    }
  | {
      type: "line";
      point: StickyNoteRenderPoint;
    }
  | {
      type: "quadratic";
      control: StickyNoteRenderPoint;
      point: StickyNoteRenderPoint;
    };

export const normalizeStickyNoteStrokeColor = (
  strokeColor: string | null | undefined,
) => {
  return !strokeColor || isTransparent(strokeColor)
    ? STICKY_NOTE_INK
    : strokeColor;
};

export const normalizeStickyNoteBackgroundColor = (
  backgroundColor: string | null | undefined,
) => {
  return !backgroundColor || isTransparent(backgroundColor)
    ? DEFAULT_STICKY_NOTE_BG
    : backgroundColor;
};

/**
 * The update that applies a picked color to an element under the sticky
 * note policy: a note is always filled and its label — the visible text,
 * which the note's own `strokeColor` seeds — never goes transparent. Every
 * color surface (actions, both eyedroppers, paste styles, bind) routes
 * through this instead of re-deriving the rule.
 */
/**
 * The element a color pick on `element` lands on. 便签正文内嵌在元素自身，
 * 没有独立的标签元素，因此颜色永远落在元素本身。
 */
export const getColorTargetElement = (
  element: ExcalidrawElement,
  property: "strokeColor" | "backgroundColor",
  elementsMap: ElementsMap,
): ExcalidrawElement => {
  return element;
};

export const getColorUpdate = (
  element: ExcalidrawElement,
  property: "strokeColor" | "backgroundColor",
  color: string,
  elementsMap: ElementsMap,
): { strokeColor: string } | { backgroundColor: string } => {
  if (isStickyNoteElement(element)) {
    return property === "backgroundColor"
      ? { backgroundColor: normalizeStickyNoteBackgroundColor(color) }
      : { strokeColor: normalizeStickyNoteStrokeColor(color) };
  }
  return property === "backgroundColor"
    ? { backgroundColor: color }
    : { strokeColor: color };
};

/**
 * Whether the paper is the default yellow, which pairs with its own ink
 * (`STICKY_NOTE_YELLOW_INK`). Compared case-insensitively: the value is
 * user-visible data, not confined to the factory constant's casing.
 */
export const isDefaultYellowStickyNote = (backgroundColor: string) =>
  backgroundColor.toLowerCase() === DEFAULT_STICKY_NOTE_BG;

/**
 * The ink a newly created note starts with: the default yellow paper pairs
 * with `STICKY_NOTE_YELLOW_INK`, any other paper takes the sticky ink
 * default. (Recolors of an existing note go through `syncStickyNoteInk`.)
 */
export const getStickyNoteCreationInk = (
  backgroundColor: string,
  stickyStrokeColor: string,
) =>
  isDefaultYellowStickyNote(normalizeStickyNoteBackgroundColor(backgroundColor))
    ? STICKY_NOTE_YELLOW_INK
    : normalizeStickyNoteStrokeColor(stickyStrokeColor);

/** 便签预设样式的标识，与 `STICKY_NOTE_BACKGROUND_PICKS` 同序同位 */
const STICKY_NOTE_PRESET_IDS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "violet",
  "gray",
] as const;

export type StickyNotePresetId = typeof STICKY_NOTE_PRESET_IDS[number];

export type StickyNotePreset = {
  id: StickyNotePresetId;
  backgroundColor: string;
  strokeColor: string;
};

/**
 * 内置的便签预设样式：一条 = 一组纸色 + 墨色。纸色即
 * `STICKY_NOTE_BACKGROUND_PICKS`（同序），墨色由创建规则推导 —— 一条预设
 * 因此恒等于「照这张纸新建出来的便签长什么样」，两者不会各自漂移。
 */
export const STICKY_NOTE_PRESETS: readonly StickyNotePreset[] =
  STICKY_NOTE_BACKGROUND_PICKS.map((backgroundColor, index) => ({
    id: STICKY_NOTE_PRESET_IDS[index],
    backgroundColor,
    strokeColor: getStickyNoteCreationInk(backgroundColor, STICKY_NOTE_INK),
  }));

/**
 * 一份便签样式（纸色 + 墨色）命中的预设，未命中返回 `null`。墨色先按创建
 * 规则推导再比：默认黄纸的 `currentItemStickynoteStrokeColor` 停在通用墨色
 * 上，而实际新建出来的是深棕墨，直接比原文值会让默认状态判成未命中。
 */
export const findStickyNotePreset = (
  backgroundColor: string,
  stickyStrokeColor: string,
): StickyNotePreset | null => {
  const ink = getStickyNoteCreationInk(backgroundColor, stickyStrokeColor);
  return (
    STICKY_NOTE_PRESETS.find(
      (preset) =>
        preset.backgroundColor.toLowerCase() ===
          backgroundColor.toLowerCase() &&
        preset.strokeColor.toLowerCase() === ink.toLowerCase(),
    ) ?? null
  );
};

/**
 * 便签纸面与 Ink 的配对：默认黄色纸面配 `STICKY_NOTE_YELLOW_INK`，
 * 切走时把仅由纸面带来的 Ink 还原成默认色。无变化时返回原数组。
 */
export const syncStickyNoteInk = <T extends ExcalidrawElement>(
  elements: readonly T[],
  prevElementsMap: ElementsMap,
): readonly T[] => {
  const inkById = new Map<string, string>();
  for (const container of elements) {
    if (!isStickyNoteElement(container) || container.isDeleted) {
      continue;
    }
    const prevContainer = prevElementsMap.get(container.id);
    if (
      prevContainer &&
      isDefaultYellowStickyNote(container.backgroundColor) !==
        isDefaultYellowStickyNote(prevContainer.backgroundColor)
    ) {
      if (isDefaultYellowStickyNote(container.backgroundColor)) {
        inkById.set(container.id, STICKY_NOTE_YELLOW_INK);
      } else if (
        container.strokeColor.toLowerCase() === STICKY_NOTE_YELLOW_INK
      ) {
        inkById.set(container.id, STICKY_NOTE_INK);
      }
    }
  }
  if (!inkById.size) {
    return elements;
  }
  return elements.map((element) => {
    const strokeColor = inkById.get(element.id);
    return strokeColor === undefined
      ? element
      : (newElementWith(element as ExcalidrawElement, { strokeColor }) as T);
  });
};

/**
 * The paper is a plain rect with a fixed small radius (a rounded index card,
 * not a rough sketch): `STICKY_NOTE_CORNER_RADIUS` when the element is round,
 * 0 when it is sharp. Also used for collision geometry
 * (`deconstructRectanguloidElement`).
 */
export const getStickyNoteCornerRadius = (
  element: ExcalidrawStickyNoteElement,
) => {
  if (!element.roundness) {
    return 0;
  }

  return Math.min(
    STICKY_NOTE_CORNER_RADIUS,
    Math.min(element.width, element.height) / 2,
  );
};

/**
 * The paper outline in note-local coordinates: a rounded rectangle traced
 * clockwise from just past the top-left corner. Shared by the canvas and SVG
 * renderers, which fill it (and never stroke it — the paper has no border).
 */
export const getStickyNotePathCommands = (
  element: ExcalidrawStickyNoteElement,
): StickyNotePathCommand[] => {
  const radius = getStickyNoteCornerRadius(element);
  const { width, height } = element;

  if (!radius) {
    return [
      { type: "move", point: { x: 0, y: 0 } },
      { type: "line", point: { x: width, y: 0 } },
      { type: "line", point: { x: width, y: height } },
      { type: "line", point: { x: 0, y: height } },
    ];
  }

  return [
    { type: "move", point: { x: radius, y: 0 } },
    { type: "line", point: { x: width - radius, y: 0 } },
    {
      type: "quadratic",
      control: { x: width, y: 0 },
      point: { x: width, y: radius },
    },
    { type: "line", point: { x: width, y: height - radius } },
    {
      type: "quadratic",
      control: { x: width, y: height },
      point: { x: width - radius, y: height },
    },
    { type: "line", point: { x: radius, y: height } },
    {
      type: "quadratic",
      control: { x: 0, y: height },
      point: { x: 0, y: height - radius },
    },
    { type: "line", point: { x: 0, y: radius } },
    {
      type: "quadratic",
      control: { x: 0, y: 0 },
      point: { x: radius, y: 0 },
    },
  ];
};

// -----------------------------------------------------------------------------
// font size — `baseFontSize` is the size the user picked, `fontSize` the fitted one
// -----------------------------------------------------------------------------

// clamping the ceiling: the fit steps down from it in `STICKY_NOTE_FONT_STEP`
// increments, and for values >= ~2^56 (1e20 - 2 === 1e20) that would never
// progress and hang the editor
export const normalizeStickyNoteFontSize = (fontSize: number) => {
  if (!Number.isFinite(fontSize)) {
    return STICKY_NOTE_FALLBACK_FONT_SIZE;
  }
  return Math.min(STICKY_NOTE_MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize));
};

/**
 * The creation-date label: absolute, so painting needs no clock and exports
 * don't go stale. Chinese format "M月D日", with the year prepended when the
 * note's year differs from the viewer's current one ("2025年10月11日").
 * `null` when the note has no usable timestamp (files restored without one).
 * The viewer's local time zone — the element package has no locale, and the
 * footer is chosen by width bucket rather than measured.
 */
export const getStickyNoteDateLabel = (
  created: ExcalidrawStickyNoteElement["created"],
  { short = false, now = Date.now() }: { short?: boolean; now?: number } = {},
): string | null => {
  if (created === null || !Number.isFinite(created)) {
    return null;
  }
  const date = new Date(created);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const label = `${date.getMonth() + 1}月${date.getDate()}日`;
  return short || date.getFullYear() === new Date(now).getFullYear()
    ? label
    : `${date.getFullYear()}年${label}`;
};

/**
 * What the footer paints and where, in note-local coordinates — shared by the
 * canvas and SVG renderers, which take the font and opacity from
 * `STICKY_NOTE_FOOTER`. `null` for the 0×0 creation draft and anything under
 * the data floor, where the band would overlap the top padding.
 */
export const getStickyNoteFooter = (
  element: Pick<ExcalidrawStickyNoteElement, "created" | "width" | "height">,
  now = Date.now(),
) => {
  if (
    element.width < STICKY_NOTE_MIN_SIZE ||
    element.height < STICKY_NOTE_MIN_SIZE
  ) {
    return null;
  }
  const text = getStickyNoteDateLabel(element.created, {
    short:
      element.width - STICKY_NOTE_PADDING * 2 <
      STICKY_NOTE_FOOTER.minBodyWidthForYear,
    now,
  });
  if (!text) {
    return null;
  }
  return {
    text,
    x: element.width - STICKY_NOTE_PADDING,
    y: element.height - STICKY_NOTE_FOOTER.baselineFromBottom,
  };
};

/**
 * The smallest note the UI lets a user create or resize to: one line at the
 * label's font ceiling plus padding (and, vertically, the footer), never below
 * `STICKY_NOTE_MIN_SIZE`. Without the font term a fresh note would grow on
 * the very first keystroke. Data-level passes (restore, action post-passes)
 * only enforce the constant floor — the layout grows a note as needed.
 */
export const getStickyNoteMinSize = ({
  fontSize,
  fontFamily,
}: Pick<TextBlockStyle, "fontSize" | "fontFamily">) => {
  const lineHeightPx = Math.ceil(
    normalizeStickyNoteFontSize(fontSize) * getLineHeight(fontFamily),
  );
  return {
    width: Math.max(
      STICKY_NOTE_MIN_SIZE,
      lineHeightPx + STICKY_NOTE_PADDING * 2,
    ),
    height: Math.max(
      STICKY_NOTE_MIN_SIZE,
      lineHeightPx + STICKY_NOTE_BODY_INSET_Y,
    ),
  };
};

// -----------------------------------------------------------------------------
// layout — one pure calculation, two ways of applying it
// -----------------------------------------------------------------------------

export type StickyNoteLayoutAnchor = VerticalResizeAnchor;

export type StickyNoteLayoutOpts = {
  /** unwrapped text to lay out; defaults to the label's `originalText` */
  originalText?: string;
  /**
   * absolute base-height intent — the gesture-start value to preserve, or the
   * height a resize asked for. Omitted = keep the note's live `baseHeight`
   * (typing, style changes, restore).
   */
  baseHeight?: number;
  /**
   * absolute font-ceiling intent (a proportional resize passes
   * `gesture-start ceiling × scale`). Omitted = keep the label's live ceiling.
   * Never a multiplier on the live value — that compounds across pointer-moves.
   */
  baseFontSize?: number;
  /** the edge that stays put when the content correction changes the height */
  anchor?: StickyNoteLayoutAnchor;
};

export type StickyNoteLayout = {
  container: Pick<
    ExcalidrawStickyNoteElement,
    "x" | "y" | "width" | "height" | "baseHeight"
  >;
};

export type StickyNoteLayoutText = Readonly<{
  /** 源文本；换行结果由布局派生 */
  text: string;
  /** 用户设定的字号上限；fit 的搜索起点 */
  baseFontSize: number;
  style: TextBlockStyle;
}>;

type FontFit = {
  text: string;
  fontSize: number;
  width: number;
  height: number;
};

const getStickyNoteBaseWidth = (container: ExcalidrawStickyNoteElement) => {
  return Math.max(container.width, STICKY_NOTE_MIN_SIZE);
};

/**
 * Largest font size on the grid `{ceiling − k·STEP} ∪ {min}` whose wrapped
 * text fits the note; `min` when nothing fits (the note then grows). The grid
 * is anchored at the ceiling so the result never depends on earlier edits.
 * Warm-started from the previously fitted size: the common keystroke costs one
 * or two wrap+measure passes, a cold search at most log2(steps) + 2.
 */
const fitStickyNoteFont = (
  fit: (fontSize: number) => FontFit,
  {
    baseFontSize,
    fontSizeMin,
    maxWidth,
    maxHeight,
    warmStart,
  }: {
    baseFontSize: number;
    fontSizeMin: number;
    maxWidth: number;
    maxHeight: number;
    warmStart: number;
  },
): FontFit => {
  const steps = Math.max(
    0,
    Math.ceil((baseFontSize - fontSizeMin) / STICKY_NOTE_FONT_STEP),
  );
  const sizeAt = (index: number) =>
    index >= steps ? fontSizeMin : baseFontSize - index * STICKY_NOTE_FONT_STEP;

  const fits = new Map<number, FontFit>();
  const at = (index: number) => {
    let result = fits.get(index);
    if (!result) {
      result = fit(sizeAt(index));
      fits.set(index, result);
    }
    return result;
  };
  const doesFit = (index: number) => {
    const result = at(index);
    return result.width <= maxWidth && result.height <= maxHeight;
  };

  if (steps === 0) {
    return at(0);
  }

  // the previous fitted size, snapped onto the grid and clamped into the
  // current interval (a lowered ceiling must not keep the old larger size)
  const warm = clamp(
    Math.round((baseFontSize - warmStart) / STICKY_NOTE_FONT_STEP),
    0,
    steps,
  );

  // binary search for the smallest index (largest font) that fits
  let lo: number;
  let hi: number;
  if (doesFit(warm)) {
    if (warm === 0 || !doesFit(warm - 1)) {
      return at(warm);
    }
    lo = 0;
    hi = warm - 1;
  } else {
    if (warm === steps) {
      return at(steps);
    }
    lo = warm + 1;
    hi = steps;
  }
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (doesFit(mid)) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return at(lo);
};

/**
 * The single source of truth for a sticky note's geometry: wraps the body at
 * the note's width, fits the font under the ceiling, and grows the note past
 * `baseHeight` only when the text still overflows at the minimum size.
 * Pure — returns the updates for the container.
 */
export const getStickyNoteLayout = (
  container: ExcalidrawStickyNoteElement,
  textElement: StickyNoteLayoutText | null,
  opts: StickyNoteLayoutOpts = {},
): StickyNoteLayout => {
  const baseWidth = getStickyNoteBaseWidth(container);
  const baseHeight = Math.max(
    opts.baseHeight ?? (container.baseHeight || container.height),
    STICKY_NOTE_MIN_SIZE,
  );
  const anchor = opts.anchor ?? "top";

  if (!textElement) {
    // an empty note sits at its base height
    return {
      container: {
        ...getPositionAfterHeightChange(container, baseHeight, anchor),
        width: baseWidth,
        height: baseHeight,
        baseHeight,
      },
    };
  }

  const originalText = opts.originalText ?? textElement.text;
  const baseFontSize = normalizeStickyNoteFontSize(
    opts.baseFontSize ?? textElement.baseFontSize,
  );
  const fontSizeMin = Math.min(STICKY_NOTE_MIN_FONT_SIZE, baseFontSize);
  const maxWidth = Math.max(baseWidth - STICKY_NOTE_PADDING * 2, 1);
  const maxHeight = Math.max(baseHeight - STICKY_NOTE_BODY_INSET_Y, 0);
  const { fontFamily, lineHeight } = textElement.style;

  const fit = (fontSize: number): FontFit => {
    const font = getFontString({ fontFamily, fontSize });
    const text = wrapText(originalText, font, maxWidth);
    return { text, fontSize, ...measureText(text, font, lineHeight) };
  };

  const isBlank = !originalText.trim();
  const fitted: FontFit = isBlank
    ? {
        text: "",
        fontSize: baseFontSize,
        ...measureText(
          "",
          getFontString({ fontFamily, fontSize: baseFontSize }),
          lineHeight,
        ),
      }
    : fitStickyNoteFont(fit, {
        baseFontSize,
        fontSizeMin,
        maxWidth,
        maxHeight,
        warmStart: baseFontSize,
      });

  const height = isBlank
    ? baseHeight
    : Math.max(baseHeight, fitted.height + STICKY_NOTE_BODY_INSET_Y);

  return {
    container: {
      ...getPositionAfterHeightChange(container, height, anchor),
      width: baseWidth,
      height,
      baseHeight,
    },
  };
};

export type StickyNoteTextFit = Readonly<{
  text: string;
  lines: readonly string[];
  fontSize: number;
  width: number;
  height: number;
  lineHeightPx: number;
}>;

/**
 * 便签正文的纯布局：在 `maxWidth × maxHeight` 内换行并逐步缩小字号，
 * 与 `getStickyNoteLayout` 共用同一套 fit 算法。空文本按用户设定的字号
 * 返回一行空行。
 */
export const getStickyNoteTextFit = (
  originalText: string,
  style: Pick<TextBlockStyle, "fontFamily" | "fontSize" | "lineHeight">,
  maxWidth: number,
  maxHeight: number,
): StickyNoteTextFit => {
  const baseFontSize = normalizeStickyNoteFontSize(style.fontSize);
  const fontSizeMin = Math.min(STICKY_NOTE_MIN_FONT_SIZE, baseFontSize);
  const { fontFamily, lineHeight } = style;

  const fit = (fontSize: number): FontFit => {
    const font = getFontString({ fontFamily, fontSize });
    const text = wrapText(originalText, font, maxWidth);
    return { text, fontSize, ...measureText(text, font, lineHeight) };
  };

  const fitted: FontFit = !originalText.trim()
    ? {
        text: "",
        fontSize: baseFontSize,
        ...measureText(
          "",
          getFontString({ fontFamily, fontSize: baseFontSize }),
          lineHeight,
        ),
      }
    : fitStickyNoteFont(fit, {
        baseFontSize,
        fontSizeMin,
        maxWidth,
        maxHeight,
        warmStart: baseFontSize,
      });

  return {
    text: fitted.text,
    lines: fitted.text.split("\n"),
    fontSize: fitted.fontSize,
    width: fitted.width,
    height: fitted.height,
    lineHeightPx: getLineHeightInPx(fitted.fontSize, lineHeight),
  };
};

/**
 * 便签内嵌正文的合成文本视图：只用于 `getStickyNoteLayout` 计算。
 * 不插入场景、不消耗 id/seed；字号取用户设定的 ceiling，`fontSize`
 * 同时作为 fit 搜索的热启动值（与 `texts` 区域布局的口径一致）。
 */
export const getStickyNoteBodyTextView = (
  container: ExcalidrawStickyNoteElement,
): StickyNoteLayoutText | null => {
  const block = container.texts?.body;
  if (!block) {
    return null;
  }
  const { style } = block;
  return {
    text: block.text,
    baseFontSize: style.fontSize,
    style,
  };
};

/**
 * 便签内嵌正文按 fit 求解的完整布局；没有 `texts.body` 时返回 null。
 * 返回的 `container` 只含几何字段，调用方负责合并进元素。
 */
export const getStickyNoteBodyLayout = (
  container: ExcalidrawStickyNoteElement,
  opts?: StickyNoteLayoutOpts,
): StickyNoteLayout | null => {
  const textView = getStickyNoteBodyTextView(container);
  return textView ? getStickyNoteLayout(container, textView, opts) : null;
};

/**
 * Resize intents for a sticky note — the §3.3 matrix of the plan. Every value
 * is absolute and derived from the gesture-start snapshot on each pointer-move,
 * so releasing Shift (or Alt) mid-gesture restores the original base height
 * and ceiling instead of keeping values a previous move scaled.
 *
 * - width-only gestures (free E/W, Stats W) preserve the base height
 * - height-changing gestures use the requested height as the new base
 * - proportional gestures (Shift on any handle, aspect-locked multi-select,
 *   Stats group) additionally scale the font ceiling with the note
 * - flips preserve everything
 * - the content correction anchors at the edge the gesture holds still
 */
export const getStickyNoteResizeIntent = (
  /** the note with the requested geometry already applied */
  container: ExcalidrawStickyNoteElement,
  originalElementsMap: ElementsMap,
  handleDirection: TransformHandleDirection,
  {
    proportional,
    fromCenter,
    flip = false,
  }: { proportional: boolean; fromCenter: boolean; flip?: boolean },
): Pick<StickyNoteLayoutOpts, "baseHeight" | "baseFontSize" | "anchor"> => {
  const origContainer = originalElementsMap.get(container.id);
  const origSticky = isStickyNoteElement(origContainer)
    ? origContainer
    : container;
  const ceiling = origSticky.texts?.body?.style.fontSize;

  if (flip) {
    return { baseHeight: origSticky.baseHeight, baseFontSize: ceiling };
  }

  const changesHeight =
    proportional ||
    handleDirection.includes("n") ||
    handleDirection.includes("s");
  const scale =
    proportional && origSticky.width ? container.width / origSticky.width : 1;
  const isSideHandle = handleDirection.length === 1;

  return {
    baseHeight: changesHeight ? container.height : origSticky.baseHeight,
    baseFontSize: ceiling === undefined ? undefined : ceiling * scale,
    anchor: fromCenter
      ? "center"
      : handleDirection.includes("n")
      ? "bottom"
      : proportional &&
        isSideHandle &&
        (handleDirection === "e" || handleDirection === "w")
      ? // Shift+E/W holds the opposite side's midpoint, i.e. the vertical center
        "center"
      : "top",
  };
};

/**
 * Applies `getStickyNoteLayout` to a live scene, then runs the bound-arrow
 * pass unless the caller already owns one (`bindings: false`) or needs to
 * forward its context (`bindings: { simultaneouslyUpdated }` — arrows resized
 * in the same gesture must not be moved by the pass, `updateBoundElements`
 * skips them only when told).
 */
export const updateStickyNoteLayout = (
  container: ExcalidrawStickyNoteElement,
  scene: Scene,
  {
    bindings,
    ...layoutOpts
  }: StickyNoteLayoutOpts & {
    bindings?:
      | { simultaneouslyUpdated?: readonly NonDeletedExcalidrawElement[] }
      | false;
  } = {},
): StickyNoteLayout => {
  const bodyBlock = container.texts?.body;
  const textElement = bodyBlock ? getStickyNoteBodyTextView(container) : null;
  const layout = getStickyNoteLayout(container, textElement, layoutOpts);
  // 比例缩放意图直接写回 block 的字号 ceiling，高度仍由 layout 的 fit 结果决定
  const nextTexts =
    bodyBlock && layoutOpts.baseFontSize !== undefined
      ? withTextBlock(container.texts, "body", {
          ...bodyBlock,
          style: {
            ...bodyBlock.style,
            fontSize: normalizeStickyNoteFontSize(layoutOpts.baseFontSize),
          },
        })
      : undefined;

  scene.mutateElement(container, {
    ...layout.container,
    ...(nextTexts ? { texts: nextTexts } : null),
  });
  if (bindings !== false && !container.isDeleted) {
    updateBoundElements(
      container as NonDeletedExcalidrawElement,
      scene,
      bindings || undefined,
    );
  }

  return layout;
};

const STICKY_NOTE_LAYOUT_INPUTS = {
  // `texts` 覆盖内嵌正文：text/style 变化后不能复用旧布局
  container: ["x", "y", "width", "baseHeight", "angle", "texts"],
} as const;

const hasStickyNoteLayoutInputChanged = (
  container: ExcalidrawStickyNoteElement,
  prevElementsMap: ElementsMap,
) => {
  const prevContainer = prevElementsMap.get(container.id);
  if (!prevContainer) {
    return true;
  }
  return STICKY_NOTE_LAYOUT_INPUTS.container.some(
    (key) => (prevContainer as any)[key] !== container[key],
  );
};

/**
 * Applies `getStickyNoteLayout` inside an immutable elements array (property
 * actions, paste styles, restore): the notes among `affectedIds` get their
 * geometry merged into their clones. Elements that need no change keep their
 * identity and version; when `prevElementsMap` is given, notes whose layout
 * inputs did not change skip the fit entirely.
 * Bound arrows are the caller's job once the result is installed.
 */
export const relayoutStickyNotes = <T extends ExcalidrawElement>(
  elements: readonly T[],
  affectedIds: ReadonlySet<ExcalidrawElement["id"]>,
  opts?: { prevElementsMap?: ElementsMap },
): readonly T[] => {
  if (!affectedIds.size) {
    return elements;
  }
  const elementsMap = arrayToMap(elements);
  const containerIds = new Set<ExcalidrawElement["id"]>();
  for (const id of affectedIds) {
    const element = elementsMap.get(id);
    if (!element || element.isDeleted) {
      continue;
    }
    if (isStickyNoteElement(element)) {
      containerIds.add(element.id);
    }
  }
  if (!containerIds.size) {
    return elements;
  }

  const replacements = new Map<ExcalidrawElement["id"], T>();
  for (const id of containerIds) {
    const container = elementsMap.get(id) as ExcalidrawStickyNoteElement;
    if (
      opts?.prevElementsMap &&
      !hasStickyNoteLayoutInputChanged(container, opts.prevElementsMap)
    ) {
      continue;
    }
    const layout = getStickyNoteLayout(
      container,
      getStickyNoteBodyTextView(container),
    );
    const nextContainer = newElementWith(container, layout.container);
    if (nextContainer !== container) {
      replacements.set(id, nextContainer as unknown as T);
    }
  }
  if (!replacements.size) {
    return elements;
  }
  return elements.map((element) => replacements.get(element.id) ?? element);
};
