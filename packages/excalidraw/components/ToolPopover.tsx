import React, { useEffect, useState } from "react";
import clsx from "clsx";

import { capitalizeString } from "@excalidraw/common";

import { Popover } from "radix-ui";

import { trackEvent } from "../analytics";

import { IconButton } from "./IconButton";
import { isToolButtonDisabled } from "./Tools";

import "./ToolPopover.scss";

import { useExcalidrawContainer } from "./App";

import type { AppClassProperties, ToolType } from "../types";

type ToolOption = {
  type: string;
  icon: React.ReactNode;
  title: string;
  fillable?: boolean;
};

type ToolPopoverProps = {
  app: AppClassProperties;
  options: readonly ToolOption[];
  activeTool: { type: string };
  activeOptionType?: string;
  defaultOption: string;
  "data-testid": string;
  onToolChange: (type: string) => void;
  displayedOption: ToolOption;
  keyBindingLabel?: string | null;
  ariaKeyshortcuts?: string;
  shortcut?: string | null;
  /**
   * 组内选项共享的工具类型（缺省 = 各选项自己的 `type`）：选项是样式而非
   * 工具时用它 —— 无论选哪条，激活的都是同一个工具。
   */
  sharedToolType?: ToolType;
  /** 触发按钮的高亮条件；缺省为「显示项即当前项」（工具组语义） */
  isTriggerChecked?: boolean;
  /**
   * 触发按钮的按下钩子。工具栏里可从按钮拖出元素的工具在这里起手
   * （见 `AppToolDrag`），按下即武装、原地松开仍算一次点击。
   */
  onTriggerPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

export const ToolPopover = ({
  app,
  options,
  activeTool,
  activeOptionType,
  defaultOption,
  "data-testid": dataTestId,
  onToolChange,
  displayedOption,
  keyBindingLabel,
  ariaKeyshortcuts,
  shortcut,
  sharedToolType,
  isTriggerChecked,
  onTriggerPointerDown,
}: ToolPopoverProps) => {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const currentType = activeOptionType ?? activeTool.type;
  const isActive = isTriggerChecked ?? displayedOption.type === currentType;
  const SIDE_OFFSET = 16;
  const { container } = useExcalidrawContainer();

  /** 选项标识之外，该选项实际激活的工具（见 `sharedToolType`） */
  const optionToolType = (type: string) => sharedToolType ?? type;

  // if the active tool left the group, close the popup
  if (
    !options.some(
      (option) => optionToolType(option.type) === activeTool.type,
    ) &&
    isPopupOpen
  ) {
    setIsPopupOpen(false);
  }

  // Close popover when user starts interacting with the canvas (pointer down)
  useEffect(() => {
    // app.onPointerDownEmitter emits when pointer down happens on canvas area
    const unsubscribe = app.onPointerDownEmitter.on(() => {
      setIsPopupOpen(false);
    });
    return () => unsubscribe?.();
  }, [app]);

  return (
    <Popover.Root open={isPopupOpen}>
      <Popover.Trigger asChild>
        <IconButton
          className={clsx({ fillable: displayedOption.fillable })}
          type="toggle"
          icon={displayedOption.icon}
          checked={isActive}
          disabled={options.every((option) =>
            isToolButtonDisabled(app, optionToolType(option.type)),
          )}
          title={`${capitalizeString(displayedOption.title)}${
            shortcut ? ` — ${shortcut}` : ""
          }`}
          aria-label={capitalizeString(displayedOption.title)}
          aria-keyshortcuts={ariaKeyshortcuts}
          keyBindingLabel={keyBindingLabel}
          data-testid={dataTestId}
          onPointerDown={onTriggerPointerDown}
          onSelect={() => {
            setIsPopupOpen((v) => !v);
            onToolChange(defaultOption);
          }}
        />
      </Popover.Trigger>

      <Popover.Content
        className="tool-popover-content"
        sideOffset={SIDE_OFFSET}
        collisionBoundary={container ?? undefined}
      >
        {options.map(({ type, icon, title, fillable }) => (
          <IconButton
            className={clsx({ fillable })}
            key={type}
            type="toggle"
            icon={icon}
            checked={currentType === type}
            disabled={isToolButtonDisabled(app, optionToolType(type))}
            title={capitalizeString(title)}
            aria-label={capitalizeString(title)}
            data-testid={`toolbar-${type}`}
            onSelect={() => {
              if (currentType !== type) {
                trackEvent("toolbar", type, "ui");
                // 选项标识不一定是工具类型（复合图形是一条形状 id），这里
                // 按工具类型收窄；真正落定的工具由调用方在 `onToolChange`
                // 里给出（见 GenericShapeToolPopover）
                app.setActiveTool({ type: optionToolType(type) as ToolType });
                onToolChange?.(type);
              }
            }}
          />
        ))}
      </Popover.Content>
    </Popover.Root>
  );
};
