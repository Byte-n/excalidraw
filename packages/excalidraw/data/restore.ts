import {
  clamp,
  isFiniteNumber,
  isValidPoint,
  pointFrom,
} from "@excalidraw/math";

import {
  colorToHex,
  COLOR_TOP_PICKS_SLOTS,
  type CombineBrandsIfNeeded,
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_STREAMLINE,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_VERTICAL_ALIGN,
  ROUNDNESS,
  DEFAULT_SIDEBAR,
  DEFAULT_ELEMENT_PROPS,
  DEFAULT_FREEDRAW_STROKE_WIDTH,
  DEFAULT_GRID_SIZE,
  DEFAULT_GRID_STEP,
  randomId,
  getUpdatedTimestamp,
  updateActiveTool,
  arrayToMap,
  getSizeFromPoints,
  normalizeLink,
  getLineHeight,
  STROKE_WIDTH,
  STROKE_WIDTH_KEYS,
  type StrokeWidthKey,
  STICKY_NOTE_BACKGROUND_PICKS,
  isTransparent,
} from "@excalidraw/common";
import {
  getNonDeletedElements,
  isValidPolygon,
  isMindmapNodeElement,
  isMindmapEdgeElement,
  isValidMindmapOrder,
  repairMindmapElements,
  buildMindmapGraphIndex,
  layoutMindmap,
  assertShapeElementType,
  assertMindmapShapeData,
  assertValidTableData,
  assertValidContainerRefs,
  normalizeTableDimensions,
} from "@excalidraw/element";
import { normalizeAttachPoint } from "@excalidraw/element";
import {
  updateElbowArrowPoints,
  validateElbowPoints,
} from "@excalidraw/element";
import { LinearElementEditor } from "@excalidraw/element";
import {
  bumpVersion,
  getStickyNoteBodyLayout,
  normalizeStickyNote,
  normalizeStickyNoteBackgroundColor,
  normalizeStickyNoteFontSize,
  normalizeStickyNoteStrokeColor,
} from "@excalidraw/element";
import {
  DEFAULT_BOUND_TEXT_LABEL_POSITION,
  getTextElementBaseFontSize,
  getTextElementBaseFontSizePatch,
  normalizeText,
  parseTextRegionKey,
  withoutTextBlock,
  withTextBlock,
} from "@excalidraw/element";
import {
} from "@excalidraw/element";
import { isStickyNoteElement } from "@excalidraw/element";
import {
  isSequenceFragmentElement,
  normalizeSequenceFragmentGeometry,
  normalizeSequenceLifelineGeometry,
} from "@excalidraw/element";
import {
  isArrowBoundToElement,
  isElbowArrow,
  isLinearElement,
  isLineElement,
  isTextElement,
  isUsingAdaptiveRadius,
} from "@excalidraw/element";

import { syncInvalidIndices } from "@excalidraw/element";

import { refreshTextDimensions } from "@excalidraw/element";

import { getNormalizedDimensions } from "@excalidraw/element";

import { isInvisiblySmallElement } from "@excalidraw/element";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type { TextBlockStyle } from "@excalidraw/element";

import type {
  ElementsMap,
  ElementsMapOrArray,
  ExcalidrawArrowElement,
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawSelectionElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  ElementBinding,
  NonDeletedSceneElementsMap,
  OrderedExcalidrawElement,
  StrokeVariability,
  StrokeRoundness,
} from "@excalidraw/element/types";

import type { Merge, Mutable } from "@excalidraw/common/utility-types";

import { getDefaultAppState } from "../appState";

import {
  getNormalizedGridSize,
  getNormalizedGridStep,
  getNormalizedZoom,
} from "../scene";

import type {
  AppState,
  BinaryFiles,
  LibraryItem,
  LibraryItems,
} from "../types";
import type { ImportedDataState, LegacyAppState } from "./types";

type RestoredAppState = Omit<
  AppState,
  "offsetTop" | "offsetLeft" | "width" | "height"
>;

const MAX_LINEAR_PX = 75_000;

/** 脑图节点正文：归一化文本；空文本不落 key；样式必须是对象。 */
const normalizeMindmapNodeTexts = (
  node: ExcalidrawMindmapNodeElement,
): ExcalidrawMindmapNodeElement => {
  const body = node.texts?.body;
  if (!body) {
    return node;
  }
  if (!body.style || typeof body.style !== "object") {
    throw new Error("Unsupported mindmap node text style");
  }
  const text = normalizeText(body.text);
  return text.trim()
    ? {
        ...node,
        texts: withTextBlock(node.texts, "body", { ...body, text }),
      }
    : { ...node, texts: withoutTextBlock(node.texts, "body") };
};

/**
 * 表格文本：只保留可见格的 `cell:<id>` 键与非空文本；覆盖格、未知格的键丢弃。
 */
const normalizeTableTexts = (
  element: ExcalidrawTableElement,
): ExcalidrawTableElement => {
  if (!element.texts) {
    return element;
  }
  const visible = new Set(
    element.table.cells
      .filter((cell) => !cell.mergedInto)
      .map((cell) => cell.id),
  );
  let texts: ExcalidrawTableElement["texts"];
  for (const key of Object.keys(
    element.texts,
  ) as (keyof typeof element.texts)[]) {
    const block = element.texts[key];
    const parsed = parseTextRegionKey(key);
    if (!block || parsed?.kind !== "cell" || !visible.has(parsed.cellId)) {
      continue;
    }
    if (!block.style || typeof block.style !== "object") {
      throw new Error("Unsupported table cell text style");
    }
    const text = normalizeText(block.text);
    if (!text.trim()) {
      continue;
    }
    texts = withTextBlock(texts, key, { ...block, text });
  }
  if (!texts) {
    const { texts: _texts, ...rest } = element;
    return rest as ExcalidrawTableElement;
  }
  return { ...element, texts };
};

