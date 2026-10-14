import { COLORS_PER_ROW, COLOR_PALETTE, KEYS } from "@excalidraw/common";

import type { ColorPickerColor } from "@excalidraw/common";

import type { ColorPaletteCustom } from "@excalidraw/common";

import {
  colorPickerHotkeyBindings,
  getColorNameAndShadeFromColor,
} from "./colorPickerUtils";

import type { ActiveColorPickerSectionAtomType } from "./colorPickerUtils";

/** 便签纸色 picksOnly 变体的预设行为单行平铺（最多 6 枚），行内左右循环、
 * 上下键不动 */
const PRESET_COLORS_PER_ROW = 6;

const arrowHandler = (
  eventKey: string,
  currentIndex: number | null,
  length: number,
  colorsPerRow = COLORS_PER_ROW,
) => {
  const rows = Math.ceil(length / colorsPerRow);

  currentIndex = currentIndex ?? -1;

  switch (eventKey) {
    case "ArrowLeft": {
      const prevIndex = currentIndex - 1;
      return prevIndex < 0 ? length - 1 : prevIndex;
    }
    case "ArrowRight": {
      return (currentIndex + 1) % length;
    }
    case "ArrowDown": {
      const nextIndex = currentIndex + colorsPerRow;
      return nextIndex >= length ? currentIndex % colorsPerRow : nextIndex;
    }
    case "ArrowUp": {
      const prevIndex = currentIndex - colorsPerRow;
      const newIndex =
        prevIndex < 0 ? colorsPerRow * rows + prevIndex : prevIndex;
      return newIndex >= length ? undefined : newIndex;
    }
  }
};

interface HotkeyHandlerProps {
  e: React.KeyboardEvent;
  colorObj: { colorName: ColorPickerColor; shade: number | null } | null;
  onChange: (color: string) => void;
  palette: ColorPaletteCustom;
  customColors: string[];
  presetColors: readonly string[];
  setActiveColorPickerSection: (
    update: React.SetStateAction<ActiveColorPickerSectionAtomType>,
  ) => void;
  activeShade: number;
  /** 便签纸色变体：字母键按预设行映射（纸色不在调色板内） */
  picksOnly?: boolean;
  excludedColors?: readonly string[];
}

/**
 * @returns true if the event was handled
 */
const hotkeyHandler = ({
  e,
  colorObj,
  onChange,
  palette,
  customColors,
  presetColors,
  setActiveColorPickerSection,
  activeShade,
  picksOnly = false,
  excludedColors,
}: HotkeyHandlerProps): boolean => {
  if (colorObj?.shade != null) {
    // shift + numpad is extremely messed up on windows apparently
    if (
      ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"].includes(e.code) &&
      e.shiftKey
    ) {
      const newShade = Number(e.code.slice(-1)) - 1;
      onChange(palette[colorObj.colorName][newShade]);
      setActiveColorPickerSection("shades");
      return true;
    }
  }

  if (["1", "2", "3", "4", "5"].includes(e.key)) {
    const c = customColors[Number(e.key) - 1];
    if (c) {
      onChange(customColors[Number(e.key) - 1]);
      setActiveColorPickerSection("custom");
      return true;
    }
  }

  if (colorPickerHotkeyBindings.includes(e.key)) {
    const index = colorPickerHotkeyBindings.indexOf(e.key);

    if (picksOnly) {
      const preset = presetColors[index];
      // 超出预设数量的绑定键是空键：在弹层键盘作用域内保持惰性（不上报
      // unhandled，否则会泄漏到全局快捷键——`q` 会切换工具锁定）
      if (preset == null) {
        return true;
      }
      onChange(preset);
      setActiveColorPickerSection("baseColors");
      return true;
    }

    const paletteKey = Object.keys(palette)[index];
    const paletteValue = palette[paletteKey];
    const resolved = Array.isArray(paletteValue)
      ? paletteValue[activeShade]
      : paletteValue;
    // hotkeys of excluded (hidden) or absent palette entries are dead, not
    // remapped — this keeps every other color on its usual key. Still
    // HANDLED: within the modal's keyboard scope the key is deliberately
    // inert, and reporting it unhandled would let it escape to global
    // shortcuts (`q` toggles the tool lock)
    if (resolved == null || excludedColors?.includes(resolved)) {
      return true;
    }
    onChange(resolved);
    setActiveColorPickerSection("baseColors");
    return true;
  }
  return false;
};

interface ColorPickerKeyNavHandlerProps {
  event: React.KeyboardEvent;
  activeColorPickerSection: ActiveColorPickerSectionAtomType;
  palette: ColorPaletteCustom;
  color: string | null;
  onChange: (color: string) => void;
  customColors: string[];
  presetColors: readonly string[];
  setActiveColorPickerSection: (
    update: React.SetStateAction<ActiveColorPickerSectionAtomType>,
  ) => void;
  updateData: (formData?: any) => void;
  activeShade: number;
  onEyeDropperToggle: (force?: boolean) => void;
  onEscape: (event: React.KeyboardEvent | KeyboardEvent) => void;
  /** 便签纸色变体只有预设 + 明度、无取色入口：取色热键不响应 */
  picksOnly?: boolean;
  excludedColors?: readonly string[];
}

/**
 * @returns true if the event was handled
 */
