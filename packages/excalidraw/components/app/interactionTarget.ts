import { CURSOR_TYPE } from "@excalidraw/common";
import {
  getCommonBounds,
  getElementWithTransformHandleType,
  getTransformHandleTypeFromCoords,
  isLinearElement,
  LinearElementEditor,
  type TransformHandleType,
} from "@excalidraw/element";

import type { ExcalidrawElement, NonDeleted } from "@excalidraw/element/types";

import {
  getTableBodyHoverAtSceneCoords,
  getTableStructureCursor,
  getTableStructureHoverAtSceneCoords,
  setTableStructureHover,
} from "./table";

import type { TableRowColStructureHover } from "../../types";
import type App from "../App";

export type ContainerControl =
  | "resize"
  | "insert"
  | "reorder"
  | "select"
  | "border"
  | "body";

export type ContainerInteractionCandidate = {
  containerId: string;
  control: ContainerControl;
  /** Higher priority wins when several containers report the same point. */
  priority: number;
  /** Provider-specific gesture identifier (e.g. the table zone kind). */
  gesture?: string;
  /** Provider-private render payload handed back to renderHover verbatim. */
  data?: unknown;
};

export interface ContainerInteractionProvider {
  /** Report the container's candidate control zone at the point, if any. */
  getInteractionCandidate(
    app: PointerApp,
    point: ScenePoint,
  ): ContainerInteractionCandidate | null;
  /**
   * Cursor for the candidate; an empty string leaves the tool cursor
   * untouched. Providers must never set the global cursor themselves
   * (interaction-target-resolution.md).
   */
  getCursor(app: PointerApp, candidate: ContainerInteractionCandidate): string;
  /** Derive this container's legacy hover state from the candidate. */
  renderHover(app: PointerApp, candidate: ContainerInteractionCandidate): void;
  /** Clear this container's hover state. */
  clearHover(app: PointerApp): void;
}

export type InteractionTarget =
  | { kind: "textHandle"; elementId: string }
  | { kind: "linearHandle"; elementId: string }
  | { kind: "transformHandle"; elementId: string; handle: TransformHandleType }
  | { kind: "selectedElement"; elementId: string }
  | {
      kind: "containerControl";
      containerId: string;
      control: ContainerControl;
      candidate: ContainerInteractionCandidate;
    }
  | { kind: "element"; elementId: string }
  | {
      kind: "containerBody";
      containerId: string;
      candidate: ContainerInteractionCandidate;
    }
  | { kind: "canvas" };

const providers: ContainerInteractionProvider[] = [];

export const registerContainerInteractionProvider = (
  provider: ContainerInteractionProvider,
) => {
  if (!providers.includes(provider)) {
    providers.push(provider);
  }
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) {
      providers.splice(index, 1);
    }
  };
};

const tableProvider: ContainerInteractionProvider = {
  getInteractionCandidate: (app, point) => {
    const hover =
      getTableStructureHoverAtSceneCoords(app, point) ??
      getTableBodyHoverAtSceneCoords(app, point);
    if (!hover) {
      return null;
    }
    const control: ContainerControl =
      hover.kind === "rowGrip" || hover.kind === "columnGrip"
        ? "reorder"
        : hover.kind === "rowInsert" || hover.kind === "columnInsert"
        ? "insert"
        : hover.kind === "rowSelect" || hover.kind === "columnSelect"
        ? "select"
        : hover.kind === "rowResize" || hover.kind === "columnResize"
        ? "resize"
        : "body";
    return {
      containerId: hover.tableId,
      control,
      // the body reveal must lose to every zone and element hit
      priority: control === "body" ? 10 : 100,
      gesture: hover.kind,
      data: hover,
    };
  },
  getCursor: (_app, candidate) => {
    const hover = candidate.data as TableRowColStructureHover | undefined;
    return hover ? getTableStructureCursor(hover) : "";
  },
  renderHover: (app, candidate) => {
    setTableStructureHover(app, candidate.data as TableRowColStructureHover);
  },
  clearHover: (app) => {
    setTableStructureHover(app, null);
  },
};

const frameProvider: ContainerInteractionProvider = {
  getInteractionCandidate: (app, point) => {
    const frame = app.getTopLayerFrameAtSceneCoords(point);
    if (!frame) {
      return null;
    }
    const hit = app.getElementAtPosition(point.x, point.y, {
      includeLockedElements: true,
    });
    return hit?.id === frame.id
      ? { containerId: frame.id, control: "border", priority: 50 }
      : null;
  },
  // frames keep the generic cursor semantics (MOVE while selected, default
  // otherwise); the frame-highlight channel stays self-clearing until the
  // hover migration covers it
  getCursor: (app, candidate) =>
    app.state.selectedElementIds[candidate.containerId] ? CURSOR_TYPE.MOVE : "",
  renderHover: () => {},
  clearHover: () => {},
};

registerContainerInteractionProvider(tableProvider);
registerContainerInteractionProvider(frameProvider);

type PointerApp = Pick<App, keyof App> & Record<string, any>;
type ScenePoint = { x: number; y: number };

