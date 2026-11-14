import {
  COLOR_PALETTE,
  ROUNDNESS,
  THEME,
  applyDarkModeFilter,
  colorToHex,
} from "@excalidraw/common";

import {
  TABLE_PRESET_TITLE_FILL,
  resolveTableColor,
} from "@excalidraw/element";

import {
  SEQUENCE_LIFELINE_HEAD_HEIGHTS,
  buildShapeData,
  compositeShapePathToSvg,
  flattenCompositeShapePath,
  getCompositeShapeGeometry,
  getSequenceElementBox,
  getSequenceFragmentRowPaths,
  getSequenceFragmentTabPath,
  getSequenceLifelineGeometry,
  isCompositeShapeOpen,
  isSequenceLifelineShapeId,
  isSequenceShapeId,
} from "@excalidraw/element/compositeShape";

import type { TablePresetId } from "@excalidraw/element";

import type {
  CompositeShapePath,
  SequenceLifelineId,
} from "@excalidraw/element/compositeShape";

import type {
  SequenceShapeId,
  ShapeId,
  Theme,
} from "@excalidraw/element/types";

import { useUIAppState } from "../context/ui-appState";

import { createIcon, tableToolIcon } from "./icons";
import {
  SHAPE_PRESET_DEFAULTS,
  type ShapePresetDefault,
} from "./shapePresetDefaults";

import type { ReactNode } from "react";

/**
 * 全部预设图例的唯一实现点：形状几何来自 element 注册表，填充色/宽高比来自
 * `SHAPE_PRESET_DEFAULTS`，因此新增预设只需在 catalog 里加一行，图例自动跟上。
 * 图例只求「看起来像」真实预设，不绘制文案。
 */

const ICON_SIZE = 24;
const ICON_PADDING = 2;
const CONTENT_SIZE = ICON_SIZE - ICON_PADDING * 2;

export type PresetShapeIconOptions = {
  /** `sc-fragment` 图标画出的正文行数（else 预设多一行分隔线） */
  fragmentBodyRows?: number;
};

type PresetIconPath = CompositeShapePath & {
  fill?: string;
  strokeLineDash?: number[];
};

const isTransparent = (color: string): boolean =>
  color === "transparent" || color === COLOR_PALETTE.transparent;

const getPresetFill = (
  defaults: ShapePresetDefault,
  theme: Theme,
): string | undefined =>
  isTransparent(defaults.backgroundColor)
    ? undefined
    : applyDarkModeFilter(defaults.backgroundColor, theme === THEME.DARK);

