/**
 * Pointer frame contract (docs/pointer-pipeline/02-frame-contract.md).
 *
 * Every pointer frame resolves to exactly one `PointerFrame` here. Resolution
 * is a pure read: it never writes the cursor, app state or repaint. Only
 * `applyPointerFrame` (pointerDispatch.ts) is allowed to apply the frame.
 *
 * PR2 registers a single provider (`compositeControl`); the remaining kinds
 * are defined so PR3 / PR4 can register them without reshaping the contract.
 */
import { isDevEnv, isSelectionLikeTool } from "@excalidraw/common";

import { isShapeElement } from "@excalidraw/element";

import type {
  CompositeShapeControlPoint,
  ConnectionHit,
  MindmapAddButtonKind,
  QuickCreateDirection,
} from "@excalidraw/element";
import type { GlobalPoint, Radians } from "@excalidraw/math";

import { hitCompositeControlPoint } from "./compositeShapeControls";
import {
  resolveInteractionTarget,
  type InteractionTarget,
} from "./interactionTarget";

import type { ToolType } from "../../types";
import type App from "../App";

type PointerApp = Pick<App, keyof App> & Record<string, any>;

/**
 * Placement of a pole-click activation preview. Mirrors the return value of
 * `getSequenceLifelinePoleActivationPlacement`; PR4 exports the element type.
 */
export type PoleActivationPlacement = {
  /** Rotated scene center of the activation bar. */
  center: { x: number; y: number };
  angle: Radians;
  /** Activation center y in the lifeline's local frame (clamped). */
  localY: number;
};

/** Local shape id of the composite control point; PR4 may re-export it. */
export type CompositeControlPoint = CompositeShapeControlPoint;

export type PointerTarget =
  | InteractionTarget
  | {
      kind: "connection";
      elementId: string;
      hit: ConnectionHit;
    }
  | {
      kind: "activationEdge";
      elementId: string;
      side: "left" | "right";
      point: GlobalPoint;
    }
  | {
      kind: "poleActivation";
      lifelineId: string;
      placement: PoleActivationPlacement;
    }
  | {
      kind: "quickCreateHandle";
      elementId: string;
      direction: QuickCreateDirection;
    }
  | {
      kind: "compositeControl";
      elementId: string;
      control: CompositeControlPoint;
    }
  | {
      kind: "mindmapAddButton";
      elementId: string;
      button: MindmapAddButtonKind;
    };

export type PointerPhase = "hover" | "armed" | "gesture" | "pending";

export type GestureOwner =
  | "selection"
  | "container"
  | "transform"
  | "text"
  | "linear"
  | "quickCreate"
  | "sequenceMessage";

export type PointerMode =
  | "selection" // selection / lasso: handles, containers and elements all participate
  | "arrow" // arrow / line: connection targets only, selection handles degrade
  | "mindmap" // mindmap tool: node / add-button hover only, no selection handles
  | "shape" // rectangle & co: preset preview only, no target resolution
  | "other"; // text / eraser / hand / laser

export type PointerFrameInput = {
  point: GlobalPoint;
  phase: Extract<PointerPhase, "hover" | "armed">;
  mode: PointerMode;
  pointerType: "mouse" | "touch" | "pen";
  event?: { pointerType?: string };
  /** Modifier state at the same event (connection preview / angle lock). */
  shiftKey?: boolean;
  altKey?: boolean;
};

export type PointerFrame = {
  phase: PointerPhase;
  point: GlobalPoint;
  /** pointerdown origin (armed / gesture); absent while hovering. */
  origin?: GlobalPoint;
  target: PointerTarget;
  pointerType: PointerFrameInput["pointerType"];
  owner?: GestureOwner;
};

/** Screen-pixel drag threshold shared by all frame-owned gestures. */
export const DRAGGING_THRESHOLD = 10;

/** Whether the frame moved past `DRAGGING_THRESHOLD` (screen px). */
export const hasFrameMoved = (
  frame: Pick<PointerFrame, "origin" | "point">,
  zoom: number,
): boolean => {
  if (!frame.origin) {
    return false;
  }
  const distance = Math.hypot(
    frame.point[0] - frame.origin[0],
    frame.point[1] - frame.origin[1],
  );
  return distance * zoom >= DRAGGING_THRESHOLD;
};

type ProviderFor<K extends PointerTarget["kind"]> = {
  kind: K;
  /**
   * Pure read: must not write the cursor, app state or repaint.
   * Returning null means "not applicable for this frame"; the next provider
   * (or the resolved base target) wins.
   */
  resolve(
    app: PointerApp,
    input: PointerFrameInput,
  ): Extract<PointerTarget, { kind: K }> | null;
};

