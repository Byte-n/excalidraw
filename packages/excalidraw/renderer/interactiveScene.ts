import {
  clamp,
  pointFrom,
  pointsEqual,
  type GlobalPoint,
  type LocalPoint,
  type Radians,
  pointRotateRads,
  pointDistance,
} from "@excalidraw/math";

import {
  arrayToMap,
  BIND_MODE_TIMEOUT,
  DEFAULT_TRANSFORM_HANDLE_SPACING,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  TABLE_STRUCTURE_RAIL_OFFSET,
  TABLE_STRUCTURE_INSERTION_OFFSET,
  TABLE_STYLE,
  FRAME_STYLE,
  getFeatureFlag,
  getFontFamilyString,
  getFontString,
  getVerticalOffset,
  invariant,
  setColorAlpha,
  shouldRotateWithDiscreteAngle,
  THEME,
  applyDarkModeFilter,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import {
  deconstructRectanguloidElement,
  elementCenterPoint,
  getCompositeShapeAnchors,
  getCompositeShapeControlPoints,
  getCompositeShapeGlobalPath,
  getCompositeShapeOffsetPaths,
  isCompositeShapeElement,
  FOCUS_POINT_SIZE,
  getTransformHandles,
  getTransformHandlesFromCoords,
  hasBoundingBox,
  hitElementItself,
  isArrowElement,
  isBindableElement,
  isCurvedArrow,
  isElbowArrow,
  isFrameLikeElement,
  isImageElement,
  isLinearElement,
  isLineElement,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  isStickyNoteElement,
  getStickyNoteCornerRadius,
  isTableElement,
  isTableCellBackgroundText,
  getTableAxisBlockRange,
  getTableCellBounds,
  getTableCellFillColor,
  getTableCellRangeBounds,
  getCellBackgroundTextLayout,
  getLineHeightInPx,
  getTextVerticalOffset,
  resolveTableBackgroundTextFontWeight,
  resolveTableColor,
  maxBindingDistance_simple,
  isTextElement,
  getContainingFrame,
  LinearElementEditor,
  getActiveTextElement,
  getElementsInGroup,
  getSelectedGroupIds,
  isSelectedViaGroup,
  selectGroupsFromGivenElements,
  traceMindmapEdgePath,
  getCompletelySelectedMindmapGraphElementIds,
  getMindmapCollapseAffordance,
  getMindmapAddButtonAffordances,
  getMindmapLayoutConfig,
  MINDMAP_COLLAPSE_STUB_LENGTH,
  getQuickCreateHandles,
  QUICK_CREATE_HANDLE_SIZE,
  QUICK_CREATE_HANDLE_SIZE_HOVER,
  QUICK_CREATE_HANDLE_SIZE_DOWN,
  QUICK_CREATE_HANDLE_SIZE_COMPACT,
  QUICK_CREATE_HANDLE_SIZE_HOVER_COMPACT,
  QUICK_CREATE_HANDLE_SIZE_DOWN_COMPACT,
  QUICK_CREATE_HANDLE_REST_ALPHA,
  QUICK_CREATE_RING_HOVER_COMPACT,
  QUICK_CREATE_PLUS_SIZE,
  QUICK_CREATE_PLUS_SIZE_DOWN,
  QUICK_CREATE_PLUS_SIZE_COMPACT,
  renderElement,
} from "@excalidraw/element";

import { renderSelectionElement } from "@excalidraw/element";

import {
  getCommonBounds,
  getElementAbsoluteCoords,
  getTransformStatusReadout,
} from "@excalidraw/element";
import {
  getGlobalFixedPointForBindableElement,
  isFocusPointVisible,
} from "@excalidraw/element";

import type { EditorInterface } from "@excalidraw/common";

import type {
  TransformHandles,
  TransformHandleType,
  QuickCreateHandle,
  TransformStatusReadout,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawCompositeShapeElement,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawImageElement,
  ExcalidrawLinearElement,
  ExcalidrawMindmapEdgeElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawStickyNoteElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  GroupId,
  NonDeleted,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { getTableTitle, getTableTitleBar } from "../components/app/tableTitle";
import { renderSnaps } from "../renderer/renderSnaps";
import { getCompositeControlPointGlobal } from "../components/app/compositeShapeControls";
import { roundRect } from "../renderer/roundRect";
import {
  getScrollBars,
  SCROLLBAR_COLOR,
  SCROLLBAR_WIDTH,
} from "../scene/scrollbars";

import { getClientColor, renderRemoteCursors } from "../clients";
import {
  getTextAutoResizeHandle,
  getTextBoxPadding,
} from "../textAutoResizeHandle";

import {
  bootstrapCanvas,
  fillCircle,
  getNormalizedCanvasDimensions,
  strokeRectWithRotation_simple,
  snapScrollToDevicePixels,
  getSelectionColor,
} from "./helpers";

import type {
  AppState,
  AppClassProperties,
  InteractiveCanvasAppState,
} from "../types";
import type {
  InteractiveCanvasRenderConfig,
  InteractiveSceneRenderConfig,
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../scene/types";

// The interactive canvas used to be inverted in dark mode via a CSS filter
// (`invert(93%) hue-rotate(180deg)`), which is prohibitively slow in browsers
// that composite in software (e.g. Firefox on software WebRender). We now map
// the colors in JS instead (see `applyDarkModeFilter`), so the dark-mode
// values below are the post-filter equivalents of the previous ones.
// ---------------------------------------------------------------------------

const BINDING_HIGHLIGHT_RGB = {
  [THEME.LIGHT]: "22, 119, 255",
  [THEME.DARK]: "64, 150, 255",
} as const;

// alpha for the unified binding "glow" outline (subtle, drawn over the
// bindable element instead of a hard full-opacity stroke)
const BINDING_GLOW_ALPHA = {
  [THEME.LIGHT]: 0.22,
  [THEME.DARK]: 0.24,
} as const;

const BINDING_MIDPOINT_COLOR = {
  [THEME.LIGHT]: "rgba(22, 119, 255, 0.35)",
  [THEME.DARK]: "rgba(64, 150, 255, 0.4)",
} as const;

const SEARCH_MATCH_COLOR = {
  [THEME.LIGHT]: {
    focus: "rgba(255, 124, 0, 0.4)",
    match: "rgba(255, 226, 0, 0.4)",
  },
  [THEME.DARK]: {
    focus: "rgba(250, 123, 53, 0.4)",
    match: "rgba(221, 181, 136, 0.4)",
  },
} as const;

/** maps a light-mode UI color to its dark-mode counterpart when in dark mode */
const getThemedColor = (
  color: string,
  theme: InteractiveCanvasAppState["theme"],
) => applyDarkModeFilter(color, theme === THEME.DARK);

const renderElbowArrowMidPointHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elementsMap?: ElementsMap,
) => {
  invariant(appState.selectedLinearElement, "selectedLinearElement is null");

  const { segmentMidPointHoveredCoords } = appState.selectedLinearElement;

  invariant(segmentMidPointHoveredCoords, "midPointCoords is null");

  // When the selected elbow arrow can be resolved, render the hovered segment
  // as a 2px primary stroke with a solid primary capsule on its midpoint.
  // Otherwise fall back to the circular highlight.
  const element = elementsMap
    ? LinearElementEditor.getElement(
        appState.selectedLinearElement.elementId,
        elementsMap,
      )
    : null;

  if (element && isElbowArrow(element)) {
    const points = LinearElementEditor.getPointsGlobalCoordinates(
      element,
      elementsMap!,
    );
    const zoom = appState.zoom.value;
    for (let idx = 0; idx < points.length - 1; idx++) {
      const segStart = points[idx];
      const segEnd = points[idx + 1];
      const mid = pointFrom<GlobalPoint>(
        (segStart[0] + segEnd[0]) / 2,
        (segStart[1] + segEnd[1]) / 2,
      );
      if (pointsEqual(mid, segmentMidPointHoveredCoords, 2 / zoom)) {
        context.save();
        context.translate(appState.scrollX, appState.scrollY);
        drawElbowSegmentMidpointHandle(
          context,
          appState,
          mid,
          segStart,
          segEnd,
          { isHovered: true, isPhantom: false },
        );
        context.restore();
        return;
      }
    }
  }

  highlightPoint(segmentMidPointHoveredCoords, context, appState);
};

const renderLinearElementPointHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elementsMap: ElementsMap,
) => {
  const { elementId, hoverPointIndex } = appState.selectedLinearElement!;
  if (
    appState.selectedLinearElement?.isEditing &&
    appState.selectedLinearElement?.selectedPointsIndices?.includes(
      hoverPointIndex,
    )
  ) {
    return;
  }
  if (appState.selectedLinearElement?.isDragging) {
    return;
  }
  const element = LinearElementEditor.getElement(elementId, elementsMap);

  if (!element) {
    return;
  }
  const point = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    element,
    hoverPointIndex,
    elementsMap,
  );
  highlightPoint(point, context, appState);
};

/** draws the point marker in scene coordinates */
const highlightPoint = <Point extends LocalPoint | GlobalPoint>(
  point: Point,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  context.fillStyle = `rgba(${BINDING_HIGHLIGHT_RGB[appState.theme]}, 0.4)`;

  fillCircle(
    context,
    point[0],
    point[1],
    LinearElementEditor.POINT_HANDLE_SIZE / appState.zoom.value,
    false,
  );

  context.restore();
};

/**
 * Marks where on the hovered arrow the text tool would attach text — a free
 * endpoint, or the midpoint the arrow's label would center on.
 *
 * Purely presentational: `AppArrowText` maintains the anchor at every event
 * that can change it (pointermove, the ctrl/cmd binding toggle, pointerdown,
 * tool switches, finalize). The element lookup below only guards against the
 * arrow vanishing through channels no local event covers, e.g. a collaborator
 * deleting it.
 */
const renderHoveredArrowTextAnchor = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elementsMap: ElementsMap,
) => {
  const { elementId, anchor } = appState.hoveredArrowTextAnchor!;

  const element = elementsMap.get(elementId);

  if (!element || !isArrowElement(element) || element.isDeleted) {
    return;
  }

  const point =
    anchor === "label"
      ? LinearElementEditor.getBoundTextElementCenter(element, elementsMap)
      : LinearElementEditor.getPointAtIndexGlobalCoordinates(
          element,
          anchor === "start" ? 0 : -1,
          elementsMap,
        );

  highlightPoint(point, context, appState);
};

const renderSingleLinearPoint = <Point extends GlobalPoint | LocalPoint>(
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  point: Point,
  radius: number,
  isSelected: boolean,
  isPhantomPoint: boolean,
  isOverlappingPoint: boolean,
  isBound = false,
) => {
  context.setLineDash([]);
  const zoom = appState.zoom.value;
  const primaryRGB = BINDING_HIGHLIGHT_RGB[appState.theme];

  if (isPhantomPoint) {
    // midpoint add-point handle: 6px/zoom translucent primary circle
    context.fillStyle = `rgba(${primaryRGB}, 0.5)`;
    fillCircle(context, point[0], point[1], 6 / zoom, false, true);
    return;
  }

  // Endpoint handle. Bound endpoints render as a solid primary disc; free
  // endpoints render as a hollow primary ring (a selected free endpoint
  // renders solid so the selection stays visible while editing). The radius
  // is bumped when this point overlaps a neighbour so both stays grabbable.
  const r =
    (isOverlappingPoint
      ? radius * (appState.selectedLinearElement?.isEditing ? 1.5 : 2)
      : radius) / zoom;

  const solid = isBound || isSelected;
  context.lineWidth = 1.5 / zoom;
  context.strokeStyle = `rgba(${primaryRGB}, 1)`;
  context.fillStyle = `rgba(${primaryRGB}, 1)`;
  fillCircle(context, point[0], point[1], r, true, solid);
};

/**
 * Elbow segment-midpoint handle drawn as a 16×5 rounded capsule oriented
 * along the segment. The dragged/hovered segment gets a 2px primary segment
 * stroke and a solid primary capsule; non-fixed (add-point) segments get a
 * translucent primary capsule; fixed-vertex segments get a hollow primary
 * capsule.
 *
 * The caller must apply the scroll transform — the points passed in are in
 * scene coordinates.
 */
const drawElbowSegmentMidpointHandle = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  midPoint: GlobalPoint,
  segStart: GlobalPoint,
  segEnd: GlobalPoint,
  opts: { isHovered: boolean; isPhantom: boolean },
) => {
  const { isHovered, isPhantom } = opts;
  const zoom = appState.zoom.value;
  const primaryRGB = BINDING_HIGHLIGHT_RGB[appState.theme];
  const angle = Math.atan2(segEnd[1] - segStart[1], segEnd[0] - segStart[0]);

  context.save();
  context.setLineDash([]);

  if (isHovered) {
    // stroke the dragged/hovered segment in 2px primary
    context.strokeStyle = `rgba(${primaryRGB}, 1)`;
    context.lineWidth = 2 / zoom;
    context.beginPath();
    context.moveTo(segStart[0], segStart[1]);
    context.lineTo(segEnd[0], segEnd[1]);
    context.stroke();
  }

  // 16 × 5 rounded capsule centered on the midpoint, oriented along segment
  const capsuleLen = 16 / zoom;
  const capsuleW = 5 / zoom;
  const cornerR = 2.5 / zoom;

  context.translate(midPoint[0], midPoint[1]);
  context.rotate(angle);
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(
      -capsuleLen / 2,
      -capsuleW / 2,
      capsuleLen,
      capsuleW,
      cornerR,
    );
  } else {
    context.rect(-capsuleLen / 2, -capsuleW / 2, capsuleLen, capsuleW);
  }

  if (isHovered) {
    context.fillStyle = `rgba(${primaryRGB}, 1)`;
    context.fill();
  } else if (isPhantom) {
    context.fillStyle = `rgba(${primaryRGB}, 0.35)`;
    context.fill();
  } else {
    context.strokeStyle = `rgba(${primaryRGB}, 1)`;
    context.lineWidth = 1.5 / zoom;
    context.stroke();
  }

  context.restore();
};

/**
 * Hover trace for a hovered-but-unselected linear element: an 8px/zoom
 * translucent primary stroke painted along the element's point polyline. The
 * points returned by `getPointsGlobalCoordinates` already carry the element's
 * rotation, so the trace follows the path. This replaces the rectangular box
 * highlight that non-linear hovered elements receive.
 */
const renderHoveredLinearTrace = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  element: NonDeleted<ExcalidrawLinearElement>,
  elementsMap: RenderableElementsMap,
) => {
  const points = LinearElementEditor.getPointsGlobalCoordinates(
    element,
    elementsMap,
  );
  if (points.length < 2) {
    return;
  }
  const zoom = appState.zoom.value;
  const alpha = appState.theme === THEME.DARK ? 0.24 : 0.18;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.strokeStyle = `rgba(${
    BINDING_HIGHLIGHT_RGB[appState.theme]
  }, ${alpha})`;
  context.lineWidth = 8 / zoom;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash([]);

  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i][0], points[i][1]);
  }
  context.stroke();
  context.restore();
};

const strokeCompositeShapeOutline = (
  context: CanvasRenderingContext2D,
  element: ExcalidrawCompositeShapeElement,
  offset = 0,
) => {
  if (offset > 0) {
    for (const points of getCompositeShapeOffsetPaths(element, offset)) {
      if (!points.length) {
        continue;
      }
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      for (const point of points.slice(1)) {
        context.lineTo(point[0], point[1]);
      }
      context.closePath();
      context.stroke();
    }
    return;
  }

  const path = getCompositeShapeGlobalPath(element);
  context.beginPath();
  context.moveTo(path.start[0], path.start[1]);
  for (const command of path.commands) {
    if (command.type === "line") {
      context.lineTo(command.to[0], command.to[1]);
    } else {
      context.bezierCurveTo(
        command.control1[0],
        command.control1[1],
        command.control2[0],
        command.control2[1],
        command.to[0],
        command.to[1],
      );
    }
  }
  if (path.closed) {
    context.closePath();
  }
  context.stroke();
};

