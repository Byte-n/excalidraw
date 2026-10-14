import { Popover } from "radix-ui";
import clsx from "clsx";
import { memo, useRef, useEffect } from "react";

import {
  applyDarkModeFilter,
  COLOR_OUTLINE_CONTRAST_THRESHOLD,
  COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_PICKS,
  DEFAULT_ELEMENT_STROKE_PRESETS,
  isColorDark,
  isWritableElement,
  THEME,
} from "@excalidraw/common";

import type { ColorPaletteCustom } from "@excalidraw/common";

import type { ExcalidrawElement, Theme } from "@excalidraw/element/types";

import { useAtom } from "../../editor-jotai";
import { t } from "../../i18n";
import { useApp, useExcalidrawContainer, useStylesPanelMode } from "../App";
import { ButtonSeparator } from "../ButtonSeparator";
import { activeEyeDropperAtom } from "../EyeDropper";
import {
  PropertiesPopover,
  markPropertiesPopoverEscClose,
} from "../PropertiesPopover";
import { strokeIcon } from "../icons";
import {
  saveCaretPosition,
  restoreCaretPosition,
  temporarilyDisableTextEditorBlur,
} from "../../hooks/useTextEditorFocus";

import { ColorInput } from "./ColorInput";
import { Picker } from "./Picker";
import PickerHeading from "./PickerHeading";
import { TopPicks } from "./TopPicks";
import { activeColorPickerSectionAtom } from "./colorPickerUtils";
import {
  ColorPickerDnDContext,
  useColorPickerDnD,
  useTopPicksDnD,
} from "./topPicksDnD";

import "./ColorPicker.scss";

import type { ColorPickerType } from "./colorPickerUtils";

import type { AppState, UIAppState } from "../../types";

interface ColorPickerProps {
  type: ColorPickerType;
  /**
   * null indicates no color should be displayed as active
   * (e.g. when multiple shapes selected with different colors)
   */
  color: string | null;
  onChange: (color: string) => void;
  label: string;
  elements: readonly ExcalidrawElement[];
  appState: UIAppState;
  palette?: ColorPaletteCustom | null;
  topPicks?: readonly string[];
  /** 弹层预设行（仅便签纸色 picksOnly 变体渲染；其余变体为全色板网格）。
   * 缺省回退到 topPicks 基线（不含用户自定义）；预设色不计入自定义色 */
  presetColors?: readonly string[];
  /** palette colors to hide from the popup, keeping hotkey positions */
  excludedColors?: readonly string[];
  updateData: (formData?: any) => void;
  /** allow users to customize the top picks strip by drag & dropping colors
   * from the picker popup onto it. The value names the
   * `appState.colorTopPicks` slot the customization is stored in */
  customizableTopPicks?: keyof AppState["colorTopPicks"];
  enableEyeDropper?: boolean;
  compact?: boolean;
  /** 便签纸色变体：弹层只有预设 + 明度（无自定义、无色值输入/取色） */
  picksOnly?: boolean;
}