export const colorPickerKeyNavHandler = ({
  event,
  activeColorPickerSection,
  palette,
  color,
  onChange,
  customColors,
  presetColors,
  setActiveColorPickerSection,
  updateData,
  activeShade,
  onEyeDropperToggle,
  onEscape,
  picksOnly = false,
  excludedColors,
}: ColorPickerKeyNavHandlerProps): boolean => {
  if (event[KEYS.CTRL_OR_CMD]) {
    return false;
  }

  if (event.key === KEYS.ESCAPE) {
    onEscape(event);
    return true;
  }

  // checkt using `key` to ignore combos with Alt modifier
  if (event.key === KEYS.ALT) {
    if (!picksOnly) {
      onEyeDropperToggle(true);
    }
    return true;
  }

  if (event.key === KEYS.I) {
    // picksOnly 变体无取色入口：吞掉按键（外泄会命中画布级 `i` 取色快捷键）
    // 但不唤起取色器
    if (!picksOnly) {
      onEyeDropperToggle();
    }
    return true;
  }

  const colorObj = getColorNameAndShadeFromColor({ color, palette });

  if (event.key === KEYS.TAB) {
    const sectionsMap: Record<
      NonNullable<ActiveColorPickerSectionAtomType>,
      boolean
    > = {
      custom: !!customColors.length,
      baseColors: true,
      shades: colorObj?.shade != null,
      hex: true,
    };

    const sections = Object.entries(sectionsMap).reduce((acc, [key, value]) => {
      if (value) {
        acc.push(key as ActiveColorPickerSectionAtomType);
      }
      return acc;
    }, [] as ActiveColorPickerSectionAtomType[]);

    const activeSectionIndex = sections.indexOf(activeColorPickerSection);
    const indexOffset = event.shiftKey ? -1 : 1;
    const nextSectionIndex =
      activeSectionIndex + indexOffset > sections.length - 1
        ? 0
        : activeSectionIndex + indexOffset < 0
        ? sections.length - 1
        : activeSectionIndex + indexOffset;

    const nextSection = sections[nextSectionIndex];

    if (nextSection) {
      setActiveColorPickerSection(nextSection);
    }

    if (nextSection === "custom") {
      onChange(customColors[0]);
    } else if (nextSection === "baseColors") {
      if (picksOnly) {
        // 当前色不在预设行时，Tab 进入预设区落到首个预设
        if (color == null || !presetColors.includes(color)) {
          onChange(presetColors[0]);
        }
      } else if (!colorObj) {
        // 当前色不在调色板时，Tab 进入色板区落到黑色（与上游一致）
        onChange(COLOR_PALETTE.black);
      }
    }

    event.preventDefault();
    event.stopPropagation();

    return true;
  }

  if (
    hotkeyHandler({
      e: event,
      colorObj,
      onChange,
      palette,
      customColors,
      presetColors,
      setActiveColorPickerSection,
      activeShade,
      picksOnly,
      excludedColors,
    })
  ) {
    return true;
  }

  if (activeColorPickerSection === "shades") {
    if (colorObj) {
      const { shade } = colorObj;
      const newShade = arrowHandler(event.key, shade, COLORS_PER_ROW);

      if (newShade !== undefined) {
        onChange(palette[colorObj.colorName][newShade]);
        return true;
      }
    }
  }

  if (activeColorPickerSection === "baseColors") {
    if (picksOnly) {
      // 预设行按值导航（当前色不在预设内时方向键不动）
      const currentIndex = color != null ? presetColors.indexOf(color) : -1;

      if (currentIndex !== -1) {
        const newIndex = arrowHandler(
          event.key,
          currentIndex,
          presetColors.length,
          PRESET_COLORS_PER_ROW,
        );

        if (newIndex !== undefined) {
          onChange(presetColors[newIndex]);
          return true;
        }
      }
    } else if (colorObj) {
      const { colorName } = colorObj;
      const colorNames = Object.keys(palette);
      const indexOfColorName = colorNames.indexOf(colorName);

      let newColorIndex = arrowHandler(
        event.key,
        indexOfColorName,
        colorNames.length,
      );

      // step over excluded (hidden) palette entries, continuing in the
      // arrow's direction
      let guard = 0;
      while (newColorIndex !== undefined && guard++ < colorNames.length) {
        const value = palette[colorNames[newColorIndex]];
        const resolved = Array.isArray(value) ? value[activeShade] : value;
        if (!excludedColors?.includes(resolved)) {
          break;
        }
        newColorIndex = arrowHandler(
          event.key,
          newColorIndex,
          colorNames.length,
        );
      }

      if (newColorIndex !== undefined) {
        const newColorNameValue = palette[colorNames[newColorIndex]];

        onChange(
          Array.isArray(newColorNameValue)
            ? newColorNameValue[activeShade]
            : newColorNameValue,
        );
        return true;
      }
    }
  }

  if (activeColorPickerSection === "custom") {
    const indexOfColor = color != null ? customColors.indexOf(color) : 0;

    const newColorIndex = arrowHandler(
      event.key,
      indexOfColor,
      customColors.length,
    );

    if (newColorIndex !== undefined) {
      const newColor = customColors[newColorIndex];
      onChange(newColor);
      return true;
    }
  }

  return false;
};
