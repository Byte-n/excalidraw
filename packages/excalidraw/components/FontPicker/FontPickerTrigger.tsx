import { Popover } from "radix-ui";

import type { FontFamilyValues } from "@excalidraw/element/types";

import { t } from "../../i18n";
import { IconButton } from "../IconButton";
import { TextIcon } from "../icons";

import { useExcalidrawSetAppState, useStylesPanelMode } from "../App";

interface FontPickerTriggerProps {
  selectedFontFamily: FontFamilyValues | null;
  isOpened?: boolean;
  compactMode?: boolean;
}

export const FontPickerTrigger = ({
  selectedFontFamily,
  isOpened = false,
  compactMode = false,
}: FontPickerTriggerProps) => {
  const setAppState = useExcalidrawSetAppState();
  const stylesPanelMode = useStylesPanelMode();

  // 手机底部条（tb-bar）图标按钮 38×38：条改实底后磨砂底去除（T5）；
  // 内联尺寸压过 styles.scss 旧 isMobile 规则（button.standalone 32px）。
  // 桌面/平板浮动栏由 toolbar.scss 的 tb-iconbtn 规格统一（28px / 触控 32px）
  const compactStyle =
    compactMode && stylesPanelMode === "mobile"
      ? {
          width: "38px",
          height: "38px",
        }
      : {};

  return (
    <Popover.Trigger asChild>
      <div data-openpopup="fontFamily" className="properties-trigger">
        <IconButton
          type="toggle"
          icon={TextIcon}
          title={t("labels.showFonts")}
          aria-label={t("labels.showFonts")}
          className="standalone properties-trigger"
          data-testid="font-family-show-fonts"
          checked={isOpened}
          onSelect={() => {
            setAppState((appState) => ({
              openPopup:
                appState.openPopup === "fontFamily" ? null : appState.openPopup,
            }));
          }}
          style={{
            border: "none",
            ...compactStyle,
          }}
        />
      </div>
    </Popover.Trigger>
  );
};
