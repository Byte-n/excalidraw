import clsx from "clsx";

import "./toolbar.scss";

import type { ReactNode } from "react";

/**
 * 工具栏分组容器：`fieldset.tb-group > legend.tb-legend` + 控件内容。
 * 设计稿（docs/design-ui/excalidraw-canvas-toolbar.html）的统一分组结构，
 * 浮动栏 / 弹层 / 底部 sheet 三端共用；分组标题为 11px 弱化文本、组距 12。
 */
export const ToolbarGroup = ({
  legend,
  className,
  children,
}: {
  legend: ReactNode;
  className?: string;
  children: ReactNode;
}) => (
  <fieldset className={clsx("tb-group", className)}>
    <legend className="tb-legend">{legend}</legend>
    {children}
  </fieldset>
);
