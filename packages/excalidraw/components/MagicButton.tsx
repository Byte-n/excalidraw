import clsx from "clsx";

import type { JSX } from "react";

/**
 * 画布悬浮按钮：贴元素边缘外侧的图标 + 文字胶囊（tb-canvasbtn，
 * 规格见 toolbar.scss——高 28、圆角 999）。主行动作传 variant="primary"
 * （主色底白字）。
 */
export const ElementCanvasButton = (props: {
  title: string;
  icon: JSX.Element;
  onChange?(): void;
  variant?: "primary";
}) => {
  return (
    <button
      type="button"
      className={clsx("tb-canvasbtn", {
        primary: props.variant === "primary",
      })}
      title={props.title}
      aria-label={props.title}
      onClick={() => props.onChange?.()}
    >
      {props.icon}
      {props.title}
    </button>
  );
};