const ColorPickerPopupContent = ({
  type,
  color,
  onChange,
  label,
  elements,
  palette = COLOR_PALETTE,
  presetColors,
  excludedColors,
  updateData,
  getOpenPopup,
  appState,
  enableEyeDropper,
  compact,
  picksOnly,
}: Pick<
  ColorPickerProps,
  | "type"
  | "color"
  | "onChange"
  | "label"
  | "elements"
  | "palette"
  | "updateData"
  | "appState"
  | "enableEyeDropper"
  | "compact"
  | "picksOnly"
  | "excludedColors"
> & {
  /** 弹层预设行（调用方已解析为固定基线，见 effectivePresetColors） */
  presetColors: readonly string[];
  getOpenPopup: () => AppState["openPopup"];
}) => {
  const { container } = useExcalidrawContainer();
  const app = useApp();
  const stylesPanelMode = useStylesPanelMode();
  const isCompactMode = compact || stylesPanelMode !== "full";
  const isMobileMode = stylesPanelMode === "mobile";
  const [, setActiveColorPickerSection] = useAtom(activeColorPickerSectionAtom);

  const [eyeDropperState, setEyeDropperState] = useAtom(activeEyeDropperAtom);

  const colorInputJSX = (
    <div>
      <PickerHeading>{t("colorPicker.hexCode")}</PickerHeading>
      <ColorInput
        color={color || ""}
        label={label}
        onChange={(color) => {
          onChange(color);
        }}
        colorPickerType={type}
        enableEyeDropper={enableEyeDropper}
        placeholder={t("colorPicker.color")}
      />
    </div>
  );

  const colorPickerContentRef = useRef<HTMLDivElement>(null);

  const focusPickerContent = () => {
    colorPickerContentRef.current?.focus();
  };

  return (
    <PropertiesPopover
      container={container}
      label={label}
      // 弹层宽度对齐设计稿（颜色弹层 236px）
      style={{ width: "14.75rem" }}
      // Improve focus handling for text editing scenarios
      preventAutoFocusOnTextEdit={!!appState.editingTextElement}
      onFocusOutside={(event) => {
        const target = event.target;
        // focus moving into the top-picks context menu — let the menu keep
        // it (stealing it back would clear the menu's focus-driven
        // `data-highlighted` styling and break its keyboard navigation)
        if (
          target instanceof app.ownerWindow.HTMLElement &&
          target.closest(".color-picker__context-menu")
        ) {
          event.preventDefault();
          return;
        }
        // refocus due to eye dropper
        if (!isWritableElement(event.target)) {
          if (
            target instanceof app.ownerWindow.HTMLElement &&
            target.matches(":active")
          ) {
            // the focus escaped because a button outside is being pressed
            // (e.g. a top pick) — stealing focus mid-press makes the browser
            // drop the button's activation (`:active` styling), so wait for
            // the release
            app.ownerWindow.addEventListener("pointerup", focusPickerContent, {
              once: true,
            });
          } else {
            focusPickerContent();
          }
        }
        event.preventDefault();
      }}
      onPointerDownOutside={(event) => {
        if (eyeDropperState) {
          // prevent from closing if we click outside the popover
          // while eyedropping (e.g. click when clicking the sidebar;
          // the eye-dropper-backdrop is prevented downstream)
          event.preventDefault();
        }
      }}
      onClose={() => {
        // only clear if we're still the active popup (avoid racing with switch)
        if (getOpenPopup() === type) {
          updateData({ openPopup: null });
        }
        setActiveColorPickerSection(null);

        // Refocus text editor when popover closes if we were editing text
        if (appState.editingTextElement) {
          app.ownerWindow.setTimeout(() => {
            const textEditor = app.ownerDocument.querySelector(
              ".excalidraw-wysiwyg",
            ) as HTMLTextAreaElement;
            if (textEditor) {
              textEditor.focus();
            }
          }, 0);
        }
      }}
    >
      {palette ? (
        <Picker
          ref={colorPickerContentRef}
          palette={palette}
          presetColors={presetColors}
          excludedColors={excludedColors}
          color={color}
          theme={appState.theme}
          onChange={(changedColor) => {
            // Save caret position before color change if editing text
            const savedSelection = appState.editingTextElement
              ? saveCaretPosition(app.ownerDocument)
              : null;

            onChange(changedColor);

            // Restore caret position after color change if editing text
            if (appState.editingTextElement && savedSelection) {
              restoreCaretPosition(savedSelection, app.ownerDocument);
            }
          }}
          onEyeDropperToggle={(force) => {
            if (!enableEyeDropper) {
              return;
            }
            setEyeDropperState((state) => {
              if (force) {
                state = state || {
                  keepOpenOnAlt: true,
                  onSelect: onChange,
                  colorPickerType: type,
                };
                state.keepOpenOnAlt = true;
                return state;
              }

              return force === false || state
                ? null
                : {
                    keepOpenOnAlt: false,
                    onSelect: onChange,
                    colorPickerType: type,
                  };
            });
          }}
          onEscape={(event) => {
            if (eyeDropperState) {
              setEyeDropperState(null);
            } else {
              // close explicitly on Escape（标记 Esc 关闭，焦点回触发器）
              markPropertiesPopoverEscClose();
              updateData({ openPopup: null });
            }
          }}
          type={type}
          elements={elements}
          updateData={updateData}
          showTitle={isCompactMode}
          showHotKey={!isMobileMode}
          picksOnly={picksOnly}
        >
          {picksOnly ? null : colorInputJSX}
        </Picker>
      ) : (
        colorInputJSX
      )}
    </PropertiesPopover>
  );
};

const isColorPickerPopup = (
  popup: AppState["openPopup"],
): popup is ColorPickerType =>
  popup === "elementStroke" ||
  popup === "elementBackground" ||
  popup === "canvasBackground" ||
  popup === "mindmapEdgeColor" ||
  popup === "tableGrid";