export type { ProviderFor };

/**
 * Fixed priority table. Registration order never decides priority; only this
 * array does (02-frame-contract.md §4.4).
 */
export const PROVIDER_ORDER = [
  "compositeControl",
  // after transformHandle (handled before this loop), before quickCreateHandle
  "mindmapAddButton",
  "quickCreateHandle",
  "connection",
  "activationEdge",
  "poleActivation",
] as const;

const providers = new Map<
  PointerTarget["kind"],
  ProviderFor<PointerTarget["kind"]>
>();

/**
 * Registers the single provider for a kind. A later registration replaces the
 * previous one; unregistering restores it so tests can stub and restore.
 */
export const registerPointerTargetProvider = <K extends PointerTarget["kind"]>(
  provider: ProviderFor<K>,
): (() => void) => {
  const kind: PointerTarget["kind"] = provider.kind;
  const entry = provider as unknown as ProviderFor<PointerTarget["kind"]>;
  const previous = providers.get(kind);
  providers.set(kind, entry);
  return () => {
    if (providers.get(kind) === entry) {
      if (previous) {
        providers.set(kind, previous);
      } else {
        providers.delete(kind);
      }
    }
  };
};

const runProvider = <K extends PointerTarget["kind"]>(
  kind: K,
  app: PointerApp,
  input: PointerFrameInput,
): Extract<PointerTarget, { kind: K }> | null => {
  // unregistered kind -> not applicable; provider errors propagate on purpose
  const provider = providers.get(kind);
  return provider
    ? (provider.resolve(app, input) as Extract<
        PointerTarget,
        { kind: K }
      > | null)
    : null;
};

const SHAPE_LIKE_TOOLS: ReadonlyArray<ToolType> = [
  "rectangle",
  "diamond",
  "ellipse",
];

/** The single mode derivation shared by pointermove and pointerdown. */
export const currentPointerMode = (app: {
  state: { activeTool: { type: ToolType | "custom" } };
}): PointerMode => {
  const type = app.state.activeTool.type;
  if (isSelectionLikeTool(type)) {
    return "selection";
  }
  if (type === "arrow" || type === "line") {
    return "arrow";
  }
  if (type === "mindmap") {
    return "mindmap";
  }
  if (SHAPE_LIKE_TOOLS.includes(type as ToolType)) {
    return "shape";
  }
  return "other";
};

export const resolvePointerType = (
  pointerType?: string,
): PointerFrameInput["pointerType"] =>
  pointerType === "touch" || pointerType === "pen" ? pointerType : "mouse";

const frame = (
  target: PointerTarget,
  input: PointerFrameInput,
): PointerFrame => ({
  phase: input.phase,
  point: input.point,
  target,
  pointerType: input.pointerType,
});

/**
 * Arrow / line tools do not resolve selection handles or container zones;
 * those base targets degrade to canvas (02-frame-contract.md §4.5).
 */
const isSelectionOnlyTarget = (
  target: InteractionTarget | { kind: "canvas" },
): boolean =>
  target.kind === "textHandle" ||
  target.kind === "linearHandle" ||
  target.kind === "transformHandle" ||
  target.kind === "selectedElement" ||
  target.kind === "containerControl" ||
  target.kind === "containerBody";

const toSceneCoord = (point: GlobalPoint) => ({
  x: point[0],
  y: point[1],
});

/**
 * Mindmap tool base target: nodes keep element / selectedElement hover so the
 * collapse affordance and node highlight follow the frame, while selection
 * handles degrade to the node (HEAD showed the tool cursor, not resize).
 */
const resolveMindmapBase = (
  app: PointerApp,
  input: PointerFrameInput,
): InteractionTarget | { kind: "canvas" } => {
  if (typeof app.getElementAtPosition !== "function") {
    return { kind: "canvas" };
  }
  const hit = app.getElementAtPosition(input.point[0], input.point[1], {
    includeBoundTextElement: true,
  });
  if (!hit || hit.locked) {
    return { kind: "canvas" };
  }
  return app.state.selectedElementIds?.[hit.id]
    ? { kind: "selectedElement", elementId: hit.id }
    : { kind: "element", elementId: hit.id };
};

