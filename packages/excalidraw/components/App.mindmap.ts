import { KEYS } from "@excalidraw/common";
import { generateKeyBetween } from "@excalidraw/fractional-indexing";

import {
  buildMindmapGraphIndex,
  CaptureUpdateAction,
  computeBoundTextPosition,
  getBoundTextElement,
  handleBindTextResize,
  isMindmapEdgeElement,
  isMindmapNodeElement,
  layoutMindmap,
  newElementWith,
  newMindmapNodeElement,
  repairMindmapElements,
} from "@excalidraw/element";

import type {
  ExcalidrawMindmapNodeElement,
  ExcalidrawTextContainer,
  FractionalIndex,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { t } from "../i18n";

import type App from "./App";
import type { PointerDownState } from "../types";
import type { ActionName } from "../actions/types";

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

  constructor(private readonly app: App) {}

  clear = () => {
    this.pendingTextNodeIds.clear();
    this.clearHover();
  };

  clearHover = () => {
    this.hoveredNodeId = null;
  };

  handlePointerMove = (sceneX: number, sceneY: number) => {
    if (
      this.app.state.activeTool.type !== "mindmap" ||
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
    if (hoveredNode?.id === this.hoveredNodeId) {
      return;
    }
    this.hoveredNodeId = hoveredNode?.id ?? null;
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
    if (event.type !== "keydown" || this.app.state.editingTextElement) {
      return false;
    }

    const selected = this.app.scene
      .getSelectedElements(this.app.state)
      .filter(isMindmapNodeElement);

    if (
      event.key === KEYS.DELETE ||
      event.key === KEYS.BACKSPACE ||
      event.key === KEYS.ARROW_LEFT ||
      event.key === KEYS.ARROW_RIGHT ||
      event.key === KEYS.ARROW_UP ||
      event.key === KEYS.ARROW_DOWN ||
      (event.key === KEYS.TAB && event.shiftKey) ||
      (event[KEYS.CTRL_OR_CMD] &&
        ["c", "x", "d"].includes(event.key.toLowerCase()))
    ) {
      if (selected.length || this.hasSelectedMindmapElement()) {
        event.preventDefault();
        event.stopPropagation();
        this.notifyUnsupportedOperation();
        return true;
      }
      return false;
    }

    if (
      selected.length !== 1 ||
      event.repeat ||
      event.shiftKey ||
      event.altKey ||
      event[KEYS.CTRL_OR_CMD]
    ) {
      return false;
    }

    const node = selected[0];
    if (event.key === KEYS.TAB) {
      event.preventDefault();
      event.stopPropagation();
      this.createNode(node, "child");
      return true;
    }

    if (event.key === KEYS.ENTER) {
      event.preventDefault();
      event.stopPropagation();
      this.createNode(node, node.role === "root" ? "child" : "sibling");
      return true;
    }

    return false;
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
    const previous = this.app.scene.getElementsMapIncludingDeleted();
    const repaired = repairMindmapElements(
      this.app.scene.getElementsIncludingDeleted(),
    );
    const graph = repaired.filter(
      (element) =>
        !element.isDeleted &&
        ((element.type === "mindmap-node" && element.graphId === graphId) ||
          (element.type === "mindmap-edge" && element.graphId === graphId)),
    );
    const index = buildMindmapGraphIndex(graph, graphId);
    const layout = layoutMindmap(index);
    const updated = new Map(repaired.map((element) => [element.id, element]));
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
    // 布局和派生连接线随文字提交一并进入历史，不能作为 NEVER 更新排除。
    this.app.updateScene({
      elements: repaired.map((element) => {
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
      }),
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
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
      },
      onSelect,
    );
  }

  private hasSelectedMindmapElement() {
    return this.app.scene
      .getSelectedElements({
        selectedElementIds: this.app.state.selectedElementIds,
        includeBoundTextElement: true,
        includeElementsInFrames: true,
      })
      .some(this.isMindmapRelatedElement);
  }

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
