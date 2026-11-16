import type { Radians } from "@excalidraw/math";

import {
  getSequenceLifelineActivationCenter,
  isActivationElement,
  isSequenceFragmentElement,
  isSequenceLifelineElement,
  normalizeSequenceFragmentRows,
  SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT,
  SEQUENCE_FRAGMENT_TAB_HEIGHT,
} from "../compositeShape";
import { CanvasSceneError, createCalculationScene } from "../sceneOperations";
import { isLinearElement } from "../typeChecks";

import { getLayoutBounds, getLayoutOrigin } from "./boxes";

import type { SequenceLifelineElement } from "../compositeShape";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeletedExcalidrawElement,
  Ordered,
} from "../types";
import type {
  LayoutOptions,
  LayoutPoint,
  LayoutResult,
  LayoutWarning,
} from "./types";

const DEFAULT_PARTICIPANT_GAP = 160;
const DEFAULT_MESSAGE_TOP_GAP = 80;
const DEFAULT_MESSAGE_GAP = 56;
const ACTIVATION_CONTENT_PADDING = 16;
const ACTIVATION_TRAILING_PADDING = 32;
const FRAGMENT_PADDING = 24;
const SELF_MESSAGE_OFFSET = 24;
const SELF_MESSAGE_WIDTH = 40;

type SequenceActivationElement = NonDeletedExcalidrawElement & {
  type: "sequence";
  shape: {
    id: "sc-activation";
    link?: { lifelineId: string; localY: number };
  };
};
type SequenceMessageElement = Ordered<NonDeletedExcalidrawElement> &
  ExcalidrawLinearElement;

type MessageRow = {
  message: SequenceMessageElement;
  y: number;
};

const isMessageArrow = (
  element: ExcalidrawElement,
): element is SequenceMessageElement =>
  !element.isDeleted &&
  isLinearElement(element) &&
  element.type === "arrow" &&
  Boolean(element.startBinding && element.endBinding);

const sortByIdentity = (
  left: ExcalidrawElement,
  right: ExcalidrawElement,
): number => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const sequenceSignature = (element: ExcalidrawElement): string =>
  JSON.stringify([
    element.x,
    element.y,
    element.width,
    element.height,
    element.angle,
    isLinearElement(element) ? element.points : null,
    isLinearElement(element) ? element.startBinding : null,
    isLinearElement(element) ? element.endBinding : null,
    "shape" in element ? element.shape : null,
  ]);

const mutateIfChanged = (
  scene: ReturnType<typeof createCalculationScene>,
  element: NonDeletedExcalidrawElement,
  updates: Record<string, unknown>,
) => {
  const source = element as unknown as Record<string, unknown>;
  if (Object.entries(updates).every(([key, value]) => source[key] === value)) {
    return false;
  }
  scene.mutateElement(element, updates);
  return true;
};

const activationOf = (
  elementsMap: Map<string, NonDeletedExcalidrawElement>,
  bindingId: string | undefined,
): SequenceActivationElement | null => {
  if (!bindingId) {
    return null;
  }
  const element = elementsMap.get(bindingId);
  return element && isActivationElement(element)
    ? (element as SequenceActivationElement)
    : null;
};

/**
 * Sequence layout: participants become evenly spaced columns, messages become
 * evenly spaced horizontal rows between their activation bars, and fragments
 * wrap the participants/messages they currently cover.
 */