export const resolvePointerFrame = (
  app: PointerApp,
  input: PointerFrameInput,
): PointerFrame => {
  const base =
    input.mode === "selection" || input.mode === "arrow"
      ? resolveInteractionTarget(app, toSceneCoord(input.point), input.event)
      : ({ kind: "canvas" } as const);

  if (input.mode === "shape" || input.mode === "other") {
    return frame(base, input);
  }

  if (input.mode === "mindmap") {
    const addButton = runProvider("mindmapAddButton", app, input);
    return frame(addButton ?? resolveMindmapBase(app, input), input);
  }

  if (input.mode === "arrow") {
    const arrowBase = isSelectionOnlyTarget(base)
      ? ({ kind: "canvas" } as const)
      : base;
    const connection = runProvider("connection", app, input);
    return frame(connection ?? arrowBase, input);
  }

  // —— selection mode ——

  // 1. text / linear handles always win
  if (base.kind === "textHandle" || base.kind === "linearHandle") {
    return frame(base, input);
  }

  // 2. composite control points beat transform handles (pointerCanvas.ts:1155)
  const composite = runProvider("compositeControl", app, input);
  if (composite) {
    return frame(composite, input);
  }

  // 3. transform handles keep their current priority
  if (base.kind === "transformHandle") {
    return frame(base, input);
  }

  // 4. remaining kinds in the fixed order, first hit wins
  for (const kind of PROVIDER_ORDER) {
    if (kind === "compositeControl" || kind === "connection") {
      continue;
    }
    const target = runProvider(kind, app, input);
    if (target) {
      return frame(target, input);
    }
  }

  return frame(base, input);
};

const POINT_EPSILON = 1e-6;

const sameGlobalPoint = (a: GlobalPoint, b: GlobalPoint) =>
  Math.abs(a[0] - b[0]) <= POINT_EPSILON &&
  Math.abs(a[1] - b[1]) <= POINT_EPSILON;

const sameCoord = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) <= POINT_EPSILON && Math.abs(a.y - b.y) <= POINT_EPSILON;

const sameControl = (a: CompositeControlPoint, b: CompositeControlPoint) =>
  a === b || (a.kind === b.kind && a.x === b.x && a.y === b.y);

const samePlacement = (
  a: PoleActivationPlacement,
  b: PoleActivationPlacement,
) =>
  a === b ||
  (sameCoord(a.center, b.center) &&
    a.localY === b.localY &&
    a.angle === b.angle);

/**
 * Field-level frame equality. Payload references / values are compared so a
 * frame rebuilt every pointermove does not repaint when nothing changed.
 */
export const isSamePointerFrame = (
  previous: PointerFrame,
  next: PointerFrame,
): boolean => {
  if (previous === next) {
    return true;
  }
  if (previous.phase !== next.phase) {
    return false;
  }
  if (previous.owner !== next.owner) {
    return false;
  }
  if (Boolean(previous.origin) !== Boolean(next.origin)) {
    return false;
  }
  if (
    previous.origin &&
    next.origin &&
    !sameGlobalPoint(previous.origin, next.origin)
  ) {
    return false;
  }
  if (!sameGlobalPoint(previous.point, next.point)) {
    return false;
  }
  const a = previous.target;
  const b = next.target;
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "connection":
      return (
        a.elementId === (b as typeof a).elementId &&
        a.hit === (b as typeof a).hit
      );
    case "activationEdge":
      return (
        a.elementId === (b as typeof a).elementId &&
        a.side === (b as typeof a).side &&
        sameGlobalPoint(a.point, (b as typeof a).point)
      );
    case "poleActivation":
      return (
        a.lifelineId === (b as typeof a).lifelineId &&
        samePlacement(a.placement, (b as typeof a).placement)
      );
    case "quickCreateHandle":
      return (
        a.elementId === (b as typeof a).elementId &&
        a.direction === (b as typeof a).direction
      );
    case "compositeControl":
      return (
        a.elementId === (b as typeof a).elementId &&
        sameControl(a.control, (b as typeof a).control)
      );
    case "mindmapAddButton":
      return (
        a.elementId === (b as typeof a).elementId &&
        a.button === (b as typeof a).button
      );
    case "textHandle":
    case "linearHandle":
    case "selectedElement":
    case "element":
      return a.elementId === (b as typeof a).elementId;
    case "transformHandle":
      return (
        a.elementId === (b as typeof a).elementId &&
        a.handle === (b as typeof a).handle
      );
    case "containerControl":
      return (
        a.containerId === (b as typeof a).containerId &&
        a.control === (b as typeof a).control
      );
    case "containerBody":
      return a.containerId === (b as typeof a).containerId;
    case "canvas":
      return true;
    default:
      return false;
  }
};

