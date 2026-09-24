import { DRAGGING_THRESHOLD, getFontString, KEYS } from "@excalidraw/common";
import {
  generateKeyBetween,
  generateNKeysBetween,
} from "@excalidraw/fractional-indexing";
import { pointFrom } from "@excalidraw/math";

import {
  applyMindmapTreeCommand,
  bumpVersion,
  buildMindmapGraphIndex,
  CaptureUpdateAction,
  computeBoundTextPosition,
  computeContainerDimensionForBoundText,
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  getBoundTextElement,
  handleBindTextResize,
  isMindmapElementHidden,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  getMindmapSubtreeIds,
  getMindmapEdgeGeometry,
  getMindmapLayoutConfig,
  layoutMindmap,
  navigateMindmap,
  newElement,
  newElementWith,
  newLinearElement,
  newMindmapNodeElement,
  measureText,
  reparentMindmapNodes,
  repairMindmapElements,
  wrapText,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawTextContainer,
  FractionalIndex,
  NonDeletedExcalidrawElement,
  MindmapLayoutDirection,
  MindmapEdgeRouting,
  StrokeStyle,
} from "@excalidraw/element/types";

import type { MindmapTreeCommand } from "@excalidraw/element";

import { t } from "../i18n";

import type App from "./App";
import type { PointerDownState } from "../types";
import type { ActionName, ActionResult } from "../actions/types";

type NewNodeKind = "child" | "sibling";

type MindmapDropTarget = {
  parentId: string;
  beforeId: string | null;
};

type MindmapDragSession = {
  mode: "reparent" | "move";
  nodeIds: readonly string[];
  graphIds: readonly string[];
  elementIds: ReadonlySet<string>;
  initialElements: ReadonlyMap<string, NonDeletedExcalidrawElement>;
  origin: { x: number; y: number };
  offset: { x: number; y: number };
  target: MindmapDropTarget | null;
  paused: boolean;
  invalid: boolean;
  previewElements: readonly ExcalidrawElement[];
  copyMode: "graph" | "subtree" | null;
  duplicated: boolean;
  unsupportedAltNotified: boolean;
};

type MindmapDragCandidate = {
  mode: "reparent" | "move";
  nodeIds: readonly string[];
  graphIds: readonly string[];
  elementIds: ReadonlySet<string>;
  copyMode: "graph" | "subtree" | null;
};

const unsupportedSelectionActions = new Set<ActionName>([
  "addToLibrary",
  "alignBottom",
  "alignHorizontallyCentered",
  "alignLeft",
  "alignRight",
  "alignTop",
  "alignVerticallyCentered",
  "autoResize",
  "bindText",
  "bringForward",
  "bringToFront",
  "distributeHorizontally",
  "distributeVertically",
  "flipHorizontal",
  "flipVertical",
  "group",
  "pasteStyles",
  "removeAllElementsFromFrame",
  "sendBackward",
  "sendToBack",
  "unbindText",
  "ungroup",
  "wrapSelectionInFrame",
  "wrapTextInContainer",
]);

const lockedMindmapMutationActions = new Set<ActionName>([
  "cut",
  "deleteSelectedElements",
  "duplicateSelection",
  "hyperlink",
  "toggleShapeSwitch",
]);

const relayoutAfterStyleActions = new Set<ActionName>([
  "changeBackgroundColor",
  "changeFillStyle",
  "changeFontFamily",
  "changeFontSize",
  "changeOpacity",
  "changeRoundness",
  "changeStrokeColor",
  "changeStrokeStyle",
  "changeStrokeWidth",
  "changeTextAlign",
  "changeVerticalAlign",
  "decreaseFontSize",
  "increaseFontSize",
]);

/**
 * Owns the first phase of mindmap interaction. Structural writes go through
 * the existing Scene/Store path; the controller only keeps transient typing
 * state for nodes that have not received their first label yet.
 */
export class AppMindmap {
  private readonly pendingTextNodeIds = new Set<string>();
  private hoveredNodeId: string | null = null;
  private consumedSpace = false;
  private dragSession: MindmapDragSession | null = null;
  private dragOpacityApplied = false;
  private dimmedDragElementIds = new Set<string>();
  private cancelledPointerDown: PointerDownState | null = null;
  private renderOverlay: (() => void) | null = null;
  private selectedSingleVisibleNodeGraphId: string | null = null;

  constructor(private readonly app: App) {}

  clear = () => {
    this.pendingTextNodeIds.clear();
    this.consumedSpace = false;
    this.cancelDrag();
    this.clearHover();
    this.selectedSingleVisibleNodeGraphId = null;
  };

  clearHover = () => {
    this.hoveredNodeId = null;
  };

  handlePointerMove = (sceneX: number, sceneY: number) => {
    if (
      !["mindmap", "selection"].includes(this.app.state.activeTool.type) ||
      this.app.state.openDialog?.name === "elementLinkSelector"
    ) {
      if (this.hoveredNodeId) {
        this.hoveredNodeId = null;
        this.app.setState({ hoveredElementIds: {} });
      }
      return;
    }

    const hit = this.app.getElementAtPosition(sceneX, sceneY, {
      includeBoundTextElement: true,
    });
    const node =
      hit?.type === "text" && hit.containerId
        ? this.app.scene.getNonDeletedElement(hit.containerId)
        : hit;
    const hoveredNode = node && isMindmapNodeElement(node) ? node : null;
    const hoveredNodeId = hoveredNode?.id ?? null;
    if (
      hoveredNodeId === this.hoveredNodeId &&
      (!hoveredNode || this.app.state.hoveredElementIds[hoveredNode.id])
    ) {
      return;
    }
    this.hoveredNodeId = hoveredNodeId;
    this.app.setState({
      hoveredElementIds: hoveredNode ? { [hoveredNode.id]: true } : {},
    });
  };

  handlePointerDown = (pointerDownState: PointerDownState) => {
    if (this.app.state.editingTextElement) {
      return;
    }
    const pointerHit =
      pointerDownState.hit.element ??
      this.app.getElementAtPosition(
        pointerDownState.origin.x,
        pointerDownState.origin.y,
        { includeBoundTextElement: true },
      );
    const hit =
      pointerHit?.type === "text" && pointerHit.containerId
        ? this.app.scene.getNonDeletedElement(pointerHit.containerId)
        : pointerHit;
    if (hit && isMindmapNodeElement(hit)) {
      this.selectNode(hit);
      return;
    }

    // A click on an edge or another regular element is not a mindmap create
    // gesture. Only an empty canvas click starts a new graph.
    if (hit) {
      return;
    }

    this.createRoot(pointerDownState.origin.x, pointerDownState.origin.y);
  };