export const layoutSequence = (
  elements: readonly ExcalidrawElement[],
  selected: readonly ExcalidrawElement[],
  origin: LayoutPoint | undefined,
  options: LayoutOptions,
  warnings: LayoutWarning[],
): LayoutResult => {
  const scene = createCalculationScene(elements);
  try {
    const elementsMap = scene.getNonDeletedElementsMap();
    const selectedOrder = new Map(
      selected.map((element, index) => [element.id, index]),
    );
    const selectedFragments = selected.filter(isSequenceFragmentElement);

    for (const element of selected) {
      if (
        !isSequenceLifelineElement(element) &&
        !isActivationElement(element) &&
        !isSequenceFragmentElement(element) &&
        !isMessageArrow(element) &&
        !isLinearElement(element)
      ) {
        warnings.push({
          code: "layout_sequence_ignored",
          message: "sequence 布局忽略非时序图元素",
          path: `ids.${element.id}`,
        });
      }
    }

    const participantIds = new Set<string>();
    const addParticipantFromActivation = (
      activation: SequenceActivationElement,
    ) => {
      const link = activation.shape.link;
      if (!link) {
        warnings.push({
          code: "layout_sequence_unlinked_activation",
          message: "激活条未绑定生命线，已忽略",
          path: `ids.${activation.id}`,
        });
        return;
      }
      participantIds.add(link.lifelineId);
    };
    for (const element of selected) {
      if (isSequenceLifelineElement(element)) {
        participantIds.add(element.id);
        continue;
      }
      if (isActivationElement(element)) {
        addParticipantFromActivation(element as SequenceActivationElement);
        continue;
      }
      if (isMessageArrow(element)) {
        for (const binding of [
          element.startBinding,
          element.endBinding,
        ] as const) {
          const activation = binding
            ? activationOf(elementsMap, binding.elementId)
            : null;
          if (activation) {
            addParticipantFromActivation(activation);
          }
        }
      }
    }

    const lifelines = (
      [...participantIds]
        .map((id) => elementsMap.get(id))
        .filter(
          (element) => !!element && isSequenceLifelineElement(element),
        ) as Array<NonDeletedExcalidrawElement & SequenceLifelineElement>
    ).sort(
      (left, right) =>
        left.x + left.width / 2 - (right.x + right.width / 2) ||
        (selectedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (selectedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        sortByIdentity(left, right),
    );
    if (!lifelines.length) {
      throw new CanvasSceneError(
        "invalid_input",
        "sequence 布局需要至少一条生命线",
      );
    }

    const participantSet = new Set(lifelines.map((lifeline) => lifeline.id));
    const activations = [...elementsMap.values()]
      .filter(isActivationElement)
      .filter((activation) => {
        const link = (activation as SequenceActivationElement).shape.link;
        return !!link && participantSet.has(link.lifelineId);
      }) as SequenceActivationElement[];
    const activationIds = new Set(
      activations.map((activation) => activation.id),
    );
    const activationToLifeline = new Map(
      activations.map((activation) => [
        activation.id,
        activation.shape.link!.lifelineId,
      ]),
    );
    const messages = [...elementsMap.values()]
      .filter(isMessageArrow)
      .filter(
        (message) =>
          activationIds.has(message.startBinding!.elementId) &&
          activationIds.has(message.endBinding!.elementId),
      )
      .sort(
        (left, right) =>
          left.y - right.y || left.x - right.x || sortByIdentity(left, right),
      );

    const resolvedOrigin = origin ?? getLayoutOrigin(lifelines);
    const participantGap = options.gap ?? DEFAULT_PARTICIPANT_GAP;
    const rowGap = options.rankGap ?? DEFAULT_MESSAGE_GAP;
    const topGap = options.nodeGap ?? DEFAULT_MESSAGE_TOP_GAP;
    const maxHeadHeight = Math.max(
      ...lifelines.map((lifeline) => lifeline.shape.lifeline.headHeight),
    );
    const messageTop = resolvedOrigin.y + maxHeadHeight + topGap;
    const messageRows: MessageRow[] = messages.map((message, index) => ({
      message,
      y: messageTop + index * rowGap,
    }));

    const messageRowsByActivation = new Map<string, number[]>();
    for (const row of messageRows) {
      for (const binding of [
        row.message.startBinding,
        row.message.endBinding,
      ] as const) {
        const activationId = binding?.elementId;
        if (!activationId) {
          continue;
        }
        const rows = messageRowsByActivation.get(activationId) ?? [];
        rows.push(row.y);
        messageRowsByActivation.set(activationId, rows);
      }
    }

    const lastRowByLifeline = new Map<string, number>();
    for (const row of messageRows) {
      const message = row.message;
      const offsets = [0];
      if (message.startBinding!.elementId === message.endBinding!.elementId) {
        offsets.push(SELF_MESSAGE_OFFSET);
      }
      for (const lifelineId of [
        activationToLifeline.get(message.startBinding!.elementId),
        activationToLifeline.get(message.endBinding!.elementId),
      ]) {
        if (!lifelineId) {
          continue;
        }
        const bottom = row.y + Math.max(...offsets);
        lastRowByLifeline.set(
          lifelineId,
          Math.max(lastRowByLifeline.get(lifelineId) ?? -Infinity, bottom),
        );
      }
    }

    let nextX = resolvedOrigin.x;
    for (const lifeline of lifelines) {
      const desiredHeight =
        lastRowByLifeline.get(lifeline.id) === undefined
          ? lifeline.height
          : lastRowByLifeline.get(lifeline.id)! -
            resolvedOrigin.y +
            ACTIVATION_TRAILING_PADDING;
      mutateIfChanged(scene, lifeline, {
        x: nextX,
        y: resolvedOrigin.y,
        height: Math.max(lifeline.height, desiredHeight),
      });
      nextX += lifeline.width + participantGap;
    }

    for (const activation of activations) {
      const live = elementsMap.get(activation.id) as
        | SequenceActivationElement
        | undefined;
      if (!live) {
        continue;
      }
      const lifelineId = activationToLifeline.get(activation.id)!;
      const lifeline = elementsMap.get(lifelineId);
      if (!lifeline || !isSequenceLifelineElement(lifeline)) {
        continue;
      }
      const rows = messageRowsByActivation.get(activation.id) ?? [];
      const currentLocalY = live.shape.link?.localY ?? 0;
      const top =
        rows.length > 0
          ? Math.min(...rows) - ACTIVATION_CONTENT_PADDING
          : undefined;
      const bottom =
        rows.length > 0
          ? Math.max(...rows) + ACTIVATION_CONTENT_PADDING
          : undefined;
      const height = Math.max(
        live.height,
        top !== undefined && bottom !== undefined ? bottom - top : 0,
      );
      const centerY =
        top !== undefined && bottom !== undefined
          ? (top + bottom) / 2
          : undefined;
      const localY =
        centerY === undefined ? currentLocalY : centerY - lifeline.y;
      const placement = getSequenceLifelineActivationCenter(
        lifeline as SequenceLifelineElement,
        localY,
        height,
      );
      mutateIfChanged(scene, live, {
        x: placement.center.x - live.width / 2,
        y: placement.center.y - height / 2,
        height,
        angle: placement.angle,
        shape: {
          ...live.shape,
          link: { lifelineId, localY: placement.localY },
        },
      });
    }

    const selfMessages = (message: SequenceMessageElement) =>
      message.startBinding!.elementId === message.endBinding!.elementId;

    for (const row of messageRows) {
      const live = elementsMap.get(row.message.id) as
        | SequenceMessageElement
        | undefined;
      if (!live) {
        continue;
      }
      const startBinding = live.startBinding!;
      const endBinding = live.endBinding!;
      const startActivation = activationOf(elementsMap, startBinding.elementId);
      const endActivation = activationOf(elementsMap, endBinding.elementId);
      if (!startActivation || !endActivation) {
        warnings.push({
          code: "layout_sequence_message_skipped",
          message: "消息缺少激活条端点，已忽略",
          path: `ids.${live.id}`,
        });
        continue;
      }
      if (selfMessages(live)) {
        const startX = startActivation.x + startActivation.width;
        const minY = startActivation.y + 1;
        const maxY = startActivation.y + startActivation.height - 1;
        let startY = Math.min(Math.max(row.y, minY), maxY);
        let endY = Math.min(Math.max(startY + SELF_MESSAGE_OFFSET, minY), maxY);
        if (endY - startY < SELF_MESSAGE_OFFSET) {
          startY = Math.max(minY, endY - SELF_MESSAGE_OFFSET);
        }
        const dy = endY - startY;
        mutateIfChanged(scene, live, {
          x: startX,
          y: startY,
          angle: 0 as Radians,
          points: [
            [0, 0],
            [SELF_MESSAGE_WIDTH, 0],
            [SELF_MESSAGE_WIDTH, dy],
            [0, dy],
          ],
          startBinding: {
            elementId: startActivation.id,
            attachPoint: [
              1,
              (startY - startActivation.y) / startActivation.height,
            ],
          },
          endBinding: {
            elementId: endActivation.id,
            attachPoint: [1, (endY - endActivation.y) / endActivation.height],
          },
        });
        continue;
      }
      const startCenter = startActivation.x + startActivation.width / 2;
      const endCenter = endActivation.x + endActivation.width / 2;
      const startSide = startCenter <= endCenter ? "right" : "left";
      const endSide = startSide === "right" ? "left" : "right";
      const minY = Math.max(startActivation.y + 1, endActivation.y + 1);
      const maxY = Math.min(
        startActivation.y + startActivation.height - 1,
        endActivation.y + endActivation.height - 1,
      );
      const y =
        minY <= maxY
          ? Math.min(Math.max(row.y, minY), maxY)
          : (startActivation.y +
              startActivation.height / 2 +
              endActivation.y +
              endActivation.height / 2) /
            2;
      const startX =
        startActivation.x + (startSide === "right" ? startActivation.width : 0);
      const endX =
        endActivation.x + (endSide === "right" ? endActivation.width : 0);
      mutateIfChanged(scene, live, {
        x: startX,
        y,
        angle: 0 as Radians,
        points: [
          [0, 0],
          [endX - startX, 0],
        ],
        startBinding: {
          elementId: startActivation.id,
          attachPoint: [
            startSide === "right" ? 1 : 0,
            (y - startActivation.y) / startActivation.height,
          ],
        },
        endBinding: {
          elementId: endActivation.id,
          attachPoint: [
            endSide === "right" ? 1 : 0,
            (y - endActivation.y) / endActivation.height,
          ],
        },
      });
    }

    const originalById = new Map(
      elements.map((element) => [element.id, element]),
    );
    for (const fragment of selectedFragments) {
      const live = elementsMap.get(fragment.id);
      if (!live || !isSequenceFragmentElement(live)) {
        continue;
      }
      const covered = lifelines.filter((lifeline) => {
        const centerX = lifeline.x + lifeline.width / 2;
        return centerX >= live.x && centerX <= live.x + live.width;
      });
      if (!covered.length) {
        warnings.push({
          code: "layout_sequence_fragment_skipped",
          message: "组合片段未覆盖任何生命线，已忽略",
          path: `ids.${live.id}`,
        });
        continue;
      }
      const left = Math.min(...covered.map((lifeline) => lifeline.x));
      const right = Math.max(
        ...covered.map((lifeline) => lifeline.x + lifeline.width),
      );
      const containedRows = messageRows.filter((row) => {
        const originalY = originalById.get(row.message.id)?.y ?? row.message.y;
        return originalY >= live.y && originalY <= live.y + live.height;
      });
      const top =
        containedRows.length > 0
          ? Math.min(...containedRows.map((row) => row.y)) - rowGap / 2
          : live.y;
      const bottom =
        containedRows.length > 0
          ? Math.max(...containedRows.map((row) => row.y)) + rowGap / 2
          : live.y + live.height;
      const height = Math.max(
        bottom - top,
        SEQUENCE_FRAGMENT_TAB_HEIGHT + SEQUENCE_FRAGMENT_MIN_ROW_HEIGHT,
      );
      const rows = live.shape.fragment?.rows ?? [];
      const nextRows =
        rows.length && height !== live.height
          ? normalizeSequenceFragmentRows(rows, height)
          : rows;
      mutateIfChanged(scene, live, {
        x: left - FRAGMENT_PADDING,
        y: top,
        width: right - left + FRAGMENT_PADDING * 2,
        height,
        ...(nextRows !== rows
          ? {
              shape: {
                ...live.shape,
                fragment: { ...live.shape.fragment, rows: nextRows },
              },
            }
          : {}),
      });
    }

    const inputById = new Map(elements.map((element) => [element.id, element]));
    const affected = new Set<string>();
    const nextElements = scene.getElementsIncludingDeleted().map((element) => {
      const previous = inputById.get(element.id);
      if (
        !previous ||
        sequenceSignature(previous) !== sequenceSignature(element)
      ) {
        affected.add(element.id);
        return element;
      }
      return previous;
    });
    const affectedElements = nextElements.filter(
      (element) => affected.has(element.id) && !element.isDeleted,
    );
    return {
      elements: nextElements,
      bounds: affectedElements.length
        ? getLayoutBounds(affectedElements)
        : {
            x: resolvedOrigin.x,
            y: resolvedOrigin.y,
            width: 0,
            height: 0,
          },
      warnings,
      affectedElementIds: [...affected],
    };
  } finally {
    scene.destroy();
  }
};