const ColorPickerTrigger = ({
  label,
  color,
  type,
  theme,
  mode = "background",
  onToggle,
  editingTextElement,
  compact,
}: {
  color: string | null;
  label: string;
  type: ColorPickerType;
  theme: Theme;
  mode?: "background" | "stroke";
  onToggle: () => void;
  editingTextElement?: boolean;
  compact?: boolean;
}) => {
  const app = useApp();
  const stylesPanelMode = useStylesPanelMode();
  const isCompactMode = compact || stylesPanelMode !== "full";
  const isMobileMode = stylesPanelMode === "mobile";
  const dnd = useColorPickerDnD();
  const displayColor = color
    ? applyDarkModeFilter(color, theme === THEME.DARK)
    : null;
  const handleClick = (e: React.MouseEvent) => {
    // use pointerdown so we run before outside-close logic
    e.preventDefault();
    e.stopPropagation();

    // If editing text, temporarily disable the wysiwyg blur event
    if (editingTextElement) {
      temporarilyDisableTextEditorBlur(app.ownerDocument);
    }

    onToggle();
  };

  return (
    <Popover.Trigger
      type="button"
      className={clsx("color-picker__button properties-trigger", {
        // null = 多值（多选属性不一致）→ 虚线斜分；transparent → 红斜线
        "is-transparent": color === "transparent",
        "is-mix": color === null,
        "compact-sizing": isCompactMode,
        "mobile-border": isMobileMode,
      })}
      aria-label={label}
      style={displayColor ? { "--swatch-color": displayColor } : undefined}
      title={
        type === "elementStroke" ||
        type === "tableGrid" ||
        type === "mindmapEdgeColor"
          ? t("labels.showStroke")
          : t("labels.showBackground")
      }
      data-openpopup={type}
      onClick={handleClick}
      // the trigger swatch can be dragged onto the top-picks strip to
      // pin the current (possibly custom) color
      onPointerDown={
        dnd ? (event) => dnd.startSwatchDrag(event, color) : undefined
      }
    >
      <div className="color-picker__button-outline" />
      {isCompactMode && color && mode === "stroke" && (
        <div className="color-picker__button-background">
          <span
            style={{
              color:
                displayColor &&
                isColorDark(displayColor, COLOR_OUTLINE_CONTRAST_THRESHOLD)
                  ? "#fff"
                  : "#111",
            }}
          >
            {strokeIcon}
          </span>
        </div>
      )}
    </Popover.Trigger>
  );
};