  /**
   * Handles the mindmap-specific part of an existing canvas pointer session.
   * Returning true keeps the generic Excalidraw drag path from moving a node
   * as a free-standing rectangle.
   */
  handlePointerMoveFromPointerDown = (
    pointerDownState: PointerDownState,
    event: PointerEvent,
    scenePoint: { x: number; y: number },
  ): boolean => {
    if (this.cancelledPointerDown === pointerDownState) {
      return true;
    }
    if (
      this.app.state.activeTool.type !== "selection" &&
      this.app.state.activeTool.type !== "mindmap"
    ) {
      return false;
    }
    const candidate = this.dragSession
      ? null
      : this.getDragCandidate(pointerDownState);
    if (!candidate && !this.dragSession) {
      return false;
    }
    if (!this.dragSession) {
      const distance = Math.hypot(
        scenePoint.x - pointerDownState.origin.x,
        scenePoint.y - pointerDownState.origin.y,
      );
      // A click remains a selection. We still consume movement for a pending
      // mindmap drag so the native transform code cannot move it prematurely.
      if (distance * this.app.state.zoom.value < DRAGGING_THRESHOLD) {
        return true;
      }
      this.dragSession = this.createDragSession(pointerDownState, candidate!);
      if (this.dragSession.mode === "reparent") {
        this.updateDragOpacity(this.dragSession.elementIds);
      }
      pointerDownState.drag.hasOccurred = true;
      this.app.setState({ selectedElementsAreBeingDragged: true });
    }

    const session = this.dragSession;
    const rawOffset = {
      x: scenePoint.x - session.origin.x,
      y: scenePoint.y - session.origin.y,
    };
    if (event.shiftKey) {
      const lockX = Math.abs(rawOffset.x) < Math.abs(rawOffset.y);
      session.offset = lockX
        ? { x: 0, y: rawOffset.y }
        : { x: rawOffset.x, y: 0 };
      session.paused = session.mode === "reparent";
    } else {
      session.offset = rawOffset;
      session.paused = false;
    }
    if (event.altKey && !session.duplicated) {
      if (session.copyMode) {
        if (session.mode === "move") {
          this.restoreMoveElements(session);
        }
        if (
          this.duplicateDragSession(
            session,
            pointerDownState,
            event,
            scenePoint,
          )
        ) {
          session.offset = { x: 0, y: 0 };
          session.target = null;
          session.paused = false;
          session.invalid = false;
          session.previewElements = [];
        } else {
          session.target = null;
          session.paused = true;
          session.invalid = true;
          session.previewElements = [];
        }
      } else {
        if (session.mode === "move") {
          this.restoreMoveElements(session);
        }
        if (!session.unsupportedAltNotified) {
          this.notifyUnsupportedOperation();
          session.unsupportedAltNotified = true;
        }
        session.target = null;
        session.paused = true;
        session.invalid = true;
        session.previewElements = [];
        if (session.mode === "reparent") {
          this.updateDragOpacity(session.elementIds);
        }
      }
    } else if (session.duplicated) {
      this.updateMoveElements(session);
      session.target = null;
      session.paused = false;
      session.invalid = false;
      session.previewElements = [];
    } else if (session.mode === "reparent") {
      const target = session.paused
        ? null
        : this.getDropTarget(scenePoint, session.nodeIds);
      session.target = target;
      session.invalid = !session.target;
      session.previewElements = this.getReparentPreview(session);
    } else {
      this.updateMoveElements(session);
      session.target = null;
      session.invalid = false;
      session.previewElements = [];
    }
    this.renderOverlay?.();
    return true;
  };

