import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { CumulativePoint, CumulativeSeries } from "../lib/board";
import { formatDayLong, formatDayShort, formatMonth, formatNumber } from "../lib/format";

export interface CumulativeChartProps {
  series: CumulativeSeries[];
  year: number;
  /** ISO date the series stop on. Nothing is drawn past it. */
  today: string;
}

const DAY_MS = 86_400_000;

/** Room for the "today" caption, the month labels and the last y label. */
const PAD_TOP = 18;
const PAD_RIGHT = 12;
const PAD_BOTTOM = 22;

/** Stable line colours in board order. Accounts wrap round if there are more. */
const SERIES_COLOURS = [
  "#ffc24d",
  "#7d6cf3",
  "#f0713f",
  "#46b6c9",
  "#e2508e",
  "#c9a2ff",
  "#ffa06b",
  "#4f8ff0",
  "#aeb4d8",
] as const;

function seriesColour(index: number): string {
  return SERIES_COLOURS[index % SERIES_COLOURS.length];
}

/** Width the chart draws at before the container has been measured. */
const ASSUMED_WIDTH = 960;

/** Rounds a maximum up to a friendly number whose half is still a whole one. */
function niceMax(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step =
    scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 4 ? 4 : scaled <= 6 ? 6 : scaled <= 8 ? 8 : 10;
  return step * power;
}

/**
 * A running total only bends on days that changed, so the path keeps the day
 * before and after every change and drops the flat middle. Same shape, far
 * fewer commands than one point per day per account.
 */
function linePath(
  points: CumulativePoint[],
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  const parts: string[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const total = points[i].total;
    const keep =
      i === 0 ||
      i === points.length - 1 ||
      total !== points[i - 1].total ||
      total !== points[i + 1].total;
    if (!keep) continue;
    parts.push(`${parts.length === 0 ? "M" : "L"}${xAt(i).toFixed(1)} ${yAt(total).toFixed(1)}`);
  }
  return parts.join(" ");
}

/**
 * One factual line per account: contributions accumulated since 1 January,
 * stopping dead at today. The x-axis still runs to 31 December, so the part of
 * the year that hasn't happened reads as empty rather than as a flat line.
 */
