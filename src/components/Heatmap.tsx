import { For, Show, createMemo } from "solid-js";
import type { ContributionWeek } from "../../shared/types";
import { formatDayLong, formatMonth, weekdayIndex } from "../lib/format";

export interface HeatmapProps {
  weeks: ContributionWeek[];
  /** Square edge in px at 1:1. The SVG scales down below that. */
  cell?: number;
  gap?: number;
  months?: boolean;
  /** Accessible summary of the strip. */
  label: string;
  /** Noun used in day tooltips. */
  unit?: string;
}

const MONTH_BAND = 15;

export default function Heatmap(props: HeatmapProps) {
  const cell = () => props.cell ?? 9;
  const gap = () => props.gap ?? 3;
  const pitch = () => cell() + gap();
  const unit = () => props.unit ?? "contributions";

  const width = createMemo(() => Math.max(0, props.weeks.length * pitch() - gap()));
  const bodyHeight = () => 7 * pitch() - gap();
  const top = () => (props.months ? MONTH_BAND : 0);
  const height = createMemo(() => bodyHeight() + top());

  const monthTicks = createMemo(() => {
    if (!props.months) return [];
    const ticks: { x: number; label: string }[] = [];
    let previous = "";
    props.weeks.forEach((week, index) => {
      const first = week.days[0];
      if (!first) return;
      const label = formatMonth(first.date);
      if (label !== previous && index <= props.weeks.length - 3) {
        ticks.push({ x: index * pitch(), label });
        previous = label;
      }
    });
    // The calendar opens mid-month; drop that stub so it can't collide with the
    // first full month's label.
    if (ticks.length > 1 && ticks[1].x - ticks[0].x < 3 * pitch()) ticks.shift();
    return ticks;
  });

  return (
    <svg
      class="heatmap"
      viewBox={`0 0 ${width()} ${height()}`}
      width={width()}
      height={height()}
      role="img"
      aria-label={props.label}
      style={{ "max-width": `${width()}px` }}
    >
      <Show when={props.months}>
        <For each={monthTicks()}>
          {(tick) => (
            <text class="heatmap__month" x={tick.x} y={MONTH_BAND - 6}>
              {tick.label}
            </text>
          )}
        </For>
      </Show>
      <For each={props.weeks}>
        {(week, weekIndex) => (
          <For each={week.days}>
            {(day) => (
              <rect
                class="heatmap__day"
                data-level={day.level}
                x={weekIndex() * pitch()}
                y={top() + weekdayIndex(day.date) * pitch()}
                width={cell()}
                height={cell()}
                rx={Math.max(1, Math.round(cell() * 0.22))}
              >
                <title>
                  {day.count === 0
                    ? `No ${unit()} on ${formatDayLong(day.date)}`
                    : `${day.count} ${day.count === 1 ? unit().replace(/s$/, "") : unit()} on ${formatDayLong(day.date)}`}
                </title>
              </rect>
            )}
          </For>
        )}
      </For>
    </svg>
  );
}