  /** Commits a valid drag or cancels it without creating a history entry. */
  handlePointerUp = (
    pointerDownState: PointerDownState,
    event: PointerEvent,
    scenePoint: { x: number; y: number },
  ): boolean => {
    if (this.cancelledPointerDown === pointerDownState) {
      this.cancelledPointerDown = null;
      return true;
    }
    const session = this.dragSession;
    if (!session) {
      return false;
    }
    if (session.mode === "reparent") {
      session.paused = event.shiftKey || event.altKey;
      session.target = !session.paused
        ? this.getDropTarget(scenePoint, session.nodeIds)
        : null;
      session.invalid = !session.target;
    }
    if (
      event.type === "pointerup" &&
      session.mode === "reparent" &&
      session.target &&
      !session.paused &&
      !session.invalid
    ) {
      const index = buildMindmapGraphIndex(
        this.app.scene.getNonDeletedElements(),
        session.graphIds[0],
      );
      const shadowNodes = reparentMindmapNodes(
        index,
        session.nodeIds,
        session.target.parentId,
        session.target.beforeId,
      );
      if (shadowNodes.some((node) => node !== index.nodes.get(node.id))) {
        const shadowMap = new Map(shadowNodes.map((node) => [node.id, node]));
        const nextElements = this.app.scene
          .getElementsIncludingDeleted()
          .map((element) => shadowMap.get(element.id) ?? element);
        this.app.syncActionResult({
          elements: this.getLaidOutElements(nextElements, session.graphIds),
          appState: { hoveredElementIds: {} },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
    } else if (
      event.type === "pointerup" &&
      session.mode === "move" &&
      (session.duplicated || !event.altKey)
    ) {
      if (session.offset.x !== 0 || session.offset.y !== 0) {
        this.app.syncActionResult({
          elements: this.getMovedElements(session),
          appState: { hoveredElementIds: {} },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
    }
    const committedMove =
      event.type === "pointerup" &&
      session.mode === "move" &&
      (session.duplicated || !event.altKey);
    this.cancelDrag(!committedMove);
    // Mark the pointer as handled even when it was cancelled, preventing the
    // regular selection path from scheduling an empty history capture.
    pointerDownState.drag.hasOccurred = true;
    return true;
  };

  handlePointerKeyDown = (
    pointerDownState: PointerDownState,
    event: KeyboardEvent,
  ): boolean => {
    if (!this.dragSession || event.key !== KEYS.ESCAPE) {
      return false;
    }
    this.cancelledPointerDown = pointerDownState;
    this.cancelDrag();
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  cancelDrag = (restoreMove = true) => {
    if (!this.dragSession && !this.dragOpacityApplied) {
      return;
    }
    const session = this.dragSession;
    if (restoreMove && session?.mode === "move") {
      this.restoreMoveElements(session);
    }
    if (session?.mode === "move" && this.app.props.isCollaborating) {
      this.app.setElementRenderOverrides(null);
    }
    this.dragSession = null;
    if (this.dragOpacityApplied) {
      this.app.setMindmapDragOpacity(null);
      this.dragOpacityApplied = false;
      this.dimmedDragElementIds.clear();
    }
    this.app.setState({
      selectedElementsAreBeingDragged: false,
      hoveredElementIds: {},
    });
    this.renderOverlay?.();
  };

  /** Cancels a local drag when a remote update invalidates its source or target. */
  handleRemoteSceneUpdate = (elements: readonly ExcalidrawElement[]) => {
    const session = this.dragSession;
    if (!session || !this.app.props.isCollaborating) {
      return;
    }
    const elementsById = new Map(
      elements.map((element) => [element.id, element]),
    );
    const invalidated = [...session.initialElements].some(([id, initial]) => {
      const current = elementsById.get(id);
      return (
        !current || current.isDeleted || current.version !== initial.version
      );
    });
    const targetInvalidated =
      session.target &&
      (!elementsById.has(session.target.parentId) ||
        elementsById.get(session.target.parentId)?.isDeleted);
    if (invalidated || targetInvalidated) {
      this.cancelDrag();
      this.notifyUnsupportedOperation();
    }
  };

  setOverlayRenderer = (render: (() => void) | null) => {
    this.renderOverlay = render;
  };

  private updateDragOpacity = (ids: Iterable<string>) => {
    const next = new Set(ids);
    if (
      next.size === this.dimmedDragElementIds.size &&
      [...next].every((id) => this.dimmedDragElementIds.has(id))
    ) {
      return;
    }
    this.dimmedDragElementIds = next;
    this.app.setMindmapDragOpacity([...next]);
    this.dragOpacityApplied = true;
  };

  getDragPreview = () => this.dragSession;
  isReparenting = () => this.dragSession?.mode === "reparent";

  /** Drawn by the interactive canvas; never inserted into Scene. */
  renderPreview = (
    context: CanvasRenderingContext2D,
    scrollX: number,
    scrollY: number,
  ) => {
    const session = this.dragSession;
    if (!session || !session.previewElements.length) {
      return;
    }
    context.save();
    context.translate(scrollX, scrollY);
    context.globalAlpha = 0.9;
    const preview = session.previewElements;
    preview.filter(isMindmapEdgeElement).forEach((element) => {
      context.strokeStyle = "#4f83e7";
      context.lineWidth = element.strokeWidth;
      const [start, ...points] = element.points;
      if (!start) {
        return;
      }
      context.beginPath();
      context.moveTo(element.x + start[0], element.y + start[1]);
      if (element.routing === "curved" && points.length === 3) {
        context.bezierCurveTo(
          element.x + points[0][0],
          element.y + points[0][1],
          element.x + points[1][0],
          element.y + points[1][1],
          element.x + points[2][0],
          element.y + points[2][1],
        );
      } else {
        points.forEach((point) =>
          context.lineTo(element.x + point[0], element.y + point[1]),
        );
      }
      context.stroke();
    });
    preview
      .filter(
        (element) =>
          isMindmapNodeElement(element) ||
          element.type === "rectangle" ||
          element.type === "ellipse" ||
          element.type === "diamond",
      )
      .forEach((element) => {
        context.fillStyle = element.backgroundColor;
        context.strokeStyle = element.strokeColor;
        context.lineWidth = element.strokeWidth;
        context.beginPath();
        const shape = isMindmapNodeElement(element)
          ? element.shape
          : element.type;
        if (shape === "ellipse") {
          context.ellipse(
            element.x + element.width / 2,
            element.y + element.height / 2,
            element.width / 2,
            element.height / 2,
            0,
            0,
            2 * Math.PI,
          );
        } else if (shape === "diamond") {
          context.moveTo(element.x + element.width / 2, element.y);
          context.lineTo(
            element.x + element.width,
            element.y + element.height / 2,
          );
          context.lineTo(
            element.x + element.width / 2,
            element.y + element.height,
          );
          context.lineTo(element.x, element.y + element.height / 2);
          context.closePath();
        } else if (shape === "pill") {
          if (context.roundRect) {
            context.roundRect(
              element.x,
              element.y,
              element.width,
              element.height,
              element.height / 2,
            );
          } else {
            context.rect(element.x, element.y, element.width, element.height);
          }
        } else {
          context.rect(element.x, element.y, element.width, element.height);
        }
        context.fill();
        context.stroke();
      });
    preview.forEach((element) => {
      if (element.type !== "text") {
        return;
      }
      context.fillStyle = element.strokeColor;
      context.font = getFontString({
        fontSize: element.fontSize,
        fontFamily: element.fontFamily,
      });
      context.textBaseline = "top";
      context.textAlign =
        element.textAlign === "center" || element.textAlign === "right"
          ? element.textAlign
          : "left";
      const x =
        element.textAlign === "center"
          ? element.x + element.width / 2
          : element.textAlign === "right"
          ? element.x + element.width
          : element.x;
      element.text.split("\n").forEach((line, i) => {
        context.fillText(
          line,
          x,
          element.y + i * element.fontSize * element.lineHeight,
        );
      });
    });
    context.restore();
  };

  handleDoubleClick = (sceneX: number, sceneY: number) => {
    if (this.app.state.activeTool.type !== "mindmap") {
      return false;
    }
    const hit = this.app.getElementAtPosition(sceneX, sceneY, {
      includeBoundTextElement: true,
    });
    const node =
      hit?.type === "text" && hit.containerId
        ? this.app.scene.getNonDeletedElement(hit.containerId)
        : hit;
    if (!node || !isMindmapNodeElement(node)) {
      return false;
    }
    this.startNodeEditing(node);
    return true;
  };

  /** Prevents unsupported native transforms from moving a mindmap freely. */
  shouldBlockNativePointer = (pointerDownState: PointerDownState) => {
    if (this.app.state.activeTool.type === "mindmap") {
      return false;
    }
    // Area selection normalizes Mindmap graphs to either the complete graph or
    // no graph. A complete graph is safe to move through the regular
    // selection path, including when the pointer starts on an ordinary shape.
    if (this.isCompleteMindmapSelection()) {
      return this.hasLockedMindmapGraph();
    }
    return Boolean(
      pointerDownState.hit.element &&
        (this.isMindmapRelatedElement(pointerDownState.hit.element) ||
          this.hasSelectedMindmapElement()),
    );
  };

  preparePointerDown = (pointerDownState: PointerDownState) => {
    const pointerHit = pointerDownState.hit.element;
    const hit =
      pointerHit?.type === "text" && pointerHit.containerId
        ? this.app.scene.getNonDeletedElement(pointerHit.containerId)
        : pointerHit;
    if (
      this.app.state.activeTool.type === "selection" &&
      hit &&
      isMindmapNodeElement(hit) &&
      hit.role === "root" &&
      !this.app.scene
        .getNonDeletedElements()
        .some(
          (element) =>
            isMindmapNodeElement(element) &&
            element.graphId === hit.graphId &&
            element.id !== hit.id &&
            !isMindmapElementHidden(
              element,
              this.app.scene.getNonDeletedElementsMap(),
            ),
        )
    ) {
      this.selectedSingleVisibleNodeGraphId =
        this.selectedSingleVisibleNodeGraphId === hit.graphId
          ? null
          : hit.graphId;
    } else {
      this.selectedSingleVisibleNodeGraphId = null;
    }
    if (pointerDownState.hit.element) {
      this.app.setState((prevState) => {
        const candidate = this.getDragCandidate(
          pointerDownState,
          prevState.selectedElementIds,
        );
        if (candidate?.mode !== "move") {
          return null;
        }
        const expanded = new Set(Object.keys(prevState.selectedElementIds));
        const elements = this.app.scene.getNonDeletedElements();
        const elementsMap = this.app.scene.getNonDeletedElementsMap();
        for (const graphId of candidate.graphIds) {
          elements.forEach((element) => {
            if (
              isMindmapNodeElement(element) &&
              element.graphId === graphId &&
              !isMindmapElementHidden(element, elementsMap)
            ) {
              expanded.add(element.id);
            }
          });
        }
        return {
          selectedElementIds: Object.fromEntries(
            [...expanded].map((id) => [id, true]),
          ),
        };
      });
    }
    if (
      (pointerDownState.hit.replacedSelection &&
        (!pointerDownState.hit.element ||
          !this.isMindmapRelatedElement(pointerDownState.hit.element))) ||
      !this.shouldBlockNativePointer(pointerDownState)
    ) {
      return;
    }
    pointerDownState.drag.blockDragging = true;
    pointerDownState.resize.handleType = false;
    pointerDownState.resize.isResizing = false;
    if (this.app.state.resizingElement || this.app.state.isResizing) {
      this.app.setState({ resizingElement: null, isResizing: false });
    }
  };

  handleKeyEvent = (event: React.KeyboardEvent | KeyboardEvent): boolean => {
    if (
      ("isComposing" in event
        ? event.isComposing
        : event.nativeEvent.isComposing) ||
      this.app.state.openDialog?.name === "mindmapDelete"
    ) {
      return this.hasSelectedMindmapElement();
    }
    if (
      event.type !== "keydown" ||
      this.app.state.editingTextElement ||
      this.app.state.openDialog ||
      this.app.state.contextMenu
    ) {
      return false;
    }
    const arrows: readonly string[] = [
      KEYS.ARROW_LEFT,
      KEYS.ARROW_RIGHT,
      KEYS.ARROW_UP,
      KEYS.ARROW_DOWN,
    ];
    const isArrow = arrows.includes(event.key);
    const isDelete = event.key === KEYS.DELETE || event.key === KEYS.BACKSPACE;
    const isCopy =
      event[KEYS.CTRL_OR_CMD] &&
      ["c", "x", "d"].includes(event.key.toLowerCase());
    if (
      !isArrow &&
      !isDelete &&
      !isCopy &&
      event.key !== KEYS.TAB &&
      event.key !== KEYS.ENTER &&
      event.key !== KEYS.SPACE
    ) {
      return false;
    }
    if (!this.hasSelectedMindmapElement()) {
      return false;
    }
    // Let the browser copy/cut event and the action manager handle these
    // commands. Consuming them here would show the structural-operation toast
    // before the native clipboard action gets a chance to run.
    if (isCopy) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === KEYS.SPACE) {
      this.consumedSpace = true;
    }
    const node = this.getSelectedNode();
    if (
      !node ||
      event.altKey ||
      event[KEYS.CTRL_OR_CMD] ||
      (event.shiftKey && !isDelete && event.key !== KEYS.TAB)
    ) {
      this.notifyUnsupportedOperation();
      return true;
    }
    if (isArrow) {
      const index = buildMindmapGraphIndex(
        this.app.scene.getNonDeletedElements(),
        node.graphId,
      );
      const target = navigateMindmap(
        index,
        node.id,
        event.key as Parameters<typeof navigateMindmap>[2],
      );
      if (target) {
        this.selectNode(index.nodes.get(target)!);
      }
    } else if (!event.repeat) {
      if (isDelete) {
        this.app.syncActionResult(this.getDeleteActionResult(event.shiftKey));
      } else if (event.key === KEYS.SPACE) {
        this.executeTreeCommand({ type: "toggleCollapse" }, node.id);
      } else if (event.key === KEYS.TAB && event.shiftKey) {
        this.promote(node.id);
      } else if (event.key === KEYS.TAB) {
        this.createNode(node, "child");
      } else if (event.key === KEYS.ENTER) {
        this.createNode(node, node.role === "root" ? "child" : "sibling");
      }
    }
    return true;
  };

  handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === KEYS.SPACE && this.consumedSpace) {
      this.consumedSpace = false;
      return true;
    }
    return false;
  };

  getSelectedNode = () => {
    const selected = this.app.scene.getSelectedElements(this.app.state);
    return selected.length === 1 &&
      isMindmapNodeElement(selected[0]) &&
      !isMindmapElementHidden(
        selected[0],
        this.app.scene.getNonDeletedElementsMap(),
      )
      ? selected[0]
      : null;
  };

  getSelectedGraphRoot = () => {
    const selected = this.app.scene.getSelectedElements(this.app.state);
    const roots = selected
      .filter(isMindmapNodeElement)
      .filter((node) => node.role === "root");
    if (roots.length !== 1) {
      return null;
    }
    const root = roots[0];
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    if (
      selected.some((element) => {
        if (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) {
          return element.graphId !== root.graphId;
        }
        const container =
          element.type === "text" && element.containerId
            ? elementsMap.get(element.containerId)
            : null;
        return (
          !container ||
          !isMindmapNodeElement(container) ||
          container.graphId !== root.graphId
        );
      })
    ) {
      return null;
    }
    const graphNodes = this.app.scene
      .getNonDeletedElements()
      .filter(isMindmapNodeElement)
      .filter((node) => node.graphId === root.graphId);
    const visibleNodes = graphNodes.filter(
      (node) => !isMindmapElementHidden(node, elementsMap),
    );
    if (
      (visibleNodes.length === 1 &&
        this.selectedSingleVisibleNodeGraphId !== root.graphId) ||
      visibleNodes.some((node) => !this.app.state.selectedElementIds[node.id])
    ) {
      return null;
    }
    return root;
  };

  getLayoutDirection = (graphId: string): MindmapLayoutDirection => {
    const index = buildMindmapGraphIndex(
      this.app.scene.getNonDeletedElements(),
      graphId,
    );
    return getMindmapLayoutConfig(index.nodes.get(index.rootId)).direction;
  };

  private commitGraphUpdate = (
    graphId: string,
    update: (element: ExcalidrawElement) => ExcalidrawElement,
  ) => {
    const current = this.app.scene.getElementsIncludingDeleted();
    const next = current.map((element) =>
      isMindmapNodeElement(element) || isMindmapEdgeElement(element)
        ? element.graphId === graphId
          ? update(element)
          : element
        : element,
    );
    this.app.syncActionResult({
      elements: this.getLaidOutElements(next, [graphId]),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  setNodeShape = (shape: ExcalidrawMindmapNodeElement["shape"]) => {
    const node = this.getSelectedNode();
    if (!node || !this.canEditNode(node.id)) {
      this.notifyUnsupportedOperation();
      return;
    }
    this.commitGraphUpdate(node.graphId, (element) =>
      isMindmapNodeElement(element) && element.id === node.id
        ? newElementWith(element, { shape })
        : element,
    );
  };

  setIncomingEdgeStyle = (style: {
    strokeColor?: string;
    strokeWidth?: number;
    strokeStyle?: StrokeStyle;
    routing?: MindmapEdgeRouting;
  }) => {
    const node = this.getSelectedNode();
    if (!node || node.role === "root" || !this.canEditNode(node.id)) {
      this.notifyUnsupportedOperation();
      return;
    }
    this.commitGraphUpdate(node.graphId, (element) =>
      isMindmapEdgeElement(element) && element.childId === node.id
        ? newElementWith(element, style)
        : element,
    );
  };

  setGraphEdgeStyle = (style: {
    strokeColor?: string;
    strokeWidth?: number;
    strokeStyle?: StrokeStyle;
    routing?: MindmapEdgeRouting;
  }) => {
    const root = this.getSelectedGraphRoot();
    if (!root || !this.canEditNode(root.id)) {
      this.notifyUnsupportedOperation();
      return;
    }
    this.commitGraphUpdate(root.graphId, (element) =>
      isMindmapNodeElement(element) && element.id === root.id
        ? newElementWith(element, {
            ...(style.strokeColor !== undefined && {
              defaultEdgeStrokeColor: style.strokeColor,
            }),
            ...(style.strokeWidth !== undefined && {
              defaultEdgeStrokeWidth: style.strokeWidth,
            }),
            ...(style.strokeStyle !== undefined && {
              defaultEdgeStrokeStyle: style.strokeStyle,
            }),
            ...(style.routing !== undefined && {
              defaultEdgeRouting: style.routing,
            }),
          })
        : isMindmapEdgeElement(element)
        ? newElementWith(element, style)
        : element,
    );
  };

  setLayoutConfig = (config: { direction?: MindmapLayoutDirection }) => {
    const root = this.getSelectedGraphRoot();
    if (!root || !this.canEditNode(root.id)) {
      this.notifyUnsupportedOperation();
      return;
    }
    const nextRoot = newElementWith(root, {
      ...(config.direction !== undefined && {
        layoutDirection: config.direction,
      }),
    });
    this.commitGraphUpdate(root.graphId, (element) =>
      isMindmapNodeElement(element) && element.id === root.id
        ? nextRoot
        : element,
    );
  };

  relayoutActionResult = (
    actionName: ActionName,
    result: ActionResult,
  ): ActionResult => {
    if (
      result === false ||
      !relayoutAfterStyleActions.has(actionName) ||
      !result.elements
    ) {
      return result;
    }
    const previous = this.app.scene.getElementsMapIncludingDeleted();
    const graphIds = new Set<string>();
    result.elements.forEach((element) => {
      if (
        (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
        previous.get(element.id) !== element
      ) {
        graphIds.add(element.graphId);
      } else if (
        element.type === "text" &&
        !element.isDeleted &&
        element.containerId &&
        previous.get(element.id) !== element
      ) {
        const container = previous.get(element.containerId);
        if (isMindmapNodeElement(container)) {
          graphIds.add(container.graphId);
        }
      }
    });
    return graphIds.size
      ? {
          ...result,
          elements: this.getLaidOutElements(result.elements, [...graphIds]),
        }
      : result;
  };

  /** Returns all nodes and bound labels for the graphs represented by a selection. */
  getLockableMindmapElements = (
    selectedElements = this.app.scene.getSelectedElements({
      selectedElementIds: this.app.state.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    }),
  ): readonly NonDeletedExcalidrawElement[] => {
    const graphIds = new Set(
      selectedElements.flatMap((element) => {
        if (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) {
          return [element.graphId];
        }
        if (element.type === "text" && element.containerId) {
          const container = this.app.scene.getNonDeletedElement(
            element.containerId,
          );
          return container && isMindmapNodeElement(container)
            ? [container.graphId]
            : [];
        }
        return [];
      }),
    );
    if (!graphIds.size) {
      return [];
    }
    return this.app.scene
      .getNonDeletedElements()
      .filter(
        (element) =>
          (isMindmapNodeElement(element) && graphIds.has(element.graphId)) ||
          (element.type === "text" &&
            !!element.containerId &&
            isMindmapNodeElement(
              this.app.scene.getNonDeletedElement(element.containerId),
            ) &&
            graphIds.has(
              (
                this.app.scene.getNonDeletedElement(element.containerId) as
                  | ExcalidrawMindmapNodeElement
                  | undefined
              )?.graphId ?? "",
            )),
      );
  };

  hasLockedMindmapGraph = (
    selectedElements = this.app.scene.getSelectedElements({
      selectedElementIds: this.app.state.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    }),
  ) => {
    const lockable = this.getLockableMindmapElements(selectedElements);
    const graphIds = new Set(
      lockable.filter(isMindmapNodeElement).map((node) => node.graphId),
    );
    return lockable.some(
      (element) =>
        isMindmapNodeElement(element) &&
        graphIds.has(element.graphId) &&
        element.locked,
    );
  };

  canEditNode = (nodeId: string) => {
    const node = this.app.scene.getNonDeletedElement(nodeId);
    return (
      !!node &&
      isMindmapNodeElement(node) &&
      !node.locked &&
      !this.hasLockedMindmapGraph([node]) &&
      !this.app.state.viewModeEnabled &&
      this.app.isInteractionEnabled() &&
      !this.app.state.editingTextElement &&
      !isMindmapElementHidden(node, this.app.scene.getNonDeletedElementsMap())
    );
  };

  hasChildren = (nodeId: string) =>
    this.app.scene
      .getNonDeletedElements()
      .some(
        (element) =>
          isMindmapNodeElement(element) && element.parentId === nodeId,
      );

  private getDragCandidate = (
    pointerDownState: PointerDownState,
    selectedElementIds = this.app.state.selectedElementIds,
  ): MindmapDragCandidate | null => {
    if (
      !this.app.isInteractionEnabled() ||
      this.app.state.viewModeEnabled ||
      this.app.state.editingTextElement
    ) {
      return null;
    }
    // Complete graphs are ordinary move selections. Structural Mindmap drag
    // is only used for direct, partial-node interactions.
    if (this.isCompleteMindmapSelection(selectedElementIds)) {
      return null;
    }
    const selected = this.app.scene.getSelectedElements({ selectedElementIds });
    const nodes = selected.filter(isMindmapNodeElement);
    const hit = pointerDownState.hit.element;
    // A drag must be anchored by this pointer-down hit. Using only the
    // current selection would let a blank-space box selection inherit a stale
    // mindmap selection when the pointer later crosses a node.
    const hitNode =
      hit?.type === "text" && hit.containerId
        ? this.app.scene.getNonDeletedElement(hit.containerId)
        : hit;
    if (!hitNode || !isMindmapNodeElement(hitNode)) {
      return null;
    }
    const hitIsSelected = nodes.some((node) => node.id === hitNode.id);
    const selectedNodes = hitIsSelected ? nodes : [hitNode];
    const graphIds = [...new Set(selectedNodes.map((node) => node.graphId))];
    if (
      selectedNodes.some((node) => !this.canEditNode(node.id)) ||
      this.hasLockedMindmapGraph(selectedNodes)
    ) {
      return null;
    }
    const hasOrdinarySelection = selected.some(
      (element) =>
        !isMindmapNodeElement(element) && !isMindmapEdgeElement(element),
    );
    const canReparent =
      graphIds.length === 1 &&
      !hasOrdinarySelection &&
      selectedNodes.every((node) => node.role !== "root");
    const elementIds = new Set<string>();
    let nodeIds = selectedNodes.map((node) => node.id);
    if (canReparent) {
      const index = buildMindmapGraphIndex(
        this.app.scene.getNonDeletedElements(),
        graphIds[0],
      );
      const selectedIds = new Set(nodeIds);
      nodeIds = [];
      const collectBranchRoots = (id: string) => {
        if (selectedIds.has(id)) {
          nodeIds.push(id);
          return;
        }
        index.childrenById.get(id)?.forEach(collectBranchRoots);
      };
      collectBranchRoots(index.rootId);
      nodeIds.forEach((nodeId) => {
        getMindmapSubtreeIds(index, nodeId).forEach((id) => {
          elementIds.add(id);
          const edge = index.edgeByChildId.get(id);
          if (edge) {
            elementIds.add(edge.id);
          }
        });
      });
    } else {
      this.app.scene.getNonDeletedElements().forEach((element) => {
        if (
          (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
          graphIds.includes(element.graphId)
        ) {
          elementIds.add(element.id);
        }
      });
      selected.forEach((element) => elementIds.add(element.id));
    }
    // Bound labels move with their container even when they are hidden by a
    // collapsed branch or omitted from the selected-elements list.
    this.app.scene.getNonDeletedElements().forEach((element) => {
      if (
        element.type === "text" &&
        element.containerId &&
        elementIds.has(element.containerId)
      ) {
        elementIds.add(element.id);
      }
    });
    const copyMode =
      !hasOrdinarySelection &&
      graphIds.length === 1 &&
      hitIsSelected &&
      (hitNode.role === "root"
        ? selectedNodes.every((node) => node.graphId === hitNode.graphId)
        : selectedNodes.length === 1)
        ? hitNode.role === "root"
          ? "graph"
          : "subtree"
        : null;
    return {
      mode: canReparent ? "reparent" : "move",
      nodeIds,
      graphIds,
      elementIds,
      copyMode,
    };
  };

  /**
   * Normalizes an area-selection result per Mindmap graph. A collapsed selected
   * parent implicitly selects its hidden descendants. Each graph is either
   * fully selected (including edges and bound labels) or removed entirely.
   */
  normalizeMindmapSelection = (
    selectedElementIds: Readonly<Record<string, true>>,
  ): Record<string, true> => {
    const elements = this.app.scene.getNonDeletedElements();
    const nextSelectedElementIds: Record<string, true> = {
      ...selectedElementIds,
    };
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    const graphIds = new Set<string>();
    elements.forEach((element) => {
      if (!selectedElementIds[element.id]) {
        return;
      }
      if (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) {
        graphIds.add(element.graphId);
      } else if (element.type === "text" && element.containerId) {
        const container = elementsMap.get(element.containerId);
        if (container && isMindmapNodeElement(container)) {
          graphIds.add(container.graphId);
        }
      }
    });

    for (const graphId of graphIds) {
      const graphNodes = elements
        .filter(isMindmapNodeElement)
        .filter((element) => element.graphId === graphId);
      const index = buildMindmapGraphIndex(elements, graphId);
      const effectivelySelectedNodeIds = new Set(
        graphNodes
          .filter((node) => selectedElementIds[node.id])
          .map((node) => node.id),
      );
      graphNodes.forEach((node) => {
        if (selectedElementIds[node.id] && node.collapsed) {
          getMindmapSubtreeIds(index, node.id).forEach((id) =>
            effectivelySelectedNodeIds.add(id),
          );
        }
      });
      const graphNodeIds = new Set(graphNodes.map((node) => node.id));
      const relatedElements = elements.filter(
        (element) =>
          ((isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
            element.graphId === graphId) ||
          (element.type === "text" &&
            !!element.containerId &&
            graphNodeIds.has(element.containerId)),
      );

      relatedElements.forEach((element) => {
        if (
          graphNodes.every((node) => effectivelySelectedNodeIds.has(node.id))
        ) {
          nextSelectedElementIds[element.id] = true;
        } else {
          delete nextSelectedElementIds[element.id];
        }
      });
    }

    return nextSelectedElementIds;
  };

  /** Whether every selected Mindmap graph is complete, including edges/text. */
  isCompleteMindmapSelection = (
    selectedElementIds = this.app.state.selectedElementIds,
  ) => {
    const elements = this.app.scene.getNonDeletedElements();
    const selected = new Set(Object.keys(selectedElementIds));
    const graphIds = new Set<string>();
    elements.forEach((element) => {
      if (
        selected.has(element.id) &&
        (isMindmapNodeElement(element) || isMindmapEdgeElement(element))
      ) {
        graphIds.add(element.graphId);
      }
    });
    if (!graphIds.size) {
      return false;
    }
    return [...graphIds].every((graphId) => {
      const nodeIds = new Set(
        elements
          .filter(isMindmapNodeElement)
          .filter((element) => element.graphId === graphId)
          .map((element) => element.id),
      );
      return elements
        .filter(
          (element) =>
            ((isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
              element.graphId === graphId) ||
            (element.type === "text" &&
              !!element.containerId &&
              nodeIds.has(element.containerId)),
        )
        .every(
          (element) =>
            selected.has(element.id) ||
            (element.type === "text" &&
              !!element.containerId &&
              selected.has(element.containerId)),
        );
    });
  };

  private getSubtreeIds = (
    index: ReturnType<typeof buildMindmapGraphIndex>,
    nodeId: string,
  ): readonly string[] => {
    const ids = [nodeId];
    for (let i = 0; i < ids.length; i++) {
      ids.push(...(index.childrenById.get(ids[i]) ?? []));
    }
    return ids;
  };

  private createDragSession = (
    pointerDownState: PointerDownState,
    candidate: MindmapDragCandidate,
  ): MindmapDragSession => {
    const session: MindmapDragSession = {
      ...candidate,
      initialElements: new Map(
        this.app.scene
          .getNonDeletedElements()
          .filter((element) => candidate.elementIds.has(element.id))
          .map((element) => [element.id, element]),
      ),
      origin: { ...pointerDownState.origin },
      offset: { x: 0, y: 0 },
      target: null,
      paused: false,
      invalid: false,
      previewElements: [],
      duplicated: false,
      unsupportedAltNotified: false,
    };
    session.previewElements =
      session.mode === "move" ? [] : this.getReparentPreview(session);
    return session;
  };

  private getDropTarget = (
    scenePoint: { x: number; y: number },
    nodeIds: readonly string[],
  ): MindmapDropTarget | null => {
    const source = this.app.scene.getNonDeletedElement(nodeIds[0]);
    if (!source || !isMindmapNodeElement(source)) {
      return null;
    }
    const index = buildMindmapGraphIndex(
      this.app.scene.getNonDeletedElements(),
      source.graphId,
    );
    const selected = new Set(nodeIds);
    const excluded = new Set(
      nodeIds.flatMap((id) => this.getSubtreeIds(index, id)),
    );
    const tolerance = 40 / this.app.state.zoom.value;
    const root = index.nodes.get(index.rootId)!;
    const { direction } = getMindmapLayoutConfig(root);
    const isVertical =
      direction === "top-to-bottom" || direction === "bottom-to-top";
    const mainSign =
      direction === "right-to-left" || direction === "bottom-to-top" ? -1 : 1;
    let closest: { target: MindmapDropTarget; distance: number } | null = null;
    for (const node of index.nodes.values()) {
      if (
        excluded.has(node.id) ||
        node.locked ||
        isMindmapElementHidden(node, this.app.scene.getNonDeletedElementsMap())
      ) {
        continue;
      }
      const main = isVertical ? scenePoint.y : scenePoint.x;
      const cross = isVertical ? scenePoint.x : scenePoint.y;
      const nodeMain = isVertical ? node.y : node.x;
      const nodeMainSize = isVertical ? node.height : node.width;
      const nodeCross = isVertical ? node.x : node.y;
      const nodeCrossSize = isVertical ? node.width : node.height;
      const centerCross = nodeCross + nodeCrossSize / 2;
      const crossDistance = Math.abs(cross - centerCross);
      const childDistance =
        mainSign > 0
          ? Math.max(0, main - (nodeMain + nodeMainSize))
          : Math.max(0, nodeMain - main);
      const childBoundary = mainSign > 0 ? nodeMain + nodeMainSize : nodeMain;
      const childNear =
        mainSign > 0
          ? nodeMain + nodeMainSize * 0.6
          : nodeMain + nodeMainSize * 0.4;
      const childFar =
        mainSign > 0
          ? childBoundary + tolerance * 2.5
          : childBoundary - tolerance * 2.5;
      if (
        !node.collapsed &&
        (mainSign > 0
          ? main >= childNear && main <= childFar
          : main <= childNear && main >= childFar) &&
        crossDistance <= nodeCrossSize / 2 + tolerance
      ) {
        const distance = childDistance + crossDistance;
        if (!closest || distance < closest.distance) {
          closest = {
            target: { parentId: node.id, beforeId: null },
            distance,
          };
        }
      }
      if (!node.parentId) {
        continue;
      }
      if (
        main < nodeMain - tolerance ||
        main > nodeMain + nodeMainSize + tolerance / 2
      ) {
        continue;
      }
      const above = cross < centerCross;
      const edgeCross = above ? nodeCross : nodeCross + nodeCrossSize;
      if (Math.abs(cross - edgeCross) > tolerance) {
        continue;
      }
      const siblings = (index.childrenById.get(node.parentId) ?? []).filter(
        (id) => !selected.has(id),
      );
      const position = siblings.indexOf(node.id);
      if (position < 0) {
        continue;
      }
      const distance =
        Math.abs(cross - edgeCross) +
        Math.max(0, nodeMain - main, main - (nodeMain + nodeMainSize));
      if (!closest || distance < closest.distance) {
        closest = {
          target: {
            parentId: node.parentId,
            beforeId: above ? node.id : siblings[position + 1] ?? null,
          },
          distance,
        };
      }
    }
    return closest?.target ?? null;
  };

  private getReparentPreview = (
    session: MindmapDragSession,
  ): readonly ExcalidrawElement[] => {
    const source = this.app.scene.getNonDeletedElement(session.nodeIds[0]);
    if (!source || !isMindmapNodeElement(source)) {
      return [];
    }
    const sourceIndex = buildMindmapGraphIndex(
      this.app.scene.getNonDeletedElements(),
      source.graphId,
    );
    const { direction } = getMindmapLayoutConfig(
      sourceIndex.nodes.get(sourceIndex.rootId),
    );
    const previewNode = {
      ...source,
      x: source.x + session.offset.x,
      y: source.y + session.offset.y,
    };
    const label = this.app.scene
      .getNonDeletedElements()
      .find(
        (element) =>
          element.type === "text" && element.containerId === source.id,
      );
    const preview: ExcalidrawElement[] = [previewNode];
    if (label) {
      preview.push({
        ...label,
        x: label.x + session.offset.x,
        y: label.y + session.offset.y,
      });
    }
    if (session.target) {
      const parent = this.app.scene.getNonDeletedElement(
        session.target.parentId,
      );
      const edge = this.app.scene
        .getNonDeletedElements()
        .find(
          (element) =>
            isMindmapEdgeElement(element) && element.childId === source.id,
        );
      if (
        parent &&
        isMindmapNodeElement(parent) &&
        edge &&
        isMindmapEdgeElement(edge)
      ) {
        const geometry = getMindmapEdgeGeometry(
          parent,
          previewNode,
          edge.routing,
          direction,
        );
        preview.unshift({
          ...edge,
          parentId: parent.id,
          ...geometry,
        });
      }
    }
    return preview;
  };

  private getMovedElements = (session: MindmapDragSession) => {
    if (!this.app.props.isCollaborating) {
      return this.app.scene.getElementsIncludingDeleted();
    }
    return this.app.scene.getElementsIncludingDeleted().map((element) => {
      const initial = session.initialElements.get(element.id);
      return initial
        ? newElementWith(initial, {
            x: initial.x + session.offset.x,
            y: initial.y + session.offset.y,
          })
        : element;
    });
  };

  private updateMoveElements = (session: MindmapDragSession) => {
    if (this.app.props.isCollaborating) {
      this.app.setElementRenderOverrides(
        new Map(
          [...session.initialElements.keys()].map((id) => [
            id,
            { offset: session.offset },
          ]),
        ),
      );
      return;
    }

    // Keep full-graph movement in Scene for the standalone editor so the local
    // canvas follows the pointer without drawing a second copy over the graph.
    this.app.scene.mapElements((element) => {
      const initial = session.initialElements.get(element.id);
      if (!initial) {
        return element;
      }
      return newElementWith(initial, {
        x: initial.x + session.offset.x,
        y: initial.y + session.offset.y,
      });
    });
  };

  private duplicateDragSession = (
    session: MindmapDragSession,
    pointerDownState: PointerDownState,
    event: PointerEvent,
    scenePoint: { x: number; y: number },
  ) => {
    const elementsToDuplicate = [...session.initialElements.values()].filter(
      (element) =>
        !(
          session.copyMode === "subtree" &&
          isMindmapEdgeElement(element) &&
          session.nodeIds.includes(element.childId) &&
          !session.nodeIds.includes(element.parentId)
        ),
    );
    const duplicatedElements = this.app.duplicate.duplicateDraggedSelection(
      pointerDownState,
      event,
      elementsToDuplicate,
    );
    if (!duplicatedElements?.length) {
      return false;
    }

    session.initialElements = new Map(
      duplicatedElements.map((element) => [element.id, element]),
    );
    session.elementIds = new Set(
      duplicatedElements.map((element) => element.id),
    );
    session.nodeIds = [];
    session.graphIds = [
      ...new Set(
        duplicatedElements
          .filter(isMindmapNodeElement)
          .map((element) => element.graphId),
      ),
    ];
    session.mode = "move";
    session.duplicated = true;
    session.origin = { ...scenePoint };
    session.offset = { x: 0, y: 0 };
    session.target = null;
    session.paused = false;
    session.invalid = false;
    session.previewElements = [];
    session.unsupportedAltNotified = false;

    if (this.dragOpacityApplied) {
      this.app.setMindmapDragOpacity(null);
      this.dragOpacityApplied = false;
      this.dimmedDragElementIds.clear();
    }
    return true;
  };

  private restoreMoveElements = (session: MindmapDragSession) => {
    if (this.app.props.isCollaborating) {
      this.app.setElementRenderOverrides(null);
      return;
    }
    this.app.scene.mapElements(
      (element) => session.initialElements.get(element.id) ?? element,
    );
  };

  getTreeActionResult = (
    command: MindmapTreeCommand,
    nodeId = this.getSelectedNode()?.id,
  ): ActionResult => {
    if (!nodeId || !this.canEditNode(nodeId)) {
      this.notifyUnsupportedOperation();
      return false;
    }
    const result = applyMindmapTreeCommand(
      this.app.scene.getElementsIncludingDeleted(),
      nodeId,
      command,
    );
    if (!result) {
      return false;
    }
    return {
      elements: this.getLaidOutElements(result.elements, result.graphIds),
      appState: {
        selectedElementIds: result.selectedNodeId
          ? { [result.selectedNodeId]: true }
          : {},
        selectedGroupIds: {},
        previousSelectedElementIds: {},
        selectedLinearElement: null,
        hoveredElementIds: {},
        openDialog: null,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  };

  executeTreeCommand = (command: MindmapTreeCommand, nodeId?: string) => {
    this.app.syncActionResult(this.getTreeActionResult(command, nodeId));
  };

  getDeleteActionResult = (preserveChildren = false): ActionResult => {
    const node = this.getSelectedNode();
    if (!node || !this.canEditNode(node.id)) {
      this.notifyUnsupportedOperation();
      return false;
    }
    const children =
      buildMindmapGraphIndex(
        this.app.scene.getNonDeletedElements(),
        node.graphId,
      ).childrenById.get(node.id) ?? [];
    if (preserveChildren && children.length > 1) {
      return {
        appState: {
          openDialog: { name: "mindmapDelete", nodeId: node.id },
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      };
    }
    return this.getTreeActionResult(
      { type: preserveChildren ? "deletePreservingChildren" : "delete" },
      node.id,
    );
  };

  getPromoteActionResult = (
    nodeId = this.getSelectedNode()?.id,
  ): ActionResult => {
    const used = new Set(
      this.app.scene
        .getElementsIncludingDeleted()
        .filter(isMindmapNodeElement)
        .map((node) => node.graphId),
    );
    const base = `mindmap:${nodeId}`;
    let newGraphId = base;
    let suffix = 0;
    while (used.has(newGraphId)) {
      newGraphId = `${base}:${++suffix}`;
    }
    return this.getTreeActionResult({ type: "promote", newGraphId }, nodeId);
  };

  promote = (nodeId: string) => {
    this.app.syncActionResult(this.getPromoteActionResult(nodeId));
  };

  createSibling = (nodeId: string) => {
    const node = this.app.scene.getNonDeletedElement(nodeId);
    if (node && isMindmapNodeElement(node)) {
      this.createNode(node, node.role === "root" ? "child" : "sibling");
    }
  };

  /** Called by App after the shared text editor has committed its value. */
  handleTextSubmit = (textElement: NonDeletedExcalidrawElement): boolean => {
    if (textElement.type !== "text" || !textElement.containerId) {
      return false;
    }
    const container = this.app.scene.getNonDeletedElement(
      textElement.containerId,
    );
    if (!container || !isMindmapNodeElement(container)) {
      return false;
    }

    const isNewNode = this.pendingTextNodeIds.delete(container.id);
    handleBindTextResize(container, this.app.scene, "se", false, false);
    this.layoutGraph(container.graphId);
    return isNewNode;
  };

  createChild = (nodeId: string) => {
    const node = this.app.scene.getNonDeletedElement(nodeId);
    if (node && isMindmapNodeElement(node)) {
      this.createNode(node, "child");
    }
  };

  private createRoot(x: number, y: number) {
    if (this.app.state.viewModeEnabled) {
      this.notifyUnsupportedOperation();
      return;
    }
    const root = newMindmapNodeElement({
      x: x - 80,
      y: y - 28,
      graphId: "",
      role: "root",
      parentId: null,
      order: null,
    });
    const graphId = `mindmap:${root.id}`;
    const graphRoot = { ...root, graphId };
    this.app.insertNewElement(graphRoot);
    this.layoutGraph(graphId);
    this.pendingTextNodeIds.add(graphRoot.id);
    this.startNodeEditing(graphRoot);
  }

  private createNode(parent: ExcalidrawMindmapNodeElement, kind: NewNodeKind) {
    if (!this.canEditNode(parent.id)) {
      this.notifyUnsupportedOperation();
      return;
    }
    if (kind === "child" && parent.collapsed) {
      this.app.scene.mutateElement(parent, { collapsed: false });
    }
    const index = buildMindmapGraphIndex(
      this.app.scene.getNonDeletedElements(),
      parent.graphId,
    );
    const siblings = [
      ...(index.childrenById.get(
        kind === "child" ? parent.id : parent.parentId!,
      ) ?? []),
    ];
    const parentId = kind === "child" ? parent.id : parent.parentId;
    if (!parentId) {
      return;
    }
    const currentIndex =
      kind === "child" ? siblings.length : siblings.indexOf(parent.id) + 1;
    const previousId = currentIndex > 0 ? siblings[currentIndex - 1] : null;
    const nextId =
      currentIndex < siblings.length ? siblings[currentIndex] : null;
    const order = generateKeyBetween(
      previousId ? index.nodes.get(previousId)!.order : null,
      nextId ? index.nodes.get(nextId)!.order : null,
    );
    const node = newMindmapNodeElement({
      x: parent.x + parent.width + 80,
      y: parent.y,
      graphId: parent.graphId,
      role: "node",
      parentId,
      order: order as FractionalIndex,
      shape: index.nodes.get(index.rootId)?.defaultNodeShape ?? "rectangle",
    });
    this.app.insertNewElement(node);
    this.layoutGraph(parent.graphId);
    this.pendingTextNodeIds.add(node.id);
    this.startNodeEditing(node);
  }

  /** Converts a node or a complete graph into ordinary Excalidraw elements. */
  convertToShape = (nextType: "rectangle" | "diamond" | "ellipse"): boolean => {
    const selectedElements = this.app.scene.getSelectedElements({
      selectedElementIds: this.app.state.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });
    if (this.hasLockedMindmapGraph(selectedElements)) {
      this.notifyUnsupportedOperation();
      return false;
    }
    const selectedIds = new Set(selectedElements.map((element) => element.id));
    const selectedNodes = selectedElements.flatMap((element) => {
      if (isMindmapNodeElement(element)) {
        return [element];
      }
      if (element.type === "text" && element.containerId) {
        const container = this.app.scene.getNonDeletedElement(
          element.containerId,
        );
        return container && isMindmapNodeElement(container) ? [container] : [];
      }
      return [];
    });
    if (!selectedNodes.length) {
      return false;
    }

    const elements = this.app.scene.getElementsIncludingDeleted();
    const graphIds = [...new Set(selectedNodes.map((node) => node.graphId))];
    const wholeGraphIds = new Set<string>();
    const partialNodes: ExcalidrawMindmapNodeElement[] = [];
    for (const graphId of graphIds) {
      const index = buildMindmapGraphIndex(
        this.app.scene.getNonDeletedElements(),
        graphId,
      );
      const graphSelected = selectedNodes.filter(
        (node) => node.graphId === graphId,
      );
      if (
        graphSelected.some((node) => node.role === "root") ||
        [...index.nodes.keys()].every((id) => selectedIds.has(id))
      ) {
        wholeGraphIds.add(graphId);
      } else {
        partialNodes.push(
          ...graphSelected.filter((node) => node.role !== "root"),
        );
      }
    }

    const branchRoots = partialNodes.filter(
      (node) =>
        !partialNodes.some(
          (candidate) =>
            candidate.id !== node.id &&
            getMindmapSubtreeIds(
              buildMindmapGraphIndex(
                this.app.scene.getNonDeletedElements(),
                node.graphId,
              ),
              candidate.id,
            ).includes(node.id),
        ),
    );
    if (branchRoots.length > 1) {
      this.notifyUnsupportedOperation();
      return false;
    }

    const convertNode = (node: ExcalidrawMindmapNodeElement) => {
      const { graphId, role, parentId, order, collapsed, shape, ...rest } =
        node;
      return bumpVersion(
        newElement({
          ...rest,
          type: nextType,
          roundness: node.roundness,
        }),
      ) as NonDeletedExcalidrawElement;
    };
    const convertEdge = (edge: ExcalidrawElement) => {
      if (!isMindmapEdgeElement(edge)) {
        return edge;
      }
      const { graphId, parentId, childId, routing, points, ...rest } = edge;
      return bumpVersion(
        newLinearElement({
          ...rest,
          type: "line",
          points:
            points.length > 1
              ? points
              : [
                  pointFrom<LocalPoint>(0, 0),
                  pointFrom<LocalPoint>(Math.max(edge.width, 1), edge.height),
                ],
        }),
      ) as NonDeletedExcalidrawElement;
    };

    const convertedNodeIds = new Set<string>();
    wholeGraphIds.forEach((graphId) => {
      this.app.scene
        .getNonDeletedElements()
        .filter(
          (element) =>
            isMindmapNodeElement(element) && element.graphId === graphId,
        )
        .forEach((node) => convertedNodeIds.add(node.id));
    });
    branchRoots.forEach((node) => convertedNodeIds.add(node.id));

    const reparentedChildren = new Map<
      string,
      { parentId: string; order: FractionalIndex }
    >();
    for (const node of branchRoots) {
      const index = buildMindmapGraphIndex(
        this.app.scene.getNonDeletedElements(),
        node.graphId,
      );
      const parentId = node.parentId!;
      const siblings = (index.childrenById.get(parentId) ?? []).filter(
        (id) => id !== node.id,
      );
      const position = index.childrenById.get(parentId)!.indexOf(node.id);
      const previous =
        position > 0 ? index.nodes.get(siblings[position - 1]) : null;
      const next =
        position < siblings.length ? index.nodes.get(siblings[position]) : null;
      const children = index.childrenById.get(node.id) ?? [];
      const orders = generateNKeysBetween(
        previous?.order ?? null,
        next?.order ?? null,
        children.length,
      );
      children.forEach((childId, index) => {
        reparentedChildren.set(childId, {
          parentId,
          order: orders[index] as FractionalIndex,
        });
      });
    }

    const nextElements = elements.map((element) => {
      if (isMindmapNodeElement(element)) {
        if (convertedNodeIds.has(element.id)) {
          return convertNode(element);
        }
        const update = reparentedChildren.get(element.id);
        return update
          ? newElementWith(element, {
              parentId: update.parentId,
              order: update.order,
            })
          : element;
      }
      if (isMindmapEdgeElement(element)) {
        if (wholeGraphIds.has(element.graphId)) {
          return convertEdge(element);
        }
        if (convertedNodeIds.has(element.childId)) {
          return newElementWith(element, { isDeleted: true });
        }
        const childUpdate = reparentedChildren.get(element.childId);
        if (childUpdate) {
          return newElementWith(element, {
            parentId: childUpdate.parentId,
          });
        }
      }
      return element;
    });

    const laidOut = this.getLaidOutElements(nextElements, graphIds);
    const nextSelectedElementIds = Object.fromEntries(
      laidOut
        .filter((element) => !element.isDeleted && selectedIds.has(element.id))
        .map((element) => [element.id, true]),
    ) as Record<string, true>;
    this.app.syncActionResult({
      elements: laidOut,
      appState: {
        selectedElementIds: nextSelectedElementIds,
        selectedLinearElement: null,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return true;
  };

  private startNodeEditing(node: ExcalidrawMindmapNodeElement) {
    if (!this.canEditNode(node.id)) {
      this.notifyUnsupportedOperation();
      return;
    }
    const current = this.app.scene.getNonDeletedElement(node.id);
    if (!current || !isMindmapNodeElement(current)) {
      return;
    }
    // 等待选中状态更新，避免共享编辑器取到上一个节点的绑定文字。
    this.selectNode(current, () => {
      this.app.startTextEditing({
        sceneX: current.x + current.width / 2,
        sceneY: current.y + current.height / 2,
        container: current as ExcalidrawTextContainer,
      });
    });
  }

  private layoutGraph(graphId: string) {
    // 布局和派生连接线随文字提交一并进入历史，不能作为 NEVER 更新排除。
    this.app.updateScene({
      elements: this.getLaidOutElements(
        this.app.scene.getElementsIncludingDeleted(),
        [graphId],
      ),
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    });
  }

  getLaidOutElements(
    elements: readonly ExcalidrawElement[],
    graphIds: readonly string[],
  ) {
    const previous = this.app.scene.getElementsMapIncludingDeleted();
    const repaired = repairMindmapElements(elements);
    const updated = new Map(repaired.map((element) => [element.id, element]));
    for (const graphId of graphIds) {
      const graph = repaired.filter(
        (element) =>
          !element.isDeleted &&
          (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
          element.graphId === graphId,
      );
      if (!graph.some(isMindmapNodeElement)) {
        continue;
      }
      // Text style changes can enlarge a node. Re-run the layout after that
      // resize so sibling spacing and edge endpoints use the final bounds.
      for (let pass = 0; pass < 2; pass++) {
        const currentGraph = [...updated.values()].filter(
          (element) =>
            !element.isDeleted &&
            (isMindmapNodeElement(element) || isMindmapEdgeElement(element)) &&
            element.graphId === graphId,
        );
        const layout = layoutMindmap(
          buildMindmapGraphIndex(currentGraph, graphId),
        );
        for (const element of [...layout.elements, ...layout.edges]) {
          updated.set(element.id, element);
        }
        let resized = false;
        for (const node of layout.elements) {
          const text = getBoundTextElement(node, updated);
          if (!text) {
            continue;
          }
          const maxWidth = getBoundTextMaxWidth(node, text);
          const wrappedText = wrapText(
            text.originalText,
            getFontString(text),
            maxWidth,
          );
          const metrics = measureText(
            wrappedText,
            getFontString(text),
            text.lineHeight,
          );
          const shape = node.shape === "pill" ? "ellipse" : node.shape;
          const maxHeight = getBoundTextMaxHeight(node, text);
          const nextNode = newElementWith(node, {
            ...(metrics.width > maxWidth && {
              width: computeContainerDimensionForBoundText(
                metrics.width,
                shape,
              ),
            }),
            ...(metrics.height > maxHeight && {
              height: computeContainerDimensionForBoundText(
                metrics.height,
                shape,
              ),
            }),
          });
          resized ||=
            nextNode.width !== node.width || nextNode.height !== node.height;
          updated.set(node.id, nextNode);
          const nextText = {
            ...text,
            text: wrappedText,
            width: metrics.width,
            height: metrics.height,
          };
          updated.set(text.id, {
            ...nextText,
            ...computeBoundTextPosition(nextNode, nextText, updated),
          });
        }
        if (!resized) {
          break;
        }
      }
    }
    return repaired.map((element) => {
      const next = updated.get(element.id) ?? element;
      const prev = previous.get(element.id);
      if (!prev || prev === next) {
        return next;
      }
      // 纯修复和布局不改版本，在写回边界只提交真实差异，供历史与协作识别。
      const updates = Object.fromEntries(
        Object.entries(next).filter(
          ([key, value]) =>
            key !== "version" &&
            key !== "versionNonce" &&
            key !== "updated" &&
            prev[key as keyof typeof prev] !== value,
        ),
      );
      return newElementWith(prev, updates);
    });
  }

  private selectNode(
    node: ExcalidrawMindmapNodeElement,
    onSelect?: () => void,
  ) {
    this.app.setState(
      {
        selectedElementIds: { [node.id]: true },
        selectedLinearElement: null,
        hoveredElementIds: {},
        selectedGroupIds: {},
        editingGroupId: null,
      },
      onSelect,
    );
  }

  hasSelectedMindmapElement = () => {
    return this.app.scene
      .getSelectedElements({
        selectedElementIds: this.app.state.selectedElementIds,
        includeBoundTextElement: true,
        includeElementsInFrames: true,
      })
      .some(this.isMindmapRelatedElement);
  };

  private isMindmapRelatedElement = (element: NonDeletedExcalidrawElement) =>
    isMindmapNodeElement(element) ||
    isMindmapEdgeElement(element) ||
    (element.type === "text" &&
      !!element.containerId &&
      isMindmapNodeElement(
        this.app.scene.getNonDeletedElement(element.containerId),
      ));

  shouldBlockNativeAction = (name: ActionName) => {
    if (name === "clearCanvas") {
      return this.app.scene
        .getNonDeletedElements()
        .some(this.isMindmapRelatedElement);
    }
    if (!this.hasSelectedMindmapElement()) {
      return false;
    }
    if (unsupportedSelectionActions.has(name)) {
      return true;
    }
    return (
      lockedMindmapMutationActions.has(name) && this.hasLockedMindmapGraph()
    );
  };

  notifyUnsupportedOperation = () => {
    this.app.setToast({ message: t("errors.mindmapUnsupported") });
  };
}