/**
 * 线性元素标签：只保留 `label` 键与非空文本；沿路径位置归一化到 [0,1]，
 * 非法的 placement 直接丢弃并回到默认位置。
 */
const normalizeLinearTexts = <T extends ExcalidrawLinearElement>(
  element: T,
): T => {
  const label = element.texts?.label;
  if (!label) {
    return element;
  }
  if (!label.style || typeof label.style !== "object") {
    throw new Error("Unsupported linear element label style");
  }
  const text = normalizeText(label.text);
  if (!text.trim()) {
    const { texts: _texts, ...rest } = element;
    return rest as T;
  }
  const labelPosition = isFiniteNumber(label.placement?.labelPosition)
    ? clamp(label.placement.labelPosition, 0, 1)
    : DEFAULT_BOUND_TEXT_LABEL_POSITION;
  return {
    ...element,
    texts: withTextBlock(undefined, "label", {
      text,
      style: label.style,
      placement: { labelPosition },
    }),
  } as T;
};

// Last resort fix for extremely large linear elements (lines / arrows), which
// would otherwise freeze the editor while rendering — e.g. a dotted or dashed
// stroke spanning a huge distance generates an enormous dash array.
// https://github.com/excalidraw/excalidraw/issues/11497
const handleOversizedLinearElements = <T extends ExcalidrawLinearElement>(
  element: T,
): T => {
  if (element.width <= MAX_LINEAR_PX && element.height <= MAX_LINEAR_PX) {
    return element;
  }

  const label =
    element.type === "arrow"
      ? `${isElbowArrow(element) ? "elbow" : "simple"} arrow`
      : element.type;

  console.error(
    `Removing extremely large ${label} ${element.id} (width: ${element.width}, height: ${element.height}, x: ${element.x}, y: ${element.y})`,
  );

  return {
    ...element,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 100)],
    isDeleted: true,
  };
};

const restoreLinearElementPoints = (
  points: unknown,
  width: unknown,
  height: unknown,
): LocalPoint[] => {
  const restoredPoints = Array.isArray(points)
    ? points.reduce<LocalPoint[]>((acc, point) => {
        if (isValidPoint(point)) {
          acc.push(pointFrom<LocalPoint>(point[0], point[1]));
        }
        return acc;
      }, [])
    : [];

  return restoredPoints.length < 2
    ? [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(
          isFiniteNumber(width) ? width : 0,
          isFiniteNumber(height) ? height : 0,
        ),
      ]
    : restoredPoints;
};

const restoreFreedrawPoints = (
  points: unknown,
  pressures: unknown,
): {
  points: LocalPoint[];
  pressures: number[];
} => {
  if (!Array.isArray(points)) {
    return {
      points: [],
      pressures: [],
    };
  }

  const pressureValues: readonly unknown[] = Array.isArray(pressures)
    ? pressures
    : [];
  const restoredPoints: LocalPoint[] = [];
  const restoredPressures: number[] = [];

  points.forEach((point, index) => {
    if (isValidPoint(point)) {
      restoredPoints.push(pointFrom<LocalPoint>(point[0], point[1]));
      if (index in pressureValues) {
        const pressure = pressureValues[index];
        restoredPressures.push(isFiniteNumber(pressure) ? pressure : 0.5);
      }
    }
  });

  return {
    points: restoredPoints,
    pressures: restoredPressures,
  };
};

export const AllowedExcalidrawActiveTools: Record<
  AppState["activeTool"]["type"],
  boolean
> = {
  selection: true,
  lasso: true,
  text: true,
  rectangle: true,
  diamond: true,
  ellipse: true,
  line: true,
  image: true,
  arrow: true,
  freedraw: true,
  stickynote: true,
  eraser: false,
  custom: true,
  frame: true,
  embeddable: true,
  hand: true,
  laser: false,
  autoshape: false,
  magicframe: false,
  bucketfill: true,
  mindmap: true,
  table: true,
};

export type RestoredDataState = {
  elements: OrderedExcalidrawElement[];
  appState: RestoredAppState;
  files: BinaryFiles;
};

const ALLOWED_STROKE_VARIABILITIES = new Set<StrokeVariability>([
  "constant",
  "variable",
]);

const restoreStrokeVariability = (
  variability: unknown,
  defaultValue: StrokeVariability,
): StrokeVariability => {
  return typeof variability === "string" &&
    ALLOWED_STROKE_VARIABILITIES.has(variability as StrokeVariability)
    ? (variability as StrokeVariability)
    : defaultValue;
};

const getStrokeWidthKey = (strokeWidth: unknown): StrokeWidthKey | null => {
  return isFiniteNumber(strokeWidth)
    ? STROKE_WIDTH_KEYS.find((key) => STROKE_WIDTH[key] === strokeWidth) ?? null
    : null;
};

const restoreFreedrawStrokeOptions = (
  strokeOptions: unknown,
): { variability: StrokeVariability; streamline: number } => {
  const options =
    strokeOptions && typeof strokeOptions === "object"
      ? (strokeOptions as { variability?: unknown; streamline?: unknown })
      : null;

  return {
    variability: restoreStrokeVariability(options?.variability, "variable"),
    streamline: isFiniteNumber(options?.streamline)
      ? options?.streamline
      : DEFAULT_STROKE_STREAMLINE,
  };
};

