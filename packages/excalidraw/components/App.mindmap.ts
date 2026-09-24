import { KEYS } from "@excalidraw/common";
import { generateKeyBetween } from "@excalidraw/fractional-indexing";

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
  layoutMindmap,
  navigateMindmap,
  newElementWith,
  newMindmapNodeElement,
  repairMindmapElements,
} from "@excalidraw/element";

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
  "hyperlink",
  "increaseFontSize",
  "linkToElement",
  "pasteStyles",
  "removeAllElementsFromFrame",
  "sendBackward",
  "sendToBack",
  "toggleElementLock",
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

  constructor(private readonly app: App) {}

  clear = () => {
    this.pendingTextNodeIds.clear();
    this.consumedSpace = false;
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
    return Boolean(
      (pointerDownState.hit.element &&
        this.isMindmapRelatedElement(pointerDownState.hit.element)) ||
        this.hasSelectedMindmapElement(),
    );
  };

  preparePointerDown = (pointerDownState: PointerDownState) => {
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
    event.preventDefault();
    event.stopPropagation();
    if (event.key === KEYS.SPACE) {
      this.consumedSpace = true;
    }
    const node = this.getSelectedNode();
    if (
      !node ||
      isCopy ||
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
