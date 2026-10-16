import React from "react";
import clsx from "clsx";

import { isTransparent } from "@excalidraw/common";

import { getSwatchLabelColor } from "./colorPickerUtils";

interface HotkeyLabelProps {
  color: string;
  keyLabel: string | number;
  isShade?: boolean;
}
const HotkeyLabel = ({
  color,
  keyLabel,
  isShade = false,
}: HotkeyLabelProps) => {
  // the transparent swatch renders a checkerboard whose brightness flips with
  // the theme, so its label color is decided by CSS (per theme) rather than an
  // inline color — the `--transparent` modifier carries that. An empty color
  // is treated the same way: the swatch judge is
  // `color === "transparent" || !color`, so a falsy value also paints the
  // checkerboard (and would otherwise get a white label on a light checker)
  const transparent = !color || isTransparent(color);
  return (
    <div
      className={clsx("color-picker__button__hotkey-label", {
        "color-picker__button__hotkey-label--transparent": transparent,
      })}
      style={transparent ? undefined : { color: getSwatchLabelColor(color) }}
    >
      {isShade && "⇧"}
      {keyLabel}
    </div>
  );
};

export default HotkeyLabel;