/**
 * Dev-only shadow switch: `window.__POINTER_PIPELINE_SHADOW__ = true` makes
 * `compareFrameWithLegacy` compare the frame against the legacy hover fields.
 */
export const isPointerPipelineShadowEnabled = () =>
  isDevEnv() &&
  typeof window !== "undefined" &&
  Boolean((window as any).__POINTER_PIPELINE_SHADOW__);

const warnShadowMismatch = (
  frame: PointerFrame,
  legacy: unknown,
  app: PointerApp,
) => {
  console.warn("[pointer-pipeline-shadow] frame/legacy mismatch", {
    point: frame.point,
    target: frame.target,
    pointerType: frame.pointerType,
    legacy,
    suggestedBinding: app.state?.suggestedBinding ?? null,
  });
};

/**
 * Skeleton for PR3 / PR4: never changes execution, and is a no-op unless the
 * dev shadow flag is on. Not called from production paths in PR2.
 */
export const compareFrameWithLegacy = (
  app: PointerApp,
  frame: PointerFrame,
): void => {
  if (!isPointerPipelineShadowEnabled()) {
    return;
  }
  switch (frame.target.kind) {
    case "quickCreateHandle":
    case "activationEdge":
      // PR4b removed the legacy hover mirrors; the frame is the only source.
      break;
    case "poleActivation": {
      // PR4 adds `getPoleActivationHover()`; until then only presence is known
      const hasPoleActivation = (app.quickCreate as any)?.hasPoleActivation;
      if (
        typeof hasPoleActivation === "function" &&
        !hasPoleActivation.call(app.quickCreate)
      ) {
        warnShadowMismatch(frame, "no pole activation hover", app);
      }
      break;
    }
    case "connection": {
      const legacy = app.state?.suggestedBinding ?? null;
      if (legacy?.element?.id !== frame.target.elementId) {
        warnShadowMismatch(frame, legacy, app);
      }
      break;
    }
    default:
      break;
  }
};

/**
 * PR2's only provider. Gate mirrors pointerCanvas.ts:1141-1162 (the scroll-bar
 * condition is already enforced by the caller's `canDispatchInteraction`).
 */
const compositeControlProvider: ProviderFor<"compositeControl"> = {
  kind: "compositeControl",
  resolve: (app, input) => {
    if (input.mode !== "selection") {
      return null;
    }
    const selectedElements = app.scene.getSelectedElements(app.state);
    if (selectedElements.length !== 1) {
      return null;
    }
    const selected = selectedElements[0];
    if (
      (app.state.activeTool.type !== "selection" &&
        app.state.activeTool.type !== "lasso") ||
      !isShapeElement(selected) ||
      selected.locked ||
      app.state.viewModeEnabled ||
      app.state.editingTextElement ||
      app.state.croppingElementId ||
      app.state.selectedLinearElement?.isEditing
    ) {
      return null;
    }
    const control = hitCompositeControlPoint(
      selected,
      input.point[0],
      input.point[1],
      app.state.zoom.value,
      input.pointerType,
    );
    return control
      ? { kind: "compositeControl", elementId: selected.id, control }
      : null;
  },
};

registerPointerTargetProvider(compositeControlProvider);

/**
 * Mindmap node add button (05-general-hover.md §4.8, PR5b). Gate mirrors the
 * legacy pointermove hover gate; the provider is a pure read (hit testing
 * only) and never writes hover, cursor or repaint.
 */
const mindmapAddButtonProvider: ProviderFor<"mindmapAddButton"> = {
  kind: "mindmapAddButton",
  resolve: (app, input) => {
    if (input.mode !== "selection" && input.mode !== "mindmap") {
      return null;
    }
    const tool = app.state.activeTool?.type;
    if (tool !== "mindmap" && tool !== "selection") {
      return null;
    }
    if (
      app.state.openDialog?.name === "elementLinkSelector" ||
      app.state.viewModeEnabled ||
      typeof app.mindmap?.hitTestAddButton !== "function" ||
      (typeof app.isInteractionEnabled === "function" &&
        !app.isInteractionEnabled()) ||
      app.mindmap.getDragPreview?.()
    ) {
      return null;
    }
    const node = app.mindmap.getAddButtonTargetNode();
    if (!node) {
      return null;
    }
    const button = app.mindmap.hitTestAddButton(input.point[0], input.point[1]);
    return button
      ? { kind: "mindmapAddButton", elementId: node.id, button }
      : null;
  },
};

registerPointerTargetProvider(mindmapAddButtonProvider);