const repairBinding = (
  binding: ElementBinding | null,
  targetElementsMap: Readonly<ElementsMap>,
  existingElementsMap: Readonly<ElementsMap> | null | undefined,
): ElementBinding | null => {
  // 本项目没有存量数据，因此不做旧 schema 的迁移：绑定就是 elementId +
  // 归一化的 attachPoint，读回来只做一次归一化即可。
  // （原先这里还有 v1 → v2 那条「把旧锚点重投影到外扩轮廓再反算比率、
  // 并按点是否在图形内决定 inside/orbit」的迁移路径，随 mode 一并删除。）
  try {
    if (!binding || !binding.elementId) {
      return null;
    }

    // 悬空引用照旧丢掉绑定（这一步与 v1 迁移无关，必须保留）
    const target =
      targetElementsMap.get(binding.elementId) ??
      existingElementsMap?.get(binding.elementId);
    if (!target) {
      return null;
    }

    return {
      elementId: binding.elementId,
      attachPoint: normalizeAttachPoint(binding.attachPoint),
    };
  } catch (error) {
    console.error("Error repairing binding:", error);
  }

  return null;
};

const restoreElementWithProperties = <
  T extends Merge<
    Required<ExcalidrawElement>,
    Pick<ExcalidrawElement, "containerRef"> & {
      /** 文本区域随元素一起读取，暂不单独归一化。 */
      texts?: ExcalidrawElement["texts"];
      customData?: ExcalidrawElement["customData"];
      /** @deprecated */
      boundElementIds?: readonly ExcalidrawElement["id"][];
      /** @deprecated */
      strokeSharpness?: StrokeRoundness;
    }
  >,
  K extends Pick<T, keyof Omit<Required<T>, keyof ExcalidrawElement>>,
>(
  element: T,
  extra: Pick<
    T,
    // This extra Pick<T, keyof K> ensure no excess properties are passed.
    // @ts-ignore TS complains here but type checks the call sites fine.
    keyof K
  > &
    Partial<Pick<ExcalidrawElement, "type" | "x" | "y" | "customData">>,
): T => {
  const base: Pick<T, keyof ExcalidrawElement> = {
    type: extra.type || element.type,
    // all elements must have version > 0 so getSceneVersion() will pick up
    // newly added elements
    version: element.version || 1,
    versionNonce: element.versionNonce ?? 0,
    index: element.index ?? null,
    isDeleted: element.isDeleted ?? false,
    id: element.id || randomId(),
    fillStyle: element.fillStyle || DEFAULT_ELEMENT_PROPS.fillStyle,
    strokeWidth:
      // 笔宽是物理尺寸，入口处只接受有限正数；非法值回落画笔默认像素笔宽。
      extra.type === "freedraw" || element.type === "freedraw"
        ? Number.isFinite(element.strokeWidth) && element.strokeWidth > 0
          ? element.strokeWidth
          : DEFAULT_FREEDRAW_STROKE_WIDTH
        : element.strokeWidth || DEFAULT_ELEMENT_PROPS.strokeWidth,
    strokeStyle: element.strokeStyle ?? DEFAULT_ELEMENT_PROPS.strokeStyle,
    opacity:
      element.opacity == null ? DEFAULT_ELEMENT_PROPS.opacity : element.opacity,
    angle: element.angle || (0 as Radians),
    x: extra.x ?? element.x ?? 0,
    y: extra.y ?? element.y ?? 0,
    strokeColor: element.strokeColor || DEFAULT_ELEMENT_PROPS.strokeColor,
    backgroundColor:
      element.backgroundColor || DEFAULT_ELEMENT_PROPS.backgroundColor,
    width: element.width || 0,
    height: element.height || 0,
    seed: element.seed ?? 1,
    groupIds: element.groupIds ?? [],
    containerRef: element.containerRef,
    roundness: element.roundness
      ? element.roundness
      : element.strokeSharpness === "round"
      ? {
          // for old elements that would now use adaptive radius algo,
          // use legacy algo instead
          type: isUsingAdaptiveRadius(element.type)
            ? ROUNDNESS.LEGACY
            : ROUNDNESS.PROPORTIONAL_RADIUS,
        }
      : null,
    boundElements: element.boundElementIds
      ? element.boundElementIds.map((id) => ({ type: "arrow", id }))
      : element.boundElements ?? [],
    updated: element.updated ?? getUpdatedTimestamp(),
    created: element.created ?? null,
    link: element.link ? normalizeLink(element.link) : null,
    locked: element.locked ?? false,
  };

  if ("customData" in element || "customData" in extra) {
    base.customData =
      "customData" in extra ? extra.customData : element.customData;
  }

  const ret = {
    // spread the original element properties to not lose unknown ones
    // for forward-compatibility
    ...element,
    // normalized properties
    ...base,
    ...getNormalizedDimensions(base),
    ...extra,
  } as unknown as T;

  // strip legacy props (migrated in previous steps)
  delete ret.strokeSharpness;
  delete ret.boundElementIds;

  return ret;
};

