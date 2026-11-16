import { bindBindingElementToAttachPoint } from "./binding";
import {
  buildShapeData,
  deleteSequenceFragmentRow,
  fitSequenceFragmentOperatorFromTexts,
  getSequenceLifelineActivationCenter,
  getSequenceLifelineDefaultSize,
  insertSequenceFragmentRow,
  isActivationElement,
  isSequenceFragmentElement,
  isSequenceLifelineElement,
  normalizeSequenceFragmentGeometry,
  normalizeSequenceLifelineGeometry,
  SEQUENCE_ACTIVATION_HEIGHT,
  SEQUENCE_ACTIVATION_WIDTH,
  SEQUENCE_FRAGMENT_DEFAULT_HEIGHT,
  SEQUENCE_FRAGMENT_DEFAULT_WIDTH,
  SEQUENCE_MIN_ACTIVATION_OFFSET,
} from "./compositeShape";
import { newArrowElement, newElement } from "./newElement";
import {
  CanvasSceneError,
  applySceneElementStyle,
  createCalculationScene,
  deleteSceneElements,
  finishSceneOperation,
  updateSceneLabel,
} from "./sceneOperations";
import { isLinearElement } from "./typeChecks";

import type { SequenceLifelineElement } from "./compositeShape";
import type { Scene } from "./Scene";
import type {
  Arrowhead,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawSequenceElement,
  ExcalidrawShapeElement,
  NonDeleted,
  SequenceShapeData,
  ShapeId,
} from "./types";
import type {
  CanvasElementOperationResult,
  ConnectorStyle,
  SceneElementTarget,
  ScenePoint,
  SceneTextStyle,
  ShapeStyle,
} from "./sceneOperations";
import type { ShapeTextFitOption } from "./shapeScene";

const SEQUENCE_MESSAGE_TOP_GAP = 48;
const SEQUENCE_MESSAGE_ROW_GAP = 56;
const SEQUENCE_SELF_MESSAGE_OFFSET = 24;
const SEQUENCE_SELF_MESSAGE_WIDTH = 40;

export type SequenceMessageEndpoint = Readonly<{
  participantId: string;
  activationId?: string;
}>;

export type SequenceOperation =
  | Readonly<{
      action: "addParticipant";
      kind: Extract<SequenceShapeData, { lifeline: unknown }>["id"];
      position: ScenePoint;
      width?: number;
      height?: number;
      text?: string;
      textStyle?: SceneTextStyle;
      style?: ShapeStyle;
      textFit?: ShapeTextFitOption;
    }>
  | Readonly<{ action: "removeParticipant"; target: SceneElementTarget }>
  | Readonly<{
      action: "addMessage";
      from: SequenceMessageEndpoint;
      to: SequenceMessageEndpoint;
      text?: string;
      textStyle?: SceneTextStyle;
      style?: ConnectorStyle;
      y?: number;
      order?: number;
      startArrowhead?: Arrowhead | null;
      endArrowhead?: Arrowhead | null;
    }>
  | Readonly<{
      action: "updateMessage";
      target: SceneElementTarget;
      text?: string;
      textStyle?: SceneTextStyle;
    }>
  | Readonly<{ action: "removeMessage"; target: SceneElementTarget }>
  | Readonly<{
      action: "addFragment";
      position: ScenePoint;
      width?: number;
      height?: number;
      operator?: string;
      textStyle?: SceneTextStyle;
      style?: ShapeStyle;
    }>
  | Readonly<{
      action: "updateFragment";
      target: SceneElementTarget;
      operator?: string;
      textStyle?: SceneTextStyle;
      insertRowAt?: number;
      deleteRowId?: string;
    }>;

type SequenceActivationElement = NonDeleted<ExcalidrawElement> & {
  type: "sequence";
  shape: Extract<SequenceShapeData, { id: "sc-activation" }>;
};
type SequenceMessageElement = NonDeleted<ExcalidrawLinearElement>;

const addToScene = (scene: Scene, element: ExcalidrawElement) => {
  scene.replaceAllElements([...scene.getElementsIncludingDeleted(), element], {
    skipValidation: true,
  });
  const live = scene.getNonDeletedElementsMap().get(element.id);
  if (!live) {
    throw new CanvasSceneError("internal_error", "新建元素未写入场景");
  }
  return live;
};

