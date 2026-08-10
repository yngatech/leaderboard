import { For, Show, createMemo } from "solid-js";
import type { Grid } from "../../shared/board";
import {
  formatDayLong,
  formatMonth,
  weekdayIndex,
  type FirstDayOfWeek,
} from "../../shared/format";

export interface HeatmapProps {
  weeks: Grid;
  /** Square edge in px at 1:1. The SVG scales down below that. */
  cell?: number;
  gap?: number;
  months?: boolean;
  /** Accessible summary of the strip. */
  label: string;
  /** Noun used in day tooltips. */
  unit?: string;
  /** Intl weekday number: Monday=1 through Sunday=7. */
  firstDay?: FirstDayOfWeek;
  /**
   * ISO date of this strip's busiest day. That one cell gets a star. Left off
   * for combined strips and for anyone whose year is empty.
   */
  peakDate?: string;
}

const MONTH_BAND = 15;

/* Peak marker geometry, tuned so the star still reads inside an 8px cell. */
const STAR_ARMS = 5;
/** Outer radius as a fraction of the cell edge. */
const STAR_RADIUS = 0.44;
/** Waist as a fraction of the outer radius. Fatter than a textbook star, so the
 *  arms survive antialiasing at row scale. */
const STAR_WAIST = 0.47;

function starPoints(cx: number, cy: number, radius: number): string {
  const waist = radius * STAR_WAIST;
  // A five-point star sits high in its own bounding box; drop it to optical centre.
  const drop = (radius - radius * Math.cos(Math.PI / STAR_ARMS)) / 2;
  const points: string[] = [];
  for (let i = 0; i < STAR_ARMS * 2; i += 1) {
    const r = i % 2 === 0 ? radius : waist;
    const angle = (Math.PI / STAR_ARMS) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + drop + r * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

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
      // Label from the first day of the week that belongs to the year.
      const first = week.find((day) => day.state !== "outside") ?? week[0];
      if (!first) return;
      const label = formatMonth(first.date);
      if (label !== previous && index <= props.weeks.length - 3) {
        ticks.push({ x: index * pitch(), label });
        previous = label;
      }
    });
    // The grid opens mid-week, so drop a stub label that would collide.
    if (ticks.length > 1 && ticks[1].x - ticks[0].x < 3 * pitch()) ticks.shift();
    return ticks;
  });

  /** Where the star goes, if this strip has a peak worth marking. */
  const peakMark = createMemo(() => {
    const date = props.peakDate;
    if (!date) return null;
    for (let index = 0; index < props.weeks.length; index += 1) {
      const day = props.weeks[index].find((item) => item.date === date);
      if (!day) continue;
      // Never mark padding, a day still to come, or a day with nothing on it.
      if (day.state !== "day" || day.count <= 0) return null;
      return {
        level: day.level,
        points: starPoints(
          index * pitch() + cell() / 2,
          top() + weekdayIndex(day.date, props.firstDay) * pitch() + cell() / 2,
          cell() * STAR_RADIUS,
        ),
      };
    }
    return null;
  });

  return (
    <svg
      class="block h-auto w-full"
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
            <text
              class="fill-dimmer font-mono text-[10px] tracking-[0.06em]"
              x={tick.x}
              y={MONTH_BAND - 6}
            >
              {tick.label}
            </text>
          )}
        </For>
      </Show>
      <For each={props.weeks}>
        {(week, weekIndex) => (
          <For each={week.filter((day) => day.state !== "outside")}>
            {(day) => (
              <rect
                // Level drives the ramp; "future" days are an outline rather
                // than a filled square, and only real days light up on hover.
                class="fill-heat-0 transition-[fill] duration-150 data-[level=1]:fill-heat-1 data-[level=2]:fill-heat-2 data-[level=3]:fill-heat-3 data-[level=4]:fill-heat-4 data-[state=future]:fill-none data-[state=future]:stroke-future-line data-[state=future]:stroke-1 data-[state=day]:hover:stroke-1 data-[state=day]:hover:stroke-white/70"
                data-state={day.state}
                data-level={day.state === "day" ? day.level : undefined}
                x={weekIndex() * pitch()}
                y={top() + weekdayIndex(day.date, props.firstDay) * pitch()}
                width={cell()}
                height={cell()}
                rx={Math.max(1, Math.round(cell() * 0.22))}
              >
                {/* Keep title directly under rect so Solid creates it in the SVG namespace. */}
                <title>
                  {day.state === "day"
                    ? day.count === 0
                      ? `No ${unit()} on ${formatDayLong(day.date)}`
                      : `${day.count} ${day.count === 1 ? unit().replace(/s$/, "") : unit()} on ${formatDayLong(day.date)}`
                    : ""}
                </title>
              </rect>
            )}
          </For>
        )}
      </For>
      {/* Drawn after the squares so the star sits on its own cell. It stays out
          of the way of the pointer, so the cell keeps its hover and tooltip. */}
      <Show when={peakMark()}>
        {(mark) => (
          <polygon
            // The two brightest steps of the ramp need a dark marker to read.
            // pointer-events-none keeps the cell's own hover and tooltip.
            class="pointer-events-none fill-ink [shape-rendering:geometricPrecision] data-[level=3]:fill-void data-[level=4]:fill-void"
            data-level={mark().level}
            points={mark().points}
            aria-hidden="true"
          />
        )}
      </Show>
    </svg>
  );
}
