import clsx from "clsx";
import React, { useState } from "react";

import { isArrowKey, KEYS } from "@excalidraw/common";

import { getLanguage } from "../i18n";

import Collapsible from "./Stats/Collapsible";
import { markPropertiesPopoverEscClose } from "./PropertiesPopover";

import "./IconPicker.scss";

import type { JSX } from "react";

const PICKER_COLUMNS = 4;

export type IconGridOption<T> = {
  value: T;
  text: string;
  icon: JSX.Element;
  keyBinding: string | null;
};

export const findIconOption = <T,>(
  options: readonly IconGridOption<T>[],
  predicate: (option: IconGridOption<T>) => boolean,
) => options.find(predicate) ?? null;

const getNavigationRows = <T,>(
  sections: readonly (readonly IconGridOption<T>[])[],
) =>
  sections.flatMap((options) =>
    Array.from(
      { length: Math.ceil(options.length / PICKER_COLUMNS) },
      (_, index) =>
        options.slice(
          index * PICKER_COLUMNS,
          index * PICKER_COLUMNS + PICKER_COLUMNS,
        ),
    ),
  );

// 折叠态记忆（设计稿：关系型端点默认折叠、展开后刷新仍记忆）——localStorage 持久化
const readCollapseMemory = (key: string): boolean | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as boolean);
  } catch {
    return null;
  }
};

const writeCollapseMemory = (key: string, open: boolean) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(open));
  } catch {
    // localStorage 不可用（隐私模式等）时降级为会话内状态
  }
};

/**
 * 端点库网格（设计稿「箭头端点库」）：常用选项 4 列网格 + 折叠区
 * （默认折叠，记忆态经 localStorage 持久化；当前值落在折叠区时强制展开，
 * 保持当前值可见）。内联在属性弹层内（弹层内不再开弹层）。
 *
 * 快捷键与旧版一致：字母键直接选中、Tab 循环、方向键按行导航、
 * Esc/Enter 关闭所在弹层。
 */
