import clsx from "clsx";

import "./toolbar.scss";

import type { ReactNode } from "react";

/**
 * 底部 sheet（手机竖屏二级界面容器，设计稿 tb-sheet）：
 * 圆角 14 14 0 0、顶部抓手 36×4、160ms 上滑进入、遮罩压暗。
 *
 * 分组集合与顺序与桌面弹层同一渲染源，仅容器不同（触控放大规格见
 * toolbar.scss 的 .tb-sheet 块）。本组件只管展示——开启态与关闭路径
 * 由调用方持有：
 *
 * - PropertiesPopover（radix 弹层骨架）：点遮罩 = 内容外点击，经既有
 *   DismissableLayer 路径关闭（取色中等 onPointerDownOutside 保护不变），
 *   Esc/焦点回归沿用 radix 既有行为；
 * - MobileMindmapActions（本地 state）：遮罩 onPointerDown + Esc 自行关闭。
 *
 * 取舍记录（实施计划 T5 风险）：首期实现「点遮罩 / Esc 关闭 + 上滑进入
 * 动效」，抓手下拽关闭手势降级未做。
 */
export const BottomSheet = ({
  className,
  label,
  children,
}: {
  className?: string;
  /** 对话框可访问名（role="dialog"） */
  label?: string;
  children: ReactNode;
}) => (
  <div className={clsx("tb-sheet", className)} role="dialog" aria-label={label}>
    <div className="tb-sheet__grab" aria-hidden="true" />
    {children}
  </div>
);

/**
 * sheet 遮罩：视觉压暗 + 拦截画布手势（data-prevent-outside-click）。
 * radix 弹层分支不传 onPointerDown——点击遮罩即「内容外点击」，由
 * DismissableLayer 走既有 onOpenChange(false) 关闭，勿在此自行关闭。
 */
export const BottomSheetOverlay = ({
  onPointerDown,
}: {
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
}) => (
  <div
    className="tb-sheet__overlay"
    data-prevent-outside-click
    aria-hidden="true"
    onPointerDown={onPointerDown}
  />
);