export const restoreElement = (
  /** element to be restored */
  element: Exclude<ExcalidrawElement, ExcalidrawSelectionElement>,
  /** all elements to be restored */
  targetElementsMap: Readonly<ElementsMap>,
  /** used for additional context */
  existingElementsMap: Readonly<ElementsMap> | null | undefined,
  opts?: {
    deleteInvisibleElements?: boolean;
  },
): typeof element | null => {
  element = { ...element };

  switch (element.type) {
    case "text": {
      const body = element.texts?.body;
      if (!body || !body.style || typeof body.style !== "object") {
        throw new Error("Unsupported text element text block");
      }
      const text = normalizeText(
        typeof body.text === "string" ? body.text : "",
      );
      const style: TextBlockStyle = {
        fontFamily: body.style.fontFamily,
        fontSize: isFiniteNumber(body.style.fontSize)
          ? body.style.fontSize
          : DEFAULT_FONT_SIZE,
        ...(body.style.fontWeight !== undefined
          ? { fontWeight: body.style.fontWeight }
          : {}),
        lineHeight:
          body.style.lineHeight || getLineHeight(body.style.fontFamily),
        textAlign: body.style.textAlign || DEFAULT_TEXT_ALIGN,
        verticalAlign: body.style.verticalAlign || DEFAULT_VERTICAL_ALIGN,
        ...(body.style.color !== undefined ? { color: body.style.color } : {}),
      };
      element = restoreElementWithProperties(
        {
          ...element,
          texts: { body: { text, style } },
        },
        {
          autoResize: element.autoResize ?? true,
        },
      );

      // if empty text, mark as deleted. We keep in array
      // for data integrity purposes (collab etc.)
      if (opts?.deleteInvisibleElements && !text && !element.isDeleted) {
        // TODO: we should not do this since it breaks sync / versioning when we exchange / apply just deltas and restore the elements (deletion isn't recorded)
        element = { ...element, isDeleted: true };
        element = bumpVersion(element);
      }

      return element;
    }
    case "freedraw": {
      const { points, pressures } = restoreFreedrawPoints(
        element.points,
        element.pressures,
      );

      return restoreElementWithProperties(element, {
        points,
        simulatePressure: element.simulatePressure,
        strokeOptions: restoreFreedrawStrokeOptions(element.strokeOptions),
        pressures,
      });
    }
    case "image":
      return restoreElementWithProperties(element, {
        status: element.status || "pending",
        fileId: element.fileId,
        scale: element.scale || [1, 1],
        crop: element.crop ?? null,
      });
    case "line":
    // @ts-ignore LEGACY type
    // eslint-disable-next-line no-fallthrough
    case "draw":
      const startArrowhead = element.startArrowhead ?? null;
      const endArrowhead = element.endArrowhead ?? null;
      let x = element.x;
      let y = element.y;
      let points = restoreLinearElementPoints(
        element.points,
        element.width,
        element.height,
      );

      if (points[0][0] !== 0 || points[0][1] !== 0) {
        ({ points, x, y } =
          LinearElementEditor.getNormalizeElementPointsAndCoords({
            ...element,
            points,
            x: x ?? 0,
            y: y ?? 0,
          } as ExcalidrawLinearElement));
      }

      const restoredLine = restoreElementWithProperties(element, {
        type: "line",
        startBinding: repairBinding(
          element.startBinding,
          targetElementsMap,
          existingElementsMap,
        ),
        endBinding: repairBinding(
          element.endBinding,
          targetElementsMap,
          existingElementsMap,
        ),
        startArrowhead,
        endArrowhead,
        points,
        x,
        y,
        ...(isLineElement(element)
          ? {
              polygon: isValidPolygon(points)
                ? element.polygon ?? false
                : false,
            }
          : {}),
        ...getSizeFromPoints(points),
      });

      return handleOversizedLinearElements(normalizeLinearTexts(restoredLine));
    case "arrow": {
      const startArrowhead = element.startArrowhead ?? null;
      const endArrowhead =
        element.endArrowhead === undefined
          ? "arrow"
          : element.endArrowhead ?? null;
      const x = element.x as number | undefined;
      const y = element.y as number | undefined;
      const points = restoreLinearElementPoints(
        element.points,
        element.width,
        element.height,
      );
      const base = {
        type: element.type,
        startBinding: repairBinding(
          element.startBinding,
          targetElementsMap,
          existingElementsMap,
        ),
        endBinding: repairBinding(
          element.endBinding,
          targetElementsMap,
          existingElementsMap,
        ),
        startArrowhead,
        endArrowhead,
        points,
        x: x ?? 0,
        y: y ?? 0,
        elbowed: (element as ExcalidrawArrowElement).elbowed,
        ...getSizeFromPoints(points),
      };

      // TODO: Separate arrow from linear element
      const restoredElement = isElbowArrow(element)
        ? restoreElementWithProperties(element as ExcalidrawElbowArrowElement, {
            ...base,
            elbowed: true,
            fixedSegments:
              element.fixedSegments?.length && base.points.length >= 4
                ? element.fixedSegments
                : null,
            startIsSpecial: element.startIsSpecial,
            endIsSpecial: element.endIsSpecial,
          })
        : restoreElementWithProperties(element as ExcalidrawArrowElement, base);

      const normalizedRestoredElement = {
        ...restoredElement,
        ...LinearElementEditor.getNormalizeElementPointsAndCoords(
          restoredElement,
        ),
      };

      return handleOversizedLinearElements(
        normalizeLinearTexts(normalizedRestoredElement),
      );
    }

    case "mindmap-node": {
      assertMindmapShapeData(element.shape);
      const relation =
        element.role === "root"
          ? { role: "root" as const, parentId: null, order: null }
          : {
              role: "node" as const,
              parentId:
                typeof element.parentId === "string" ? element.parentId : "",
              order: isValidMindmapOrder(element.order) ? element.order : null,
            };
      const restored = restoreElementWithProperties(element, {
        graphId:
          typeof element.graphId === "string" && element.graphId
            ? element.graphId
            : `mindmap:${element.id}`,
        ...relation,
        collapsed: element.collapsed === true,
        shape: element.shape,
      });
      return normalizeMindmapNodeTexts({
        ...restored,
        x: isFiniteNumber(restored.x) ? restored.x : 0,
        y: isFiniteNumber(restored.y) ? restored.y : 0,
        width:
          isFiniteNumber(restored.width) && restored.width > 0
            ? restored.width
            : 160,
        height:
          isFiniteNumber(restored.height) && restored.height > 0
            ? restored.height
            : 56,
        angle: 0 as Radians,
      });
    }
    case "mindmap-edge": {
      const points = Array.isArray(element.points)
        ? element.points.filter(isValidPoint)
        : [];
      const restored = restoreElementWithProperties(element, {
        graphId: typeof element.graphId === "string" ? element.graphId : "",
        parentId: typeof element.parentId === "string" ? element.parentId : "",
        childId: typeof element.childId === "string" ? element.childId : "",
        routing: element.routing === "curved" ? "curved" : "orthogonal",
        points,
      });
      return { ...restored, angle: 0 as Radians, locked: false };
    }

    // generic elements
    case "composite":
    case "flow":
    case "sequence":
    case "dataflow":
      assertShapeElementType(element.type, element.shape);
      return normalizeSequenceFragmentGeometry(
        normalizeSequenceLifelineGeometry(
          restoreElementWithProperties(element, { shape: element.shape }),
        ),
      );
    case "table": {
      assertValidTableData(element.table);
      // only bounded float drift between the element size and its rows and
      // columns is normalized here; gross inconsistencies throw
      return normalizeTableTexts(
        normalizeTableDimensions(
          restoreElementWithProperties(element, {
            name: element.name ?? null,
            table: element.table,
          }),
        ),
      );
    }
    case "iframe":
    case "embeddable":
      return restoreElementWithProperties(element, {});
    case "stickynote": {
      const restored = normalizeStickyNote(
        restoreElementWithProperties(element, {
          baseHeight:
            element.baseHeight ??
            (element as typeof element & { maxHeight?: number }).maxHeight ??
            element.height,
        }),
      );
      const body = restored.texts?.body;
      if (!body) {
        return restored;
      }
      // 正文颜色跟随便签 ink：不保留 block 里自带的 color；
      // 字号归一化后按 fit 重新求高度（不创建文字元素）
      const style: TextBlockStyle = {
        fontFamily: body.style.fontFamily,
        fontSize: normalizeStickyNoteFontSize(body.style.fontSize),
        ...(body.style.fontWeight !== undefined
          ? { fontWeight: body.style.fontWeight }
          : {}),
        lineHeight: body.style.lineHeight,
        textAlign: body.style.textAlign,
        verticalAlign: body.style.verticalAlign,
      };
      const withBody = {
        ...restored,
        texts: withTextBlock(restored.texts, "body", {
          ...body,
          text: normalizeText(body.text),
          style,
        }),
      };
      const layout = getStickyNoteBodyLayout(withBody);
      return layout ? { ...withBody, ...layout.container } : withBody;
    }
    case "magicframe":
    case "frame":
      return restoreElementWithProperties(element, {
        name: element.name ?? null,
      });

    // Keep this exhaustive so unsupported persisted element types fail clearly.
  }
  throw new Error(
    `Unsupported element type: ${(element as ExcalidrawElement).type}`,
  );
};

