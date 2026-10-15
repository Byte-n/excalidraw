import { normalizeRadians, radiansToDegrees } from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";
import type { Radians } from "@excalidraw/math";

import { getCommonBounds } from "./bounds";

import type { TransformHandleType } from "./transformHandles";
import type { ElementsMap, NonDeletedExcalidrawElement } from "./types";

/**
 * 变换读数：选中图形或选区做旋转/缩放时，在画布上给出的角度与尺寸。
 *
 * 这里只算「报什么」，不管「报在哪」——气泡的位置要量文本宽度，属于渲染层。
 * 拆开是为了能直接测：读数的分支比它看起来多（单选/多选 × 旋转/缩放 ×
 * 手势中/悬停），而且其中两条是有意的不对称：
 *
 * - 单选旋转报**绝对角**（元素自身的 angle），多选旋转报**本次手势的增量**
 *   （选区框恒为 0°，每个元素各自加同一个增量，增量才有信息量）。
 * - 多选旋转时「选区大小」取**按下瞬间冻结的选框**，不是实时 AABB：多选旋转
 *   时 AABB 会随角度呼吸（实测转到 -39° 时实时 AABB 是 295 × 267，而选区在
 *   自身坐标系里恒为 240 × 235），与旁边稳定跳动的增量并排显示会很别扭。
 */

export type TransformStatusKind = "angle" | "size";

export type TransformStatusReadout = {
  kind: TransformStatusKind;
  text: string;
};

export type TransformStatusInput = {
  /** 手势进行中的变换类型；没有手势时为 null，此时由 `hoveredHandle` 决定 */
  gesture: "rotation" | "scale" | null;
  /** 悬停在哪个变换手柄上（光标已切成对应操作态） */
  hoveredHandle: TransformHandleType | null;
  selectedElements: readonly NonDeletedExcalidrawElement[];
  elementsMap: ElementsMap;
  /** 多选旋转时，本次手势累计转过的角度 */
  rotationDelta?: Radians | null;
  /** 多选旋转时，按下瞬间的选区框 */
  gestureBounds?: Bounds | null;
};

const formatSize = (width: number, height: number) =>
  `${Math.round(Math.abs(width))} × ${Math.round(Math.abs(height))}`;

/** 元素的 angle 已被 `normalizeRadians` 规到 [0, 2π)，取整后取模挡住 360°。 */
const formatAbsoluteAngle = (angle: Radians) => {
  const degrees = Math.round(radiansToDegrees(angle)) % 360;
  return `${((degrees % 360) + 360) % 360}°`;
};

/** 手势增量是有方向的，折到 (-180, 180]，带符号显示。 */
const formatDeltaAngle = (delta: Radians) => {
  let degrees: number = radiansToDegrees(normalizeRadians(delta));
  if (degrees > 180) {
    degrees -= 360;
  }
  const rounded = Math.round(degrees);
  return `${rounded < 0 ? "-" : "+"}${Math.abs(rounded)}°`;
};

export const getTransformStatusReadout = (
  input: TransformStatusInput,
): TransformStatusReadout | null => {
  const {
    gesture,
    hoveredHandle,
    selectedElements,
    elementsMap,
    rotationDelta,
    gestureBounds,
  } = input;

  if (!selectedElements.length) {
    return null;
  }

  const multi = selectedElements.length > 1;

  let kind: TransformStatusKind;
  if (gesture) {
    kind = gesture === "rotation" ? "angle" : "size";
  } else {
    if (!hoveredHandle) {
      return null;
    }
    // 悬停时读数跟着光标走：旋转柄给角度，其余手柄给尺寸。
    // 多选没有「选区角度」可报（框恒为 0°，增量要按下才有），退回报大小。
    kind = hoveredHandle === "rotation" && !multi ? "angle" : "size";
  }

  const sizeText = () => {
    if (!multi) {
      const element = selectedElements[0];
      // getElementAbsoluteCoords 给的是**未旋转**的本地框，所以 width/height
      // 就是图形自身尺寸，不随角度变化
      return formatSize(element.width, element.height);
    }
    const bounds =
      gesture === "rotation" && gestureBounds
        ? gestureBounds
        : getCommonBounds(selectedElements, elementsMap);
    return formatSize(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  };

  if (kind === "size") {
    return { kind, text: sizeText() };
  }

  if (!multi) {
    return { kind, text: formatAbsoluteAngle(selectedElements[0].angle) };
  }

  // 多选旋转：增量 + 选区大小同报（单选不报尺寸，旋转时宽高本来也不变）
  if (!rotationDelta) {
    return null;
  }
  return { kind, text: `${formatDeltaAngle(rotationDelta)} · ${sizeText()}` };
};