const renderBindingHighlightForBindableElement_simple = (
  context: CanvasRenderingContext2D,
  suggestedBinding: NonNullable<AppState["suggestedBinding"]>,
  elementsMap: ElementsMap,
  appState: InteractiveCanvasAppState,
  pointerCoords: GlobalPoint | null,
  angleLocked = false,
) => {
  // resolved through the parent chain, so cell members of a table inside a
  // frame highlight against the frame like other frame descendants
  const enclosingFrame = getContainingFrame(
    suggestedBinding.element,
    elementsMap,
  );
  if (enclosingFrame && isFrameLikeElement(enclosingFrame)) {
    context.translate(enclosingFrame.x, enclosingFrame.y);

    context.beginPath();

    if (FRAME_STYLE.radius && context.roundRect) {
      context.roundRect(
        -1,
        -1,
        enclosingFrame.width + 1,
        enclosingFrame.height + 1,
        FRAME_STYLE.radius / appState.zoom.value,
      );
    } else {
      context.rect(-1, -1, enclosingFrame.width + 1, enclosingFrame.height + 1);
    }

    context.clip();

    context.translate(-enclosingFrame.x, -enclosingFrame.y);
  }

  switch (suggestedBinding.element.type) {
    case "magicframe":
    case "frame":
      context.save();

      context.translate(suggestedBinding.element.x, suggestedBinding.element.y);

      context.lineWidth = 6 / Math.max(0.25, appState.zoom.value);
      context.strokeStyle = `rgba(${BINDING_HIGHLIGHT_RGB[appState.theme]}, ${
        BINDING_GLOW_ALPHA[appState.theme]
      })`;

      if (FRAME_STYLE.radius && context.roundRect) {
        context.beginPath();
        context.roundRect(
          0,
          0,
          suggestedBinding.element.width,
          suggestedBinding.element.height,
          FRAME_STYLE.radius / appState.zoom.value,
        );
        context.stroke();
        context.closePath();
      } else {
        context.strokeRect(
          0,
          0,
          suggestedBinding.element.width,
          suggestedBinding.element.height,
        );
      }

      context.restore();
      break;
    default:
      context.save();

      if (isCompositeShapeElement(suggestedBinding.element)) {
        context.lineWidth = 6 / Math.max(0.25, appState.zoom.value);
        context.strokeStyle = `rgba(${BINDING_HIGHLIGHT_RGB[appState.theme]}, ${
          BINDING_GLOW_ALPHA[appState.theme]
        })`;
        strokeCompositeShapeOutline(context, suggestedBinding.element);
        context.restore();
        break;
      }

      const center = elementCenterPoint(suggestedBinding.element, elementsMap);

      context.translate(center[0], center[1]);
      context.rotate(suggestedBinding.element.angle as Radians);
      context.translate(-center[0], -center[1]);

      context.translate(suggestedBinding.element.x, suggestedBinding.element.y);

      context.lineWidth = 6 / Math.max(0.25, appState.zoom.value);
      context.strokeStyle = `rgba(${BINDING_HIGHLIGHT_RGB[appState.theme]}, ${
        BINDING_GLOW_ALPHA[appState.theme]
      })`;

      const [segments, curves] = deconstructRectanguloidElement(
        suggestedBinding.element,
      );

      // Draw each line segment individually
      segments.forEach((segment) => {
        context.beginPath();
        context.moveTo(
          segment[0][0] - suggestedBinding.element.x,
          segment[0][1] - suggestedBinding.element.y,
        );
        context.lineTo(
          segment[1][0] - suggestedBinding.element.x,
          segment[1][1] - suggestedBinding.element.y,
        );
        context.stroke();
      });

      // Draw each curve individually (for rounded corners)
      curves.forEach((curve) => {
        const [start, control1, control2, end] = curve;
        context.beginPath();
        context.moveTo(
          start[0] - suggestedBinding.element.x,
          start[1] - suggestedBinding.element.y,
        );
        context.bezierCurveTo(
          control1[0] - suggestedBinding.element.x,
          control1[1] - suggestedBinding.element.y,
          control2[0] - suggestedBinding.element.x,
          control2[1] - suggestedBinding.element.y,
          end[0] - suggestedBinding.element.x,
          end[1] - suggestedBinding.element.y,
        );
        context.stroke();
      });
      context.restore();

      break;
  }

  if (
    appState.isMidpointSnappingEnabled &&
    !appState.gridModeEnabled &&
    !angleLocked &&
    (isFrameLikeElement(suggestedBinding.element) ||
      isBindableElement(suggestedBinding.element))
  ) {
    // Draw midpoint indicators
    const linearElement = appState.selectedLinearElement;
    const arrow =
      linearElement?.elementId &&
      LinearElementEditor.getElement(linearElement?.elementId, elementsMap);
    const cursorIsInsideBindable =
      pointerCoords &&
      hitElementItself({
        point: pointerCoords,
        element: suggestedBinding.element,
        elementsMap,
        threshold: 0,
        overrideShouldTestInside: true,
      });

    const isElbow =
      (arrow && isElbowArrow(arrow)) ||
      (appState.activeTool.type === "arrow" &&
        appState.currentItemArrowType === "elbow");

    if (!cursorIsInsideBindable || isElbow) {
      context.save();

      const center = elementCenterPoint(suggestedBinding.element, elementsMap);

      let midpoints: GlobalPoint[];
      if (isCompositeShapeElement(suggestedBinding.element)) {
        midpoints = getCompositeShapeAnchors(suggestedBinding.element);
      } else {
        const basePoints = [
          {
            x: suggestedBinding.element.width,
            y: suggestedBinding.element.height / 2,
          }, // RIGHT
          {
            x: suggestedBinding.element.width / 2,
            y: suggestedBinding.element.height,
          }, // BOTTOM
          { x: 0, y: suggestedBinding.element.height / 2 }, // LEFT
          { x: suggestedBinding.element.width / 2, y: 0 }, // TOP
        ];
        midpoints = basePoints.map((point) => {
          const globalPoint = pointFrom<GlobalPoint>(
            point.x + suggestedBinding.element.x,
            point.y + suggestedBinding.element.y,
          );
          const rotatedPoint = pointRotateRads(
            globalPoint,
            center,
            suggestedBinding.element.angle,
          );
          return pointFrom<GlobalPoint>(rotatedPoint[0], rotatedPoint[1]);
        });
      }

      const hoveredMidpoint =
        pointerCoords &&
        midpoints.reduce(
          (
            closestIdx: {
              idx: number;
              distance: number;
            },
            point,
            idx,
          ) => {
            const distance = pointDistance(point, pointerCoords);
            if (idx === -1 || distance < closestIdx.distance) {
              return { idx, distance };
            }
            return closestIdx;
          },
          {
            idx: -1,
            distance: Infinity,
          },
        );

      const hitRadius = 9 / appState.zoom.value;
      const anchorRadius = 6 / appState.zoom.value;
      const highlightThreshold =
        maxBindingDistance_simple(appState.zoom) +
        suggestedBinding.element.strokeWidth / 2;

      context.lineWidth = 1.5 / appState.zoom.value;

      midpoints.forEach((midpoint, idx) => {
        const isHighlighted =
          (!cursorIsInsideBindable || isElbow) &&
          hoveredMidpoint?.idx === idx &&
          hoveredMidpoint.distance <= highlightThreshold;

        // also render midpoint if cursor close but not highlighted
        // (for elbows, always show all points)
        const isShown =
          !isHighlighted &&
          (isElbow ||
            (idx === hoveredMidpoint?.idx &&
              hoveredMidpoint.distance <= highlightThreshold * 2));

        if (isHighlighted) {
          // HIT anchor: solid primary filled
          context.fillStyle = `rgba(${
            BINDING_HIGHLIGHT_RGB[appState.theme]
          }, 1)`;
          fillCircle(context, midpoint[0], midpoint[1], hitRadius, false, true);
        } else if (isShown) {
          // non-hit: hollow primary ring
          context.strokeStyle = BINDING_MIDPOINT_COLOR[appState.theme];
          fillCircle(
            context,
            midpoint[0],
            midpoint[1],
            anchorRadius,
            true,
            false,
          );
        }
      });

      context.restore();
    }
  }
};

const renderBindingHighlightForBindableElement_complex = (
  app: AppClassProperties,
  context: CanvasRenderingContext2D,
  element: ExcalidrawBindableElement,
  allElementsMap: NonDeletedSceneElementsMap,
  appState: InteractiveCanvasAppState,
  deltaTime: number,
  state?: { runtime: number },
) => {
  const countdownInProgress =
    app.state.bindMode === "orbit" && app.bindModeHandler !== null;

  const remainingTime =
    BIND_MODE_TIMEOUT -
    (state?.runtime ?? (countdownInProgress ? 0 : BIND_MODE_TIMEOUT));
  const opacity = clamp((1 / BIND_MODE_TIMEOUT) * remainingTime, 0.0001, 1);
  const offset = element.strokeWidth / 2;

  // resolved through the parent chain, so cell members of a table inside a
  // frame highlight against the frame like other frame descendants
  const enclosingFrame = getContainingFrame(element, allElementsMap);
  if (enclosingFrame && isFrameLikeElement(enclosingFrame)) {
    context.translate(enclosingFrame.x, enclosingFrame.y);

    context.beginPath();

    if (FRAME_STYLE.radius && context.roundRect) {
      context.roundRect(
        -1,
        -1,
        enclosingFrame.width + 1,
        enclosingFrame.height + 1,
        FRAME_STYLE.radius / appState.zoom.value,
      );
    } else {
      context.rect(-1, -1, enclosingFrame.width + 1, enclosingFrame.height + 1);
    }

    context.clip();

    context.translate(-enclosingFrame.x, -enclosingFrame.y);
  }

  switch (element.type) {
    case "magicframe":
    case "frame":
      context.save();

      context.translate(element.x, element.y);

      context.lineWidth = 6 / Math.max(0.25, appState.zoom.value);
      context.strokeStyle = `rgba(${
        BINDING_HIGHLIGHT_RGB[appState.theme]
      }, ${opacity})`;

      if (FRAME_STYLE.radius && context.roundRect) {
        context.beginPath();
        context.roundRect(
          0,
          0,
          element.width,
          element.height,
          FRAME_STYLE.radius / appState.zoom.value,
        );
        context.stroke();
        context.closePath();
      } else {
        context.strokeRect(0, 0, element.width, element.height);
      }

      context.restore();
      break;
    default:
      context.save();

      if (isCompositeShapeElement(element)) {
        context.translate(appState.scrollX, appState.scrollY);
        context.lineWidth = 6 / Math.max(0.25, appState.zoom.value);
        context.strokeStyle = `rgba(${BINDING_HIGHLIGHT_RGB[appState.theme]}, ${
          opacity / 2
        })`;
        strokeCompositeShapeOutline(context, element, offset);
        context.restore();
        break;
      }

      const center = elementCenterPoint(element, allElementsMap);
      const cx = center[0] + appState.scrollX;
      const cy = center[1] + appState.scrollY;

      context.translate(cx, cy);
      context.rotate(element.angle as Radians);
      context.translate(-cx, -cy);

      context.translate(
        element.x + appState.scrollX - offset,
        element.y + appState.scrollY - offset,
      );

      context.lineWidth = 6 / Math.max(0.25, appState.zoom.value);
      context.strokeStyle = `rgba(${BINDING_HIGHLIGHT_RGB[appState.theme]}, ${
        opacity / 2
      })`;

      const [segments, curves] = deconstructRectanguloidElement(
        element,
        offset,
      );

      // Draw each line segment individually
      segments.forEach((segment) => {
        context.beginPath();
        context.moveTo(
          segment[0][0] - element.x + offset,
          segment[0][1] - element.y + offset,
        );
        context.lineTo(
          segment[1][0] - element.x + offset,
          segment[1][1] - element.y + offset,
        );
        context.stroke();
      });

      // Draw each curve individually (for rounded corners)
      curves.forEach((curve) => {
        const [start, control1, control2, end] = curve;
        context.beginPath();
        context.moveTo(
          start[0] - element.x + offset,
          start[1] - element.y + offset,
        );
        context.bezierCurveTo(
          control1[0] - element.x + offset,
          control1[1] - element.y + offset,
          control2[0] - element.x + offset,
          control2[1] - element.y + offset,
          end[0] - element.x + offset,
          end[1] - element.y + offset,
        );
        context.stroke();
      });
      context.restore();

      break;
  }

  // Middle indicator is not rendered after it expired
  if (!countdownInProgress || (state?.runtime ?? 0) > BIND_MODE_TIMEOUT) {
    return;
  }

  const radius = 0.5 * (Math.min(element.width, element.height) / 2);

  // Draw center snap area
  if (!isFrameLikeElement(element)) {
    context.save();
    context.translate(
      element.x + appState.scrollX,
      element.y + appState.scrollY,
    );

    const PROGRESS_RATIO = (1 / BIND_MODE_TIMEOUT) * remainingTime;

    context.strokeStyle = getThemedColor("rgba(0, 0, 0, 0.2)", appState.theme);
    context.lineWidth = 1 / appState.zoom.value;
    context.setLineDash([4 / appState.zoom.value, 4 / appState.zoom.value]);
    context.lineDashOffset = (-PROGRESS_RATIO * 10) / appState.zoom.value;

    context.beginPath();
    context.ellipse(
      element.width / 2,
      element.height / 2,
      radius,
      radius,
      0,
      0,
      2 * Math.PI,
    );
    context.stroke();

    // context.strokeStyle = "transparent";
    context.fillStyle = getThemedColor("rgba(0, 0, 0, 0.04)", appState.theme);
    context.beginPath();
    context.ellipse(
      element.width / 2,
      element.height / 2,
      radius * (1 - opacity),
      radius * (1 - opacity),
      0,
      0,
      2 * Math.PI,
    );

    context.fill();

    context.restore();

    if (
      appState.isMidpointSnappingEnabled &&
      !appState.gridModeEnabled &&
      (!app.lastPointerMoveEvent ||
        !shouldRotateWithDiscreteAngle(app.lastPointerMoveEvent))
    ) {
      // Draw midpoint indicators
      context.save();
      context.translate(
        element.x + appState.scrollX,
        element.y + appState.scrollY,
      );

      const midpointRadius = 6 / appState.zoom.value;
      context.lineWidth = 1.5 / appState.zoom.value;
      context.strokeStyle = `rgba(${
        BINDING_HIGHLIGHT_RGB[appState.theme]
      }, ${opacity})`;

      let midpoints;
      if (isCompositeShapeElement(element)) {
        midpoints = getCompositeShapeAnchors(element).map(([x, y]) => ({
          x: x - element.x,
          y: y - element.y,
        }));
      } else {
        const center = elementCenterPoint(element, allElementsMap);
        const basePoints = [
          { x: element.width / 2, y: 0 }, // TOP
          { x: element.width, y: element.height / 2 }, // RIGHT
          { x: element.width / 2, y: element.height }, // BOTTOM
          { x: 0, y: element.height / 2 }, // LEFT
        ];
        midpoints = basePoints.map((point) => {
          const globalPoint = pointFrom<GlobalPoint>(
            point.x + element.x,
            point.y + element.y,
          );
          const rotatedPoint = pointRotateRads(
            globalPoint,
            center,
            element.angle,
          );
          return {
            x: rotatedPoint[0] - element.x,
            y: rotatedPoint[1] - element.y,
          };
        });
      }

      // Hollow primary anchor rings (stroke-only, so no clearout is needed)
      midpoints.forEach((midpoint) => {
        fillCircle(
          context,
          midpoint.x,
          midpoint.y,
          midpointRadius,
          true,
          false,
        );
      });

      context.restore();
    }
  }

  return {
    runtime: (state?.runtime ?? 0) + deltaTime,
  };
};

const renderBindingHighlightForBindableElement = (
  app: AppClassProperties,
  context: CanvasRenderingContext2D,
  suggestedBinding: AppState["suggestedBinding"],
  allElementsMap: NonDeletedSceneElementsMap,
  appState: InteractiveCanvasAppState,
  deltaTime: number,
  state?: { runtime: number },
) => {
  if (suggestedBinding === null) {
    return;
  }

  if (getFeatureFlag("COMPLEX_BINDINGS")) {
    return renderBindingHighlightForBindableElement_complex(
      app,
      context,
      suggestedBinding.element,
      allElementsMap,
      appState,
      deltaTime,
      state,
    );
  }

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  const pointerCoords = app.lastPointerMoveCoords
    ? pointFrom<GlobalPoint>(
        app.lastPointerMoveCoords.x,
        app.lastPointerMoveCoords.y,
      )
    : null;
  const angleLocked =
    !!app.lastPointerMoveEvent &&
    shouldRotateWithDiscreteAngle(app.lastPointerMoveEvent);
  renderBindingHighlightForBindableElement_simple(
    context,
    suggestedBinding,
    allElementsMap,
    appState,
    pointerCoords,
    angleLocked,
  );
  context.restore();
};