/**
 * Repairs container element's boundElements array by removing duplicates. Also
 * removes any bound elements that do not exist in the elements array.
 *
 * NOTE mutates elements.
 */
const repairContainerElement = (
  container: Mutable<ExcalidrawElement>,
  elementsMap: Map<string, Mutable<ExcalidrawElement>>,
) => {
  if (container.boundElements) {
    // copy because we're not cloning on restore, and we don't want to mutate upstream
    const boundElements = container.boundElements.slice();

    // dedupe bindings
    const boundIds = new Set<ExcalidrawElement["id"]>();
    container.boundElements = boundElements.reduce(
      (
        acc: Mutable<NonNullable<ExcalidrawElement["boundElements"]>>,
        binding,
      ) => {
        const boundElement = elementsMap.get(binding.id);
        if (boundElement && !boundIds.has(binding.id)) {
          boundIds.add(binding.id);

          if (boundElement.isDeleted) {
            return acc;
          }

          acc.push(binding);
        }
        return acc;
      },
      [],
    );
  }
};

/** Preserve the preexisting recovery for a parent absent from restored input. */
const repairFrameMembership = (
  element: Mutable<ExcalidrawElement>,
  elementsMap: Map<string, Mutable<ExcalidrawElement>>,
) => {
  const ref = element.containerRef;
  if (!ref) {
    return;
  }
  const parent = elementsMap.get(ref.elementId);
  if (!parent) {
    element.containerRef = undefined;
  }
};

/**
 * Sticky note invariants that need both halves of the pair present, so they
 * run after binding repair. Mutates elements (like the repair helpers).
 * - a label's `baseFontSize` is meaningful only while bound to a sticky note:
 *   seeded from `fontSize` when missing, cleared everywhere else
 * - a sticky label's stroke is never transparent (it is the visible text)
 * - a note's stroke — its ink, which the footer paints with — equals its label's
 * - with `refreshDimensions`, the note and its label are refitted together
 */