export default function CumulativeChart(props: CumulativeChartProps) {
  const [measured, setMeasured] = createSignal(0);
  let canvas: HTMLDivElement | undefined;

  // The SVG draws in real pixels, so labels stay 10px whatever the viewport is.
  onMount(() => {
    const node = canvas;
    if (!node) return;

    const measure = () => setMeasured(node.clientWidth);
    measure();
    // Keep the window event as a pragmatic backstop. Some embedded previews
    // resize their viewport without delivering a ResizeObserver entry.
    window.addEventListener("resize", measure);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(node);
    }

    onCleanup(() => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    });
  });

  const chart = createMemo(() => {
    const width = Math.max(240, measured() || ASSUMED_WIDTH);
    const height = Math.round(Math.min(210, Math.max(150, width * 0.24)));

    const dayCount =
      Math.round((Date.UTC(props.year, 11, 31) - Date.UTC(props.year, 0, 1)) / DAY_MS) + 1;
    const drawnDays = props.series.reduce((most, item) => Math.max(most, item.points.length), 0);

    const peak = props.series.reduce((most, item) => Math.max(most, item.total), 0);
    // An all-zero board still needs a valid scale: every line sits on the floor.
    const scaleMax = peak > 0 ? niceMax(peak) : 0;

    const padLeft = Math.max(26, (scaleMax > 0 ? formatNumber(scaleMax).length : 1) * 6 + 12);
    const plotWidth = Math.max(1, width - padLeft - PAD_RIGHT);
    const plotHeight = Math.max(1, height - PAD_TOP - PAD_BOTTOM);
    const baseline = PAD_TOP + plotHeight;
    const span = Math.max(1, dayCount - 1);

    const xAt = (index: number) => padLeft + (index / span) * plotWidth;
    const yAt = (value: number) =>
      scaleMax > 0 ? baseline - (value / scaleMax) * plotHeight : baseline;

    const todayX = xAt(Math.max(0, drawnDays - 1));
    const rightEdge = width - PAD_RIGHT;

    // Labelling every month needs room; below that, every second or third one.
    const monthStep = plotWidth >= 620 ? 1 : plotWidth >= 380 ? 2 : 3;
    const months = Array.from({ length: 12 }, (_, month) => {
      const first = `${props.year}-${String(month + 1).padStart(2, "0")}-01`;
      const index = Math.round(
        (Date.UTC(props.year, month, 1) - Date.UTC(props.year, 0, 1)) / DAY_MS,
      );
      return { x: xAt(index), label: formatMonth(first), show: month % monthStep === 0 };
    });

    // A half-way line only helps when it lands on a whole number.
    const gridValues =
      scaleMax <= 0
        ? [0]
        : Number.isInteger(scaleMax / 2)
          ? [0, scaleMax / 2, scaleMax]
          : [0, scaleMax];

    return {
      width,
      height,
      padLeft,
      baseline,
      rightEdge,
      todayX,
      xAt,
      yAt,
      months,
      gridValues,
      dotRadius: width < 520 ? 2.6 : 3.2,
      // Late in the year the caption has to flip inside the line, not off the edge.
      todayTight: rightEdge - todayX < 46,
      todayLabelX: rightEdge - todayX >= 46 ? todayX + 5 : todayX - 5,
    };
  });

  /** Draw the leader last so the brightest line sits on top of the pile. */
  const stack = createMemo(() =>
    props.series.map((item, index) => ({ item, index })).reverse(),
  );

  const accounts = () => props.series.length;

  return (
    <section
      class="mt-[clamp(2.25rem,5vw,3.25rem)] animate-rise"
      aria-labelledby="climb-heading"
    >
      <div class="mb-[0.9rem] flex flex-wrap items-center gap-x-[0.85rem] gap-y-2 text-[0.66rem] tracking-[0.2em] text-dimmer uppercase max-phone:tracking-[0.14em]">
        <h2 id="climb-heading">
          cumulative contributions
        </h2>
        <span class="h-px min-w-6 flex-[1_1_24px] bg-line-soft" aria-hidden="true" />
      </div>

      <div class="rounded-2xl border border-line bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-4 pt-[0.9rem] pb-[0.7rem] max-phone:px-[0.65rem] max-phone:pt-[0.7rem] max-phone:pb-2">
        <div class="w-full" ref={canvas}>
          <svg
            class="block h-auto w-full"
            viewBox={`0 0 ${chart().width} ${chart().height}`}
            width={chart().width}
            height={chart().height}
            role="img"
            aria-labelledby="climb-chart-title climb-chart-desc"
          >
            <title id="climb-chart-title">
              Running contribution totals for {accounts()} accounts in {props.year}
            </title>
            <desc id="climb-chart-desc">
              One line per account, adding up day by day from 1 January to {formatDayLong(props.today)}.
              Each line stops at today; the rest of the year is empty. Every account's current total is
              listed under the chart.
            </desc>

            <g aria-hidden="true">
              {/* The part of the year that hasn't happened, left deliberately bare. */}
              <Show when={chart().rightEdge - chart().todayX > 1}>
                <rect
                  class="fill-[rgba(10,12,24,0.5)]"
                  x={chart().todayX}
                  y={PAD_TOP}
                  width={chart().rightEdge - chart().todayX}
                  height={chart().baseline - PAD_TOP}
                />
              </Show>

              <For each={chart().months}>
                {(month) => (
                  <line
                    class="stroke-line-soft opacity-[0.55]"
                    x1={month.x}
                    x2={month.x}
                    y1={PAD_TOP}
                    y2={chart().baseline}
                  />
                )}
              </For>

              <For each={chart().gridValues}>
                {(value) => (
                  <>
                    <line
                      class={
                        value === 0
                          ? "stroke-line"
                          : "stroke-line-soft [stroke-dasharray:1_5]"
                      }
                      x1={chart().padLeft}
                      x2={chart().rightEdge}
                      y1={chart().yAt(value)}
                      y2={chart().yAt(value)}
                    />
                    <text
                      class="fill-dimmer font-mono text-[10px] tracking-[0.06em]"
                      x={chart().padLeft - 8}
                      y={chart().yAt(value) + 3}
                      text-anchor="end"
                    >
                      {formatNumber(value)}
                    </text>
                  </>
                )}
              </For>

              <For each={chart().months}>
                {(month) => (
                  <Show when={month.show}>
                    <text
                      class="fill-dimmer font-mono text-[10px] tracking-[0.06em]"
                      x={month.x + 2}
                      y={chart().height - 7}
                    >
                      {month.label}
                    </text>
                  </Show>
                )}
              </For>

              <line
                class="stroke-[rgba(236,234,247,0.24)] [stroke-dasharray:2_4]"
                x1={chart().todayX}
                x2={chart().todayX}
                y1={PAD_TOP - 6}
                y2={chart().baseline}
              />
              <text
                class="fill-dim font-mono text-[9px] tracking-[0.12em] uppercase"
                x={chart().todayLabelX}
                y={PAD_TOP - 8}
                text-anchor={chart().todayTight ? "end" : "start"}
              >
                today
              </text>
            </g>

            <g>
              <For each={stack()}>
                {(entry) => (
                  <path
                    class="fill-none [stroke:var(--series,var(--color-dim))] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75] transition-[stroke-width] duration-150 hover:[stroke-width:3.25]"
                    data-series={entry.index % SERIES_COLOURS.length}
                    d={linePath(entry.item.points, chart().xAt, chart().yAt)}
                    style={{ "--series": seriesColour(entry.index) }}
                  >
                    {/* Keep title directly under path so Solid creates it in the SVG namespace. */}
                    <title>
                      {entry.item.login}: {formatNumber(entry.item.total)}{" "}
                      {entry.item.total === 1 ? "contribution" : "contributions"} to{" "}
                      {formatDayShort(props.today)}
                    </title>
                  </path>
                )}
              </For>
            </g>

            {/* A dot on every line's last day, so the stop at today is unmissable. */}
            <g aria-hidden="true">
              <For each={stack()}>
                {(entry) => (
                  <Show when={entry.item.points.length > 0}>
                    <circle
                      class="[fill:var(--series,var(--color-dim))] stroke-void [stroke-width:1]"
                      data-series={entry.index % SERIES_COLOURS.length}
                      cx={chart().xAt(entry.item.points.length - 1)}
                      cy={chart().yAt(entry.item.total)}
                      r={chart().dotRadius}
                      style={{ "--series": seriesColour(entry.index) }}
                    />
                  </Show>
                )}
              </For>
            </g>
          </svg>
        </div>
      </div>

      <ul
        class="mt-[0.85rem] flex list-none flex-wrap gap-x-[1.4rem] gap-y-2 p-0 text-[0.72rem] max-phone:grid max-phone:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] max-phone:gap-x-4 max-phone:gap-y-[0.45rem]"
        aria-label="Contributions so far, by account"
      >
        <For each={props.series}>
          {(item, index) => (
            <li
              class="flex min-w-0 items-center gap-[0.45rem] whitespace-nowrap max-phone:justify-start"
              data-series={index() % SERIES_COLOURS.length}
              style={{ "--series": seriesColour(index()) }}
            >
              <span
                class="h-[3px] w-3.5 flex-none rounded-sm [background:var(--series,var(--color-dim))]"
                aria-hidden="true"
              />
              <span class="overflow-hidden text-ellipsis text-dim">{item.login}</span>
              <span class="text-ink tabular-nums">{formatNumber(item.total)}</span>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