const requireLifeline = (
  scene: Scene,
  participantId: string,
): SequenceLifelineElement => {
  const element = scene.getNonDeletedElementsMap().get(participantId);
  if (!element || !isSequenceLifelineElement(element)) {
    throw new CanvasSceneError(
      "target_not_found",
      `生命线不存在: ${participantId}`,
    );
  }
  return element as SequenceLifelineElement;
};

const requireFragment = (scene: Scene, fragmentId: string) => {
  const element = scene.getNonDeletedElementsMap().get(fragmentId);
  if (!element || !isSequenceFragmentElement(element)) {
    throw new CanvasSceneError(
      "target_not_found",
      `组合片段不存在: ${fragmentId}`,
    );
  }
  return element as NonDeleted<ExcalidrawElement> & {
    type: "sequence";
    shape: Extract<SequenceShapeData, { id: "sc-fragment" }>;
  };
};

const requireMessage = (
  scene: Scene,
  messageId: string,
): SequenceMessageElement => {
  const element = scene.getNonDeletedElementsMap().get(messageId);
  if (!element || !isLinearElement(element) || element.type !== "arrow") {
    throw new CanvasSceneError("target_not_found", `消息不存在: ${messageId}`);
  }
  return element as SequenceMessageElement;
};

const normalizeSequenceElement = (
  scene: Scene,
  element: ExcalidrawShapeElement,
): ExcalidrawShapeElement => {
  const normalized = normalizeSequenceFragmentGeometry(
    normalizeSequenceLifelineGeometry(element),
  );
  if (normalized === element) {
    return element;
  }
  scene.mutateElement(element, {
    height: normalized.height,
    ...(normalized.shape !== element.shape ? { shape: normalized.shape } : {}),
    ...(normalized.texts !== element.texts ? { texts: normalized.texts } : {}),
    ...(normalized.textFitMode !== element.textFitMode
      ? { textFitMode: normalized.textFitMode }
      : {}),
  });
  return (
    (scene.getNonDeletedElementsMap().get(element.id) as
      | ExcalidrawShapeElement
      | undefined) ?? element
  );
};

const addActivationBinding = (
  scene: Scene,
  lifeline: SequenceLifelineElement,
  activationId: string,
) => {
  const boundElements = lifeline.boundElements ?? [];
  if (
    boundElements.some(
      (entry) => entry.id === activationId && entry.type === "activation",
    )
  ) {
    return;
  }
  scene.mutateElement(lifeline, {
    boundElements: [...boundElements, { id: activationId, type: "activation" }],
  });
};

const ensureActivation = (
  scene: Scene,
  lifeline: SequenceLifelineElement,
  y: number,
  requestedId?: string,
): SequenceActivationElement => {
  const elementsMap = scene.getNonDeletedElementsMap();
  if (requestedId) {
    const element = elementsMap.get(requestedId);
    if (!element || !isActivationElement(element)) {
      throw new CanvasSceneError(
        "target_not_found",
        `激活条不存在: ${requestedId}`,
      );
    }
    if (element.shape.link?.lifelineId !== lifeline.id) {
      throw new CanvasSceneError(
        "invalid_operation",
        `激活条不属于参与者: ${requestedId}`,
      );
    }
    return element as SequenceActivationElement;
  }
  for (const element of elementsMap.values()) {
    if (!isActivationElement(element)) {
      continue;
    }
    if (element.shape.link?.lifelineId !== lifeline.id) {
      continue;
    }
    if (y >= element.y && y <= element.y + element.height) {
      return element as SequenceActivationElement;
    }
  }

  const height = SEQUENCE_ACTIVATION_HEIGHT;
  const headHeight = lifeline.shape.lifeline.headHeight;
  const minimumCenter =
    lifeline.y + headHeight + SEQUENCE_MIN_ACTIVATION_OFFSET + height / 2;
  if (y < minimumCenter) {
    throw new CanvasSceneError(
      "invalid_input",
      "消息位置必须落在生命线杆上（头部以下）",
    );
  }
  const requiredHeight =
    y - lifeline.y + height / 2 + SEQUENCE_MIN_ACTIVATION_OFFSET;
  if (lifeline.height < requiredHeight) {
    scene.mutateElement(lifeline, { height: requiredHeight });
  }
  const liveLifeline = requireLifeline(scene, lifeline.id);
  const placement = getSequenceLifelineActivationCenter(
    liveLifeline,
    y - liveLifeline.y,
    height,
  );
  const shape = {
    ...buildShapeData("sc-activation"),
    link: { lifelineId: lifeline.id, localY: placement.localY },
  } as Extract<SequenceShapeData, { id: "sc-activation" }>;
  const activation = newElement({
    type: "sequence",
    shape,
    x: placement.center.x - SEQUENCE_ACTIVATION_WIDTH / 2,
    y: placement.center.y - height / 2,
    width: SEQUENCE_ACTIVATION_WIDTH,
    height,
    angle: liveLifeline.angle,
  });
  const live = addToScene(scene, activation) as SequenceActivationElement;
  addActivationBinding(scene, liveLifeline, live.id);
  return live;
};

