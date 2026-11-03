import React from "react";
import { yearChoices } from "./presentation.mjs";
import { Icon } from "./Icon";
export function PeriodControl({
  year,
  month,
  yearText,
  onYearText,
  onYear,
  onStep,
  disabled = false,
}: {
  year: number;
  month?: number;
  yearText: string;
  onYearText: (value: string) => void;
  onYear: (value: number) => void;
  onStep: (step: number) => void;
  disabled?: boolean;
}) {
  const commit = () =>
    onYear(/^[0-9]{1,4}$/.test(yearText) ? Number(yearText) : 0);
  return (
    <div
      className="period-control heading-period-control"
      aria-label="対象期間"
    >
      <button
        className="icon-button"
        aria-label={month ? "前月へ" : "前年へ"}
        disabled={disabled || (year === 1 && (!month || month === 1))}
        onClick={() => onStep(-1)}
      >
        <Icon name="left" />
      </button>
      <label className="period-year">
        <span className="sr-only">対象年度</span>
        <input
          aria-label="対象年度"
          inputMode="numeric"
          maxLength={4}
          value={yearText}
          disabled={disabled}
          onChange={(e) => onYearText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing)
              e.currentTarget.blur();
          }}
        />
        <span className="year-unit" aria-hidden="true">
          年
        </span>
      </label>
      <div className="year-picker" title="年度を選択">
        <Icon name="down" size={15} />
        <select
          aria-label="年度を選択"
          value={year}
          disabled={disabled}
          onChange={(e) => onYear(Number(e.target.value))}
        >
          {yearChoices(year).map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
      </div>
      {month && (
        <span className="period-month" aria-label={`対象月 ${month}月`}>
          {month}月
        </span>
      )}
      <button
        className="icon-button"
        aria-label={month ? "翌月へ" : "翌年へ"}
        disabled={disabled || (year === 9999 && (!month || month === 12))}
        onClick={() => onStep(1)}
      >
        <Icon name="right" />
      </button>
    </div>
  );
}