const restoreStickyNotes = (
  elements: readonly ExcalidrawElement[],
  opts: { refreshDimensions: boolean },
) => {
  if (!opts.refreshDimensions) {
    return;
  }
  for (const element of elements) {
    if (!isStickyNoteElement(element) || element.isDeleted) {
      continue;
    }
    const layout = getStickyNoteBodyLayout(element);
    if (layout) {
      Object.assign(element, layout.container);
    }
  }
};

/** 仅在完整场景恢复时修复树；增量协作的单元素恢复不改变结构。 */
const restoreMindmaps = (elements: readonly ExcalidrawElement[]) => {
  const repaired = repairMindmapElements(elements);
  const graphs = new Map<string, ExcalidrawElement[]>();
  for (const element of repaired) {
    if (
      !element.isDeleted &&
      (isMindmapNodeElement(element) || isMindmapEdgeElement(element))
    ) {
      const graph = graphs.get(element.graphId) ?? [];
      graph.push(element);
      graphs.set(element.graphId, graph);
    }
  }
  if (!graphs.size) {
    return repaired;
  }
  const updated = arrayToMap(repaired);
  for (const [graphId, graph] of graphs) {
    const layout = layoutMindmap(buildMindmapGraphIndex(graph, graphId));
    for (const element of [...layout.elements, ...layout.edges]) {
      updated.set(element.id, element);
    }
  }
  return repaired.map((element) => updated.get(element.id)!);
};

export const restoreElements = <T extends ExcalidrawElement>(
  targetElements: readonly T[] | undefined | null,
  /** used for additional context (e.g. repairing arrow bindings) */
  existingElements: Readonly<ElementsMapOrArray> | null | undefined,
  opts?:
    | {
        refreshDimensions?: boolean;
        repairBindings?: boolean;
        deleteInvisibleElements?: boolean;
      }
    | undefined,
): CombineBrandsIfNeeded<T, OrderedExcalidrawElement> => {
  if (
    targetElements?.some(
      (element) =>
        element.type === "table" ||
        (element.type === "sequence" && isSequenceFragmentElement(element)),
    )
  ) {
    const incomingIds = new Set<string>();
    for (const element of targetElements) {
      if (incomingIds.has(element.id)) {
        throw new Error(`Duplicate element id: ${element.id}`);
      }
      incomingIds.add(element.id);
    }
    const otherElements = existingElements
      ? Array.from(existingElements.values()).filter(
          (element) => !incomingIds.has(element.id),
        )
      : [];
    assertValidContainerRefs([...otherElements, ...targetElements]);
  }
  // used to detect duplicate top-level element ids
  const existingIds = new Set<string>();
  const targetElementsMap = arrayToMap(targetElements || []);
  const existingElementsMap = existingElements
    ? arrayToMap(existingElements)
    : null;

  const restoredElements = syncInvalidIndices(
    (targetElements || []).reduce((elements, element) => {
      // filtering out selection, which is legacy, no longer kept in elements,
      // and causing issues if retained
      if (element.type === "selection") {
        return elements;
      }
      if (
        element.type === "composite" ||
        element.type === "flow" ||
        element.type === "sequence" ||
        element.type === "dataflow"
      ) {
        assertShapeElementType(element.type, element.shape);
      } else if (element.type === "mindmap-node") {
        assertMindmapShapeData(element.shape);
      } else if (element.type === "table") {
        // fail loudly on invalid structure or grossly inconsistent sizes
        assertValidTableData(element.table);
        normalizeTableDimensions(element);
      }
      let migratedElement: ExcalidrawElement | null;
      try {
        migratedElement = restoreElement(
          element,
          targetElementsMap,
          existingElementsMap,
          {
            deleteInvisibleElements: opts?.deleteInvisibleElements,
          },
        );
      } catch (error) {
        console.error("Error restoring element:", error);
        migratedElement = null;
      }
      if (migratedElement) {
        const localElement = existingElementsMap?.get(element.id);

        const shouldMarkAsDeleted =
          opts?.deleteInvisibleElements && isInvisiblySmallElement(element);

        if (shouldMarkAsDeleted) {
          migratedElement = bumpVersion(migratedElement, localElement?.version);
        }

        if (shouldMarkAsDeleted) {
          migratedElement = { ...migratedElement, isDeleted: true };
        }

        if (existingIds.has(migratedElement.id)) {
          migratedElement = { ...migratedElement, id: randomId() };
        }
        existingIds.add(migratedElement.id);

        elements.push(migratedElement);
      }

      return elements;
    }, [] as ExcalidrawElement[]),
  );

  if (!opts?.repairBindings) {
    return restoredElements as CombineBrandsIfNeeded<
      T,
      OrderedExcalidrawElement
    >;
  }

  // repair binding. Mutates elements.
  const restoredElementsMap = arrayToMap(restoredElements);
  for (const element of restoredElements) {
    repairFrameMembership(element, restoredElementsMap);

    if (element.boundElements) {
      repairContainerElement(element, restoredElementsMap);
    }

    if (opts.refreshDimensions && isTextElement(element)) {
      Object.assign(
        element,
        refreshTextDimensions(element, restoredElementsMap),
      );
    }

    if (isLinearElement(element)) {
      if (
        element.startBinding &&
        !restoredElementsMap.has(element.startBinding.elementId)
      ) {
        (element as Mutable<ExcalidrawLinearElement>).startBinding = null;
      }
      if (
        element.endBinding &&
        !restoredElementsMap.has(element.endBinding.elementId)
      ) {
        (element as Mutable<ExcalidrawLinearElement>).endBinding = null;
      }
    }
  }

  restoreStickyNotes(restoredElements, {
    refreshDimensions: !!opts.refreshDimensions,
  });

  const repairedElements = syncInvalidIndices(restoreMindmaps(restoredElements));

  // NOTE (mtolmacs): Temporary fix for invalid/self-bound elbow arrows
  // Need to iterate again so we have attached text nodes in elementsMap
  return repairedElements.map((element) => {
    if (
      isElbowArrow(element) &&
      !isArrowBoundToElement(element) &&
      !validateElbowPoints(element.points)
    ) {
      return {
        ...element,
        ...updateElbowArrowPoints(
          element,
          restoredElementsMap as NonDeletedSceneElementsMap,
          {
            points: [
              pointFrom<LocalPoint>(0, 0),
              element.points[element.points.length - 1],
            ],
          },
        ),
        index: element.index,
      };
    }

    if (
      isElbowArrow(element) &&
      element.startBinding &&
      element.endBinding &&
      element.startBinding.elementId === element.endBinding.elementId &&
      element.points.length > 1 &&
      element.points.some(
        ([rx, ry]) => Math.abs(rx) > 1e6 || Math.abs(ry) > 1e6,
      )
    ) {
      console.error("Fixing self-bound elbow arrow", element.id);
      const boundElement = restoredElementsMap.get(
        element.startBinding.elementId,
      );
      if (!boundElement) {
        console.error(
          "Bound element not found",
          element.startBinding.elementId,
        );
        return element;
      }

      return {
        ...element,
        x: boundElement.x + boundElement.width / 2,
        y: boundElement.y - 5,
        width: boundElement.width,
        height: boundElement.height,
        points: [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(0, -10),
          pointFrom<LocalPoint>(boundElement.width / 2 + 5, -10),
          pointFrom<LocalPoint>(
            boundElement.width / 2 + 5,
            boundElement.height / 2 + 5,
          ),
        ],
      };
    }

    return element;
  }) as CombineBrandsIfNeeded<T, OrderedExcalidrawElement>;
};

