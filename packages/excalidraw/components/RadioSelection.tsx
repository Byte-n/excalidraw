import clsx from "clsx";

import { RadioButton } from "./RadioButton";

import "./toolbar/toolbar.scss";

import type { JSX } from "react";

/**
 * 分段选择器（设计稿 tb-seg）：槽底容器 + 选项行。
 * 仅被选中元素面板/弹层使用（FontPicker、actionProperties、Actions），
 * 导出对话框等界面用的是 RadioGroup，不受此视觉影响。
 */
export const RadioSelection = <T extends Object>(
  props: {
    options: {
      value: T;
      text: string;
      icon: JSX.Element;
      testId?: string;
      /** if not supplied, defaults to value identity check */
      active?: boolean;
    }[];
    value: T | null;
    type?: "radio" | "button";
  } & (
    | { type?: "radio"; group: string; onChange: (value: T) => void }
    | {
        type: "button";
        onClick: (
          value: T,
          event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
        ) => void;
      }
  ),
) => (
  <div
    className="tb-seg"
    role={props.type === "button" ? "group" : "radiogroup"}
  >
    {props.options.map((option) =>
      props.type === "button" ? (
        <RadioButton
          key={option.text}
          className="tb-seg__option"
          icon={option.icon}
          title={option.text}
          testId={option.testId}
          active={option.active ?? props.value === option.value}
          onClick={(event) => props.onClick(option.value, event)}
        />
      ) : (
        <label
          key={option.text}
          className={clsx("tb-seg__option", {
            active: props.value === option.value,
          })}
          title={option.text}
        >
          <input
            type="radio"
            name={props.group}
            onChange={() => props.onChange(option.value)}
            checked={props.value === option.value}
            data-testid={option.testId}
          />
          {option.icon}
        </label>
      ),
    )}
  </div>
);
