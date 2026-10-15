import React, { useEffect, useRef, useState } from "react";
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
  /**
   * 弹层底部的整行插槽：靠 `flex-wrap` 换到选项之后独占一行（见
   * `ToolPopover.scss` 的 `.tool-popover-footer`）。点它收起本弹层——
   * 目前只有普通图形 popover 用它挂「更多功能」（图形抽屉入口）。
   */
  footer?: React.ReactNode;
};

/**
 * 悬停开合的延迟：移入后等这么久才展开（扫过工具栏不会连续弹层），移出后
 * 等这么久才收起（留出穿过按钮与弹层间隙的时间）。测试按这两个值推进定时器。
 */
export const POPOVER_HOVER_OPEN_DELAY = 120;
export const POPOVER_HOVER_CLOSE_DELAY = 250;

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
  footer,
}: ToolPopoverProps) => {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const currentType = activeOptionType ?? activeTool.type;
  const isActive = isTriggerChecked ?? displayedOption.type === currentType;
  const SIDE_OFFSET = 16;
  const { container } = useExcalidrawContainer();

  const openTimeoutRef = useRef<number | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const clearOpenTimeout = () => {
    if (openTimeoutRef.current != null) {
      window.clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
  };
  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current != null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearOpenTimeout();
      clearCloseTimeout();
    };
  }, []);

  // 悬停即展开：鼠标（含触控板）移入触发按钮时延迟一点打开，扫过工具栏
  // 不会连续弹层；移出后延迟关闭，留出穿过按钮与弹层的间隙、移入弹层的
  // 时间（弹层是包裹层的后代，进入弹层即取消关闭）。触控/笔不做悬停，
  // 保持原有「点按切换」行为。
  const handlePointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") {
      return;
    }
    clearCloseTimeout();
    if (!isPopupOpen && openTimeoutRef.current == null) {
      openTimeoutRef.current = window.setTimeout(() => {
        openTimeoutRef.current = null;
        setIsPopupOpen(true);
      }, POPOVER_HOVER_OPEN_DELAY);
    }
  };

  const handlePointerLeave = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") {
      return;
    }
    clearOpenTimeout();
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      setIsPopupOpen(false);
    }, POPOVER_HOVER_CLOSE_DELAY);
  };

  /** 选项标识之外，该选项实际激活的工具（见 `sharedToolType`） */
  const optionToolType = (type: string) => sharedToolType ?? type;

  // 换到本组之外的其它工具时收起弹层。只在激活工具**发生变化**时判定：
  // 悬停展开不要求先选中本组工具，此时激活工具本来就不在本组，按渲染期
  // 无条件判定会把刚展开的弹层立刻关掉（见 handlePointerEnter）。
  useEffect(() => {
    if (
      !options.some((option) => optionToolType(option.type) === activeTool.type)
    ) {
      setIsPopupOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool.type]);

  // Close popover when user starts interacting with the canvas (pointer down)
  useEffect(() => {
    // app.onPointerDownEmitter emits when pointer down happens on canvas area
    const unsubscribe = app.onPointerDownEmitter.on(() => {
      setIsPopupOpen(false);
    });
    return () => unsubscribe?.();
  }, [app]);

  return (
    // 包裹触发按钮与弹层：两者是同一 DOM 子树，鼠标从按钮移到弹层上时
    // 不触发外层 pointerleave，弹层得以保持展开
    <div
      className="tool-popover-root"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
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
          {footer && (
            // 整行插槽：.tool-popover-content 是换行 flex，`flex-basis:100%`
            // 让它独占最后一行。点这里即收起弹层（footer 里的按钮自行处理
            // 打开抽屉等副作用），因此无需向外暴露额外的回调。
            <div
              className="tool-popover-footer"
              onClick={() => setIsPopupOpen(false)}
            >
              {footer}
            </div>
          )}
        </Popover.Content>
      </Popover.Root>
    </div>
  );
};