/**
 * When replacing elements that may exist locally, this bumps their versions
 * to the local version + 1. Mainly for later reconciliation to work properly.
 *
 * See https://github.com/excalidraw/excalidraw/issues/3795
 *
 * Generally use this on editor boundaries (importing from file etc.), though
 * it does not apply universally (e.g. we don't want to do this for collab
 * updates).
 */
export const bumpElementVersions = <T extends ExcalidrawElement>(
  targetElements: readonly T[],
  localElements: Readonly<ElementsMapOrArray> | null | undefined,
) => {
  const localElementsMap = localElements ? arrayToMap(localElements) : null;

  return targetElements.map((element) => {
    const localElement = localElementsMap?.get(element.id);

    if (
      localElement &&
      (localElement.version > element.version ||
        // same versions but different versionNonce means different edits
        // (this often means the element was bumped during restore e.g. due
        // to re-indexing, and the original element was modified elsewhere
        // and supplied as localElements)
        (localElement.version === element.version &&
          localElement.versionNonce !== element.versionNonce))
    ) {
      return bumpVersion(element, localElement.version);
    }
    return element;
  });
};

const coalesceAppStateValue = <
  T extends keyof ReturnType<typeof getDefaultAppState>,
>(
  key: T,
  appState: Exclude<ImportedDataState["appState"], null | undefined>,
  defaultAppState: ReturnType<typeof getDefaultAppState>,
) => {
  const value = appState[key];
  // NOTE the value! assertion is needed in TS 4.5.5 (fixed in newer versions)
  return value !== undefined ? value! : defaultAppState[key];
};

const LegacyAppStateMigrations: {
  [K in keyof LegacyAppState]: (
    ImportedDataState: Exclude<ImportedDataState["appState"], null | undefined>,
    defaultAppState: ReturnType<typeof getDefaultAppState>,
  ) => [LegacyAppState[K][1], AppState[LegacyAppState[K][1]]];
} = {
  isSidebarDocked: (appState, defaultAppState) => {
    return [
      "defaultSidebarDockedPreference",
      appState.isSidebarDocked ??
        coalesceAppStateValue(
          "defaultSidebarDockedPreference",
          appState,
          defaultAppState,
        ),
    ];
  },
};

const restoreColorTopPicksList = (
  value: unknown,
  slots: number = COLOR_TOP_PICKS_SLOTS,
): readonly string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  // keyed by normalized color value so notation variants (`#fff` vs
  // `#ffffff` vs `white`) dedupe, while the value keeps the original
  // notation — normalizing the output would break e.g. `transparent`
  // (→ `#00000000`), which the picker matches by literal value
  const colors = new Map<string, string>();
  for (const color of value) {
    if (typeof color !== "string") {
      continue;
    }
    const normalized = colorToHex(color) ?? color.toLowerCase();
    if (!colors.has(normalized)) {
      colors.set(normalized, color);
    }
    // the strip layout fits exactly this many slots — longer lists (hostile
    // or hand-edited storage) would overflow the properties island
    if (colors.size >= slots) {
      break;
    }
  }
  return colors.size ? [...colors.values()] : null;
};

