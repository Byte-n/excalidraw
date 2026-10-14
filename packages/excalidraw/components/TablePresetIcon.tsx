import { THEME } from "@excalidraw/common";

import {
  TABLE_PRESET_TITLE_FILL,
  resolveTableColor,
} from "@excalidraw/element";

import type { TablePresetId } from "@excalidraw/element";
import type { Theme } from "@excalidraw/element/types";

import { createIcon, tableToolIcon } from "./icons";

/**
 * 表格预设的缩略图：24px 里画出**真实的结构**——普通表格是均匀网格，水平泳道
 * 是左边一条合并的标题带 + 两条泳道，垂直泳道是它的转置（两者互为 180° 旋转，
 * 就像数据那样）。
 *
 * 标题带的底色解析 `TABLE_PRESET_TITLE_FILL` 这个主题令牌，和画布上新建出来的
 * 表头带同色；网格线用图标自身的 currentColor，与工具栏其它图标一致。
 */
export const getTablePresetIcon = (presetId: TablePresetId, theme: Theme) => {
  if (presetId === "plain") {
    return tableToolIcon;
  }

  const band = resolveTableColor(TABLE_PRESET_TITLE_FILL, theme === THEME.DARK);
  const horizontal = presetId === "swimlane-horizontal";

  return createIcon(
    <>
      {/* 表体 */}
      <rect x={4} y={4} width={16} height={16} rx={2} />
      {/* 合并的标题带：横向占满宽度，纵向占满高度（跟数据一样只盖自己那一轴） */}
      <path
        d={
          horizontal
            ? "M4 6a2 2 0 0 1 2-2h2v16H6a2 2 0 0 1-2-2z"
            : "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H4z"
        }
        fill={band}
        stroke="none"
      />
      {/* 标题带与名字带的分界 */}
      <path d={horizontal ? "M8 4v16" : "M4 8h16"} />
      {/* 泳道名带与内容区的分界 */}
      <path d={horizontal ? "M12 4v16" : "M4 12h16"} />
      {/* 泳道之间的分界：只穿过名字带与内容区，标题带是整条合并的 */}
      <path d={horizontal ? "M8 12h12" : "M12 8v12"} />
    </>,
    {
      width: 24,
      height: 24,
      stroke: "currentColor",
      strokeWidth: 1.5,
      fill: "none",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  );
};