/** 与 `element/src/shape.ts` 的 `shadeCompositeFill` 同参数，用于立体面着色 */
const shadeFill = (color: string, tone: "light" | "base" | "dark"): string => {
  if (tone === "base") {
    return color;
  }
  const hex = colorToHex(color);
  if (!hex) {
    return color;
  }
  const target = tone === "light" ? 255 : 0;
  const amount = tone === "light" ? 0.2 : 0.18;
  const channels = [1, 3, 5].map((offset) => {
    const original = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(original + (target - original) * amount)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}${hex.slice(7)}`;
};

/** 基础图形/流程图：整元素几何，按预设宽高比出图 */
const getOutlineIconPaths = (id: ShapeId, theme: Theme): PresetIconPath[] => {
  const defaults = SHAPE_PRESET_DEFAULTS[id];
  const geometry = getCompositeShapeGeometry({
    width: defaults.width,
    height: defaults.height,
    shape: buildShapeData(id),
    roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
  });
  const fill = isCompositeShapeOpen(id)
    ? undefined
    : getPresetFill(defaults, theme);
  const paths: PresetIconPath[] = [];

  if (geometry.fillFaces?.length) {
    for (const face of geometry.fillFaces) {
      paths.push({
        ...face.path,
        fill: fill ? shadeFill(fill, face.tone) : undefined,
      });
    }
    paths.push({ ...geometry.outline });
  } else {
    paths.push({ ...geometry.outline, fill });
  }

  for (const detail of geometry.details) {
    paths.push({ ...detail });
  }
  return paths;
};

const getSequenceIconPaths = (
  id: SequenceShapeId,
  theme: Theme,
  options?: PresetShapeIconOptions,
): PresetIconPath[] => {
  const defaults = SHAPE_PRESET_DEFAULTS[id];
  const fill = getPresetFill(defaults, theme);

  if (isSequenceLifelineShapeId(id)) {
    const { head, attachments } = getSequenceLifelineGeometry(
      id as SequenceLifelineId,
      defaults.width,
      SEQUENCE_LIFELINE_HEAD_HEIGHTS[id],
    );
    return [
      ...head.map((path) => ({ ...path, fill })),
      ...attachments.map((path) => ({ ...path })),
    ];
  }

  if (id === "sc-fragment") {
    const paths: PresetIconPath[] = [
      { ...getSequenceElementBox(defaults.width, defaults.height) },
      { ...getSequenceFragmentTabPath(), fill },
    ];
    const bodyRows = Math.max(1, Math.floor(options?.fragmentBodyRows ?? 1));
    if (bodyRows > 1) {
      paths.push(
        ...getSequenceFragmentRowPaths(defaults.width, defaults.height, {
          rows: [
            { id: "icon-header", height: 1 },
            ...Array.from({ length: bodyRows }, (_, index) => ({
              id: `icon-body-${index}`,
              height: 1,
            })),
          ],
        }),
      );
    }
    return paths;
  }

  return [{ ...getSequenceElementBox(defaults.width, defaults.height), fill }];
};

const getShapeIconPaths = (
  id: ShapeId,
  theme: Theme,
  options?: PresetShapeIconOptions,
): PresetIconPath[] =>
  isSequenceShapeId(id)
    ? getSequenceIconPaths(id, theme, options)
    : getOutlineIconPaths(id, theme);

const getBounds = (paths: readonly PresetIconPath[]) => {
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

const renderShapeIcon = (paths: readonly PresetIconPath[]) => {
  const { minX, minY, maxX, maxY } = getBounds(paths);
  const width = Math.max(maxX - minX, Number.EPSILON);
  const height = Math.max(maxY - minY, Number.EPSILON);
  // 等比缩放：最长边铺满内容区，另一维按真实预设比例居中
  const scale = CONTENT_SIZE / Math.max(width, height);
  const translateX = (ICON_SIZE - width * scale) / 2 - minX * scale;
  const translateY = (ICON_SIZE - height * scale) / 2 - minY * scale;

  return createIcon(
    <g transform={`translate(${translateX} ${translateY}) scale(${scale})`}>
      {paths.map((path, index) => (
        <path
          key={index}
          d={compositeShapePathToSvg(path)}
          fill={path.fill ?? "none"}
          strokeDasharray={path.strokeLineDash?.join(" ")}
          // 缩放后仍保持 1.5px 线宽，与其余 UI 图标一致
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

/** 53 个 shape id 的统一图例入口 */
export const getPresetShapeIcon = (
  id: ShapeId,
  theme: Theme,
  options?: PresetShapeIconOptions,
): ReactNode => renderShapeIcon(getShapeIconPaths(id, theme, options));

/**
 * 便签缩略图：纸色铺底，墨色画边框、右下折角与两行正文。颜色随主题过
 * `applyDarkModeFilter`，与画布上的便签同一套换算。
 */
export const getStickyNotePresetIcon = (
  backgroundColor: string,
  strokeColor: string,
  theme: Theme,
) => {
  const dark = theme === THEME.DARK;
  const paper = applyDarkModeFilter(backgroundColor, dark);
  const ink = applyDarkModeFilter(strokeColor, dark);

  return createIcon(
    <>
      <rect x={4} y={4} width={16} height={16} rx={2} fill={paper} />
      <path d="M14 20v-4a2 2 0 0 1 2-2h4" fill="none" />
      <path d="M8 9h8M8 13h5" fill="none" />
    </>,
    {
      width: ICON_SIZE,
      height: ICON_SIZE,
      stroke: ink,
      strokeWidth: 1.5,
      fill: "none",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  );
};

/**
 * 表格预设缩略图：普通表格是均匀网格，泳道预设画出合并的标题带与泳道分隔。
 * 标题带底色与画布上新建出来的表头带同色。
 */
export const getTablePresetIcon = (presetId: TablePresetId, theme: Theme) => {
  if (presetId === "plain") {
    return tableToolIcon;
  }

  const band = resolveTableColor(TABLE_PRESET_TITLE_FILL, theme === THEME.DARK);
  const horizontal = presetId === "swimlane-horizontal";

  return createIcon(
    <>
      <rect x={4} y={4} width={16} height={16} rx={2} />
      <path
        d={
          horizontal
            ? "M4 6a2 2 0 0 1 2-2h2v16H6a2 2 0 0 1-2-2z"
            : "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H4z"
        }
        fill={band}
        stroke="none"
      />
      <path d={horizontal ? "M8 4v16" : "M4 8h16"} />
      <path d={horizontal ? "M12 4v16" : "M4 12h16"} />
      <path d={horizontal ? "M8 12h12" : "M12 8v12"} />
    </>,
    {
      width: ICON_SIZE,
      height: ICON_SIZE,
      stroke: "currentColor",
      strokeWidth: 1.5,
      fill: "none",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  );
};

/** 画框预设：虚线边框 + 左上角标题签 */
export const getFramePresetIcon = (theme: Theme) => {
  const labelFill = applyDarkModeFilter(
    COLOR_PALETTE.gray[0],
    theme === THEME.DARK,
  );

  return createIcon(
    <>
      <rect
        x={3.5}
        y={5}
        width={17}
        height={15}
        rx={2}
        fill="none"
        strokeDasharray="3 2.5"
      />
      <rect x={3.5} y={2} width={8} height={4} rx={1} fill={labelFill} />
    </>,
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

/** 脑图预设：深色根节点 + 三个浅紫分支节点的树形结构 */
export const getMindmapPresetIcon = (theme: Theme) => {
  const dark = theme === THEME.DARK;
  const rootFill = applyDarkModeFilter("#1f2329", dark);
  const branchFill = applyDarkModeFilter(COLOR_PALETTE.violet[0], dark);

  return createIcon(
    <>
      <rect x={2} y={9} width={8} height={6} rx={1.5} fill={rootFill} />
      <rect x={14} y={2} width={8} height={4} rx={1} fill={branchFill} />
      <rect x={14} y={10} width={8} height={4} rx={1} fill={branchFill} />
      <rect x={14} y={18} width={8} height={4} rx={1} fill={branchFill} />
      <path d="M10 12h1.5M11.5 4v16M11.5 4H14M11.5 12H14M11.5 20H14" />
    </>,
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

/** 静态数据表（如 `TOOLS`）里使用的主题感知包装组件 */
export const ShapePresetIcon = ({ id }: { id: ShapeId }) => {
  const theme = useUIAppState().theme;
  return <>{getPresetShapeIcon(id, theme)}</>;
};

export const FramePresetIcon = () => {
  const theme = useUIAppState().theme;
  return <>{getFramePresetIcon(theme)}</>;
};

export const MindmapPresetIcon = () => {
  const theme = useUIAppState().theme;
  return <>{getMindmapPresetIcon(theme)}</>;
};