type ElementSelectionBorder = {
  angle: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selectionColors: string[];
  dashed?: boolean;
  cx: number;
  cy: number;
  activeEmbeddable: boolean;
  padding?: number;
};

const ELEMENT_OUTLINE_PADDING = DEFAULT_TRANSFORM_HANDLE_SPACING * 2;

const renderSelectionBorder = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elementProperties: ElementSelectionBorder,
) => {
  const {
    angle,
    x1,
    y1,
    x2,
    y2,
    selectionColors,
    cx,
    cy,
    dashed,
    activeEmbeddable,
  } = elementProperties;
  const elementWidth = x2 - x1;
  const elementHeight = y2 - y1;

  const padding = elementProperties.padding ?? ELEMENT_OUTLINE_PADDING;

  const linePadding = padding / appState.zoom.value;
  const lineWidth = 3 / appState.zoom.value;
  const spaceWidth = 3 / appState.zoom.value;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.lineWidth = (activeEmbeddable ? 4 : 1) / appState.zoom.value;

  const count = selectionColors.length;
  for (let index = 0; index < count; ++index) {
    context.strokeStyle = selectionColors[index];
    context.setLineDash(
      dashed
        ? [lineWidth, spaceWidth + (lineWidth + spaceWidth) * (count - 1)]
        : [],
    );
    context.lineDashOffset = (lineWidth + spaceWidth) * index;
    strokeRectWithRotation_simple(
      context,
      x1 - linePadding,
      y1 - linePadding,
      elementWidth + linePadding * 2,
      elementHeight + linePadding * 2,
      cx,
      cy,
      angle,
    );
  }
  context.restore();
};

/** 变换读数气泡的规格，全部是屏幕 px（绘制时一律除以 zoom）。 */
const TRANSFORM_STATUS_FONT = 11;
const TRANSFORM_STATUS_HEIGHT = 20;
const TRANSFORM_STATUS_RADIUS = 5;
/** 气泡「离指针最近的那条边」到指针的距离。 */
const TRANSFORM_STATUS_GAP = 16;

/**
 * 解出气泡中心相对锚点的偏移量 d，使 `nearest(d)` 正好等于 gap。
 *
 * 只把气泡的上边中点摆到 `锚点 + 方向 × gap` 是不够的：短文本（`15°`）和
 * 长文本（`120 × 80`）在同一个 gap 下肉眼看到的空隙并不一样，旋转时恰好
 * 总是短文本，看上去就比缩放远。所以按「最近的一条边」对齐。
 *
 * `nearest(d)` 随 d 单调增，二分即可；顺带兜住 gap 比半个气泡还小的退化。
 */
const solveTransformStatusOffset = (
  ux: number,
  uy: number,
  width: number,
  height: number,
  gap: number,
) => {
  const nearest = (d: number) =>
    Math.hypot(
      Math.max(0, ux * d - width / 2),
      Math.max(0, uy * d - height / 2),
    );
  let lo = 0;
  let hi = gap + width + height + 4;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (nearest(mid) < gap) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
};

/**
 * 变换读数气泡：11px 字、高 20、圆角 5 的胶囊，跟随指针，沿「选区中心 →
 * 指针」方向外推，最近边恒距指针 {@link TRANSFORM_STATUS_GAP} 屏幕 px。
 * 旋转报角度（墨底），缩放报尺寸（选区色底）。
 */
const renderTransformStatusLabel = (
  context: CanvasRenderingContext2D,
  app: AppClassProperties,
  appState: InteractiveCanvasAppState,
  readout: TransformStatusReadout,
  selectionColor: string,
  center: { x: number; y: number },
) => {
  const zoom = appState.zoom.value;
  // 指针用 viewport.lastPosition：它挂在 ownerDocument 的 pointermove 上，
  // 手势进行中也逐帧更新（lastPointerMoveCoords 只在画布上的移动里更新）
  const pointer = viewportCoordsToSceneCoords(
    {
      clientX: app.viewport.lastPosition.x,
      clientY: app.viewport.lastPosition.y,
    },
    appState,
  );

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.font = `${TRANSFORM_STATUS_FONT / zoom}px sans-serif`;
  const width = context.measureText(readout.text).width + 12 / zoom;
  const height = TRANSFORM_STATUS_HEIGHT / zoom;

  const gap = TRANSFORM_STATUS_GAP / zoom;
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = Math.abs(dx) / length;
  const uy = Math.abs(dy) / length;
  const offset = solveTransformStatusOffset(ux, uy, width, height, gap);
  // Math.sign(0) 为 0：指针正对中心时不会往某个方向甩出去
  const cx = pointer.x + Math.sign(dx) * ux * offset;
  const cy = pointer.y + Math.sign(dy) * uy * offset;

  const isAngle = readout.kind === "angle";
  context.fillStyle = isAngle
    ? getThemedColor("#1f2329", appState.theme)
    : selectionColor;
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(
      cx - width / 2,
      cy - height / 2,
      width,
      height,
      TRANSFORM_STATUS_RADIUS / zoom,
    );
  } else {
    context.rect(cx - width / 2, cy - height / 2, width, height);
  }
  context.fill();
  // 角度底是墨色，文字随主题反转（同 renderTableResizeSizeLabel）；尺寸底是
  // 选区色（本身已随主题），白字两头都压得住
  context.fillStyle = isAngle
    ? getThemedColor("#ffffff", appState.theme)
    : "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(readout.text, cx, cy);
  context.restore();
};

const renderMindmapEdgeSelection = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  edge: ExcalidrawMindmapEdgeElement,
  color: string,
) => {
  if (!edge.points.length) {
    return;
  }

  context.save();
  context.translate(appState.scrollX + edge.x, appState.scrollY + edge.y);
  context.strokeStyle = color;
  context.lineWidth = edge.strokeWidth + 2 / appState.zoom.value;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([]);
  traceMindmapEdgePath(context, edge);
  context.stroke();
  context.restore();
};

/** 思维导图折叠 affordance：折叠徽标（计数）常驻，「−」按钮随悬停/单选出现。 */
const renderMindmapCollapseAffordances = (
  context: CanvasRenderingContext2D,
  app: AppClassProperties,
  appState: InteractiveCanvasAppState,
  allElementsMap: ElementsMap,
  selectedElements: readonly NonDeletedExcalidrawElement[],
) => {
  const collapsedCounts = app.scene.getMindmapCollapsedCounts();
  const hiddenIds = app.scene.getMindmapHiddenElementIds();
  const hasChildren = new Set<string>();
  const rootByGraph = new Map<string, ExcalidrawMindmapNodeElement>();
  for (const element of allElementsMap.values()) {
    if (isMindmapNodeElement(element)) {
      if (element.parentId) {
        hasChildren.add(element.parentId);
      }
      if (element.role === "root") {
        rootByGraph.set(element.graphId, element);
      }
    }
  }
  const hoveredNodeId = app.mindmap.getHoveredNodeId();
  const singleSelectedNodeId =
    selectedElements.length === 1 && isMindmapNodeElement(selectedElements[0])
      ? selectedElements[0].id
      : null;
  const isDark = appState.theme === THEME.DARK;

  for (const element of allElementsMap.values()) {
    if (!isMindmapNodeElement(element) || hiddenIds.has(element.id)) {
      continue;
    }
    const count = collapsedCounts.get(element.id) ?? 0;
    const showBadge = element.collapsed && count > 0;
    const showMinus =
      !element.collapsed &&
      !appState.viewModeEnabled &&
      hasChildren.has(element.id) &&
      (hoveredNodeId === element.id || singleSelectedNodeId === element.id);
    if (!showBadge && !showMinus) {
      continue;
    }
    const direction = getMindmapLayoutConfig(
      rootByGraph.get(element.graphId),
    ).direction;
    const affordance = getMindmapCollapseAffordance(element, direction);
    const branchColor = applyDarkModeFilter(element.strokeColor, isDark);
    const fillColor = applyDarkModeFilter("#ffffff", isDark);

    context.save();
    context.translate(appState.scrollX, appState.scrollY);
    if (showBadge) {
      const { edgeMidpoint, normal, badge } = affordance;
      context.strokeStyle = branchColor;
      context.lineWidth = 1.5;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(edgeMidpoint[0], edgeMidpoint[1]);
      context.lineTo(
        edgeMidpoint[0] + normal[0] * MINDMAP_COLLAPSE_STUB_LENGTH,
        edgeMidpoint[1] + normal[1] * MINDMAP_COLLAPSE_STUB_LENGTH,
      );
      context.stroke();
      context.beginPath();
      context.arc(
        badge.center[0],
        badge.center[1],
        badge.radius,
        0,
        Math.PI * 2,
      );
      context.fillStyle = fillColor;
      context.fill();
      context.lineWidth = 1.25;
      context.stroke();
      context.fillStyle = branchColor;
      context.font = "600 11px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(count), badge.center[0], badge.center[1] + 0.5);
    } else {
      const { minus } = affordance;
      context.beginPath();
      context.arc(
        minus.center[0],
        minus.center[1],
        minus.radius,
        0,
        Math.PI * 2,
      );
      context.fillStyle = fillColor;
      context.fill();
      context.lineWidth = 1.25;
      context.strokeStyle = branchColor;
      context.stroke();
      context.lineWidth = 1.5;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(minus.center[0] - 3, minus.center[1]);
      context.lineTo(minus.center[0] + 3, minus.center[1]);
      context.stroke();
    }
    context.restore();
  }
};

/**
 * 思维导图「+」新增节点按钮：子侧/同级侧，仅随单选出现。
 * 目标节点与显隐判定由 app.mindmap.getAddButtonTargetNode() 统一收口，
 * 与指针命中（hitTestAddButton）共用，保证所见即可点。
 */
const renderMindmapAddButtons = (
  context: CanvasRenderingContext2D,
  app: AppClassProperties,
  appState: InteractiveCanvasAppState,
  allElementsMap: ElementsMap,
) => {
  const node = app.mindmap.getAddButtonTargetNode();
  if (!node || !allElementsMap.has(node.id)) {
    return;
  }
  let root: ExcalidrawMindmapNodeElement | undefined;
  let hasChildren = false;
  for (const element of allElementsMap.values()) {
    if (!isMindmapNodeElement(element)) {
      continue;
    }
    if (element.parentId === node.id) {
      hasChildren = true;
    }
    if (element.graphId === node.graphId && element.role === "root") {
      root = element;
    }
  }
  const { direction } = getMindmapLayoutConfig(root);
  const collapsedCount =
    app.scene.getMindmapCollapsedCounts().get(node.id) ?? 0;
  const childSideAffordance =
    node.collapsed && collapsedCount > 0
      ? ("badge" as const)
      : hasChildren
      ? ("minus" as const)
      : null;
  const affordances = getMindmapAddButtonAffordances(
    node,
    direction,
    childSideAffordance,
  );
  const hovered = app.mindmap.getHoveredAddButton();
  const isDark = appState.theme === THEME.DARK;
  const branchColor = applyDarkModeFilter(node.strokeColor, isDark);
  const fillColor = applyDarkModeFilter("#ffffff", isDark);

  const kinds =
    node.role === "root"
      ? (["child"] as const)
      : (["child", "sibling"] as const);
  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  for (const kind of kinds) {
    const { center, radius } = affordances[kind];
    const isHovered = hovered === kind;
    context.beginPath();
    context.arc(center[0], center[1], radius, 0, Math.PI * 2);
    context.fillStyle = isHovered ? branchColor : fillColor;
    context.fill();
    context.lineWidth = 1.25;
    context.strokeStyle = branchColor;
    context.stroke();
    // 「+」两笔
    context.lineWidth = 1.5;
    context.lineCap = "round";
    context.strokeStyle = isHovered ? fillColor : branchColor;
    context.beginPath();
    context.moveTo(center[0] - 3.5, center[1]);
    context.lineTo(center[0] + 3.5, center[1]);
    context.moveTo(center[0], center[1] - 3.5);
    context.lineTo(center[0], center[1] + 3.5);
    context.stroke();
  }
  context.restore();
};

/**
 * 方向手柄的三个形态档（屏幕 px，除 `filled` 外都在绘制时除以 zoom）。
 * 常态是极简点，悬停就地长成完整手柄（反色 + 加号），按下略缩一档。
 */
type QuickCreateHandleSpec = {
  size: number;
  ring: number;
  /** 圆填充选中色；false 时是底色圆 + 选中色描边（触屏常态） */
  filled: boolean;
  /** 加号总长，0 表示不画 */
  plus: number;
};

const getQuickCreateHandleSpec = (
  handle: QuickCreateHandle,
  state: "rest" | "hover" | "down",
  /** 指针不能悬停（触屏）：常态直接画完整形态，否则功能被藏起来 */
  touchLike: boolean,
): QuickCreateHandleSpec => {
  const compact = handle.compact;
  if (state === "rest") {
    if (touchLike) {
      return {
        size: QUICK_CREATE_HANDLE_SIZE_HOVER,
        ring: 2,
        filled: false,
        plus: QUICK_CREATE_PLUS_SIZE,
      };
    }
    return {
      size: compact
        ? QUICK_CREATE_HANDLE_SIZE_COMPACT
        : QUICK_CREATE_HANDLE_SIZE,
      ring: 1,
      filled: true,
      plus: 0,
    };
  }
  if (state === "down") {
    return {
      size: compact
        ? QUICK_CREATE_HANDLE_SIZE_DOWN_COMPACT
        : QUICK_CREATE_HANDLE_SIZE_DOWN,
      ring: 1.5,
      filled: true,
      plus: compact
        ? QUICK_CREATE_PLUS_SIZE_COMPACT
        : QUICK_CREATE_PLUS_SIZE_DOWN,
    };
  }
  return {
    size: compact
      ? QUICK_CREATE_HANDLE_SIZE_HOVER_COMPACT
      : QUICK_CREATE_HANDLE_SIZE_HOVER,
    // 设计稿规格表：紧凑档悬停的描边比常规档细一档（1.25 vs 1.5）
    ring: compact ? QUICK_CREATE_RING_HOVER_COMPACT : 1.5,
    filled: true,
    plus: compact ? QUICK_CREATE_PLUS_SIZE_COMPACT : QUICK_CREATE_PLUS_SIZE,
  };
};

/**
 * 结果预演：幽灵副本 + 幽灵连线。仅悬停命中且无修饰键时画。
 *
 * 元素由 `AppQuickCreate.getGhostElements` 提供（不进场景、不消耗 id / 随机
 * 序列），这里**用真实的元素渲染**（`renderElement`），所以线条、箭头、填充与
 * 落地后的图形一模一样，只有不透明度压到一半表示尚未提交。
 *
 * 调用点在已按 scrollX/scrollY 平移过的上下文里，而 `renderElement` 自己还会
 * 加一次 `appState.scrollX`：把 appState 的滚动归零，正好抵消外层那次平移。
 */
const renderQuickCreateGhost = (
  context: CanvasRenderingContext2D,
  app: AppClassProperties,
  appState: InteractiveCanvasAppState,
  elements: readonly NonDeletedExcalidrawElement[],
  allElementsMap: NonDeletedSceneElementsMap,
) => {
  if (!elements.length) {
    return;
  }
  // 预演元素不在场景里，合并进本次绘制的映射表，`renderElement` 才查得到
  const ghostMap = arrayToMap(elements);
  const mergedElementsMap = new Map([
    ...allElementsMap,
    ...ghostMap,
  ]) as RenderableElementsMap;
  const mergedAllElementsMap = new Map([
    ...allElementsMap,
    ...ghostMap,
  ]) as NonDeletedSceneElementsMap;

  const renderConfig: StaticCanvasRenderConfig = {
    imageCache: app.imageCache,
    isExporting: false,
    renderGrid: false,
    canvasBackgroundColor: app.state.viewBackgroundColor,
    embedsValidationStatus: app.embedsValidationStatus,
    elementsPendingErasure: app.elementsPendingErasure,
    pendingFlowchartNodes: null,
    theme: appState.theme,
  };
  const previewAppState = { ...appState, scrollX: 0, scrollY: 0 };

  context.save();
  context.setLineDash([]);
  for (const element of elements) {
    renderElement(
      element,
      mergedElementsMap,
      mergedAllElementsMap,
      app.rc,
      context,
      renderConfig,
      previewAppState,
    );
  }
  context.restore();
};

