import { THEME, applyDarkModeFilter } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { createIcon } from "./icons";

/**
 * 一条便签样式的缩略图：纸色铺底，墨色画边框、右下折角与两行正文 ——
 * 看到的即是「照这个样式新建出来的便签」。颜色随主题过
 * `applyDarkModeFilter`，与画布上的便签、色板色块同一套换算。
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
      {/* 纸面 */}
      <rect x={4} y={4} width={16} height={16} rx={2} fill={paper} />
      {/* 折角 */}
      <path d="M14 20v-4a2 2 0 0 1 2-2h4" fill="none" />
      {/* 正文两行 */}
      <path d="M8 9h8M8 13h5" fill="none" />
    </>,
    {
      width: 24,
      height: 24,
      // 边框与文字同为墨色：一组样式的墨色在缩略图上直接可见
      stroke: ink,
      strokeWidth: 1.5,
      fill: "none",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  );
};
