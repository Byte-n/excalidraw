import { ARROW_TYPE, ROUNDNESS, getStrokeWidthByKey } from "@excalidraw/common";

import type { AppState } from "../../types";

/** currentItem* → 箭头属性的映射只读这几项 AppState 字段 */
type CurrentItemArrowSource = {
  state: Pick<
    AppState,
    | "currentItemStrokeColor"
    | "currentItemBackgroundColor"
    | "currentItemFillStyle"
    | "currentItemStrokeWidthKey"
    | "currentItemStrokeStyle"
    | "currentItemOpacity"
    | "currentItemArrowType"
    | "currentItemStartArrowhead"
    | "currentItemEndArrowhead"
  >;
};

/**
 * 当前连接线样式 → 新箭头属性。画布上拖拽建箭头与方向手柄建箭头共用同一套
 * 映射，两处不得各写一份。
 */
export const getCurrentItemArrowProps = (app: CurrentItemArrowSource) => {
  const { state } = app;
  const elbowed = state.currentItemArrowType === ARROW_TYPE.elbow;
  return {
    strokeColor: state.currentItemStrokeColor,
    backgroundColor: state.currentItemBackgroundColor,
    fillStyle: state.currentItemFillStyle,
    strokeWidth: getStrokeWidthByKey("arrow", state.currentItemStrokeWidthKey),
    strokeStyle: state.currentItemStrokeStyle,
    opacity: state.currentItemOpacity,
    roundness:
      state.currentItemArrowType === ARROW_TYPE.round
        ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
        : null,
    startArrowhead: state.currentItemStartArrowhead,
    endArrowhead: state.currentItemEndArrowhead,
    locked: false,
    elbowed,
    // 折线箭头用空 fixedSegments 起步（与拖拽建箭头一致）
    fixedSegments: elbowed ? [] : null,
  };
};
