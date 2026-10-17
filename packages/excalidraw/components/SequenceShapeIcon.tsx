import {
  compositeShapePathToSvg,
  flattenCompositeShapePath,
  getSequenceElementBox,
  getSequenceFragmentTabPath,
  getSequenceLifelineGeometry,
  isSequenceLifelineShapeId,
  SEQUENCE_LIFELINE_HEAD_HEIGHTS,
} from "@excalidraw/element/compositeShape";

import type { CompositeShapePath } from "@excalidraw/element/compositeShape";
import type { SequenceShapeId } from "@excalidraw/element/types";

import { SHAPE_PRESET_DEFAULTS } from "./shapePresetDefaults";
import { createIcon } from "./icons";

/**
 * 时序图（`sc-*`）图形在抽屉里的缩略图。
 *
 * `getCompositeShapeIcon` 用 16×16 盒 + 整元素轮廓折线渲染 —— 对时序图形会
 * 画出界：时序图形的 `outline` 是**整个元素盒**（生命线高达 428），把 428 缩进
 * 16px 后头部图元只剩两个像素。这里改为按**头部盒**取图元（复用 element 导出的
 * 几何函数），再等比缩放进 24×24：图标画的是头部 glyph（含描边专用附件），
 * 杆不进图标。
 *
 * `sc-activation` 的头部盒就是整个元素（30×100），`sc-fragment` 是外框（400×240）
 * 加左上角页签，均按同样规则取路径。
 */

const ICON_SIZE = 24;
const ICON_PADDING = 2;
const CONTENT_SIZE = ICON_SIZE - ICON_PADDING * 2;

/** 一个 `sc-*` id 在图标里要画的全部路径（元素局部坐标）。 */
const getSequenceIconPaths = (id: SequenceShapeId): CompositeShapePath[] => {
  const defaults = SHAPE_PRESET_DEFAULTS[id];
  if (isSequenceLifelineShapeId(id)) {
    const { head, attachments } = getSequenceLifelineGeometry(
      id,
      defaults.width,
      SEQUENCE_LIFELINE_HEAD_HEIGHTS[id],
    );
    return [...head, ...attachments];
  }
  if (id === "sc-fragment") {
    return [
      getSequenceElementBox(defaults.width, defaults.height),
      getSequenceFragmentTabPath(),
    ];
  }
  return [getSequenceElementBox(defaults.width, defaults.height)];
};

const getBounds = (paths: readonly CompositeShapePath[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (const [x, y] of flattenCompositeShapePath(path)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
};

export const getSequenceShapeIcon = (id: SequenceShapeId) => {
  const paths = getSequenceIconPaths(id);
  const { minX, minY, maxX, maxY } = getBounds(paths);
  const width = Math.max(maxX - minX, Number.EPSILON);
  const height = Math.max(maxY - minY, Number.EPSILON);
  // 等比缩放：内容最长边铺满 20px，另一维按比例居中
  const scale = CONTENT_SIZE / Math.max(width, height);
  const translateX = (ICON_SIZE - width * scale) / 2 - minX * scale;
  const translateY = (ICON_SIZE - height * scale) / 2 - minY * scale;

  return createIcon(
    <g transform={`translate(${translateX} ${translateY}) scale(${scale})`}>
      {paths.map((path, index) => (
        <path
          key={index}
          d={compositeShapePathToSvg(path)}
          // 缩放后仍保持 1.5px 线宽，与其余抽屉图标一致
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>,
    {
      width: ICON_SIZE,
      height: ICON_SIZE,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  );
};