/**
 * 方向手柄：单选图形时在指示框四边外侧画实心圆点（悬停就地长成完整手柄并预演
 * 建图结果）。显隐与几何由 getQuickCreateHandles 统一收口，与指针命中
 * （hitTestQuickCreateHandle）共用，保证所见即可点；按住修饰键时该函数返回空，
 * 四个手柄与预演因此一起消失。
 *
 * 一帧内的次序：预演先画、四个圆点后画，创建入口永远压在预演之上——预演是
 * 「点下去会得到什么」，而圆点才是此刻要点的东西。
 */
const renderQuickCreateHandles = (
  context: CanvasRenderingContext2D,
  app: AppClassProperties,
  appState: InteractiveCanvasAppState,
  selectionColor: string,
  allElementsMap: NonDeletedSceneElementsMap,
) => {
  // 修饰键状态由 App.quickCreate 维护（keydown / keyup / blur）：按住时整组不渲染
  const suppressed = app.quickCreate.isSuppressed();
  const handles = getQuickCreateHandles(app, "mouse", suppressed);
  if (!handles.length) {
    return;
  }
  const hovered = app.quickCreate.getHovered();
  const zoom = appState.zoom.value;
  const handleSurface = getThemedColor("#fff", appState.theme);
  // 相机层拿不到当前指针类型（同 getTransformHandles 调用点的注释）：用「上一次
  // 按下是触屏」与「移动设备」两个既有信号近似「当前指针不能悬停」。
  const touchLike =
    app.state.lastPointerDownWith === "touch" ||
    app.editorInterface.userAgent.isMobileDevice;
  // 调用点在已按 scrollX/scrollY 平移过的上下文内，这里直接用场景坐标
  context.save();
  context.setLineDash([]);
  const hoveredHandle = hovered
    ? handles.find(
        (handle) =>
          handle.elementId === hovered.elementId &&
          handle.direction === hovered.direction,
      )
    : undefined;
  // 预演先画，四个创建入口随后压在上面：预演是「点下去会得到什么」，而入口
  // 是当前要操作的东西，不能被它盖住
  if (hoveredHandle) {
    renderQuickCreateGhost(
      context,
      app,
      appState,
      app.quickCreate.getGhostElements(hoveredHandle),
      allElementsMap,
    );
  }
  for (const handle of handles) {
    const isHovered = handle === hoveredHandle;
    // 能 hover 就说明不是纯触屏，按悬停态画
    const spec = getQuickCreateHandleSpec(
      handle,
      isHovered ? "hover" : "rest",
      touchLike,
    );
    // 常态圆点压低透明度：安静地提示「这儿能长出图形」，悬停才转实。触屏常态
    // 画的是悬停档的完整手柄（没有 hover 可等），那是唯一的入口，不压暗。
    context.globalAlpha =
      !isHovered && !(touchLike && spec.plus)
        ? QUICK_CREATE_HANDLE_REST_ALPHA
        : 1;
    const radius = spec.size / 2 / zoom;
    context.beginPath();
    context.arc(handle.center.x, handle.center.y, radius, 0, Math.PI * 2);
    context.fillStyle = spec.filled ? selectionColor : handleSurface;
    context.fill();
    context.lineWidth = spec.ring / zoom;
    context.strokeStyle = spec.filled ? handleSurface : selectionColor;
    context.stroke();
    if (spec.plus) {
      const arm = spec.plus / 2 / zoom;
      context.lineWidth = 2 / zoom;
      context.lineCap = "round";
      context.strokeStyle = spec.filled ? handleSurface : selectionColor;
      context.beginPath();
      context.moveTo(handle.center.x - arm, handle.center.y);
      context.lineTo(handle.center.x + arm, handle.center.y);
      context.moveTo(handle.center.x, handle.center.y - arm);
      context.lineTo(handle.center.x, handle.center.y + arm);
      context.stroke();
      context.lineCap = "butt";
    }
  }
  context.restore();
};

/**
 * The frame's own rounded border reused as interaction feedback (hover ring,
 * drop-target highlight): strokes the border path in place, optionally with a
 * translucent fill washed over the board.
 */
const renderFrameBorderFeedback = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  frame: NonDeleted<ExcalidrawFrameLikeElement>,
  elementsMap: ElementsMap,
  strokeStyle: string,
  fillStyle: string | null,
) => {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(frame, elementsMap);
  const width = x2 - x1;
  const height = y2 - y1;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.translate(x1 + width / 2, y1 + height / 2);
  context.rotate(frame.angle);

  context.beginPath();
  const radius = FRAME_STYLE.radius / appState.zoom.value;
  if (radius && context.roundRect) {
    context.roundRect(-width / 2, -height / 2, width, height, radius);
  } else {
    context.rect(-width / 2, -height / 2, width, height);
  }
  if (fillStyle) {
    context.fillStyle = fillStyle;
    context.fill();
  }
  context.strokeStyle = strokeStyle;
  context.lineWidth = 1.5 / appState.zoom.value;
  context.stroke();
  context.restore();
};

const renderFrameHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  frame: NonDeleted<ExcalidrawFrameLikeElement>,
  elementsMap: ElementsMap,
) => {
  // drop target (design: 拖入目标) — 6% primary over the board, 1.5px primary
  // border
  renderFrameBorderFeedback(
    context,
    appState,
    frame,
    elementsMap,
    getThemedColor("rgb(22,119,255)", appState.theme),
    getThemedColor("rgba(22,119,255,0.06)", appState.theme),
  );
};

/**
 * Table interaction feedback accent — the design's `--color-selection`
 * (#1677ff; the dark theme is derived by `getThemedColor`, phase-6 D.1) — and
 * its precomputed fills. Every table hover/selection/structure channel reads
 * from this one source.
 */
const TABLE_STRUCTURE_ACCENT = "rgb(22,119,255)";
/** 10% accent — hovered cell fill (the drop-target preview reuses it). */
const TABLE_CELL_HOVER_FILL = "rgba(22,119,255,0.10)";
/** 8% accent — cell range selection fill. */
const TABLE_RANGE_SELECTION_FILL = "rgba(22,119,255,0.08)";
/** 12% accent — selected row/column band fill. */
const TABLE_ROW_COL_SELECTION_FILL = "rgba(22,119,255,0.12)";
/** Idle grip bar fill (the design's `--tbl-grip`). */
const TABLE_RAIL_IDLE_FILL = "#E5E6EB";
/** Hover grip bar fill — the design's 45% accent over `--tbl-grip`. */
const TABLE_RAIL_HOVER_FILL = "#88b4f4";
/** Idle grip dot and resting insertion dot fill (the design's `--page-muted`). */
const TABLE_STRUCTURE_DOT_FILL = "#8F959E";

/**
 * Light-blue fill of the hovered table cell (phase-1.md:78). The cell bounds
 * are table-local offsets applied directly in scene space.
 */
const renderTableCellHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  highlightedTableCell: NonNullable<
    InteractiveCanvasAppState["highlightedTableCell"]
  >,
  elementsMap: ElementsMap,
) => {
  const table = elementsMap.get(highlightedTableCell.tableId);
  if (!table || !isTableElement(table) || table.isDeleted) {
    return;
  }
  const bounds = getTableCellBounds(table.table, highlightedTableCell.cellId);
  if (!bounds) {
    return;
  }

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.fillStyle = getThemedColor(TABLE_CELL_HOVER_FILL, appState.theme);
  context.fillRect(
    table.x + bounds.x,
    table.y + bounds.y,
    bounds.width,
    bounds.height,
  );
  context.restore();
};

const renderTableCellSelection = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selection: NonNullable<InteractiveCanvasAppState["tableCellSelection"]>,
  elementsMap: ElementsMap,
) => {
  const table = elementsMap.get(selection.tableId);
  if (!table || !isTableElement(table) || table.isDeleted) {
    return;
  }
  const range = getTableCellRangeBounds(
    table.table,
    selection.anchorId,
    selection.focusId,
  );
  if (!range) {
    return;
  }
  const unionX = table.x + range.x;
  const unionY = table.y + range.y;
  const unionWidth = range.width;
  const unionHeight = range.height;
  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  // 8% accent fill + 1px accent frame (设计稿 cell-range)
  context.fillStyle = getThemedColor(
    TABLE_RANGE_SELECTION_FILL,
    appState.theme,
  );
  context.fillRect(unionX, unionY, unionWidth, unionHeight);
  context.strokeStyle = getThemedColor(TABLE_STRUCTURE_ACCENT, appState.theme);
  context.lineWidth = 1 / appState.zoom.value;
  context.strokeRect(unionX, unionY, unionWidth, unionHeight);
  // the anchor cell keeps a 2px inner stroke, inset 1px to clear the frame
  const anchor = getTableCellBounds(table.table, selection.anchorId);
  if (anchor) {
    const inset = 1 / appState.zoom.value;
    context.lineWidth = 2 / appState.zoom.value;
    context.strokeRect(
      table.x + anchor.x + inset,
      table.y + anchor.y + inset,
      anchor.width - inset * 2,
      anchor.height - inset * 2,
    );
  }
  context.restore();
};

/** Shared setup for the table structure overlays (scene-space translation). */
const withTableLocalTransform = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  draw: () => void,
) => {
  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  draw();
  context.restore();
};

// Keep structure indicators outside the selection border while leaving room
// for the insertion plus mark.
const getTableStructureIndicatorOffset = (zoom: number) =>
  TABLE_STRUCTURE_RAIL_OFFSET / zoom;
const getTableStructureInsertionOffset = (zoom: number) =>
  TABLE_STRUCTURE_INSERTION_OFFSET / zoom;

/** A plus mark on a hovered insertion boundary (16px accent disc, white +). */
const drawInsertPlusMark = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  x: number,
  y: number,
) => {
  const radius = 8 / appState.zoom.value;
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = getThemedColor(TABLE_STRUCTURE_ACCENT, appState.theme);
  context.fill();
  context.strokeStyle = getThemedColor("#ffffff", appState.theme);
  const arm = 3.5 / appState.zoom.value;
  context.beginPath();
  context.moveTo(x - arm, y);
  context.lineTo(x + arm, y);
  context.moveTo(x, y - arm);
  context.lineTo(x, y + arm);
  context.lineWidth = 1.5 / appState.zoom.value;
  context.lineCap = "round";
  context.stroke();
  context.restore();
};

/**
 * One row/column grip: a 6px rounded bar (rx 3) with a centered 2×3 dot
 * grid. Three states (设计稿 tbl-grip): idle `--tbl-grip`, hover 45% accent,
 * selected full accent; the dots turn white on hover/selected. All chrome
 * metrics are CSS px, zoom-compensated.
 */
