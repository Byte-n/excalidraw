import { DRAGGING_THRESHOLD, getFontString, KEYS } from "@excalidraw/common";
import { generateKeyBetween } from "@excalidraw/fractional-indexing";
import { pointFrom } from "@excalidraw/math";

import {
  applyMindmapTreeCommand,
  buildMindmapGraphIndex,
  CaptureUpdateAction,
  computeBoundTextPosition,
  getBoundTextElement,
  handleBindTextResize,
  isMindmapElementHidden,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  getMindmapSubtreeIds,
  layoutMindmap,
  navigateMindmap,
  newElementWith,
  newMindmapNodeElement,
  reparentMindmapNodes,
  repairMindmapElements,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawMindmapNodeElement,
  ExcalidrawTextContainer,
  FractionalIndex,
  NonDeletedExcalidrawElement,
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
  initialElements: ReadonlyMap<string, ExcalidrawElement>;
  origin: { x: number; y: number };
  offset: { x: number; y: number };
  target: MindmapDropTarget | null;
  paused: boolean;
  invalid: boolean;
  previewElements: readonly ExcalidrawElement[];
};

type MindmapDragCandidate = {
  mode: "reparent" | "move";
  nodeIds: readonly string[];
  graphIds: readonly string[];
  elementIds: ReadonlySet<string>;
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
  "changeBackgroundColor",
  "changeFillStyle",
  "changeFontFamily",
  "changeFontSize",
  "changeOpacity",
  "changeRoundness",
  "changeSloppiness",
  "changeStrokeColor",
  "changeStrokeStyle",
  "changeStrokeWidth",
  "changeTextAlign",
  "changeVerticalAlign",
  "decreaseFontSize",
  "distributeHorizontally",
  "distributeVertically",
  "flipHorizontal",
  "flipVertical",
  "group",
  "increaseFontSize",
  "pasteStyles",
  "removeAllElementsFromFrame",
  "sendBackward",
  "sendToBack",
  "unbindText",
  "ungroup",
  "wrapSelectionInFrame",
  "wrapTextInContainer",
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

  constructor(private readonly app: App) {}

  clear = () => {
    this.pendingTextNodeIds.clear();
    this.consumedSpace = false;
    this.cancelDrag();
    this.clearHover();
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
    if (event.altKey) {
      if (session.mode === "move") {
        this.restoreMoveElements(session);
      }
      session.target = null;
      session.paused = true;
      session.invalid = true;
      session.previewElements = [];
      if (session.mode === "reparent") {
        this.updateDragOpacity(session.elementIds);
      }
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
      !event.altKey
    ) {
      if (session.offset.x !== 0 || session.offset.y !== 0) {
        this.app.syncActionResult({
          elements: this.app.scene.getElementsIncludingDeleted(),
          appState: { hoveredElementIds: {} },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }
    }
    const committedMove =
      event.type === "pointerup" && session.mode === "move" && !event.altKey;
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
    // Box selection normalizes Mindmap graphs to either the complete graph or
    // no graph. A complete graph is safe to move through the regular
    // selection path, including when the pointer starts on an ordinary shape.
    if (this.isCompleteMindmapSelection()) {
      return false;
    }
    return Boolean(
      pointerDownState.hit.element &&
        (this.isMindmapRelatedElement(pointerDownState.hit.element) ||
          this.hasSelectedMindmapElement()),
    );
  };

  preparePointerDown = (pointerDownState: PointerDownState) => {
    const candidate = this.getDragCandidate(pointerDownState);
    if (candidate?.mode === "move") {
      const expanded = new Set(Object.keys(this.app.state.selectedElementIds));
      for (const graphId of candidate.graphIds) {
        this.app.scene.getNonDeletedElements().forEach((element) => {
          if (
            isMindmapNodeElement(element) &&
            element.graphId === graphId &&
            !isMindmapElementHidden(
              element,
              this.app.scene.getNonDeletedElementsMap(),
            )
          ) {
            expanded.add(element.id);
          }
        });
      }
      this.app.setState({
        selectedElementIds: Object.fromEntries(
          [...expanded].map((id) => [id, true]),
        ),
      });
    }
    if (!this.shouldBlockNativePointer(pointerDownState)) {
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

  canEditNode = (nodeId: string) => {
    const node = this.app.scene.getNonDeletedElement(nodeId);
    return (
      !!node &&
      isMindmapNodeElement(node) &&
      !node.locked &&
      !this.app.state.viewModeEnabled &&
      this.app.isInteractionEnabled() &&
      !this.app.props.isCollaborating &&
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
  ): MindmapDragCandidate | null => {
    if (
      !this.app.isInteractionEnabled() ||
      this.app.state.viewModeEnabled ||
      this.app.props.isCollaborating ||
      this.app.state.editingTextElement
    ) {
      return null;
    }
    // Complete graphs are ordinary move selections. Structural Mindmap drag
    // is only used for direct, partial-node interactions.
    if (this.isCompleteMindmapSelection()) {
      return null;
    }
    const selected = this.app.scene.getSelectedElements(this.app.state);
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
    if (selectedNodes.some((node) => !this.canEditNode(node.id))) {
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
    return {
      mode: canReparent ? "reparent" : "move",
      nodeIds,
      graphIds,
      elementIds,
    };
  };

  /**
   * Normalizes a box-selection result per Mindmap graph. A collapsed selected
   * parent implicitly selects its hidden descendants. Each graph is either
   * fully selected (including edges and bound labels) or removed entirely.
   */
  normalizeBoxSelection = (
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
  isCompleteMindmapSelection = () => {
    const elements = this.app.scene.getNonDeletedElements();
    const selected = new Set(Object.keys(this.app.state.selectedElementIds));
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
        .every((element) => selected.has(element.id));
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
          .getElementsIncludingDeleted()
          .filter((element) => candidate.elementIds.has(element.id))
          .map((element) => [element.id, element]),
      ),
      origin: { ...pointerDownState.origin },
      offset: { x: 0, y: 0 },
      target: null,
      paused: false,
      invalid: false,
      previewElements: [],
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
    let closest: { target: MindmapDropTarget; distance: number } | null = null;
    for (const node of index.nodes.values()) {
      if (
        excluded.has(node.id) ||
        isMindmapElementHidden(node, this.app.scene.getNonDeletedElementsMap())
      ) {
        continue;
      }
      const centerY = node.y + node.height / 2;
      const right = node.x + node.width;
      const verticalDistance = Math.abs(scenePoint.y - centerY);
      const childDistance = Math.max(0, scenePoint.x - right);
      if (
        !node.collapsed &&
        scenePoint.x >= node.x + node.width * 0.6 &&
        scenePoint.x <= right + tolerance * 2.5 &&
        verticalDistance <= node.height / 2 + tolerance
      ) {
        const distance = childDistance + verticalDistance;
        if (!closest || distance < closest.distance) {
          closest = {
            target: { parentId: node.id, beforeId: null },
            distance,
          };
        }
      }
      if (
        !node.parentId ||
        scenePoint.x < node.x - tolerance ||
        scenePoint.x > right + tolerance / 2
      ) {
        continue;
      }
      const above = scenePoint.y < centerY;
      const edgeY = above ? node.y : node.y + node.height;
      if (Math.abs(scenePoint.y - edgeY) > tolerance) {
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
        Math.abs(scenePoint.y - edgeY) +
        Math.max(0, node.x - scenePoint.x, scenePoint.x - right);
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
        const x = parent.x + parent.width;
        const startY = parent.y + parent.height / 2;
        const endY = previewNode.y + previewNode.height / 2;
        const y = Math.min(startY, endY);
        const width = previewNode.x - x;
        preview.unshift({
          ...edge,
          parentId: parent.id,
          x,
          y,
          width,
          height: Math.abs(endY - startY),
          points: [
            pointFrom<LocalPoint>(0, startY - y),
            pointFrom<LocalPoint>(width / 2, startY - y),
            pointFrom<LocalPoint>(width / 2, endY - y),
            pointFrom<LocalPoint>(width, endY - y),
          ],
        });
      }
    }
    return preview;
  };

  private updateMoveElements = (session: MindmapDragSession) => {
    // Keep full-graph movement in Scene so the local canvas follows the pointer
    // without drawing a second, translucent copy over the original elements.
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

  private restoreMoveElements = (session: MindmapDragSession) => {
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
    if (this.app.props.isCollaborating || this.app.state.viewModeEnabled) {
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
    });
    this.app.insertNewElement(node);
    this.layoutGraph(parent.graphId);
    this.pendingTextNodeIds.add(node.id);
    this.startNodeEditing(node);
  }

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

  private getLaidOutElements(
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
      const layout = layoutMindmap(buildMindmapGraphIndex(graph, graphId));
      for (const element of [...layout.elements, ...layout.edges]) {
        updated.set(element.id, element);
      }
      for (const node of layout.elements) {
        const text = getBoundTextElement(node, updated);
        if (text) {
          updated.set(text.id, {
            ...text,
            ...computeBoundTextPosition(node, text, updated),
          });
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
    return (
      unsupportedSelectionActions.has(name) && this.hasSelectedMindmapElement()
    );
  };

  notifyUnsupportedOperation = () => {
    this.app.setToast({ message: t("errors.mindmapUnsupported") });
  };
}