const activationLinkOf = (
  scene: Scene,
  elementId: string | undefined,
): string | undefined => {
  if (!elementId) {
    return undefined;
  }
  const element = scene.getNonDeletedElementsMap().get(elementId);
  return element && isActivationElement(element)
    ? element.shape.link?.lifelineId
    : undefined;
};

const nextMessageY = (
  scene: Scene,
  fromLifeline: SequenceLifelineElement,
  toLifeline: SequenceLifelineElement,
) => {
  const base =
    Math.max(
      fromLifeline.y + fromLifeline.shape.lifeline.headHeight,
      toLifeline.y + toLifeline.shape.lifeline.headHeight,
    ) + SEQUENCE_MESSAGE_TOP_GAP;
  let bottom = -Infinity;
  for (const element of scene.getNonDeletedElementsMap().values()) {
    if (
      element.isDeleted ||
      !isLinearElement(element) ||
      element.type !== "arrow"
    ) {
      continue;
    }
    const startLifelineId = activationLinkOf(
      scene,
      element.startBinding?.elementId,
    );
    const endLifelineId = activationLinkOf(
      scene,
      element.endBinding?.elementId,
    );
    if (
      startLifelineId !== fromLifeline.id &&
      startLifelineId !== toLifeline.id &&
      endLifelineId !== fromLifeline.id &&
      endLifelineId !== toLifeline.id
    ) {
      continue;
    }
    const self =
      element.startBinding?.elementId === element.endBinding?.elementId;
    bottom = Math.max(
      bottom,
      element.y + (self ? SEQUENCE_SELF_MESSAGE_OFFSET : 0),
    );
  }
  return bottom === -Infinity ? base : bottom + SEQUENCE_MESSAGE_ROW_GAP;
};

const attachPointRatio = (activation: SequenceActivationElement, y: number) =>
  Math.min(1, Math.max(0, (y - activation.y) / Math.max(activation.height, 1)));

const clampMessageY = (
  y: number,
  start: SequenceActivationElement,
  end: SequenceActivationElement,
) => {
  const minimum = Math.max(start.y + 1, end.y + 1);
  const maximum = Math.min(start.y + start.height - 1, end.y + end.height - 1);
  if (minimum <= maximum) {
    return Math.min(Math.max(y, minimum), maximum);
  }
  return (start.y + start.height / 2 + end.y + end.height / 2) / 2;
};

const resolveMessageY = (
  scene: Scene,
  operation: Extract<SequenceOperation, { action: "addMessage" }>,
  fromLifeline: SequenceLifelineElement,
  toLifeline: SequenceLifelineElement,
) => {
  if (operation.y !== undefined) {
    return operation.y;
  }
  const base =
    Math.max(
      fromLifeline.y + fromLifeline.shape.lifeline.headHeight,
      toLifeline.y + toLifeline.shape.lifeline.headHeight,
    ) + SEQUENCE_MESSAGE_TOP_GAP;
  if (operation.order !== undefined) {
    if (!Number.isInteger(operation.order) || operation.order < 1) {
      throw new CanvasSceneError(
        "invalid_input",
        "消息序号必须是从 1 开始的整数",
      );
    }
    return base + (operation.order - 1) * SEQUENCE_MESSAGE_ROW_GAP;
  }
  return nextMessageY(scene, fromLifeline, toLifeline);
};