const drawStructureRail = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  x: number,
  y: number,
  length: number,
  orientation: "row" | "column",
  state: "idle" | "hover" | "selected" = "idle",
) => {
  const zoom = appState.zoom.value;
  const thickness = 6 / zoom;
  const radius = 3 / zoom;
  const dot = 0.75 / zoom;
  const spacing = 3.2 / zoom;
  // the bar hugs the table edge: for columns it grows upwards from (x, y),
  // for rows leftwards — same anchoring the 9px bar used
  const barX = orientation === "column" ? x : x - thickness;
  const barY = orientation === "column" ? y - thickness : y;
  const barWidth = orientation === "column" ? length : thickness;
  const barHeight = orientation === "column" ? thickness : length;
  context.save();
  context.fillStyle = getThemedColor(
    state === "selected"
      ? TABLE_STRUCTURE_ACCENT
      : state === "hover"
      ? TABLE_RAIL_HOVER_FILL
      : TABLE_RAIL_IDLE_FILL,
    appState.theme,
  );
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(barX, barY, barWidth, barHeight, radius);
  } else {
    context.rect(barX, barY, barWidth, barHeight);
  }
  context.fill();
  context.fillStyle = getThemedColor(
    state === "idle" ? TABLE_STRUCTURE_DOT_FILL : "#ffffff",
    appState.theme,
  );
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 2; b++) {
      const d1 = (a - 1) * spacing;
      const d2 = (b - 0.5) * spacing;
      context.beginPath();
      context.arc(
        orientation === "column"
          ? barX + barWidth / 2 + d1
          : barX + barWidth / 2 + d2,
        orientation === "column"
          ? barY + barHeight / 2 + d2
          : barY + barHeight / 2 + d1,
        dot,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  context.restore();
};

const renderTableStructureAffordances = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  table: NonDeleted<ExcalidrawTableElement>,
  hover: InteractiveCanvasAppState["tableStructureHover"] = null,
  title?: ExcalidrawTextElement,
) => {
  withTableLocalTransform(context, appState, () => {
    if (hover?.tableId === table.id) {
      const bar = getTableTitleBar(
        table,
        title,
        appState.zoom.value,
        title?.fontSize ?? DEFAULT_FONT_SIZE,
      );
      const dot = 1.4 / appState.zoom.value;
      context.save();
      context.fillStyle = getThemedColor("#6b6f76", appState.theme);
      for (let row = 0; row < 2; row++) {
        for (let column = 0; column < 3; column++) {
          context.beginPath();
          context.arc(
            bar.grip.x + (4 + column * 6) / appState.zoom.value,
            bar.grip.y + (7 + row * 6) / appState.zoom.value,
            dot,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
      if (!title) {
        context.globalAlpha = 0.65;
        context.font = `700 ${DEFAULT_FONT_SIZE}px ${getFontFamilyString({
          fontFamily: DEFAULT_FONT_FAMILY,
        })}`;
        context.textBaseline = "top";
        context.fillText("Title", bar.x, bar.y);
      }
      context.restore();
    }
    const railOffset = getTableStructureIndicatorOffset(appState.zoom.value);
    const rowSelection =
      appState.tableRowColSelection?.tableId === table.id &&
      appState.tableRowColSelection.kind === "row"
        ? appState.tableRowColSelection.id
        : null;
    const columnSelection =
      appState.tableRowColSelection?.tableId === table.id &&
      appState.tableRowColSelection.kind === "column"
        ? appState.tableRowColSelection.id
        : null;
    const hoveredRow =
      hover?.tableId === table.id && hover.kind === "rowGrip"
        ? hover.rowId
        : null;
    const hoveredColumn =
      hover?.tableId === table.id && hover.kind === "columnGrip"
        ? hover.columnId
        : null;

    let offset = 0;
    for (const column of table.table.columns) {
      drawStructureRail(
        context,
        appState,
        table.x + offset,
        table.y - railOffset,
        column.width,
        "column",
        hoveredColumn === column.id
          ? "hover"
          : columnSelection === column.id
          ? "selected"
          : "idle",
      );
      offset += column.width;
    }

    offset = 0;
    for (const row of table.table.rows) {
      drawStructureRail(
        context,
        appState,
        table.x - railOffset,
        table.y + offset,
        row.height,
        "row",
        hoveredRow === row.id
          ? "hover"
          : rowSelection === row.id
          ? "selected"
          : "idle",
      );
      offset += row.height;
    }

    const insertionOffset = getTableStructureInsertionOffset(
      appState.zoom.value,
    );
    context.fillStyle = getThemedColor(
      TABLE_STRUCTURE_DOT_FILL,
      appState.theme,
    );
    const drawInsertionPoint = (x: number, y: number) => {
      context.beginPath();
      context.arc(x, y, 2 / appState.zoom.value, 0, Math.PI * 2);
      context.fill();
    };
    offset = 0;
    drawInsertionPoint(table.x, table.y - insertionOffset);
    for (const column of table.table.columns) {
      offset += column.width;
      drawInsertionPoint(table.x + offset, table.y - insertionOffset);
    }
    offset = 0;
    drawInsertionPoint(table.x - insertionOffset, table.y);
    for (const row of table.table.rows) {
      offset += row.height;
      drawInsertionPoint(table.x - insertionOffset, table.y + offset);
    }
  });
};

/** Selected row/column fill. */
const renderTableRowColSelection = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selection: NonNullable<InteractiveCanvasAppState["tableRowColSelection"]>,
  elementsMap: ElementsMap,
) => {
  const table = elementsMap.get(selection.tableId);
  if (!table || !isTableElement(table) || table.isDeleted) {
    return;
  }

  withTableLocalTransform(context, appState, () => {
    if (selection.kind === "row") {
      let offset = 0;
      for (const row of table.table.rows) {
        if (row.id === selection.id) {
          context.fillStyle = getThemedColor(
            TABLE_ROW_COL_SELECTION_FILL,
            appState.theme,
          );
          context.fillRect(table.x, table.y + offset, table.width, row.height);
          context.strokeStyle = getThemedColor(
            TABLE_STRUCTURE_ACCENT,
            appState.theme,
          );
          context.lineWidth = 1.5 / appState.zoom.value;
          context.strokeRect(
            table.x,
            table.y + offset,
            table.width,
            row.height,
          );
          break;
        }
        offset += row.height;
      }
    } else {
      let offset = 0;
      for (const column of table.table.columns) {
        if (column.id === selection.id) {
          context.fillStyle = getThemedColor(
            TABLE_ROW_COL_SELECTION_FILL,
            appState.theme,
          );
          context.fillRect(
            table.x + offset,
            table.y,
            column.width,
            table.height,
          );
          context.strokeStyle = getThemedColor(
            TABLE_STRUCTURE_ACCENT,
            appState.theme,
          );
          context.lineWidth = 1.5 / appState.zoom.value;
          context.strokeRect(
            table.x + offset,
            table.y,
            column.width,
            table.height,
          );
          break;
        }
        offset += column.width;
      }
    }
  });
};

/**
 * Editing a cell's background text keeps two location cues (phase-6 D.4): a
 * 2px accent inner stroke on the edited cell (inset 1px so it clears the grid
 * lines) and the accent rails of its row and column. Every other table
 * overlay stays suppressed while editing, and no edit-mode hit behavior is
 * added — clicking a rail or outside the table still just ends the edit.
 */
const renderTableEditingIndicator = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elementsMap: ElementsMap,
) => {
  const editing = appState.editingTextElement;
  if (!editing || !isTableCellBackgroundText(editing)) {
    return;
  }
  const ref = editing.containerRef;
  if (ref?.kind !== "tableCell") {
    return;
  }
  const table = elementsMap.get(ref.elementId);
  if (!table || !isTableElement(table) || table.isDeleted) {
    return;
  }
  // the edited text belongs to the merge anchor's cell
  const rawCell = table.table.cells.find((cell) => cell.id === ref.cellId);
  const cell = rawCell?.mergedInto
    ? table.table.cells.find((candidate) => candidate.id === rawCell.mergedInto)
    : rawCell;
  const bounds = cell && getTableCellBounds(table.table, cell.id);
  if (!cell || !bounds) {
    return;
  }

  withTableLocalTransform(context, appState, () => {
    const zoom = appState.zoom.value;
    const inset = 1 / zoom;
    context.strokeStyle = getThemedColor(
      TABLE_STRUCTURE_ACCENT,
      appState.theme,
    );
    context.lineWidth = 2 / zoom;
    context.strokeRect(
      table.x + bounds.x + inset,
      table.y + bounds.y + inset,
      bounds.width - inset * 2,
      bounds.height - inset * 2,
    );
    const railOffset = getTableStructureIndicatorOffset(zoom);
    let offset = 0;
    for (const column of table.table.columns) {
      if (column.id === cell.columnId) {
        drawStructureRail(
          context,
          appState,
          table.x + offset,
          table.y - railOffset,
          column.width,
          "column",
          "selected",
        );
      }
      offset += column.width;
    }
    offset = 0;
    for (const row of table.table.rows) {
      if (row.id === cell.rowId) {
        drawStructureRail(
          context,
          appState,
          table.x - railOffset,
          table.y + offset,
          row.height,
          "row",
          "selected",
        );
      }
      offset += row.height;
    }
  });
};

const getTableStructureVisual = (
  appState: InteractiveCanvasAppState,
): InteractiveCanvasAppState["tableStructureHover"] => {
  const gesture = appState.containerGestureVisual;
  if (gesture?.container === "table") {
    return gesture.axis === "row"
      ? {
          tableId: gesture.tableId,
          kind: "rowResize",
          rowId: gesture.id,
          edge: gesture.edge,
        }
      : {
          tableId: gesture.tableId,
          kind: "columnResize",
          columnId: gesture.id,
          edge: gesture.edge,
        };
  }
  return appState.tableStructureHover;
};

/**
 * The dimension label of an active row/column resize gesture (phase-6): the
 * same bubble as `renderTransformStatusLabel` (11px, height 20, rx 5, ink
 * background, white text), pinned to the dragged separator — above the line
 * for a column width, left of the line for a row height. Shown only while the
 * gesture runs, never on a bare hover.
 */
const renderTableResizeSizeLabel = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  text: string,
  anchor: { x: number; y: number },
  placement: "above" | "left",
) => {
  const zoom = appState.zoom.value;
  context.save();
  context.font = "11px sans-serif";
  const width = context.measureText(text).width + 12 / zoom;
  const height = 20 / zoom;
  const gap = 6 / zoom;
  const left =
    placement === "above" ? anchor.x - width / 2 : anchor.x - gap - width;
  const top =
    placement === "above" ? anchor.y - gap - height : anchor.y - height / 2;
  context.fillStyle = getThemedColor("#1f2329", appState.theme);
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(left, top, width, height, 5 / zoom);
  } else {
    context.rect(left, top, width, height);
  }
  context.fill();
  context.fillStyle = getThemedColor("#ffffff", appState.theme);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, left + width / 2, top + height / 2);
  context.restore();
};

/** Paint hover or active resize using the current table geometry. */
const renderTableStructureHover = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  hover: NonNullable<InteractiveCanvasAppState["tableStructureHover"]>,
  elementsMap: ElementsMap,
) => {
  const table = elementsMap.get(hover.tableId);
  if (!table || !isTableElement(table) || table.isDeleted) {
    return;
  }
  const accent = getThemedColor(TABLE_STRUCTURE_ACCENT, appState.theme);
  const lineWidth = 2 / appState.zoom.value;
  const indicatorOffset = getTableStructureInsertionOffset(appState.zoom.value);

  withTableLocalTransform(context, appState, () => {
    switch (hover.kind) {
      case "table": {
        break;
      }
      case "rowResize": {
        const rowIndex = table.table.rows.findIndex(
          (row) => row.id === hover.rowId,
        );
        if (rowIndex < 0) {
          break;
        }
        const offsetAfter = table.table.rows
          .slice(0, rowIndex + 1)
          .reduce((acc, row) => acc + row.height, 0);
        // a start border drags the row's top edge, an end border the bottom
        const offset =
          hover.edge === "start"
            ? offsetAfter - table.table.rows[rowIndex].height
            : offsetAfter;
        context.beginPath();
        context.moveTo(table.x, table.y + offset);
        context.lineTo(table.x + table.width, table.y + offset);
        context.lineWidth = lineWidth;
        context.strokeStyle = accent;
        context.stroke();
        if (appState.containerGestureVisual?.container === "table") {
          renderTableResizeSizeLabel(
            context,
            appState,
            `${Math.round(table.table.rows[rowIndex].height)}`,
            { x: table.x, y: table.y + offset },
            "left",
          );
        }
        break;
      }
      case "columnResize": {
        const columnIndex = table.table.columns.findIndex(
          (column) => column.id === hover.columnId,
        );
        if (columnIndex < 0) {
          break;
        }
        const offsetAfter = table.table.columns
          .slice(0, columnIndex + 1)
          .reduce((acc, column) => acc + column.width, 0);
        // a start border drags the column's left edge, an end border the right
        const offset =
          hover.edge === "start"
            ? offsetAfter - table.table.columns[columnIndex].width
            : offsetAfter;
        context.beginPath();
        context.moveTo(table.x + offset, table.y);
        context.lineTo(table.x + offset, table.y + table.height);
        context.lineWidth = lineWidth;
        context.strokeStyle = accent;
        context.stroke();
        if (appState.containerGestureVisual?.container === "table") {
          renderTableResizeSizeLabel(
            context,
            appState,
            `${Math.round(table.table.columns[columnIndex].width)}`,
            { x: table.x + offset, y: table.y },
            "above",
          );
        }
        break;
      }
      case "rowInsert": {
        const boundaryY =
          table.y +
          table.table.rows
            .slice(0, hover.boundaryIndex)
            .reduce((sum, row) => sum + row.height, 0);
        context.save();
        context.beginPath();
        context.moveTo(table.x, boundaryY);
        context.lineTo(table.x + table.width, boundaryY);
        context.lineWidth = lineWidth;
        context.strokeStyle = accent;
        context.stroke();
        context.restore();
        drawInsertPlusMark(
          context,
          appState,
          table.x - indicatorOffset,
          boundaryY,
        );
        break;
      }
      case "columnInsert": {
        const boundaryX =
          table.x +
          table.table.columns
            .slice(0, hover.boundaryIndex)
            .reduce((sum, column) => sum + column.width, 0);
        context.save();
        context.beginPath();
        context.moveTo(boundaryX, table.y);
        context.lineTo(boundaryX, table.y + table.height);
        context.lineWidth = lineWidth;
        context.strokeStyle = accent;
        context.stroke();
        context.restore();
        drawInsertPlusMark(
          context,
          appState,
          boundaryX,
          table.y - indicatorOffset,
        );
        break;
      }
      case "rowGrip": {
        let offset = 0;
        for (const row of table.table.rows) {
          if (row.id === hover.rowId) {
            context.fillStyle = getThemedColor(
              TABLE_CELL_HOVER_FILL,
              appState.theme,
            );
            context.fillRect(
              table.x,
              table.y + offset,
              table.width,
              row.height,
            );
            break;
          }
          offset += row.height;
        }
        break;
      }
      case "columnGrip": {
        let offset = 0;
        for (const column of table.table.columns) {
          if (column.id === hover.columnId) {
            context.fillStyle = getThemedColor(
              TABLE_CELL_HOVER_FILL,
              appState.theme,
            );
            context.fillRect(
              table.x + offset,
              table.y,
              column.width,
              table.height,
            );
            break;
          }
          offset += column.width;
        }
        break;
      }
    }
  });
};

/**
 * Cross-axis offset of the move ghost card from the table edge (CSS px) —
 * the design keeps the floating card slightly off the faded source band so
 * both stay readable.
 */
const TABLE_MOVE_GHOST_OFFSET = 16;

/** The ghost card's drop shadow, in CSS box-shadow semantics (phase-6). */
const TABLE_MOVE_GHOST_SHADOW = [
  { offsetY: 1, blur: 2, opacity: 0.08 },
  { offsetY: 3, blur: 8, opacity: 0.1 },
] as const;

/**
 * The floating card that follows the pointer while a row/column is dragged
 * (phase-6): a white rounded card with the source band's cell fills and
 * background texts. Content elements are not copied into the ghost — they
 * stay behind, faded, at the source position.
 */
const renderTableMoveGhost = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  table: ExcalidrawTableElement,
  preview: NonNullable<InteractiveCanvasAppState["tableStructurePreview"]>,
  elementsMap: ElementsMap,
) => {
  const { sourceId, pointer, kind } = preview;
  if (!sourceId || !pointer) {
    return;
  }
  let block: { start: number; end: number };
  try {
    block = getTableAxisBlockRange(table.table, kind, sourceId);
  } catch {
    return;
  }
  const entries = kind === "row" ? table.table.rows : table.table.columns;
  const blockEntries = entries.slice(block.start, block.end + 1);
  if (!blockEntries.length) {
    return;
  }
  const sizeOf = (entry: typeof entries[number]) =>
    "height" in entry ? entry.height : entry.width;
  const blockOffset = entries
    .slice(0, block.start)
    .reduce((sum, entry) => sum + sizeOf(entry), 0);
  const blockSize = blockEntries.reduce((sum, entry) => sum + sizeOf(entry), 0);

  const zoom = appState.zoom.value;
  const isDark = appState.theme === THEME.DARK;
  const ghostWidth = kind === "row" ? table.width : blockSize;
  const ghostHeight = kind === "row" ? blockSize : table.height;
  // the drag axis centers on the pointer; the cross axis rides the table edge
  const ghostX =
    kind === "row"
      ? table.x + TABLE_MOVE_GHOST_OFFSET / zoom
      : pointer.x - ghostWidth / 2;
  const ghostY =
    kind === "row"
      ? pointer.y - ghostHeight / 2
      : table.y + TABLE_MOVE_GHOST_OFFSET / zoom;

  const traceCard = () => {
    context.beginPath();
    if (context.roundRect) {
      context.roundRect(
        ghostX,
        ghostY,
        ghostWidth,
        ghostHeight,
        TABLE_STYLE.radius,
      );
    } else {
      context.rect(ghostX, ghostY, ghostWidth, ghostHeight);
    }
  };

  // shadow: canvas shadow offsets/blur live in the untransformed bitmap
  // space, so they scale by the current transform's magnitude (same treatment
  // as the sticky note shadow in renderElement)
  const transform = context.getTransform?.();
  const bitmapScale = transform ? Math.hypot(transform.a, transform.b) : 0;
  context.save();
  context.fillStyle = resolveTableColor(TABLE_STYLE.backgroundColor, isDark);
  if (bitmapScale) {
    const shadowColor = applyDarkModeFilter("#1f2329", isDark);
    for (const layer of TABLE_MOVE_GHOST_SHADOW) {
      context.shadowColor = setColorAlpha(shadowColor, layer.opacity);
      context.shadowBlur = layer.blur * bitmapScale;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = layer.offsetY * bitmapScale;
      traceCard();
      context.fill();
    }
  } else {
    traceCard();
    context.fill();
  }
  context.restore();

  // cell fills and background texts of the source band, clipped to the card
  const blockIds = new Set(blockEntries.map((entry) => entry.id));
  const textsByCell = new Map<string, ExcalidrawTextElement[]>();
  for (const element of elementsMap.values()) {
    const ref = element.containerRef;
    if (
      ref?.kind === "tableCell" &&
      ref.elementId === table.id &&
      ref.role === "backgroundText" &&
      isTextElement(element)
    ) {
      const list = textsByCell.get(ref.cellId);
      if (list) {
        list.push(element);
      } else {
        textsByCell.set(ref.cellId, [element]);
      }
    }
  }
  context.save();
  traceCard();
  context.clip();
  for (const cell of table.table.cells) {
    if (cell.mergedInto) {
      continue;
    }
    if (!blockIds.has(kind === "row" ? cell.rowId : cell.columnId)) {
      continue;
    }
    const bounds = getTableCellBounds(table.table, cell.id);
    if (!bounds) {
      continue;
    }
    // table-local cell origin, rebased onto the ghost card
    const cellX = ghostX + bounds.x - (kind === "column" ? blockOffset : 0);
    const cellY = ghostY + bounds.y - (kind === "row" ? blockOffset : 0);
    const fill = getTableCellFillColor(cell, isDark, table.table);
    if (fill) {
      context.fillStyle = fill;
      context.fillRect(cellX, cellY, bounds.width, bounds.height);
    }
    for (const text of textsByCell.get(cell.id) ?? []) {
      const layout = getCellBackgroundTextLayout(
        text,
        table,
        bounds,
        elementsMap,
      );
      const layoutX =
        ghostX + (layout.x - table.x) - (kind === "column" ? blockOffset : 0);
      const layoutY =
        ghostY + (layout.y - table.y) - (kind === "row" ? blockOffset : 0);
      context.save();
      context.font = getFontString({
        fontSize: text.fontSize,
        fontFamily: text.fontFamily,
        fontWeight: resolveTableBackgroundTextFontWeight(text, elementsMap),
      });
      context.fillStyle = getThemedColor(text.strokeColor, appState.theme);
      context.textAlign = layout.textAlign as CanvasTextAlign;
      context.textBaseline = "alphabetic";
      const lines = layout.text.replace(/\r\n?/g, "\n").split("\n");
      const lineHeightPx = getLineHeightInPx(text.fontSize, text.lineHeight);
      const verticalOffset =
        getTextVerticalOffset(
          layout.verticalAlign,
          layout.height,
          lines.length,
          lineHeightPx,
        ) + getVerticalOffset(text.fontFamily, text.fontSize, lineHeightPx);
      const horizontalOffset =
        layout.textAlign === "center"
          ? layout.width / 2
          : layout.textAlign === "right"
          ? layout.width
          : 0;
      for (let index = 0; index < lines.length; index++) {
        context.fillText(
          lines[index],
          layoutX + horizontalOffset,
          layoutY + index * lineHeightPx + verticalOffset,
        );
      }
      context.restore();
    }
  }
  context.restore();

  // card frame on top of the fills
  context.save();
  context.strokeStyle = getThemedColor(TABLE_STYLE.strokeColor, appState.theme);
  context.lineWidth = 1 / zoom;
  traceCard();
  context.stroke();
  context.restore();
};