export const restoreAppState = (
  appState: ImportedDataState["appState"],
  localAppState: Partial<AppState> | null | undefined,
): RestoredAppState => {
  appState = appState || {};
  const defaultAppState = getDefaultAppState();
  const nextAppState = {} as typeof defaultAppState;

  // first, migrate all legacy AppState properties to new ones. We do it
  // in one go before migrate the rest of the properties in case the new ones
  // depend on checking any other key (i.e. they are coupled)
  for (const legacyKey of Object.keys(
    LegacyAppStateMigrations,
  ) as (keyof typeof LegacyAppStateMigrations)[]) {
    if (legacyKey in appState) {
      const [nextKey, nextValue] = LegacyAppStateMigrations[legacyKey](
        appState,
        defaultAppState,
      );
      (nextAppState as any)[nextKey] = nextValue;
    }
  }

  for (const [key, defaultValue] of Object.entries(defaultAppState) as [
    keyof typeof defaultAppState,
    any,
  ][]) {
    // if AppState contains a legacy key, prefer that one and migrate its
    // value to the new one
    const suppliedValue = appState[key];

    const localValue = localAppState ? localAppState[key] : undefined;
    (nextAppState as any)[key] =
      suppliedValue !== undefined
        ? suppliedValue
        : localValue !== undefined
        ? localValue
        : defaultValue;
  }

  const boxSelectionMode =
    appState.boxSelectionMode ?? localAppState?.boxSelectionMode;
  if (boxSelectionMode !== undefined) {
    nextAppState.boxSelectionMode = boxSelectionMode;
  }

  // drop malformed persisted custom top picks (imported data is untrusted)
  nextAppState.colorTopPicks = {
    elementStroke: restoreColorTopPicksList(
      nextAppState.colorTopPicks?.elementStroke,
    ),
    elementBackground: restoreColorTopPicksList(
      nextAppState.colorTopPicks?.elementBackground,
    ),
    bucketFill: restoreColorTopPicksList(
      nextAppState.colorTopPicks?.bucketFill,
    ),
    stickyNoteStroke: restoreColorTopPicksList(
      nextAppState.colorTopPicks?.stickyNoteStroke,
    ),
    stickyNoteBackground: restoreColorTopPicksList(
      nextAppState.colorTopPicks?.stickyNoteBackground,
      // the sticky paper strip has six default picks, not five
      STICKY_NOTE_BACKGROUND_PICKS.length,
    ),
  };

  // legacy
  if ((appState as any).currentItemStrokeWidth !== undefined) {
    nextAppState.currentItemStrokeWidthKey =
      getStrokeWidthKey((appState as any).currentItemStrokeWidth) ??
      defaultAppState.currentItemStrokeWidthKey;
  }

  // 自由画笔笔宽必须是有限正数，否则回落默认像素值。
  nextAppState.currentItemFreedrawStrokeWidth =
    isFiniteNumber(nextAppState.currentItemFreedrawStrokeWidth) &&
    nextAppState.currentItemFreedrawStrokeWidth > 0
      ? nextAppState.currentItemFreedrawStrokeWidth
      : defaultAppState.currentItemFreedrawStrokeWidth;

  return {
    ...nextAppState,
    cursorButton: localAppState?.cursorButton || "up",
    // reset on fresh restore so as to hide the UI button if penMode not active
    penDetected:
      localAppState?.penDetected ??
      (appState.penMode ? appState.penDetected ?? false : false),
    activeTool: {
      ...updateActiveTool(
        defaultAppState,
        nextAppState.activeTool.type &&
          AllowedExcalidrawActiveTools[nextAppState.activeTool.type]
          ? nextAppState.activeTool
          : { type: "selection" },
      ),
      lastActiveTool: null,
      locked: nextAppState.activeTool.locked ?? false,
    },
    // Migrates from previous version where appState.zoom was a number
    zoom: {
      value: getNormalizedZoom(
        isFiniteNumber(appState.zoom)
          ? appState.zoom
          : appState.zoom?.value ?? defaultAppState.zoom.value,
      ),
    },
    openSidebar:
      // string (legacy)
      typeof (appState.openSidebar as any as string) === "string"
        ? { name: DEFAULT_SIDEBAR.name }
        : nextAppState.openSidebar,
    gridSize: getNormalizedGridSize(
      isFiniteNumber(appState.gridSize) ? appState.gridSize : DEFAULT_GRID_SIZE,
    ),
    gridStep: getNormalizedGridStep(
      isFiniteNumber(appState.gridStep) ? appState.gridStep : DEFAULT_GRID_STEP,
    ),
    currentItemStickynoteStrokeColor: normalizeStickyNoteStrokeColor(
      nextAppState.currentItemStickynoteStrokeColor,
    ),
    currentItemStickynoteBackgroundColor: normalizeStickyNoteBackgroundColor(
      nextAppState.currentItemStickynoteBackgroundColor,
    ),
    editingElementTitle: null,
  };
};

const restoreLibraryItem = (libraryItem: LibraryItem): LibraryItem | null => {
  const elements = getNonDeletedElements(
    restoreElements(libraryItem.elements, null),
  );
  return elements.length ? { ...libraryItem, elements } : null;
};

export const restoreLibraryItems = (
  libraryItems: LibraryItems = [],
  defaultStatus: LibraryItem["status"],
) => {
  const restoredItems: LibraryItem[] = [];
  for (const item of libraryItems) {
    if (Array.isArray(item)) {
      throw new Error("Unsupported library item format");
    }
    const restoredItem = restoreLibraryItem(item);
    if (restoredItem) {
      restoredItems.push(restoredItem);
    }
  }
  return restoredItems;
};