/** Sequence semantic operations: participants, messages, activations and fragments. */
export const applySequenceOperation = (
  elements: readonly ExcalidrawElement[],
  operation: SequenceOperation,
): CanvasElementOperationResult => {
  const scene = createCalculationScene(elements);
  try {
    let elementId: string;
    switch (operation.action) {
      case "addParticipant": {
        const size = getSequenceLifelineDefaultSize(operation.kind);
        const element = newElement({
          type: "sequence",
          shape: buildShapeData(operation.kind as ShapeId),
          x: operation.position.x,
          y: operation.position.y,
          width: operation.width ?? size.width,
          height: operation.height ?? size.height,
          ...(operation.textFit
            ? {
                textFitMode: operation.textFit.mode,
                ...(operation.textFit.minWidth !== undefined
                  ? { textFitMinWidth: operation.textFit.minWidth }
                  : {}),
                ...(operation.textFit.minHeight !== undefined
                  ? { textFitMinHeight: operation.textFit.minHeight }
                  : {}),
              }
            : {}),
        });
        const live = normalizeSequenceElement(
          scene,
          addToScene(scene, element) as ExcalidrawShapeElement,
        );
        applySceneElementStyle(live, operation.style, scene);
        updateSceneLabel(live, operation.text, operation.textStyle, scene);
        elementId = live.id;
        break;
      }
      case "removeParticipant": {
        const lifeline = requireLifeline(scene, operation.target.elementId);
        elementId = lifeline.id;
        const deleted = new Set<string>([lifeline.id]);
        for (const element of scene.getNonDeletedElementsMap().values()) {
          if (
            isActivationElement(element) &&
            element.shape.link?.lifelineId === lifeline.id
          ) {
            deleted.add(element.id);
          }
        }
        for (const element of scene.getNonDeletedElementsMap().values()) {
          if (
            isLinearElement(element) &&
            ((element.startBinding &&
              deleted.has(element.startBinding.elementId)) ||
              (element.endBinding && deleted.has(element.endBinding.elementId)))
          ) {
            deleted.add(element.id);
          }
        }
        deleteSceneElements(deleted, scene);
        break;
      }
      case "addMessage": {
        const fromLifeline = requireLifeline(
          scene,
          operation.from.participantId,
        );
        const toLifeline = requireLifeline(scene, operation.to.participantId);
        const y = resolveMessageY(scene, operation, fromLifeline, toLifeline);
        const self = fromLifeline.id === toLifeline.id;
        const startActivation = ensureActivation(
          scene,
          fromLifeline,
          self ? y + SEQUENCE_SELF_MESSAGE_OFFSET / 2 : y,
          operation.from.activationId,
        );
        const endActivation = self
          ? startActivation
          : ensureActivation(scene, toLifeline, y, operation.to.activationId);
        const commonY = self
          ? y
          : clampMessageY(y, startActivation, endActivation);
        const startCenter = startActivation.x + startActivation.width / 2;
        const endCenter = endActivation.x + endActivation.width / 2;
        const startSide = self
          ? "right"
          : startCenter <= endCenter
          ? "right"
          : "left";
        const endSide = self
          ? "right"
          : startSide === "right"
          ? "left"
          : "right";
        const startX =
          startActivation.x +
          (startSide === "right" ? startActivation.width : 0);
        const endX =
          endActivation.x + (endSide === "right" ? endActivation.width : 0);
        const points = self
          ? [
              [0, 0],
              [SEQUENCE_SELF_MESSAGE_WIDTH, 0],
              [SEQUENCE_SELF_MESSAGE_WIDTH, SEQUENCE_SELF_MESSAGE_OFFSET],
              [0, SEQUENCE_SELF_MESSAGE_OFFSET],
            ]
          : [
              [0, 0],
              [endX - startX, 0],
            ];
        const arrow = newArrowElement({
          type: "arrow",
          x: startX,
          y: commonY,
          points: points as unknown as ExcalidrawLinearElement["points"],
          ...(operation.startArrowhead !== undefined
            ? { startArrowhead: operation.startArrowhead }
            : {}),
          endArrowhead:
            operation.endArrowhead !== undefined
              ? operation.endArrowhead
              : "arrow",
        });
        const liveArrow = addToScene(scene, arrow) as SequenceMessageElement;
        const startAttachPoint: [number, number] = [
          startSide === "right" ? 1 : 0,
          attachPointRatio(startActivation, commonY),
        ];
        const endAttachPoint: [number, number] = [
          endSide === "right" ? 1 : 0,
          attachPointRatio(
            endActivation,
            self ? commonY + SEQUENCE_SELF_MESSAGE_OFFSET : commonY,
          ),
        ];
        bindBindingElementToAttachPoint(
          liveArrow,
          startActivation,
          "start",
          startAttachPoint,
          scene,
        );
        bindBindingElementToAttachPoint(
          liveArrow,
          endActivation,
          "end",
          endAttachPoint,
          scene,
        );
        applySceneElementStyle(liveArrow, operation.style, scene);
        updateSceneLabel(liveArrow, operation.text, operation.textStyle, scene);
        elementId = liveArrow.id;
        break;
      }
      case "updateMessage": {
        const message = requireMessage(scene, operation.target.elementId);
        updateSceneLabel(message, operation.text, operation.textStyle, scene);
        elementId = message.id;
        break;
      }
      case "removeMessage": {
        const message = requireMessage(scene, operation.target.elementId);
        deleteSceneElements(new Set([message.id]), scene);
        elementId = message.id;
        break;
      }
      case "addFragment": {
        const element = newElement({
          type: "sequence",
          shape: buildShapeData("sc-fragment"),
          x: operation.position.x,
          y: operation.position.y,
          width: operation.width ?? SEQUENCE_FRAGMENT_DEFAULT_WIDTH,
          height: operation.height ?? SEQUENCE_FRAGMENT_DEFAULT_HEIGHT,
        });
        let live = normalizeSequenceElement(
          scene,
          addToScene(scene, element) as ExcalidrawShapeElement,
        );
        applySceneElementStyle(live, operation.style, scene);
        if (operation.operator !== undefined) {
          updateSceneLabel(
            live,
            operation.operator,
            operation.textStyle,
            scene,
          );
          fitSequenceFragmentOperatorFromTexts(scene, live);
          live =
            (scene.getNonDeletedElementsMap().get(live.id) as
              | ExcalidrawShapeElement
              | undefined) ?? live;
        }
        elementId = live.id;
        break;
      }
      case "updateFragment": {
        const fragment = requireFragment(
          scene,
          operation.target.elementId,
        ) as unknown as ExcalidrawShapeElement;
        if (operation.operator !== undefined) {
          updateSceneLabel(
            fragment,
            operation.operator,
            operation.textStyle,
            scene,
          );
        }
        if (operation.insertRowAt !== undefined) {
          const update = insertSequenceFragmentRow(
            scene.getNonDeletedElementsMap().get(fragment.id)!,
            operation.insertRowAt,
          );
          if (update) {
            scene.mutateElement(
              scene
                .getNonDeletedElementsMap()
                .get(fragment.id) as unknown as ExcalidrawSequenceElement,
              { height: update.height, shape: update.shape },
            );
          }
        }
        if (operation.deleteRowId !== undefined) {
          const update = deleteSequenceFragmentRow(
            scene.getNonDeletedElementsMap().get(fragment.id)!,
            operation.deleteRowId,
          );
          if (!update) {
            throw new CanvasSceneError(
              "target_not_found",
              `组合片段行不存在: ${operation.deleteRowId}`,
            );
          }
          scene.mutateElement(
            scene
              .getNonDeletedElementsMap()
              .get(fragment.id) as unknown as ExcalidrawSequenceElement,
            { height: update.height, shape: update.shape },
          );
        }
        const live = scene.getNonDeletedElementsMap().get(fragment.id)!;
        if (
          operation.operator !== undefined ||
          operation.textStyle !== undefined
        ) {
          fitSequenceFragmentOperatorFromTexts(scene, live);
        }
        normalizeSequenceElement(
          scene,
          scene
            .getNonDeletedElementsMap()
            .get(fragment.id) as unknown as ExcalidrawShapeElement,
        );
        elementId = fragment.id;
        break;
      }
    }
    return finishSceneOperation(elements, scene.getElementsIncludingDeleted(), {
      domain: "sequence",
      action: operation.action,
      elementId,
    });
  } finally {
    scene.destroy();
  }
};