/**
 * The blue boundary line of an in-flight insertion or row/column reorder —
 * the exact spot the commit will land on (phase-1.md:82, :87). A reorder
 * additionally floats the ghost card along the pointer.
 */
const renderTableStructurePreview = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  preview: NonNullable<InteractiveCanvasAppState["tableStructurePreview"]>,
  elementsMap: ElementsMap,
) => {
  const table = elementsMap.get(preview.tableId);
  if (!table || !isTableElement(table) || table.isDeleted) {
    return;
  }
  const accent = getThemedColor(TABLE_STRUCTURE_ACCENT, appState.theme);
  const lineWidth = 2 / appState.zoom.value;

  withTableLocalTransform(context, appState, () => {
    if (preview.kind === "row") {
      const y = table.y + preview.offset;
      context.beginPath();
      context.moveTo(table.x, y);
      context.lineTo(table.x + table.width, y);
      context.lineWidth = lineWidth;
      context.strokeStyle = accent;
      context.stroke();
    } else {
      const x = table.x + preview.offset;
      context.beginPath();
      context.moveTo(x, table.y);
      context.lineTo(x, table.y + table.height);
      context.lineWidth = lineWidth;
      context.strokeStyle = accent;
      context.stroke();
    }
    if (preview.source === "move") {
      renderTableMoveGhost(context, appState, table, preview, elementsMap);
    }
  });
};

const renderElementsBoxHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: RenderableElementsMap,
  config?: { colors?: string[]; dashed?: boolean; padding?: number },
) => {
  const {
    colors = [getThemedColor("rgb(0,118,255)", appState.theme)],
    dashed = false,
    padding = 0,
  } = config || {};
  const individualElements = elements.filter(
    (element) => element.groupIds.length === 0,
  );

  const elementsInGroups = elements.filter(
    (element) => element.groupIds.length > 0,
  );

  const getSelectionFromElements = (elements: ExcalidrawElement[]) => {
    // Individual elements can be rotated. Keep their local rectangle and
    // angle so the highlight follows the element instead of its axis-aligned
    // bounds. Groups still use common bounds below because they have no
    // single rotation angle.
    if (elements.length === 1) {
      const [element] = elements;
      const [x1, y1, x2, y2, cx, cy] = getElementAbsoluteCoords(
        element,
        elementsMap,
        true,
      );
      return {
        angle: element.angle,
        x1,
        x2,
        y1,
        y2,
        selectionColors: colors,
        dashed,
        cx,
        cy,
        activeEmbeddable: false,
        padding,
      };
    }

    const [x1, y1, x2, y2] = getCommonBounds(elements);
    return {
      angle: 0,
      x1,
      x2,
      y1,
      y2,
      selectionColors: colors,
      dashed,
      cx: x1 + (x2 - x1) / 2,
      cy: y1 + (y2 - y1) / 2,
      activeEmbeddable: false,
      padding,
    };
  };

  const getSelectionForGroupId = (groupId: GroupId) => {
    const groupElements = getElementsInGroup(elements, groupId);
    return getSelectionFromElements(groupElements);
  };

  Object.entries(selectGroupsFromGivenElements(elementsInGroups, appState))
    .filter(([id, isSelected]) => isSelected)
    .map(([id, isSelected]) => id)
    .map((groupId) => getSelectionForGroupId(groupId))
    .concat(
      individualElements.map((element) => getSelectionFromElements([element])),
    )
    .forEach((selection) =>
      renderSelectionBorder(context, appState, selection),
    );
};

const renderLinearPointHandles = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  element: NonDeleted<ExcalidrawLinearElement>,
  elementsMap: RenderableElementsMap,
) => {
  if (!appState.selectedLinearElement) {
    return;
  }
  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.lineWidth = 1 / appState.zoom.value;
  const points: GlobalPoint[] = LinearElementEditor.getPointsGlobalCoordinates(
    element,
    elementsMap,
  );

  const { POINT_HANDLE_SIZE } = LinearElementEditor;
  const radius = appState.selectedLinearElement?.isEditing
    ? POINT_HANDLE_SIZE
    : POINT_HANDLE_SIZE / 2;

  const _isElbowArrow = isElbowArrow(element);
  const _isLineElement = isLineElement(element);

  points.forEach((point, idx) => {
    if (_isElbowArrow && idx !== 0 && idx !== points.length - 1) {
      return;
    }

    const isOverlappingPoint =
      idx > 0 &&
      (idx !== points.length - 1 || !_isLineElement || !element.polygon) &&
      pointsEqual(
        point,
        idx === points.length - 1 ? points[0] : points[idx - 1],
        2 / appState.zoom.value,
      );

    let isSelected =
      !!appState.selectedLinearElement?.isEditing &&
      !!appState.selectedLinearElement?.selectedPointsIndices?.includes(idx);
    // when element is a polygon, highlight the last point as well if first
    // point is selected since they overlap and the last point tends to be
    // rendered on top
    if (
      _isLineElement &&
      element.polygon &&
      !isSelected &&
      idx === element.points.length - 1 &&
      !!appState.selectedLinearElement?.isEditing &&
      !!appState.selectedLinearElement?.selectedPointsIndices?.includes(0)
    ) {
      isSelected = true;
    }

    const isBound =
      idx === 0
        ? !!element.startBinding
        : idx === points.length - 1
        ? !!element.endBinding
        : false;

    renderSingleLinearPoint(
      context,
      appState,
      point,
      radius,
      isSelected,
      false,
      isOverlappingPoint,
      isBound,
    );
  });

  // Rendering segment mid points
  if (isElbowArrow(element)) {
    const fixedSegments =
      element.fixedSegments?.map((segment) => segment.index) || [];
    const hoveredCoords =
      appState.selectedLinearElement?.segmentMidPointHoveredCoords ?? null;
    points.slice(0, -1).forEach((p, idx) => {
      const segEnd = points[idx + 1];
      if (
        !LinearElementEditor.isSegmentTooShort(
          element,
          segEnd,
          p,
          idx,
          appState.zoom,
          elementsMap,
        )
      ) {
        const mid = pointFrom<GlobalPoint>(
          (p[0] + segEnd[0]) / 2,
          (p[1] + segEnd[1]) / 2,
        );
        const isHovered =
          hoveredCoords != null &&
          pointsEqual(mid, hoveredCoords, 2 / appState.zoom.value);
        drawElbowSegmentMidpointHandle(context, appState, mid, p, segEnd, {
          isHovered,
          isPhantom: !fixedSegments.includes(idx + 1),
        });
      }
    });
  } else {
    const midPoints = LinearElementEditor.getEditorMidPoints(
      element,
      elementsMap,
      appState,
    ).filter(
      (midPoint, idx, midPoints): midPoint is GlobalPoint =>
        midPoint !== null &&
        !(isElbowArrow(element) && (idx === 0 || idx === midPoints.length - 1)),
    );

    midPoints.forEach((segmentMidPoint) => {
      if (
        appState.selectedLinearElement?.isEditing ||
        points.length === 2 ||
        isCurvedArrow(element)
      ) {
        renderSingleLinearPoint(
          context,
          appState,
          segmentMidPoint,
          POINT_HANDLE_SIZE / 2,
          false,
          true,
          false,
        );
      }
    });
  }

  context.restore();
};

const renderFocusPointConnectionLine = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  fromPoint: GlobalPoint,
  toPoint: GlobalPoint,
) => {
  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  context.strokeStyle = `rgba(${BINDING_HIGHLIGHT_RGB[appState.theme]}, 0.6)`;
  context.lineWidth = 1 / appState.zoom.value;
  context.setLineDash([4 / appState.zoom.value, 4 / appState.zoom.value]);

  context.beginPath();
  context.moveTo(fromPoint[0], fromPoint[1]);
  context.lineTo(toPoint[0], toPoint[1]);
  context.stroke();

  context.restore();
};

const renderFocusPointCicle = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  point: GlobalPoint,
  radius: number,
  isHovered: boolean,
) => {
  const primaryRGB = BINDING_HIGHLIGHT_RGB[appState.theme];
  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.strokeStyle = `rgba(${primaryRGB}, 0.6)`;
  context.lineWidth = 1 / appState.zoom.value;
  context.setLineDash([]);
  context.fillStyle = `rgba(${primaryRGB}, ${isHovered ? 0.9 : 0.6})`;

  fillCircle(
    context,
    point[0],
    point[1],
    radius / appState.zoom.value,
    true,
    true,
  );
  context.restore();
};

const renderFocusPointIndicator = ({
  arrow,
  appState,
  type,
  context,
  elementsMap,
}: {
  arrow: NonDeleted<ExcalidrawArrowElement>;
  appState: InteractiveCanvasAppState;
  context: CanvasRenderingContext2D;
  elementsMap: NonDeletedSceneElementsMap;
  type: "start" | "end";
}) => {
  const binding = type === "start" ? arrow.startBinding : arrow.endBinding;
  const bindableElement =
    binding?.elementId && elementsMap.get(binding.elementId);

  if (
    !bindableElement ||
    !isBindableElement(bindableElement) ||
    bindableElement.isDeleted
  ) {
    return;
  }

  const focusPoint = getGlobalFixedPointForBindableElement(
    binding.fixedPoint,
    bindableElement,
    elementsMap,
  );

  // Only render if focus point is within the bindable element
  if (
    !isFocusPointVisible(
      focusPoint,
      arrow,
      bindableElement,
      elementsMap,
      appState,
      type,
    )
  ) {
    return;
  }

  const linearState = appState.selectedLinearElement;
  const isDragging = !!linearState?.isDragging;
  const pointIndex = type === "start" ? 0 : arrow.points.length - 1;
  const pointSelected =
    !!linearState?.selectedPointsIndices?.includes(pointIndex);

  // render focus point highlight
  // ----------------------------

  if (
    linearState?.hoveredFocusPointBinding === type &&
    !linearState.draggedFocusPointBinding
  ) {
    highlightPoint(focusPoint, context, appState);
  }

  // render focus point
  // ----------------------------

  if (!(pointSelected && isDragging)) {
    const focusPoint = getGlobalFixedPointForBindableElement(
      binding.fixedPoint,
      bindableElement,
      elementsMap,
    );

    const isHovered = linearState?.hoveredFocusPointBinding === type;

    // Render dashed line from arrow start point to focus point
    const arrowPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
      arrow,
      pointIndex,
      elementsMap,
    );

    renderFocusPointConnectionLine(context, appState, arrowPoint, focusPoint);

    renderFocusPointCicle(
      context,
      appState,
      focusPoint,
      FOCUS_POINT_SIZE,
      isHovered,
    );
  }
};

// arc-shaped double-headed arrow, bulging away from the selection
const renderRotationHandle = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  zoom: number,
) => {
  const cx = x + size / 2;
  const cy = y + size / 2;
  // arc centered toward the selection (bottom-left), so it curves around the corner
  const r = size * 0.75;
  const ox = cx - r * Math.SQRT1_2;
  const oy = cy + r * Math.SQRT1_2;
  const start = -Math.PI * 0.5;
  const end = 0;
  const head = size * 0.32;

  const drawArc = () => {
    context.beginPath();
    context.arc(ox, oy, r, start, end);
    context.stroke();
  };
  const drawHead = (angle: number, dir: 1 | -1) => {
    const px = ox + r * Math.cos(angle);
    const py = oy + r * Math.sin(angle);
    // tangent pointing outward along the arc
    const t = angle + (dir * Math.PI) / 2;
    const tx = Math.cos(t);
    const ty = Math.sin(t);
    context.beginPath();
    context.moveTo(px + tx * head, py + ty * head);
    context.lineTo(px - ty * head * 0.8, py + tx * head * 0.8);
    context.lineTo(px + ty * head * 0.8, py - tx * head * 0.8);
    context.closePath();
    context.fill();
    context.stroke();
  };

  // match the other transform handles: handle-fill body, thin selection outline
  context.lineCap = "round";
  context.lineJoin = "round";
  const color = context.strokeStyle;
  const fill = context.fillStyle;
  // arc as an outlined band
  context.strokeStyle = color;
  context.lineWidth = 3 / zoom;
  drawArc();
  context.strokeStyle = fill;
  context.lineWidth = 1 / zoom;
  drawArc();
  // arrowheads drawn like handles: filled with handle fill, outlined
  context.strokeStyle = color;
  context.fillStyle = fill;
  context.lineWidth = 1 / zoom;
  drawHead(start, -1);
  drawHead(end, 1);
};

const renderTransformHandles = (
  context: CanvasRenderingContext2D,
  renderConfig: InteractiveCanvasRenderConfig,
  appState: InteractiveCanvasAppState,
  transformHandles: TransformHandles,
  angle: number,
): void => {
  Object.keys(transformHandles).forEach((key) => {
    const transformHandle = transformHandles[key as TransformHandleType];
    if (transformHandle !== undefined) {
      const [x, y, width, height] = transformHandle;

      context.save();
      context.lineWidth = 1 / appState.zoom.value;
      if (renderConfig.selectionColor) {
        context.strokeStyle = renderConfig.selectionColor;
      }
      if (key === "rotation") {
        // hidden while rotating — the cursor takes over as the indicator
        if (appState.isRotating) {
          context.restore();
          return;
        }
        // the handle is positioned in rotated space; rotate the glyph to match
        context.translate(x + width / 2, y + height / 2);
        context.rotate(angle);
        // the glyph arcs around the bottom-left of its own box so that its
        // opening faces the selection while it sits at the ne corner; the
        // handle now sits at the se corner, so turn the glyph a further 90°
        // clockwise to keep the opening pointed at that corner. Applied after
        // the element angle, the glyph still follows the element's rotation
        // while keeping its position relative to the corner.
        context.rotate(Math.PI / 2);
        renderRotationHandle(
          context,
          -width / 2,
          -height / 2,
          width,
          appState.zoom.value,
        );
        // prefer round corners if roundRect API is available
      } else if (context.roundRect) {
        context.beginPath();
        const isSideHandle =
          key === "n" || key === "s" || key === "e" || key === "w";
        const visualWidth =
          isSideHandle && (key === "n" || key === "s")
            ? 16 / appState.zoom.value
            : isSideHandle
            ? 5 / appState.zoom.value
            : width;
        const visualHeight =
          isSideHandle && (key === "n" || key === "s")
            ? 5 / appState.zoom.value
            : isSideHandle
            ? 16 / appState.zoom.value
            : height;
        if (isSideHandle) {
          context.translate(x + width / 2, y + height / 2);
          context.rotate(angle);
          context.roundRect(
            -visualWidth / 2,
            -visualHeight / 2,
            visualWidth,
            visualHeight,
            Math.min(visualWidth, visualHeight) / 2,
          );
        } else {
          context.roundRect(
            x + (width - visualWidth) / 2,
            y + (height - visualHeight) / 2,
            visualWidth,
            visualHeight,
            width / 2,
          );
        }
        context.fill();
        context.stroke();
      } else {
        strokeRectWithRotation_simple(
          context,
          x,
          y,
          width,
          height,
          x + width / 2,
          y + height / 2,
          angle,
          true, // fill before stroke
        );
      }
      context.restore();
    }
  });
};

