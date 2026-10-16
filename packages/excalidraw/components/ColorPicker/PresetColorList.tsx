import clsx from "clsx";
import { useEffect, useRef } from "react";

import { useAtom } from "../../editor-jotai";
import { t } from "../../i18n";

import HotkeyLabel from "./HotkeyLabel";
import {
  activeColorPickerSectionAtom,
  colorPickerHotkeyBindings,
} from "./colorPickerUtils";

interface PresetColorListProps {
  /** 预设行色板（仅便签纸色 picksOnly 变体渲染：六色纸单行） */
  colors: readonly string[];
  color: string | null;
  onChange: (color: string) => void;
  showHotKey?: boolean;
}

/**
 * 便签纸色 picksOnly 变体的预设行：单行平铺（最多一行），快捷键
 * q/w/e/r/t/a… 按位绑定（超出行列的绑定键在弹层内为空键，不外泄到全局
 * 快捷键——见 keyboardNavHandlers）。当前色高亮按值匹配（预设不经 palette
 * 明度解析）。
 *
 * 纸色是「表面色」：预览始终显示真实纸色，深色主题下**不**走
 * `applyDarkModeFilter`——否则六色纸会被压到同一明度带，且灰色纸滤镜后与
 * 弹层底色重合而隐形。画布上的便签仍按深色滤镜渲染，故预览与画布观感有意
 * 保留差异。其余变体的基础色区是全色板网格（PickerColorList）。
 */
export const PresetColorList = ({
  colors,
  color,
  onChange,
  showHotKey = true,
}: PresetColorListProps) => {
  const [activeColorPickerSection, setActiveColorPickerSection] = useAtom(
    activeColorPickerSectionAtom,
  );

  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (btnRef.current && activeColorPickerSection === "baseColors") {
      btnRef.current.focus();
    }
  }, [color, activeColorPickerSection]);

  return (
    <div
      className="color-picker-content--default color-picker-content--presets"
      role="radiogroup"
      aria-label={t("colorPicker.colors")}
    >
      {colors.map((preset, index) => {
        const keybinding = colorPickerHotkeyBindings[index] as
          | string
          | undefined;

        return (
          <button
            ref={color === preset ? btnRef : undefined}
            tabIndex={-1}
            type="button"
            className={clsx(
              "color-picker__button color-picker__button--large",
              {
                active: color === preset,
                "is-transparent": preset === "transparent" || !preset,
              },
            )}
            onClick={() => {
              onChange(preset);
              setActiveColorPickerSection("baseColors");
            }}
            title={
              keybinding ? `${preset} — ${keybinding.toUpperCase()}` : preset
            }
            aria-label={keybinding ? `${preset} — ${keybinding}` : preset}
            aria-keyshortcuts={keybinding}
            style={{ "--swatch-color": preset }}
            data-testid={`color-preset-${index}`}
            key={preset}
          >
            <div className="color-picker__button-outline" />
            {showHotKey && keybinding && (
              <HotkeyLabel color={preset} keyLabel={keybinding} />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default PresetColorList;
