import { Popover } from "radix-ui";
import clsx from "clsx";
import React, { type ReactNode } from "react";

import { isInteractive } from "@excalidraw/common";

import { useEditorInterface } from "./App";
import { Island } from "./Island";
import { BottomSheet, BottomSheetOverlay } from "./toolbar/BottomSheet";

// 记录最近一次弹层关闭是否由 Esc 触发——Esc 关闭时焦点回触发器（设计稿
// 「弹层与二级界面」），其余关闭路径维持焦点回画布容器。颜色/字体弹层
// 自行拦截 Esc（stopPropagation，radix 的 onEscapeKeyDown 收不到），
// 它们在主动关闭前经此函数补标记。
let escCloseMarked = false;
export const markPropertiesPopoverEscClose = () => {
  escCloseMarked = true;
};

interface PropertiesPopoverProps {
  className?: string;
  container: HTMLDivElement | null;
  children: ReactNode;
  style?: object;
  onClose: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
  onFocusOutside?: Popover.PopoverContentProps["onFocusOutside"];
  onPointerDownOutside?: Popover.PopoverContentProps["onPointerDownOutside"];
  preventAutoFocusOnTextEdit?: boolean;
  /** sheet 分支（手机竖屏）的对话框可访问名 */
  label?: string;
}

export const PropertiesPopover = React.forwardRef<
  HTMLDivElement,
  PropertiesPopoverProps
>(
  (
    {
      className,
      container,
      children,
      style,
      onClose,
      onKeyDown,
      onFocusOutside,
      onPointerLeave,
      onPointerDownOutside,
      preventAutoFocusOnTextEdit = false,
      label,
    },
    ref,
  ) => {
    const editorInterface = useEditorInterface();
    // 手机竖屏：二级界面一律底部 sheet（设计稿「弹层统一」），不再右侧弹出；
    // 手机横屏按平板处理，保持 tb-pop 弹层
    const isMobilePortrait =
      editorInterface.formFactor === "phone" && !editorInterface.isLandscape;

    const content = (
      <Popover.Content
        ref={ref}
        className={clsx("focus-visible-none", className)}
        data-prevent-outside-click
        // 桌面/平板统一向下弹出（offset 8、碰撞翻转经 collisionBoundary）；
        // 手机竖屏的定位由 .tb-sheet-portal 覆盖为贴底通栏（toolbar.scss）
        side="bottom"
        align={isMobilePortrait ? "center" : "start"}
        sideOffset={isMobilePortrait ? 20 : 8}
        collisionBoundary={container ?? undefined}
        style={{
          zIndex: "var(--zIndex-ui-styles-popup)",
          marginLeft:
            !isMobilePortrait && editorInterface.formFactor === "phone"
              ? "0.5rem"
              : undefined,
        }}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        onFocusOutside={onFocusOutside}
        onPointerDownOutside={onPointerDownOutside}
        onEscapeKeyDown={markPropertiesPopoverEscClose}
        onOpenAutoFocus={(e) => {
          // 文本编辑中打开的属性弹层不抢占焦点（避免 wysiwyg 失焦提交），
          // 编辑内容实时生效；关闭后焦点回编辑器（见下方 onCloseAutoFocus）
          if (preventAutoFocusOnTextEdit) {
            e.preventDefault();
          }
        }}
        onCloseAutoFocus={(e) => {
          e.stopPropagation();
          const closedViaEscape = escCloseMarked;
          escCloseMarked = false;

          if (closedViaEscape && !preventAutoFocusOnTextEdit) {
            // Esc 关闭：不阻止 radix 默认行为，焦点回触发按钮
            onClose();
            return;
          }

          // prevents focusing the trigger
          e.preventDefault();

          // return focus to excalidraw container unless
          // user focuses an interactive element, such as a button, or
          // enters the text editor by clicking on canvas with the text tool
          if (container && !isInteractive(document.activeElement)) {
            container.focus();
          }

          onClose();
        }}
      >
        {isMobilePortrait ? (
          // tb-sheet：圆角 14 14 0 0 / 抓手 36×4（BottomSheet.tsx +
          // toolbar.scss）；桌面弹层的宽度 style 不适用于通栏 sheet，略去
          <BottomSheet label={label}>{children}</BottomSheet>
        ) : (
          <>
            {/* tb-pop：圆角 10 / 内边距 8（padding=2 × 4px）/ 统一阴影（toolbar.scss） */}
            <Island className="tb-pop" padding={2} style={style}>
              {children}
            </Island>
            {/* 箭头：10px 旋转方块（样式见 toolbar.scss 的 svg.tb-pop-arrow） */}
            <Popover.Arrow className="tb-pop-arrow" width={10} height={10} />
          </>
        )}
      </Popover.Content>
    );

    return (
      <Popover.Portal container={container}>
        {/*
          手机竖屏：包一层 .tb-sheet-portal 承载遮罩与 popper 定位覆盖
          （toolbar.scss）；桌面/平板不加包裹，结构不变
        */}
        {isMobilePortrait ? (
          <div className="tb-sheet-portal">
            <BottomSheetOverlay />
            {content}
          </div>
        ) : (
          content
        )}
      </Popover.Portal>
    );
  },
);