const isSelected = (app: PointerApp, element: NonDeleted<ExcalidrawElement>) =>
  Boolean(app.state.selectedElementIds[element.id]);

/**
 * A selected container keeps its own control zones; a selected normal
 * element beats every other container's zones (nested containers resolve
 * depth-first: the deeper container's id never equals an outer candidate's).
 */
const candidateBelongsToHit = (
  hit: NonDeleted<ExcalidrawElement>,
  candidate: ContainerInteractionCandidate,
) => candidate.containerId === hit.id;

export const resolveInteractionTarget = (
  app: PointerApp,
  point: ScenePoint,
  event?: { pointerType?: string },
): InteractionTarget => {
  const selected = app.scene.getSelectedElements(app.state);
  if (app.isHittingTextAutoResizeHandle(selected, point)) {
    const element = selected.find((candidate) => candidate.type === "text");
    if (element) {
      return { kind: "textHandle", elementId: element.id };
    }
  }

  const linear = app.state.selectedLinearElement;
  if (linear) {
    const element = LinearElementEditor.getElement(
      linear.elementId,
      app.scene.getNonDeletedElementsMap(),
    );
    if (element && isLinearElement(element)) {
      const index = LinearElementEditor.getPointIndexUnderCursor(
        element,
        app.scene.getNonDeletedElementsMap(),
        app.state.zoom,
        point.x,
        point.y,
      );
      if (LinearElementEditor.isPointHandle(element, index)) {
        return { kind: "linearHandle", elementId: element.id };
      }
    }
  }

  if (selected.length > 1) {
    const handle = getTransformHandleTypeFromCoords(
      getCommonBounds(selected),
      point.x,
      point.y,
      app.state.zoom,
      (event?.pointerType || "mouse") as any,
      app.editorInterface,
    );
    if (handle) {
      return { kind: "transformHandle", elementId: selected[0].id, handle };
    }
  } else if (selected.length === 1) {
    const handle = getElementWithTransformHandleType(
      selected,
      app.state,
      point.x,
      point.y,
      app.state.zoom,
      (event?.pointerType || "mouse") as any,
      app.scene.getNonDeletedElementsMap(),
      app.editorInterface,
    );
    if (handle?.transformHandleType) {
      return {
        kind: "transformHandle",
        elementId: selected[0].id,
        handle: handle.transformHandleType,
      };
    }
  }

  const hit = app.getElementAtPosition(point.x, point.y, {
    preferSelected: true,
    includeLockedElements: true,
  });
  const resolvedCandidates = providers
    .map((provider) => {
      const candidate = provider.getInteractionCandidate(app, point);
      return candidate ? { provider, candidate } : null;
    })
    .filter(
      (
        value,
      ): value is {
        provider: ContainerInteractionProvider;
        candidate: ContainerInteractionCandidate;
      } => Boolean(value),
    )
    .sort((a, b) => b.candidate.priority - a.candidate.priority);
  for (const entry of resolvedCandidates) {
    providerByCandidate.set(entry.candidate, entry.provider);
  }
  const candidate = resolvedCandidates[0]?.candidate;

  if (
    hit &&
    !hit.locked &&
    isSelected(app, hit) &&
    !(candidate && candidateBelongsToHit(hit, candidate))
  ) {
    return { kind: "selectedElement", elementId: hit.id };
  }
  if (candidate) {
    if (
      hit &&
      !hit.locked &&
      isSelected(app, hit) &&
      !candidateBelongsToHit(hit, candidate)
    ) {
      return { kind: "selectedElement", elementId: hit.id };
    }
    if (candidate.control === "body") {
      // the container body loses to any overlapping normal element; hitting
      // the container itself is the body (affordance reveal, not selection)
      if (hit && !hit.locked && hit.id !== candidate.containerId) {
        return isSelected(app, hit)
          ? { kind: "selectedElement", elementId: hit.id }
          : { kind: "element", elementId: hit.id };
      }
      return {
        kind: "containerBody",
        containerId: candidate.containerId,
        candidate,
      };
    }
    return {
      kind: "containerControl",
      containerId: candidate.containerId,
      control: candidate.control,
      candidate,
    };
  }
  if (hit && !hit.locked) {
    return { kind: "element", elementId: hit.id };
  }
  return { kind: "canvas" };
};

/** Candidates route back to their producing provider for the dispatch. */
const providerByCandidate = new WeakMap<
  ContainerInteractionCandidate,
  ContainerInteractionProvider
>();

/**
 * Dispatch-phase hover + cursor application for a resolved container target.
 * The provider owns its hover state; the global cursor is set only here.
 */
export const dispatchContainerInteraction = (
  app: PointerApp,
  candidate: ContainerInteractionCandidate,
): void => {
  const provider = providerByCandidate.get(candidate);
  if (!provider) {
    return;
  }
  provider.renderHover(app, candidate);
  const cursor = provider.getCursor(app, candidate);
  if (cursor) {
    app.cursor.set(cursor);
  }
};

/**
 * Moving to a non-container target must not leave any container hover
 * behind; every registered provider clears its own state.
 */
export const clearContainerInteractionHover = (app: PointerApp): void => {
  for (const provider of providers) {
    provider.clearHover(app);
  }
};
