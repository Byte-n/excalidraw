import { CURSOR_TYPE } from "@excalidraw/common";
import {
  getCommonBounds,
  getElementWithTransformHandleType,
  getTransformHandleTypeFromCoords,
  isLinearElement,
  isTableElement,
  LinearElementEditor,
  type TransformHandleType,
} from "@excalidraw/element";

import type { ExcalidrawElement, NonDeleted } from "@excalidraw/element/types";

import {
  getFragmentStructureCursor,
  getFragmentStructureHoverAtSceneCoords,
} from "./fragment";
import {
  getTableBodyHoverAtSceneCoords,
  getTableStructureCursor,
  getTableStructureHoverAtSceneCoords,
} from "./table";
import {
  FRAME_CONTAINER_PROVIDER,
  FRAGMENT_CONTAINER_PROVIDER,
  TABLE_CONTAINER_PROVIDER,
} from "./pointerSnapshot";

import type {
  FragmentStructureHover,
  TableRowColStructureHover,
} from "../../types";
import type App from "../App";

export type ContainerControl =
  | "resize"
  | "insert"
  | "reorder"
  | "border"
  | "body";

export type ContainerProviderId = string;

export type ContainerInteractionCandidate = {
  containerId: string;
  providerId: ContainerProviderId;
  control: ContainerControl;
  /** Higher priority wins when several containers report the same point. */
  priority: number;
  /** Provider-specific gesture identifier (e.g. the table zone kind). */
  gesture?: string;
  /** Provider-private hover payload; the snapshot carries it verbatim. */
  data?: unknown;
};

export interface ContainerInteractionProvider {
  id: ContainerProviderId;
  /** Report the container's candidate control zone at the point, if any. */
  getInteractionCandidate(
    app: PointerApp,
    point: ScenePoint,
  ): ContainerInteractionCandidate | null;
  /**
   * Cursor for the candidate; an empty string leaves the tool cursor
   * untouched. Providers never write hover state or the global cursor
   * (interaction-target-resolution.md).
   */
  getCursor(app: PointerApp, candidate: ContainerInteractionCandidate): string;
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

const providers = new Map<string, ContainerInteractionProvider>();

export const registerContainerInteractionProvider = (
  provider: ContainerInteractionProvider,
) => {
  const previous = providers.get(provider.id);
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) !== provider) {
      return;
    }
    if (previous) {
      providers.set(provider.id, previous);
    } else {
      providers.delete(provider.id);
    }
  };
};

const tableProvider: ContainerInteractionProvider = {
  id: TABLE_CONTAINER_PROVIDER,
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
        : hover.kind === "titleGrip"
        ? "reorder"
        : hover.kind === "titleBar"
        ? "border"
        : hover.kind === "rowInsert" || hover.kind === "columnInsert"
        ? "insert"
        : hover.kind === "rowResize" || hover.kind === "columnResize"
        ? "resize"
        : "body";
    return {
      containerId: hover.tableId,
      providerId: TABLE_CONTAINER_PROVIDER,
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
};

const fragmentProvider: ContainerInteractionProvider = {
  id: FRAGMENT_CONTAINER_PROVIDER,
  getInteractionCandidate: (app, point) => {
    const hover = getFragmentStructureHoverAtSceneCoords(app, point);
    if (!hover) {
      return null;
    }
    const control: ContainerControl =
      hover.kind === "rowGrip"
        ? "reorder"
        : hover.kind === "rowInsert"
        ? "insert"
        : hover.kind === "rowResize"
        ? "resize"
        : hover.kind === "rowMove"
        ? "reorder"
        : "body";
    return {
      containerId: hover.elementId,
      providerId: FRAGMENT_CONTAINER_PROVIDER,
      control,
      // the body reveal must lose to every zone and element hit
      priority: control === "body" ? 10 : 100,
      gesture: hover.kind,
      data: hover,
    };
  },
  getCursor: (_app, candidate) => {
    const hover = candidate.data as FragmentStructureHover | undefined;
    return hover ? getFragmentStructureCursor(hover) : "";
  },
};

const frameProvider: ContainerInteractionProvider = {
  id: FRAME_CONTAINER_PROVIDER,
  getInteractionCandidate: (app, point) => {
    const frame = app.getTopLayerFrameAtSceneCoords(point);
    if (!frame) {
      return null;
    }
    const hit = app.getElementAtPosition(point.x, point.y, {
      includeLockedElements: true,
    });
    return hit?.id === frame.id
      ? {
          containerId: frame.id,
          providerId: FRAME_CONTAINER_PROVIDER,
          control: "border",
          priority: 50,
        }
      : null;
  },
  // frames keep the generic cursor semantics (MOVE while selected, default
  // otherwise); the frame-highlight channel stays self-clearing until the
  // hover migration covers it
  getCursor: (app, candidate) =>
    app.state.selectedElementIds[candidate.containerId] ? CURSOR_TYPE.MOVE : "",
};

registerContainerInteractionProvider(tableProvider);
registerContainerInteractionProvider(fragmentProvider);
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

/**
 * A table's own title text is the container's title control, not an
 * independent element: clicking it (even when it is the selected element)
 * must stay with the container so the title bar / grip entry keeps its
 * pointerdown semantics (05-general-hover.md §4.7).
 */
const hitIsContainerTitle = (
  hit: NonDeleted<ExcalidrawElement>,
  candidate: ContainerInteractionCandidate | undefined,
) =>
  Boolean(
    candidate &&
      hit.containerRef?.kind === "tableTitle" &&
      hit.containerRef.elementId === candidate.containerId,
  );

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

  // Multi-selection transform handles beat a selected linear element's point
  // handles (legacy handleSelectionOnPointerDown computed the multi-selection
  // handle before it ever tried the linear point gesture).
  if (selected.length > 1) {
    const handle = getTransformHandleTypeFromCoords(
      getCommonBounds(selected),
      point.x,
      point.y,
      app.state.zoom,
      (event?.pointerType || "mouse") as any,
      app.editorInterface,
    );
    if (handle && !(handle === "rotation" && selected.some(isTableElement))) {
      return { kind: "transformHandle", elementId: selected[0].id, handle };
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

  if (selected.length === 1) {
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
  const candidate = [...providers.values()]
    .map((provider) => provider.getInteractionCandidate(app, point))
    .filter((value): value is ContainerInteractionCandidate => Boolean(value))
    .sort((a, b) => b.priority - a.priority)[0];

  if (
    hit &&
    !hit.locked &&
    isSelected(app, hit) &&
    !(candidate && candidateBelongsToHit(hit, candidate)) &&
    !hitIsContainerTitle(hit, candidate)
  ) {
    return { kind: "selectedElement", elementId: hit.id };
  }
  if (candidate) {
    if (
      hit &&
      !hit.locked &&
      isSelected(app, hit) &&
      !candidateBelongsToHit(hit, candidate) &&
      !hitIsContainerTitle(hit, candidate)
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

/**
 * Cursor contributed by the container provider; "" leaves it to the tool
 * cursor. Hover state is derived from the resolved candidate into the pointer
 * snapshot, so providers only contribute data and never write state.
 */
export const getContainerProviderCursor = (
  app: PointerApp,
  candidate: ContainerInteractionCandidate,
): string =>
  providers.get(candidate.providerId)?.getCursor(app, candidate) ?? "";