const renderCropHandles = (
  context: CanvasRenderingContext2D,
  renderConfig: InteractiveCanvasRenderConfig,
  appState: InteractiveCanvasAppState,
  croppingElement: ExcalidrawImageElement,
  elementsMap: ElementsMap,
): void => {
  const [x1, y1, , , cx, cy] = getElementAbsoluteCoords(
    croppingElement,
    elementsMap,
  );

  const LINE_WIDTH = 3;
  const LINE_LENGTH = 20;

  const ZOOMED_LINE_WIDTH = LINE_WIDTH / appState.zoom.value;
  const ZOOMED_HALF_LINE_WIDTH = ZOOMED_LINE_WIDTH / 2;

  const HALF_WIDTH = cx - x1 + ZOOMED_LINE_WIDTH;
  const HALF_HEIGHT = cy - y1 + ZOOMED_LINE_WIDTH;

  const HORIZONTAL_LINE_LENGTH = Math.min(
    LINE_LENGTH / appState.zoom.value,
    HALF_WIDTH,
  );
  const VERTICAL_LINE_LENGTH = Math.min(
    LINE_LENGTH / appState.zoom.value,
    HALF_HEIGHT,
  );

  context.save();
  context.fillStyle = renderConfig.selectionColor;
  context.strokeStyle = renderConfig.selectionColor;
  context.lineWidth = ZOOMED_LINE_WIDTH;

  const handles: Array<
    [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ]
  > = [
    [
      // x, y
      [-HALF_WIDTH, -HALF_HEIGHT],
      // horizontal line: first start and to
      [0, ZOOMED_HALF_LINE_WIDTH],
      [HORIZONTAL_LINE_LENGTH, ZOOMED_HALF_LINE_WIDTH],
      // vertical line: second  start and to
      [ZOOMED_HALF_LINE_WIDTH, 0],
      [ZOOMED_HALF_LINE_WIDTH, VERTICAL_LINE_LENGTH],
    ],
    [
      [HALF_WIDTH - ZOOMED_HALF_LINE_WIDTH, -HALF_HEIGHT],
      [ZOOMED_HALF_LINE_WIDTH, ZOOMED_HALF_LINE_WIDTH],
      [
        -HORIZONTAL_LINE_LENGTH + ZOOMED_HALF_LINE_WIDTH,
        ZOOMED_HALF_LINE_WIDTH,
      ],
      [0, 0],
      [0, VERTICAL_LINE_LENGTH],
    ],
    [
      [-HALF_WIDTH, HALF_HEIGHT],
      [0, -ZOOMED_HALF_LINE_WIDTH],
      [HORIZONTAL_LINE_LENGTH, -ZOOMED_HALF_LINE_WIDTH],
      [ZOOMED_HALF_LINE_WIDTH, 0],
      [ZOOMED_HALF_LINE_WIDTH, -VERTICAL_LINE_LENGTH],
    ],
    [
      [HALF_WIDTH - ZOOMED_HALF_LINE_WIDTH, HALF_HEIGHT],
      [ZOOMED_HALF_LINE_WIDTH, -ZOOMED_HALF_LINE_WIDTH],
      [
        -HORIZONTAL_LINE_LENGTH + ZOOMED_HALF_LINE_WIDTH,
        -ZOOMED_HALF_LINE_WIDTH,
      ],
      [0, 0],
      [0, -VERTICAL_LINE_LENGTH],
    ],
  ];

  handles.forEach((handle) => {
    const [[x, y], [x1s, y1s], [x1t, y1t], [x2s, y2s], [x2t, y2t]] = handle;

    context.save();
    context.translate(cx, cy);
    context.rotate(croppingElement.angle);

    context.beginPath();
    context.moveTo(x + x1s, y + y1s);
    context.lineTo(x + x1t, y + y1t);
    context.stroke();

    context.beginPath();
    context.moveTo(x + x2s, y + y2s);
    context.lineTo(x + x2t, y + y2t);
    context.stroke();
    context.restore();
  });

  context.restore();
};

const renderTextBox = (
  text: ExcalidrawTextElement,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selectionColor: InteractiveCanvasRenderConfig["selectionColor"],
) => {
  context.save();
  const padding = getTextBoxPadding(appState.zoom.value);
  const width = text.width + padding * 2;
  const height = text.height + padding * 2;
  const cx = text.x + text.width / 2;
  const cy = text.y + text.height / 2;
  const shiftX = -(text.width / 2 + padding);
  const shiftY = -(text.height / 2 + padding);
  context.translate(cx + appState.scrollX, cy + appState.scrollY);
  context.rotate(text.angle);
  context.lineWidth = 1 / appState.zoom.value;
  context.strokeStyle = selectionColor;
  context.globalAlpha = 0.5;
  context.setLineDash([6 / appState.zoom.value, 4 / appState.zoom.value]);
  context.strokeRect(shiftX, shiftY, width, height);
  context.restore();
};

/**
 * The primary ring a sticky note wears while its label is being edited — the
 * paper's own outline (a note has no visible stroke of its own), replacing
 * the selection box for the editing session.
 */
const renderStickyNoteEditRing = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  note: NonDeleted<ExcalidrawStickyNoteElement>,
  selectionColor: InteractiveCanvasRenderConfig["selectionColor"],
) => {
  context.save();
  context.translate(
    note.x + note.width / 2 + appState.scrollX,
    note.y + note.height / 2 + appState.scrollY,
  );
  context.rotate(note.angle);
  context.lineWidth = 1.5 / appState.zoom.value;
  context.strokeStyle = selectionColor;
  context.beginPath();
  const radius = getStickyNoteCornerRadius(note);
  if (radius && context.roundRect) {
    context.roundRect(
      -note.width / 2,
      -note.height / 2,
      note.width,
      note.height,
      radius,
    );
  } else {
    context.rect(-note.width / 2, -note.height / 2, note.width, note.height);
  }
  context.stroke();
  context.restore();
};

const renderResetAutoResizeHandle = (
  text: ExcalidrawTextElement,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selectionColor: InteractiveCanvasRenderConfig["selectionColor"],
  formFactor: EditorInterface["formFactor"],
) => {
  const autoResizeHandle = getTextAutoResizeHandle(
    text,
    appState.zoom.value,
    formFactor,
  );

  if (!autoResizeHandle) {
    return;
  }

  context.save();
  context.globalAlpha = 0.5;
  context.lineWidth = 1.5 / appState.zoom.value;
  context.lineCap = "round";
  context.strokeStyle = selectionColor;
  context.beginPath();
  context.moveTo(
    autoResizeHandle.start[0] + appState.scrollX,
    autoResizeHandle.start[1] + appState.scrollY,
  );
  context.lineTo(
    autoResizeHandle.end[0] + appState.scrollX,
    autoResizeHandle.end[1] + appState.scrollY,
  );
  context.stroke();
  context.restore();
};