export function IconOptionGrid<T>({
  label,
  value,
  commonOptions,
  commonLabel,
  collapsibleOptions = [],
  collapsibleLabel,
  collapsePersistKey,
  onChange,
  onClose,
}: {
  label: string;
  value: T;
  commonOptions: readonly IconGridOption<T>[];
  commonLabel?: string;
  collapsibleOptions?: readonly IconGridOption<T>[];
  collapsibleLabel?: string;
  collapsePersistKey?: string;
  onChange: (value: T) => void;
  onClose: () => void;
}) {
  const allOptions = [...commonOptions, ...collapsibleOptions];
  const valueInCollapsible = collapsibleOptions.some(
    (option) => option.value === value,
  );
  const [storedOpen, setStoredOpen] = useState<boolean | null>(() =>
    collapsePersistKey ? readCollapseMemory(collapsePersistKey) : null,
  );
  const showCollapsible = valueInCollapsible || storedOpen === true;

  const navigationRows = getNavigationRows([
    commonOptions,
    ...(showCollapsible ? [collapsibleOptions] : []),
  ]);

  const toggleCollapsible = () => {
    const next = !showCollapsible;
    setStoredOpen(next);
    if (collapsePersistKey) {
      writeCollapseMemory(collapsePersistKey, next);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const pressedOption = allOptions.find(
      (option) => option.keyBinding === event.key.toLowerCase(),
    );

    if (!(event.metaKey || event.altKey || event.ctrlKey) && pressedOption) {
      // Keybinding navigation
      onChange(pressedOption.value);

      event.preventDefault();
    } else if (event.key === KEYS.TAB) {
      const index = allOptions.findIndex((option) => option.value === value);
      const nextIndex = event.shiftKey
        ? (allOptions.length + index - 1) % allOptions.length
        : (index + 1) % allOptions.length;
      onChange(allOptions[nextIndex].value);
    } else if (isArrowKey(event.key)) {
      // Arrow navigation
      const isRTL = getLanguage().rtl;
      const index = allOptions.findIndex((option) => option.value === value);
      if (index !== -1) {
        const length = allOptions.length;
        let nextIndex = index;

        switch (event.key) {
          // Select the next option
          case isRTL ? KEYS.ARROW_LEFT : KEYS.ARROW_RIGHT:
            nextIndex = (index + 1) % length;
            break;
          // Select the previous option
          case isRTL ? KEYS.ARROW_RIGHT : KEYS.ARROW_LEFT:
            nextIndex = (length + index - 1) % length;
            break;
          // Go the next row
          case KEYS.ARROW_DOWN: {
            const currentRowIndex = navigationRows.findIndex((row) =>
              row.some((option) => option.value === value),
            );
            const currentRow = navigationRows[currentRowIndex];

            if (currentRowIndex !== -1 && currentRow) {
              const column = currentRow.findIndex(
                (option) => option.value === value,
              );
              const nextRow =
                navigationRows[(currentRowIndex + 1) % navigationRows.length];
              const nextOption =
                nextRow[Math.min(column, nextRow.length - 1)] ??
                allOptions[index];

              onChange(nextOption.value);
              event.preventDefault();
              event.nativeEvent.stopImmediatePropagation();
              event.stopPropagation();
              return;
            }
            break;
          }
          // Go the previous row
          case KEYS.ARROW_UP: {
            const currentRowIndex = navigationRows.findIndex((row) =>
              row.some((option) => option.value === value),
            );
            const currentRow = navigationRows[currentRowIndex];

            if (currentRowIndex !== -1 && currentRow) {
              const column = currentRow.findIndex(
                (option) => option.value === value,
              );
              const previousRow =
                navigationRows[
                  (navigationRows.length + currentRowIndex - 1) %
                    navigationRows.length
                ];
              const previousOption =
                previousRow[Math.min(column, previousRow.length - 1)] ??
                allOptions[index];

              onChange(previousOption.value);
              event.preventDefault();
              event.nativeEvent.stopImmediatePropagation();
              event.stopPropagation();
              return;
            }
            break;
          }
        }

        onChange(allOptions[nextIndex].value);
      }
      event.preventDefault();
    } else if (event.key === KEYS.ESCAPE || event.key === KEYS.ENTER) {
      // Close on escape or enter（Esc 关闭焦点回弹层触发器）
      event.preventDefault();
      if (event.key === KEYS.ESCAPE) {
        markPropertiesPopoverEscClose();
      }
      onClose();
    }
    // 弹层内键盘捕获：按键不外泄到画布全局快捷键
    event.nativeEvent.stopImmediatePropagation();
    event.stopPropagation();
  };

  const renderOption = (option: IconGridOption<T>) => (
    <button
      type="button"
      className={clsx("headgrid__option", {
        "is-on": value === option.value,
      })}
      onClick={() => {
        onChange(option.value);
      }}
      title={
        option.keyBinding
          ? `${option.text} — ${option.keyBinding.toUpperCase()}`
          : option.text
      }
      aria-label={option.text || "none"}
      aria-keyshortcuts={option.keyBinding || undefined}
      key={option.text}
      ref={(ref) => {
        if (value === option.value) {
          // Use a timeout here to render focus properly
          setTimeout(() => {
            ref?.focus();
          }, 0);
        }
      }}
    >
      {option.icon}
      {option.keyBinding && (
        <span className="picker-keybinding">{option.keyBinding}</span>
      )}
    </button>
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="icon-option-grid"
      role="group"
      aria-label={label}
      onKeyDown={handleKeyDown}
    >
      {commonLabel && <div className="tb-sub">{commonLabel}</div>}
      <div className="headgrid">{commonOptions.map(renderOption)}</div>
      {collapsibleOptions.length > 0 && collapsibleLabel && (
        <Collapsible
          label={collapsibleLabel}
          open={showCollapsible}
          openTrigger={toggleCollapsible}
          className="picker-collapsible icon-option-grid__collapsible"
        >
          <div className="headgrid">{collapsibleOptions.map(renderOption)}</div>
        </Collapsible>
      )}
    </div>
  );
}