const ColorPickerComponent = ({
  type,
  color,
  onChange,
  label,
  elements,
  palette = COLOR_PALETTE,
  topPicks,
  presetColors,
  excludedColors,
  updateData,
  appState,
  customizableTopPicks,
  enableEyeDropper = true,
  compact = false,
  picksOnly = false,
}: ColorPickerProps) => {
  const openRef = useRef(appState.openPopup);
  useEffect(() => {
    openRef.current = appState.openPopup;
  }, [appState.openPopup]);
  const stylesPanelMode = useStylesPanelMode();
  const isCompactMode = compact || stylesPanelMode !== "full";

  const isTopPicksCustomizable = !!customizableTopPicks && !isCompactMode;

  // user-pinned picks trump the (host-provided or default) baseline
  const customTopPicks =
    isTopPicksCustomizable && customizableTopPicks
      ? appState.colorTopPicks?.[customizableTopPicks]
      : null;

  // fully-resolved picks currently displayed in the strip — the baseline the
  // drag & drop customization starts from
  const effectiveTopPicks = customTopPicks?.length
    ? customTopPicks
    : topPicks ??
      (type === "elementStroke"
        ? DEFAULT_ELEMENT_STROKE_PICKS
        : DEFAULT_ELEMENT_BACKGROUND_PICKS);

  // 弹层预设行：固定基线（描边域六色 / 其余域同既有 picks），
  // 不随用户自定义快捷色板变化；仅 picksOnly 变体渲染它，其余变体据此
  // 排除「最常用自定义色」中的预设色
  const effectivePresetColors =
    presetColors ??
    topPicks ??
    (type === "elementBackground" || type === "canvasBackground"
      ? DEFAULT_ELEMENT_BACKGROUND_PICKS
      : DEFAULT_ELEMENT_STROKE_PRESETS);

  const dnd = useTopPicksDnD({
    enabled: isTopPicksCustomizable,
    picks: effectiveTopPicks,
    onPicksChange: (picks) => {
      if (!customizableTopPicks) {
        return;
      }
      // NOTE the comparator comparing `appState.colorTopPicks` is what keeps
      // this captured spread fresh — see `areColorPickerPropsEqual`
      updateData({
        colorTopPicks: {
          ...appState.colorTopPicks,
          [customizableTopPicks]: picks,
        },
      });
    },
  });

  return (
    <ColorPickerDnDContext.Provider value={isTopPicksCustomizable ? dnd : null}>
      <div
        role="dialog"
        aria-modal="true"
        className={clsx("color-picker-container", {
          "color-picker-container--no-top-picks": isCompactMode,
        })}
      >
        {!isCompactMode && (
          <TopPicks
            theme={appState.theme}
            activeColor={color}
            onChange={(pickedColor) => {
              onChange(pickedColor);
              // if another color-picker popup is open, follow the user's
              // focus over to this picker (same as clicking its trigger)
              if (
                isColorPickerPopup(appState.openPopup) &&
                appState.openPopup !== type
              ) {
                // deferred: each updateData spreads the full pre-commit
                // appState, so issuing this in the same task would clobber
                // the color change committed by `onChange` above
                setTimeout(() => updateData({ openPopup: type }), 0);
              }
            }}
            type={type}
            topPicks={customTopPicks?.length ? customTopPicks : topPicks}
            isCustomized={!!customTopPicks?.length}
            onReset={
              isTopPicksCustomizable && customizableTopPicks
                ? () => {
                    updateData({
                      colorTopPicks: {
                        ...appState.colorTopPicks,
                        [customizableTopPicks]: null,
                      },
                    });
                  }
                : undefined
            }
          />
        )}
        {!isCompactMode && <ButtonSeparator />}
        <Popover.Root
          open={appState.openPopup === type}
          onOpenChange={(open) => {
            if (open) {
              updateData({ openPopup: type });
            }
          }}
        >
          {/* serves as an active color indicator as well */}
          <ColorPickerTrigger
            color={color}
            label={label}
            type={type}
            theme={appState.theme}
            mode={
              type === "elementStroke" ||
              type === "tableGrid" ||
              type === "mindmapEdgeColor"
                ? "stroke"
                : "background"
            }
            editingTextElement={!!appState.editingTextElement}
            compact={compact}
            onToggle={() => {
              // atomic switch: if another popup is open, close it first, then open this one next tick
              if (appState.openPopup === type) {
                // toggle off on same trigger
                updateData({ openPopup: null });
              } else if (appState.openPopup) {
                updateData({ openPopup: type });
              } else {
                // open this one
                updateData({ openPopup: type });
              }
            }}
          />
          {/* popup content */}
          {appState.openPopup === type && (
            <ColorPickerPopupContent
              type={type}
              color={color}
              onChange={onChange}
              label={label}
              elements={elements}
              palette={palette}
              presetColors={effectivePresetColors}
              excludedColors={excludedColors}
              enableEyeDropper={enableEyeDropper}
              compact={compact}
              picksOnly={picksOnly}
              updateData={updateData}
              getOpenPopup={() => openRef.current}
              appState={appState}
            />
          )}
        </Popover.Root>
      </div>
    </ColorPickerDnDContext.Provider>
  );
};

/**
 * ColorPicker renders on every styles-panel render (selection churn during
 * box-select and the like), while its actual inputs are a handful of resolved
 * primitives and reference-stable objects — cheap `===` checks, no deep
 * comparisons:
 * - `palette` / `topPicks` / `presetColors` / `excludedColors` are module
 *   constants,
 * - `appState.colorTopPicks` identity changes exactly when its content does.
 *
 * Function props (`onChange`, `updateData`) are deliberately ignored — they
 * are recreated every render but semantically stable (they read fresh state
 * at call time). Same for `elements`, which is only sampled once when the
 * popup opens (most-used custom colors).
 */
const areColorPickerPropsEqual = (
  prev: ColorPickerProps,
  next: ColorPickerProps,
) => {
  // the open popup is interactive (hotkeys, eye dropper, most-used custom
  // colors) — never memoize it, including the open/close transitions
  if (
    prev.appState.openPopup === prev.type ||
    next.appState.openPopup === next.type
  ) {
    return false;
  }
  return (
    prev.type === next.type &&
    prev.color === next.color &&
    prev.label === next.label &&
    // popup open/close is rare, and the strip's click handler branches on
    // which popup is open (popup-switching) — keep its closure fresh
    prev.appState.openPopup === next.appState.openPopup &&
    prev.palette === next.palette &&
    prev.topPicks === next.topPicks &&
    prev.presetColors === next.presetColors &&
    prev.excludedColors === next.excludedColors &&
    prev.customizableTopPicks === next.customizableTopPicks &&
    prev.enableEyeDropper === next.enableEyeDropper &&
    prev.compact === next.compact &&
    prev.picksOnly === next.picksOnly &&
    prev.appState.theme === next.appState.theme &&
    prev.appState.colorTopPicks === next.appState.colorTopPicks &&
    // the trigger tweaks its click behavior while a text element is edited
    !!prev.appState.editingTextElement === !!next.appState.editingTextElement
  );
};

export const ColorPicker = memo(ColorPickerComponent, areColorPickerPropsEqual);