const _renderInteractiveScene = ({
  app,
  canvas,
  elementsMap,
  visibleElements,
  selectedElements,
  allElementsMap,
  scale,
  appState: unsnappedAppState,
  renderConfig,
  editorInterface,
  animationState,
  deltaTime,
}: InteractiveSceneRenderConfig): {
  scrollBars?: ReturnType<typeof getScrollBars>;
  animationState?: typeof animationState;
} => {
  if (canvas === null) {
    return {};
  }

  // the same whole-device-pixel scroll the static scene draws at, so the
  // overlays sit exactly on the content
  const appState = snapScrollToDevicePixels(unsnappedAppState, scale);
  const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
    canvas,
    scale,
  );
  let nextAnimationState = animationState;

  const context = bootstrapCanvas({
    canvas,
    scale,
    normalizedWidth,
    normalizedHeight,
  });

  // Apply zoom
  context.save();
  context.scale(appState.zoom.value, appState.zoom.value);

  // Mindmap drag previews are transient controller state. They are rendered
  // on this overlay canvas and never enter the Scene or collaboration delta.
  app.mindmap.renderPreview(context, appState.scrollX, appState.scrollY);

  let editingLinearElement: NonDeleted<ExcalidrawLinearElement> | undefined =
    undefined;

  visibleElements.forEach((element) => {
    // Getting the element using LinearElementEditor during collab mismatches version - being one head of visible elements due to
    // ShapeCache returns empty hence making sure that we get the
    // correct element from visible elements
    if (
      appState.selectedLinearElement?.isEditing &&
      appState.selectedLinearElement.elementId === element.id &&
      selectedElements.some((selected) => selected.id === element.id)
    ) {
      if (element) {
        editingLinearElement = element as NonDeleted<ExcalidrawLinearElement>;
      }
    }
  });

  if (editingLinearElement) {
    renderLinearPointHandles(
      context,
      appState,
      editingLinearElement,
      elementsMap,
    );
  }

  // Paint selection element
  if (appState.selectionElement && !appState.isCropping) {
    try {
      renderSelectionElement(
        appState.selectionElement,
        context,
        appState,
        renderConfig.selectionColor,
      );
    } catch (error: any) {
      console.error(error);
    }
  }

  const editingTableBackgroundText = isTableCellBackgroundText(
    appState.editingTextElement,
  );
  const activeTextElement = getActiveTextElement(selectedElements, appState);

  if (
    activeTextElement &&
    !activeTextElement.autoResize &&
    !isTableCellBackgroundText(activeTextElement)
  ) {
    renderResetAutoResizeHandle(
      activeTextElement,
      context,
      appState,
      renderConfig.selectionColor,
      editorInterface.formFactor,
    );
  }

  if (appState.editingTextElement) {
    const textElement = allElementsMap.get(appState.editingTextElement.id) as
      | ExcalidrawTextElement
      | undefined;
    if (textElement && !isTableCellBackgroundText(textElement)) {
      if (!textElement.autoResize) {
        renderTextBox(
          textElement,
          context,
          appState,
          renderConfig.selectionColor,
        );
      }
    }
    const editingContainerId = appState.editingTextElement.containerId;
    const editingContainer = editingContainerId
      ? allElementsMap.get(editingContainerId)
      : null;
    if (
      editingContainer &&
      !editingContainer.isDeleted &&
      isStickyNoteElement(editingContainer)
    ) {
      renderStickyNoteEditRing(
        context,
        appState,
        editingContainer,
        renderConfig.selectionColor || getSelectionColor(app.interactiveCanvas),
      );
    }
  }

  if (appState.isBindingEnabled && appState.suggestedBinding) {
    nextAnimationState = {
      ...animationState,
      bindingHighlight: renderBindingHighlightForBindableElement(
        app,
        context,
        appState.suggestedBinding,
        allElementsMap,
        appState,
        deltaTime,
        animationState?.bindingHighlight,
      ),
    };
  } else {
    nextAnimationState = {
      ...animationState,
      bindingHighlight: undefined,
    };
  }

  if (appState.hoveredArrowTextAnchor) {
    renderHoveredArrowTextAnchor(context, appState, allElementsMap);
  }

  if (appState.frameToHighlight) {
    renderFrameHighlight(
      context,
      appState,
      appState.frameToHighlight,
      elementsMap,
    );
  }

  if (appState.highlightedTableCell && !editingTableBackgroundText) {
    renderTableCellHighlight(
      context,
      appState,
      appState.highlightedTableCell,
      elementsMap,
    );
  }

  if (appState.tableCellSelection && !editingTableBackgroundText) {
    renderTableCellSelection(
      context,
      appState,
      appState.tableCellSelection,
      elementsMap,
    );
  }

  if (appState.tableRowColSelection && !editingTableBackgroundText) {
    renderTableRowColSelection(
      context,
      appState,
      appState.tableRowColSelection,
      elementsMap,
    );
  }

  if (appState.tableStructurePreview && !editingTableBackgroundText) {
    renderTableStructurePreview(
      context,
      appState,
      appState.tableStructurePreview,
      elementsMap,
    );
  }

  if (appState.elementsToHighlight) {
    renderElementsBoxHighlight(
      context,
      appState,
      appState.elementsToHighlight,
      elementsMap,
      {
        colors: [getThemedColor("rgba(22,119,255,0.55)", appState.theme)],
        padding: 5,
      },
    );
  }

  if (appState.hoveredElementId) {
    const hoveredElement = allElementsMap.get(appState.hoveredElementId);
    if (
      hoveredElement &&
      !hoveredElement.isDeleted &&
      isFrameLikeElement(hoveredElement) &&
      !hoveredElement.locked &&
      !selectedElements.some((element) => element.id === hoveredElement.id) &&
      appState.activeLockedId !== hoveredElement.id
    ) {
      // a frame's hover feedback is its own border in 55% primary (design:
      // 悬停) — the generic padded outline would read as selection on a
      // board. Locked frames keep the generic dashed box below.
      renderFrameBorderFeedback(
        context,
        appState,
        hoveredElement,
        elementsMap,
        getThemedColor("rgba(22,119,255,0.55)", appState.theme),
        null,
      );
    } else if (
      hoveredElement &&
      !hoveredElement.isDeleted &&
      !isLinearElement(hoveredElement) &&
      !isMindmapEdgeElement(hoveredElement) &&
      // a note's hover feedback is its lifted paper shadow (painted by the
      // static scene), not the generic outline
      !isStickyNoteElement(hoveredElement) &&
      !selectedElements.some((element) => element.id === hoveredElement.id) &&
      appState.activeLockedId !== hoveredElement.id
    ) {
      renderElementsBoxHighlight(
        context,
        appState,
        [hoveredElement],
        elementsMap,
        {
          colors: [
            hoveredElement.locked
              ? getThemedColor("#a8adb6", appState.theme)
              : getThemedColor("rgba(22,119,255,0.55)", appState.theme),
          ],
          dashed: hoveredElement.locked,
          padding: ELEMENT_OUTLINE_PADDING,
        },
      );
    } else if (
      hoveredElement &&
      !hoveredElement.isDeleted &&
      isLinearElement(hoveredElement) &&
      !selectedElements.some((element) => element.id === hoveredElement.id) &&
      appState.activeLockedId !== hoveredElement.id
    ) {
      // Linear elements get a path-following hover trace instead of the
      // rectangular box highlight used for non-linear elements.
      renderHoveredLinearTrace(context, appState, hoveredElement, elementsMap);
    }
  }

  // While a box selection is in progress, selectedElementIds is updated as
  // the pointer moves. Keep the same border treatment as a committed
  // selection until the selection is committed, instead of painting handles.
  if (appState.selectionElement && selectedElements.length) {
    // 与下方提交态选中描边同一策略：整图选中的 Mindmap 不逐元素描边。
    // 按住根节点尚未拖动时 selectionElement 仍在（开始拖动才清空），而
    // 主选中渲染被 !appState.selectionElement 门控跳过；缺少这条过滤的
    // 话，整树节点/文本/边会在这里被逐个描边。
    const suppressedMindmapSelectionIds =
      getCompletelySelectedMindmapGraphElementIds(
        allElementsMap.values(),
        appState.selectedElementIds,
      );
    const elementsToBoxHighlight = selectedElements.filter(
      (element) => !suppressedMindmapSelectionIds.has(element.id),
    );
    if (elementsToBoxHighlight.length) {
      renderElementsBoxHighlight(
        context,
        appState,
        elementsToBoxHighlight,
        elementsMap,
        {
          colors: [
            renderConfig.selectionColor ||
              getSelectionColor(app.interactiveCanvas),
          ],
          padding: ELEMENT_OUTLINE_PADDING,
        },
      );
    }
  }

  if (appState.activeLockedId) {
    const element = allElementsMap.get(appState.activeLockedId);
    const elements = element
      ? [element]
      : getElementsInGroup(allElementsMap, appState.activeLockedId);
    renderElementsBoxHighlight(
      context,
      appState,
      elements as NonDeletedExcalidrawElement[], // We don't typecheck runtime because of performance
      elementsMap,
      {
        colors: [getThemedColor("#a8adb6", appState.theme)],
        dashed: true,
        padding: ELEMENT_OUTLINE_PADDING,
      },
    );
  }

  const isFrameSelected = selectedElements.some((element) =>
    isFrameLikeElement(element),
  );

  // Getting the element using LinearElementEditor during collab mismatches version - being one head of visible elements due to
  // ShapeCache returns empty hence making sure that we get the
  // correct element from visible elements
  if (
    selectedElements.length === 1 &&
    appState.selectedLinearElement?.isEditing &&
    appState.selectedLinearElement.elementId === selectedElements[0].id &&
    selectedElements.some(
      (selected) => selected.id === appState.selectedLinearElement?.elementId,
    )
  ) {
    renderLinearPointHandles(
      context,
      appState,
      selectedElements[0] as NonDeleted<ExcalidrawLinearElement>,
      elementsMap,
    );
  }

  const linearState = appState.selectedLinearElement;
  const selectedLinearElement =
    linearState &&
    LinearElementEditor.getElement(linearState.elementId, allElementsMap);
  const isSelectedLinearElement =
    !!selectedLinearElement &&
    selectedElements.some((element) => element.id === selectedLinearElement.id);
  // Arrows have a different highlight behavior when
  // they are the only selected element
  if (selectedLinearElement && isSelectedLinearElement) {
    if (!appState.selectedLinearElement.isDragging) {
      if (linearState.segmentMidPointHoveredCoords) {
        renderElbowArrowMidPointHighlight(context, appState, allElementsMap);
      } else if (
        isElbowArrow(selectedLinearElement)
          ? linearState.hoverPointIndex === 0 ||
            linearState.hoverPointIndex ===
              selectedLinearElement.points.length - 1
          : linearState.hoverPointIndex >= 0
      ) {
        renderLinearElementPointHighlight(context, appState, elementsMap);
      }
    }

    if (isArrowElement(selectedLinearElement)) {
      renderFocusPointIndicator({
        arrow: selectedLinearElement,
        elementsMap: allElementsMap,
        appState,
        context,
        type: "start",
      });

      renderFocusPointIndicator({
        arrow: selectedLinearElement,
        elementsMap: allElementsMap,
        appState,
        context,
        type: "end",
      });
    }
  }

  // Keep table hover affordances below the selected table's bounding box and
  // transform handles. This is intentionally adjacent to selected-element
  // rendering so future hover additions cannot cover the resize indicator.
  const structureTables = new Map<string, NonDeleted<ExcalidrawTableElement>>();
  const tableVisual = getTableStructureVisual(appState);
  for (const selectedTable of selectedElements) {
    if (isTableElement(selectedTable) && !selectedTable.isDeleted) {
      structureTables.set(selectedTable.id, selectedTable);
    }
  }

  if (appState.tableRowColSelection) {
    const table = elementsMap.get(appState.tableRowColSelection.tableId);
    if (table && isTableElement(table) && !table.isDeleted) {
      structureTables.set(table.id, table);
    }
  }

  if (appState.tableStructureHover) {
    const hoveredTable = elementsMap.get(appState.tableStructureHover.tableId);
    if (
      hoveredTable &&
      isTableElement(hoveredTable) &&
      !hoveredTable.isDeleted
    ) {
      structureTables.set(hoveredTable.id, hoveredTable);
    }
  }

  if (appState.containerGestureVisual?.container === "table") {
    const table = elementsMap.get(appState.containerGestureVisual.tableId);
    if (table && isTableElement(table) && !table.isDeleted) {
      structureTables.set(table.id, table);
    }
  }

  if (!editingTableBackgroundText) {
    for (const table of structureTables.values()) {
      renderTableStructureAffordances(
        context,
        appState,
        table,
        tableVisual,
        getTableTitle(app.scene.getNonDeletedElements(), table.id),
      );
    }
  } else {
    // while a cell's background text is edited, only its location cues
    // (cell inner stroke + the row/column rails) survive the suppression
    renderTableEditingIndicator(context, appState, elementsMap);
  }

  if (tableVisual && !editingTableBackgroundText) {
    renderTableStructureHover(context, appState, tableVisual, elementsMap);
  }

  // Paint selected elements
  if (
    !editingTableBackgroundText &&
    !appState.selectionElement &&
    !appState.multiElement &&
    !appState.newElement &&
    !appState.selectedLinearElement?.isEditing &&
    !app.mindmap.isReparenting()
  ) {
    const hiddenMindmapIds = app.scene.getMindmapHiddenElementIds();
    const visibleSelectedElements = selectedElements.filter(
      (element) => !hiddenMindmapIds.has(element.id),
    );
    const showBoundingBox = hasBoundingBox(
      visibleSelectedElements,
      appState,
      editorInterface,
    );

    const isSingleLinearElementSelected =
      visibleSelectedElements.length === 1 &&
      isLinearElement(visibleSelectedElements[0]);
    // render selected linear element points
    if (
      isSingleLinearElementSelected &&
      appState.selectedLinearElement?.elementId ===
        visibleSelectedElements[0].id &&
      !visibleSelectedElements[0].locked
    ) {
      renderLinearPointHandles(
        context,
        appState,
        visibleSelectedElements[0] as NonDeleted<ExcalidrawLinearElement>,
        elementsMap,
      );
    }
    const selectionColor =
      renderConfig.selectionColor || getSelectionColor(app.interactiveCanvas);
    const lockedSelectionColor = getThemedColor("#a8adb6", appState.theme);
    const groupSelectionColor = selectionColor;

    if (showBoundingBox) {
      // Optimisation for finding quickly relevant element ids
      const locallySelectedIds = arrayToMap(visibleSelectedElements);

      // 整图选中的 Mindmap 已由下方共同虚线外框 + 变换手柄表达（如按住根
      // 节点拖整树）；再逐节点/文本/边描边只是视觉噪音，这里一次性算出并
      // 抑制。部分选中（仅根、子树、框选未覆盖全图）不受影响。
      const suppressedMindmapSelectionIds =
        getCompletelySelectedMindmapGraphElementIds(
          allElementsMap.values(),
          appState.selectedElementIds,
        );

      const selections: ElementSelectionBorder[] = [];

      for (const element of elementsMap.values()) {
        if (hiddenMindmapIds.has(element.id)) {
          continue;
        }
        const selectionColors = [];
        const remoteClients = renderConfig.remoteSelectedElementIds.get(
          element.id,
        );
        if (
          !(
            // Elbow arrow elements cannot be selected when bound on either end
            (
              isSingleLinearElementSelected &&
              isElbowArrow(element) &&
              (element.startBinding || element.endBinding)
            )
          )
        ) {
          // local user
          if (
            locallySelectedIds.has(element.id) &&
            !isSelectedViaGroup(appState, element) &&
            !suppressedMindmapSelectionIds.has(element.id)
          ) {
            selectionColors.push(selectionColor);
          }
          // remote users
          if (remoteClients) {
            selectionColors.push(
              ...remoteClients.map((socketId) => {
                const background = getClientColor(
                  socketId,
                  appState.collaborators.get(socketId),
                );
                return background;
              }),
            );
          }
        }

        if (selectionColors.length) {
          if (isMindmapEdgeElement(element)) {
            renderMindmapEdgeSelection(
              context,
              appState,
              element,
              selectionColors[0],
            );
            continue;
          }
          // while a note's label is edited, the note wears the primary edit
          // ring (rendered with the wysiwyg chrome) instead of the selection
          // box
          if (
            isStickyNoteElement(element) &&
            appState.editingTextElement?.containerId === element.id
          ) {
            continue;
          }
          const [x1, y1, x2, y2, cx, cy] = getElementAbsoluteCoords(
            element,
            elementsMap,
            true,
          );
          selections.push({
            angle: element.angle,
            x1,
            y1,
            x2,
            y2,
            selectionColors: element.locked
              ? [lockedSelectionColor]
              : selectionColors,
            dashed: !!remoteClients || element.locked,
            cx,
            cy,
            activeEmbeddable:
              appState.activeEmbeddable?.element === element &&
              appState.activeEmbeddable.state === "active",
            padding:
              element.id === appState.croppingElementId ||
              isImageElement(element) ||
              // a selected frame's selection border coincides with the
              // frame's own border (design: 选中 — 选中框与边框重合)
              isFrameLikeElement(element)
                ? 0
                : undefined,
          });
        }
      }

      const addSelectionForGroupId = (groupId: GroupId) => {
        const groupElements = getElementsInGroup(elementsMap, groupId);
        const [x1, y1, x2, y2] = getCommonBounds(groupElements);
        selections.push({
          angle: 0,
          x1,
          x2,
          y1,
          y2,
          selectionColors: groupElements.some((el) => el.locked)
            ? [lockedSelectionColor]
            : [groupSelectionColor],
          dashed: true,
          cx: x1 + (x2 - x1) / 2,
          cy: y1 + (y2 - y1) / 2,
          activeEmbeddable: false,
        });
      };

      for (const groupId of getSelectedGroupIds(appState)) {
        // TODO: support multiplayer selected group IDs
        addSelectionForGroupId(groupId);
      }

      if (appState.editingGroupId) {
        addSelectionForGroupId(appState.editingGroupId);
      }

      selections.forEach((selection) =>
        renderSelectionBorder(context, appState, selection),
      );
    }
    // Paint resize transformHandles
    context.save();
    context.translate(appState.scrollX, appState.scrollY);

    if (visibleSelectedElements.length === 1) {
      context.fillStyle = getThemedColor("#fff", appState.theme);
      const transformHandles = getTransformHandles(
        visibleSelectedElements[0],
        appState.zoom,
        elementsMap,
        "mouse", // when we render we don't know which pointer type so use mouse,
        {},
      );
      if (
        !appState.viewModeEnabled &&
        showBoundingBox &&
        // do not show transform handles when text is being edited
        !isTextElement(appState.editingTextElement) &&
        // do not show transform handles when image is being cropped
        !appState.croppingElementId
      ) {
        renderTransformHandles(
          context,
          renderConfig,
          appState,
          transformHandles,
          visibleSelectedElements[0].angle,
        );
        const selected = visibleSelectedElements[0];
        if (
          selected.type === "composite_shape" &&
          !selected.locked &&
          !isSelectedViaGroup(appState, selected)
        ) {
          context.setLineDash([]);
          context.lineWidth = 1.5 / appState.zoom.value;
          context.strokeStyle = selectionColor;
          context.fillStyle = getThemedColor("#fff", appState.theme);
          for (const point of getCompositeShapeControlPoints(selected)) {
            const [x, y] = getCompositeControlPointGlobal(selected, point);
            context.beginPath();
            context.arc(x, y, 5 / appState.zoom.value, 0, Math.PI * 2);
            context.fill();
            context.stroke();
          }
        }
        // 方向手柄：指示框四边外侧的圆点（悬停加号）
        renderQuickCreateHandles(
          context,
          app,
          appState,
          selectionColor,
          allElementsMap,
        );
      }

      if (appState.croppingElementId && !appState.isCropping) {
        const croppingElement = elementsMap.get(appState.croppingElementId);

        if (croppingElement && isImageElement(croppingElement)) {
          renderCropHandles(
            context,
            renderConfig,
            appState,
            croppingElement,
            elementsMap,
          );
        }
      }
    } else if (
      visibleSelectedElements.length > 1 &&
      // 多选旋转中框要照画：框取自实时 AABB，会随角度呼吸，与松手后的静止
      // 形态一致（旋转柄 glyph 另有「光标接管指示」的约定，见
      // renderTransformHandles）。
      !visibleSelectedElements.some((el) => el.locked)
    ) {
      const dashedLinePadding =
        (DEFAULT_TRANSFORM_HANDLE_SPACING * 2) / appState.zoom.value;
      context.fillStyle = getThemedColor("#fff", appState.theme);
      const [x1, y1, x2, y2] = getCommonBounds(
        visibleSelectedElements,
        elementsMap,
      );
      const initialLineDash = context.getLineDash();
      context.setLineDash([3 / appState.zoom.value, 3 / appState.zoom.value]);
      const lineWidth = context.lineWidth;
      context.lineWidth = 1 / appState.zoom.value;
      context.strokeStyle = selectionColor;
      strokeRectWithRotation_simple(
        context,
        x1 - dashedLinePadding,
        y1 - dashedLinePadding,
        x2 - x1 + dashedLinePadding * 2,
        y2 - y1 + dashedLinePadding * 2,
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        0,
      );
      context.lineWidth = lineWidth;
      context.setLineDash(initialLineDash);
      const transformHandles = getTransformHandlesFromCoords(
        [x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2],
        0 as Radians,
        appState.zoom,
        "mouse",
        isFrameSelected ||
          visibleSelectedElements.some(
            (element) =>
              isMindmapNodeElement(element) ||
              isMindmapEdgeElement(element) ||
              isTableElement(element),
          )
          ? { rotation: true }
          : {},
      );
      if (visibleSelectedElements.some((element) => !element.locked)) {
        renderTransformHandles(
          context,
          renderConfig,
          appState,
          transformHandles,
          0,
        );
      }
    }
    context.restore();

    // 变换读数：单选与多选共用一条出口，放在上面两个长度分支之外——它的显
    // 隐条件与手柄并不重合，抄进分支里会立刻漂移。口径是「有手柄可指才有读
    // 数」：只读模式、编辑文字、裁剪中这些手柄不画的地方，不能只剩个悬停读数。
    if (
      showBoundingBox &&
      visibleSelectedElements.length &&
      !appState.viewModeEnabled &&
      !isTextElement(appState.editingTextElement) &&
      !appState.croppingElementId
    ) {
      const readout = getTransformStatusReadout({
        gesture: appState.isRotating
          ? "rotation"
          : app.state.isResizing
          ? "scale"
          : null,
        hoveredHandle: app.transformStatus.getHoveredHandle(),
        selectedElements: visibleSelectedElements,
        elementsMap,
        rotationDelta: app.transformStatus.getRotationDelta(),
      });
      if (readout) {
        // 单选用未旋转的本地框中心——元素就是绕它转的，旋转中它不动
        const [x1, y1, x2, y2] =
          visibleSelectedElements.length === 1
            ? getElementAbsoluteCoords(
                visibleSelectedElements[0],
                elementsMap,
                true,
              )
            : getCommonBounds(visibleSelectedElements, elementsMap);
        renderTransformStatusLabel(
          context,
          app,
          appState,
          readout,
          selectionColor,
          { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
        );
      }
    }
  }

  // 折叠徽标/「−」按钮：画布覆盖层，按场景坐标缩放，不进导出
  renderMindmapCollapseAffordances(
    context,
    app,
    appState,
    allElementsMap,
    selectedElements,
  );

  // 「+」新增节点按钮：单选节点的子侧/同级侧
  renderMindmapAddButtons(context, app, appState, allElementsMap);

  appState.searchMatches?.matches.forEach(({ id, focus, matchedLines }) => {
    const element = elementsMap.get(id);

    if (element) {
      const [elementX1, elementY1, , , cx, cy] = getElementAbsoluteCoords(
        element,
        elementsMap,
        true,
      );

      context.save();
      context.fillStyle =
        SEARCH_MATCH_COLOR[appState.theme][focus ? "focus" : "match"];

      const zoomFactor = isFrameLikeElement(element) ? appState.zoom.value : 1;

      context.translate(appState.scrollX, appState.scrollY);
      context.translate(cx, cy);
      context.rotate(element.angle);

      matchedLines.forEach((matchedLine) => {
        (matchedLine.showOnCanvas || focus) &&
          context.fillRect(
            elementX1 + matchedLine.offsetX / zoomFactor - cx,
            elementY1 + matchedLine.offsetY / zoomFactor - cy,
            matchedLine.width / zoomFactor,
            matchedLine.height / zoomFactor,
          );
      });

      context.restore();
    }
  });

  renderSnaps(context, appState);

  context.restore();

  renderRemoteCursors({
    context,
    renderConfig,
    appState,
    normalizedWidth,
    normalizedHeight,
  });

  // Paint scrollbars
  let scrollBars;
  if (renderConfig.renderScrollbars) {
    scrollBars = getScrollBars(
      elementsMap,
      normalizedWidth,
      normalizedHeight,
      appState,
    );

    context.save();
    context.fillStyle = getThemedColor(SCROLLBAR_COLOR, appState.theme);
    context.strokeStyle = getThemedColor(
      "rgba(255,255,255,0.8)",
      appState.theme,
    );
    [scrollBars.horizontal, scrollBars.vertical].forEach((scrollBar) => {
      if (scrollBar) {
        roundRect(
          context,
          scrollBar.x,
          scrollBar.y,
          scrollBar.width,
          scrollBar.height,
          SCROLLBAR_WIDTH / 2,
        );
      }
    });
    context.restore();
  }

  return {
    scrollBars,
    animationState: nextAnimationState,
  };
};

/**
 * Interactive scene is the ui-canvas where we render bounding boxes, selections
 * and other ui stuff.
 */
export const renderInteractiveScene = <
  U extends typeof _renderInteractiveScene,
>(
  renderConfig: InteractiveSceneRenderConfig,
): ReturnType<U> => {
  const ret = _renderInteractiveScene(renderConfig);
  renderConfig.callback(ret);
  return ret as ReturnType<U>;
};
