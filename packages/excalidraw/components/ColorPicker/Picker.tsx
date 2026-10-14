import React, { useEffect, useImperativeHandle, useState } from "react";

import { EVENT } from "@excalidraw/common";

import {
  DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX,
  DEFAULT_ELEMENT_STROKE_COLOR_INDEX,
  KEYS,
} from "@excalidraw/common";

import type { ExcalidrawElement, Theme } from "@excalidraw/element/types";

import type { ColorPaletteCustom } from "@excalidraw/common";

import { useAtom } from "../../editor-jotai";
import { t } from "../../i18n";

import { CustomColorList } from "./CustomColorList";
import PickerColorList from "./PickerColorList";
import PresetColorList from "./PresetColorList";
import PickerHeading from "./PickerHeading";
import { ShadeList } from "./ShadeList";
import {
  activeColorPickerSectionAtom,
  getColorNameAndShadeFromColor,
  getMostUsedCustomColors,
  isCustomColor,
} from "./colorPickerUtils";
import { colorPickerKeyNavHandler } from "./keyboardNavHandlers";
import { useColorPickerDnD } from "./topPicksDnD";

import type { ColorPickerType } from "./colorPickerUtils";

interface PickerProps {
  theme: Theme;
  color: string | null;
  onChange: (color: string) => void;
  type: ColorPickerType;
  elements: readonly ExcalidrawElement[];
  palette: ColorPaletteCustom;
  /** 弹层预设行（便签纸色 picksOnly 变体的单行色板） */
  presetColors: readonly string[];
  /** palette colors to hide from the popup, keeping hotkey positions */
  excludedColors?: readonly string[];
  updateData: (formData?: any) => void;
  children?: React.ReactNode;
  showTitle?: boolean;
  /** 弹层小标题的场景名（紧凑态触发器只有色块，标题是唯一的控件说明）。
   * 缺省按 type 取通用名（描边 / 背景），无通用名的 type 不显示标题 */
  popupTitle?: string;
  onEyeDropperToggle: (force?: boolean) => void;
  onEscape: (event: React.KeyboardEvent | KeyboardEvent) => void;
  showHotKey?: boolean;
  /** 便签纸色变体：只渲染预设 + 明度（无自定义、无色值输入/取色） */
  picksOnly?: boolean;
}

export const Picker = React.forwardRef(
  (
    {
      theme,
      color,
      onChange,
      type,
      elements,
      palette,
      presetColors,
      excludedColors,
      updateData,
      children,
      showTitle,
      popupTitle,
      onEyeDropperToggle,
      onEscape,
      showHotKey = true,
      picksOnly = false,
    }: PickerProps,
    ref,
  ) => {
    const title = showTitle
      ? popupTitle ??
        (type === "elementStroke"
          ? t("labels.stroke")
          : type === "elementBackground"
          ? t("labels.background")
          : null)
      : null;

    const [customColors] = React.useState(() => {
      if (type === "canvasBackground" || picksOnly) {
        return [];
      }
      // the table grid and mindmap edge pickers sample the stroke-color domain
      return getMostUsedCustomColors(
        elements,
        type === "tableGrid" || type === "mindmapEdgeColor"
          ? "elementStroke"
          : type,
        palette,
        presetColors,
      );
    });

    const [activeColorPickerSection, setActiveColorPickerSection] = useAtom(
      activeColorPickerSectionAtom,
    );
    const dnd = useColorPickerDnD();

    const colorObj = getColorNameAndShadeFromColor({
      color,
      palette,
    });

    useEffect(() => {
      if (!activeColorPickerSection) {
        // 预设色按「基础色」对待（不是自定义色）
        const isCustom =
          !!color && isCustomColor({ color, palette, presetColors });
        const isCustomButNotInList = isCustom && !customColors.includes(color);

        setActiveColorPickerSection(
          isCustomButNotInList
            ? null
            : isCustom
            ? "custom"
            : colorObj?.shade != null
            ? "shades"
            : "baseColors",
        );
      }
    }, [
      activeColorPickerSection,
      color,
      palette,
      presetColors,
      setActiveColorPickerSection,
      colorObj,
      customColors,
    ]);

    const [activeShade, setActiveShade] = useState(
      colorObj?.shade ??
        (type === "elementBackground"
          ? DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX
          : DEFAULT_ELEMENT_STROKE_COLOR_INDEX),
    );

    useEffect(() => {
      if (colorObj?.shade != null) {
        setActiveShade(colorObj.shade);
      }

      const keyup = (event: KeyboardEvent) => {
        if (event.key === KEYS.ALT) {
          onEyeDropperToggle(false);
        }
      };
      document.addEventListener(EVENT.KEYUP, keyup, { capture: true });
      return () => {
        document.removeEventListener(EVENT.KEYUP, keyup, { capture: true });
      };
    }, [colorObj, onEyeDropperToggle]);
    const pickerRef = React.useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => pickerRef.current!);

    useEffect(() => {
      pickerRef?.current?.focus();
    }, []);

    return (
      <div role="dialog" aria-modal="true" aria-label={t("labels.colorPicker")}>
        <div
          ref={pickerRef}
          onKeyDown={(event) => {
            const handled = colorPickerKeyNavHandler({
              event,
              activeColorPickerSection,
              palette,
              color,
              onChange,
              onEyeDropperToggle,
              customColors,
              presetColors,
              setActiveColorPickerSection,
              updateData,
              activeShade,
              onEscape,
              picksOnly,
              excludedColors,
            });

            if (handled) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          className="color-picker-content properties-content"
          // to allow focusing by clicking but not by tabbing
          tabIndex={-1}
        >
          {title && <div className="color-picker__title">{title}</div>}

          {/* 弹层结构（设计稿）：色板（全色板网格 5×3）→ 明度（5，随当前色）→
              自定义 → 色值；便签纸色 picksOnly 变体为六色纸预设行（无小标题）+
              明度 */}
          {picksOnly ? (
            <PresetColorList
              theme={theme}
              colors={presetColors}
              color={color}
              onChange={onChange}
              showHotKey={showHotKey}
            />
          ) : (
            <div>
              <PickerHeading>{t("colorPicker.colors")}</PickerHeading>
              <PickerColorList
                theme={theme}
                color={color}
                palette={palette}
                onChange={onChange}
                activeShade={activeShade}
                showHotKey={showHotKey}
                excludedColors={excludedColors}
              />
            </div>
          )}

          <div>
            <PickerHeading>{t("colorPicker.shades")}</PickerHeading>
            <ShadeList
              theme={theme}
              color={color}
              onChange={onChange}
              palette={palette}
              showHotKey={showHotKey}
            />
          </div>

          {!!customColors.length && (
            <div>
              <PickerHeading>
                {t("colorPicker.mostUsedCustomColors")}
              </PickerHeading>
              <CustomColorList
                theme={theme}
                colors={customColors}
                color={color}
                label={t("colorPicker.mostUsedCustomColors")}
                onChange={onChange}
              />
            </div>
          )}

          {children}
          {/* dnd context is only provided when top picks are customizable */}
          {dnd && (
            <div className="color-picker__tip">
              {t("colorPicker.topPicksTip")}
            </div>
          )}
        </div>
      </div>
    );
  },
);
