import { useEffect, useRef, useState } from "react";

import "./Range.scss";

export type RangeProps = {
  label: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hasCommonValue?: boolean;
  testId?: string;
  /** 标签文本交给外层 fieldset>legend（tb-group）时的视觉去重；
   * 数值框的 aria-label 仍取 label */
  hideLabel?: boolean;
};

export const Range = ({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 10,
  hasCommonValue = true,
  testId,
  hideLabel = false,
}: RangeProps) => {
  const rangeRef = useRef<HTMLInputElement>(null);
  // 数值框编辑草稿；null = 未在编辑（显示当前值）
  const [draft, setDraft] = useState<string | null>(null);
  // Esc 置位后跳过 blur 的提交，实现「还原为编辑前的值」
  const cancelBlurCommitRef = useRef(false);

  useEffect(() => {
    const rangeElement = rangeRef.current;
    if (rangeElement) {
      const progress = ((value - min) / (max - min || 1)) * 100;
      rangeElement.style.background = `linear-gradient(to right, var(--color-slider-fill, var(--color-selection)) 0%, var(--color-slider-fill, var(--color-selection)) ${progress}%, var(--neutral-fill) ${progress}%, var(--neutral-fill) 100%)`;
    }
  }, [max, min, value]);

  // 提交数值框：解析失败则放弃；越界自动收敛到 [min, max]
  const commitDraft = (text: string) => {
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      if (clamped !== value) {
        onChange(clamped);
      }
    }
    setDraft(null);
  };

  return (
    <label className="control-label">
      {hideLabel ? (
        <span className="control-label__text" hidden>
          {label}
        </span>
      ) : (
        label
      )}
      <div className="range-wrapper">
        <input
          style={{
            ["--color-slider-fill" as string]: hasCommonValue
              ? undefined
              : "var(--neutral-fill)",
          }}
          ref={rangeRef}
          type="range"
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            onChange(+event.target.value);
          }}
          value={value}
          className="range-input"
          data-testid={testId}
        />
        <input
          className="range-number"
          type="text"
          inputMode="decimal"
          aria-label={typeof label === "string" ? label : undefined}
          data-testid={testId ? `${testId}-number` : undefined}
          value={draft ?? String(value)}
          onFocus={(event) => {
            setDraft(String(value));
            event.target.select();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitDraft(event.currentTarget.value);
            } else if (event.key === "Escape") {
              cancelBlurCommitRef.current = true;
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            if (cancelBlurCommitRef.current) {
              cancelBlurCommitRef.current = false;
              return;
            }
            if (draft !== null) {
              commitDraft(event.target.value);
            }
          }}
        />
      </div>
    </label>
  );
};
