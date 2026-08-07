import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { CumulativePoint, CumulativeSeries } from "../lib/board";
import {
  formatDayLong,
  formatDayShort,
  formatMonth,
  formatNumber,
  formatRank,
} from "../lib/format";

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

/**
 * A 1.75px line is honest to look at and hopeless to point at, so every line
 * also gets an invisible copy this wide to catch the pointer and the focus.
 */
const HIT_WIDTH = 14;

/* ---------------------------------------------------------------------------
   Hover annotation
   A label pinned to the line, drawn in the chart's own coordinate system: the
   same numbers that place a point decide where its panel is allowed to go, so
   the plot rectangle is the only bound to respect. That is the whole reason
   this stays hand-authored rather than pulling in a chart library.
--------------------------------------------------------------------------- */

const TIP_HEIGHT = 37;
/** Distance kept between the anchored dot and the nearest panel edge. */
const TIP_GAP = 12;
const TIP_PAD_Y = 7;
/** The colour rule down the panel's left side, and where text starts after it. */
const TIP_ACCENT_X = 7;
const TIP_ACCENT_W = 2;
const TIP_TEXT_X = 15;
/** Everything in the panel's width that isn't text: text inset plus right padding. */
const TIP_CHROME = TIP_TEXT_X + 9;
const TIP_MIN_WIDTH = 76;
const TIP_NAME_BASELINE = 15.5;
const TIP_META_BASELINE = 27.5;

/**
 * DM Mono advances 0.6em a glyph, so the width of a monospaced string is
 * arithmetic rather than a measurement. The extra covers tracking, the 500
 * weight and any fallback face: over-estimating pads the panel, which is
 * harmless, while under-estimating would push text through its own border.
 */
const NAME_ADVANCE = 11 * 0.62;
const META_ADVANCE = 10 * 0.66;

/** Clamps, but gives up to the low bound when there is no room at all. */
function clamp(value: number, low: number, high: number): number {
  return high <= low ? low : Math.min(Math.max(value, low), high);
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 1) return "…";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

/* ---------------------------------------------------------------------------
   Label rail
   The accounts in front are worth naming permanently, but a name dropped on
   the plot would sit on top of the very lines it describes. So the rail is
   real reserved canvas: the plot gives the width up, the labels take it, and a
   connector ties each label back to the end of its line. Narrow enough, and
   the whole idea is dropped — the plot takes its width back and the key below
   carries every account again. It is the measured width that decides, so a
   chart in a slim column behaves like a phone whatever the viewport says.
--------------------------------------------------------------------------- */

const LABEL_COUNT = 3;
/** Measured chart width before the rail is worth what the plot pays for it. */
const RAIL_MIN_CHART = 660;
const RAIL_MIN_WIDTH = 116;
const RAIL_MAX_WIDTH = 188;
/** Clear space between the plot edge and the labels, where connectors bend. */
const RAIL_GUTTER = 24;
/** The colour rule that stands in for the line, echoing the tooltip's accent. */
const RAIL_RULE_W = 2;
const RAIL_RULE_H = 20;
/** Both measured from the plot's right edge, which is where the rail starts. */
const RAIL_TEXT_INSET = RAIL_GUTTER + 8;
const RAIL_SEPARATOR_INSET = 11;
const RAIL_META_ADVANCE = 9.5 * 0.66;
/**
 * Set as a dx so the gap survives however SVG collapses the markup's spaces.
 * Wide enough that the two numbers read as two, not as one long figure.
 */
const RANK_DX = 8;
const RAIL_NAME_DY = -1.5;
const RAIL_META_DY = 10;
/** Half a label block, above the anchor and below it. Neither may leave the plot. */
const LABEL_UP = 11;
const LABEL_DOWN = 12;
/** The least two labels can be apart before they read as one paragraph. */
const LABEL_GAP = 29;

interface RailEntry {
  item: CumulativeSeries;
  /** Position in props.series: the colour, the hit path and the key all key off it. */
  index: number;
  rank: number;
  rankText: string;
  colour: string;
  total: string;
}

/** The widest a label's two lines can be, by the same arithmetic as the tooltip. */
function railTextWidth(entry: RailEntry): number {
  return Math.max(
    entry.item.login.length * NAME_ADVANCE,
    (entry.rankText.length + entry.total.length) * RAIL_META_ADVANCE + RANK_DX,
  );
}

/**
 * How much canvas to hand over: enough for the longest label it has to hold,
 * never enough to starve the plot. Null means no rail at all, which is the
 * only honest answer on a chart this narrow.
 */
function railWidthFor(width: number, entries: RailEntry[]): number | null {
  if (width < RAIL_MIN_CHART || entries.length === 0) return null;
  const text = entries.reduce((most, entry) => Math.max(most, railTextWidth(entry)), 0);
  const most = Math.min(RAIL_MAX_WIDTH, Math.round(width * 0.26));
  return Math.round(clamp(Math.ceil(text) + RAIL_TEXT_INSET + 2, RAIL_MIN_WIDTH, most));
}

/**
 * Who a line belongs to: the display name when there is one, the login when
 * there isn't. The handle is only worth showing when it says something the
 * name doesn't.
 */
function identity(item: CumulativeSeries): { name: string; handle: string | null } {
  const name = item.name?.trim();
  const distinct = name && name !== item.login ? name : null;
  return { name: distinct ?? item.login, handle: distinct ? `@${item.login}` : null };
}

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

  /**
   * The accounts worth naming outright: the current top three by total, with
   * the board's own order breaking a tie so the choice never flickers. A line
   * with nothing drawn isn't a candidate — there is no line end to label.
   * Declared before the geometry, which sizes the rail around these names.
   */
  const leaders = createMemo<RailEntry[]>(() =>
    props.series
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.points.length > 0)
      .sort((a, b) => b.item.total - a.item.total || a.index - b.index)
      .slice(0, LABEL_COUNT)
      .map((entry, place) => ({
        ...entry,
        rank: place + 1,
        rankText: formatRank(place + 1),
        colour: seriesColour(entry.index),
        total: formatNumber(entry.item.total),
      })),
  );

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
    // The rail is width the plot gives up, not width it lends: all data marks
    // stay left of rightEdge while the persistent labels live beyond it.
    const railWidth = railWidthFor(width, leaders());
    const plotWidth = Math.max(1, width - padLeft - PAD_RIGHT - (railWidth ?? 0));
    const plotHeight = Math.max(1, height - PAD_TOP - PAD_BOTTOM);
    const baseline = PAD_TOP + plotHeight;
    const span = Math.max(1, dayCount - 1);

    const xAt = (index: number) => padLeft + (index / span) * plotWidth;
    const yAt = (value: number) =>
      scaleMax > 0 ? baseline - (value / scaleMax) * plotHeight : baseline;

    const todayX = xAt(Math.max(0, drawnDays - 1));
    const rightEdge = padLeft + plotWidth;

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
      plotWidth,
      span,
      baseline,
      rightEdge,
      todayX,
      xAt,
      yAt,
      months,
      gridValues,
      // Null when the chart is too narrow to reserve one, which every part of
      // the component reads as "no permanent labels, full key underneath".
      rail:
        railWidth === null
          ? null
          : {
              width: railWidth,
              separatorX: rightEdge + RAIL_SEPARATOR_INSET,
              ruleX: rightEdge + RAIL_GUTTER,
              textX: rightEdge + RAIL_TEXT_INSET,
              textRoom: railWidth - RAIL_TEXT_INSET - 2,
            },
      dotRadius: width < 520 ? 2.6 : 3.2,
      // Late in the year the caption has to flip inside the line, not off the edge.
      todayTight: rightEdge - todayX < 46,
      todayLabelX: rightEdge - todayX >= 46 ? todayX + 5 : todayX - 5,
    };
  });

  /** The sentence a line answers to on focus, and in the accessibility tree. */
  const seriesLabel = (item: CumulativeSeries) => {
    const who = identity(item);
    return `${who.name}${who.handle ? ` ${who.handle}` : ""}: ${formatNumber(item.total)} ${
      item.total === 1 ? "contribution" : "contributions"
    } to ${formatDayShort(props.today)}`;
  };

  /** Draw the leader last so the brightest line sits on top of the pile. */
  const stack = createMemo(() => {
    const view = chart();
    return props.series
      .map((item, index) => ({
        item,
        index,
        colour: seriesColour(index),
        // Shared by the drawn line and its invisible pointer target.
        d: linePath(item.points, view.xAt, view.yAt),
        label: seriesLabel(item),
      }))
      .reverse();
  });

  /**
   * Where the permanent labels actually sit. Each one wants to be level with
   * the end of its line; the solver only ever pushes them apart, never past
   * each other, so the order down the rail is always the order of the lines
   * and no two leaders can cross. The floor is the last word: a label pushed
   * off the bottom drags the ones above it back up instead of leaving the plot.
   */
  const railLabels = createMemo(() => {
    const view = chart();
    const rail = view.rail;
    if (!rail) return [];

    const wanted = leaders()
      .map((entry) => ({
        entry,
        endX: view.xAt(entry.item.points.length - 1),
        anchorY: view.yAt(entry.item.total),
      }))
      .sort((a, b) => a.anchorY - b.anchorY || a.entry.rank - b.entry.rank);
    if (wanted.length === 0) return [];

    const ceiling = PAD_TOP + LABEL_UP;
    const floor = Math.max(ceiling, view.baseline - LABEL_DOWN);
    // A short chart tightens the gap rather than pushing a label out of bounds.
    const gap =
      wanted.length > 1 ? Math.min(LABEL_GAP, (floor - ceiling) / (wanted.length - 1)) : 0;

    const ys = wanted.map((slot) => clamp(slot.anchorY, ceiling, floor));
    for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
    if (ys[ys.length - 1] > floor) {
      ys[ys.length - 1] = floor;
      // Walking back up always fits: the gap above was sized so that it does.
      for (let i = ys.length - 2; i >= 0; i -= 1) ys[i] = Math.min(ys[i], ys[i + 1] - gap);
    }

    const endX = rail.ruleX - 2;
    const drop = wanted.reduce(
      (most, slot, i) => Math.max(most, Math.abs(ys[i] - slot.anchorY)),
      0,
    );
    const run = wanted.reduce(
      (least, slot) => Math.min(least, endX - (slot.endX + view.dotRadius + 4)),
      Infinity,
    );
    // One bend length shared by every connector. Sharing the horizontal
    // schedule is what keeps them parallel instead of tangled once a label has
    // been displaced; the bend grows with the biggest displacement, so a long
    // drop stays a curve rather than turning into a hook.
    const bend = Math.min(Math.max(12, Math.min(drop * 0.9, 44)), Math.max(4, run));
    const bendX = endX - bend;
    const control = bend * 0.45;
    const nameRoom = Math.floor(rail.textRoom / NAME_ADVANCE);
    const at = (value: number) => value.toFixed(1);

    return wanted.map((slot, i) => {
      const y = ys[i];
      const startX = slot.endX + view.dotRadius + 4;
      return {
        index: slot.entry.index,
        colour: slot.entry.colour,
        name: truncate(slot.entry.item.login, nameRoom),
        total: slot.entry.total,
        // The rank cue is the first thing dropped if the rail is tight.
        rank:
          (slot.entry.rankText.length + slot.entry.total.length) * RAIL_META_ADVANCE + RANK_DX <=
          rail.textRoom
            ? slot.entry.rankText
            : null,
        y,
        // The connector back to the line end: level for as long as it can be,
        // then one bend into the label it was pushed to.
        link:
          Math.abs(y - slot.anchorY) < 0.5
            ? `M${at(startX)} ${at(slot.anchorY)} H${at(endX)}`
            : `M${at(startX)} ${at(slot.anchorY)} H${at(bendX)} C${at(bendX + control)} ${at(
                slot.anchorY,
              )}, ${at(endX - control)} ${at(y)}, ${at(endX)} ${at(y)}`,
      };
    });
  });

  /**
   * What the key underneath still has to carry. With the rail up, the leaders
   * are already named on the chart itself, so listing them again would only
   * make the key longer and the naming less pointed.
   */
  const keyItems = createMemo(() => {
    const entries = props.series
      .map((item, index) => ({ item, index }))
      .sort((a, b) => b.item.total - a.item.total || a.index - b.index)
      .map((entry, place) => ({ ...entry, rank: place + 1 }));
    if (!chart().rail) return entries;
    const named = new Set(leaders().map((entry) => entry.index));
    return entries.filter((entry) => !named.has(entry.index));
  });

  /** The chart described as it is currently presented, not as it usually is. */
  const description = () => {
    const base =
      `One line per account, adding up day by day from 1 January to ${formatDayLong(props.today)}. ` +
      "Each line stops at today; the rest of the year is empty.";
    const named = railLabels().length;
    if (named === 0) return `${base} Every account's current total is listed under the chart.`;
    const front =
      named === 1
        ? "The leading account is named beside the end of its line, with its current total."
        : `The top ${named === 2 ? "two" : "three"} accounts are named beside the ends of their lines, with their current totals.`;
    const rest =
      keyItems().length > 0 ? " Every remaining account's total is listed under the chart." : "";
    return `${base} ${front}${rest}`;
  };

  interface ActivePoint {
    index: number;
    day: number;
  }

  // Pointer and focus are independent: moving off a line should reveal a
  // keyboard annotation that was already there, not accidentally dismiss it.
  const [pointed, setPointed] = createSignal<ActivePoint | null>(null);
  const [focused, setFocused] = createSignal<ActivePoint | null>(null);
  const active = createMemo(() => {
    const pointer = pointed();
    if (pointer) return { ...pointer, keyboard: false };
    const keyboard = focused();
    return keyboard ? { ...keyboard, keyboard: true } : null;
  });

  /** The day index under the pointer, kept inside the line's own drawn range. */
  const dayUnderPointer = (event: PointerEvent, points: CumulativePoint[]) => {
    const view = chart();
    const box = (event.currentTarget as SVGPathElement).ownerSVGElement?.getBoundingClientRect();
    // The viewBox is authored in CSS pixels, but a frame mid-resize can still be
    // a fraction out, so map the pointer through the box actually rendered.
    const scale = box && box.width > 0 ? view.width / box.width : 1;
    const x = box ? (event.clientX - box.left) * scale : view.padLeft;
    const day = Math.round(((x - view.padLeft) / view.plotWidth) * view.span);
    return clamp(day, 0, points.length - 1);
  };

  const track = (index: number, points: CumulativePoint[]) => (event: PointerEvent) => {
    if (points.length === 0) return;
    setPointed({ index, day: dayUnderPointer(event, points) });
  };

  /** Arrow keys walk the anchor a week at a time; Escape puts the label away. */
  const onLineKey = (index: number, points: CumulativePoint[]) => (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setFocused(null);
      return;
    }
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (direction === 0 || points.length === 0) return;
    event.preventDefault();
    const step = Math.max(1, Math.round(chart().span / 52));
    setFocused((current) => {
      const from = current && current.index === index ? current.day : points.length - 1;
      return { index, day: clamp(from + direction * step, 0, points.length - 1) };
    });
  };

  /**
   * The annotation, solved rather than positioned: anchor it to a day on the
   * line, let the strings give way before the panel does, then flip it to the
   * other side of the anchor and clamp it into the plot so no edge can clip it.
   */
  const annotation = createMemo(() => {
    const state = active();
    if (!state) return null;
    const item = props.series[state.index];
    if (!item || item.points.length === 0) return null;

    const view = chart();
    const day = clamp(state.day, 0, item.points.length - 1);
    const point = item.points[day];
    const anchorX = view.xAt(day);
    const anchorY = view.yAt(point.total);

    // The panel can never be wider than the plot, so the text budget comes first.
    const textRoom = Math.max(36, view.plotWidth - TIP_CHROME - 2);
    const name = truncate(item.login, Math.floor(textRoom / NAME_ADVANCE));
    const metaRoom = Math.floor(textRoom / META_ADVANCE);
    const counted = formatNumber(point.total);
    // The date gives way before the running total when the chart gets tight.
    const options = [`${counted} · ${formatDayShort(point.date)}`, counted];
    const meta = truncate(
      options.find((option) => option.length <= metaRoom) ?? options[options.length - 1],
      metaRoom,
    );

    const width = Math.max(
      TIP_MIN_WIDTH,
      Math.ceil(Math.max(name.length * NAME_ADVANCE, meta.length * META_ADVANCE)) + TIP_CHROME,
    );

    const flipped = anchorX + TIP_GAP + width > view.rightEdge;
    const x = clamp(
      flipped ? anchorX - TIP_GAP - width : anchorX + TIP_GAP,
      view.padLeft + 1,
      view.rightEdge - width - 1,
    );
    const y = clamp(anchorY - TIP_HEIGHT / 2, PAD_TOP + 2, view.baseline - TIP_HEIGHT - 2);

    // Only draw the leader line when the panel ends up clear of its anchor.
    const edge = x + width < anchorX - 1 ? x + width : x > anchorX + 1 ? x : null;

    return {
      colour: seriesColour(state.index),
      keyboard: state.keyboard,
      anchorX,
      anchorY,
      x,
      y,
      width,
      name,
      meta,
      leader: edge === null ? null : { x: edge, y: clamp(anchorY, y + 8, y + TIP_HEIGHT - 8) },
    };
  });

  const activeIndex = () => active()?.index ?? -1;

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
            // A group rather than an image: the lines inside are focusable and
            // named, and role="img" would hide them from assistive technology.
            role="group"
            aria-label={`Running contribution totals for ${accounts()} accounts in ${props.year}`}
            aria-describedby="climb-chart-desc"
            // Backstop for a pointer flicked straight off the chart.
            onPointerLeave={() => setPointed(null)}
          >
            <desc id="climb-chart-desc">{description()}</desc>

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

            {/* The lines themselves take no pointer events: the hit layer below
                does that for them, and hands back the emphasis as state. No
                <title> here any more, or the browser's own bubble would turn up
                a second later and say the same thing twice. */}
            <g aria-hidden="true">
              <For each={stack()}>
                {(entry) => (
                  <path
                    class="pointer-events-none fill-none [stroke:var(--series,var(--color-dim))] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75] transition-[stroke-width] duration-150 data-[active=true]:[stroke-width:3.25]"
                    data-series={entry.index % SERIES_COLOURS.length}
                    data-active={entry.index === activeIndex() ? "true" : undefined}
                    d={entry.d}
                    style={{ "--series": entry.colour }}
                  />
                )}
              </For>
            </g>

            {/* A dot on every line's last day, so the stop at today is unmissable.
                It stays out of the pointer's way so the line keeps its label. */}
            <g aria-hidden="true">
              <For each={stack()}>
                {(entry) => (
                  <Show when={entry.item.points.length > 0}>
                    <circle
                      class="pointer-events-none [fill:var(--series,var(--color-dim))] stroke-void [stroke-width:1]"
                      data-series={entry.index % SERIES_COLOURS.length}
                      cx={chart().xAt(entry.item.points.length - 1)}
                      cy={chart().yAt(entry.item.total)}
                      r={chart().dotRadius}
                      style={{ "--series": entry.colour }}
                    />
                  </Show>
                )}
              </For>
            </g>

            {/* The label rail. Hidden from assistive technology on purpose: the
                focusable line paths already say the name and the total, and a
                second copy would only make the chart read twice as long. */}
            <Show when={chart().rail}>
              {(rail) => (
                <g class="pointer-events-none" aria-hidden="true">
                  {/* One hairline is all the separation the rail needs. */}
                  <line
                    class="stroke-line-soft"
                    x1={rail().separatorX}
                    x2={rail().separatorX}
                    y1={PAD_TOP}
                    y2={chart().baseline}
                  />

                  <For each={railLabels()}>
                    {(label) => (
                      <g style={{ "--series": label.colour }}>
                        <path
                          class="fill-none [stroke:var(--series,var(--color-dim))] [stroke-linecap:round] [stroke-width:1] opacity-40 transition-opacity duration-150 data-[active=true]:opacity-90"
                          data-series={label.index % SERIES_COLOURS.length}
                          data-active={label.index === activeIndex() ? "true" : undefined}
                          d={label.link}
                        />
                        <rect
                          class="[fill:var(--series,var(--color-dim))]"
                          x={rail().ruleX}
                          y={label.y - RAIL_RULE_H / 2}
                          width={RAIL_RULE_W}
                          height={RAIL_RULE_H}
                          rx={1}
                        />
                        <text
                          class="fill-ink font-mono text-[11px] font-medium tracking-[0.01em]"
                          x={rail().textX}
                          y={label.y + RAIL_NAME_DY}
                        >
                          {label.name}
                        </text>
                        <text
                          class="font-mono text-[9.5px] tracking-[0.04em]"
                          x={rail().textX}
                          y={label.y + RAIL_META_DY}
                        >
                          <Show when={label.rank}>
                            {(rank) => <tspan class="fill-faint">{rank()}</tspan>}
                          </Show>
                          <tspan class="fill-dim tabular-nums" dx={label.rank ? RANK_DX : 0}>
                            {label.total}
                          </tspan>
                        </text>
                      </g>
                    )}
                  </For>
                </g>
              )}
            </Show>

            {/* The pointer and keyboard target: an invisible fat copy of each
                line, so a 1.75px stroke is forgiving to hit without being drawn
                any heavier. Same order as the pile, so the leader wins overlaps. */}
            <g>
              <For each={stack()}>
                {(entry) => (
                  <path
                    class="fill-none [stroke:transparent] [stroke-linecap:round] [stroke-linejoin:round] [pointer-events:stroke] [outline:none]"
                    stroke-width={HIT_WIDTH}
                    d={entry.d}
                    // A line with nothing drawn has nothing to say, so it is
                    // skipped by the tab order rather than focused in silence.
                    tabindex={entry.item.points.length > 0 ? "0" : undefined}
                    role="img"
                    aria-label={entry.label}
                    onPointerEnter={track(entry.index, entry.item.points)}
                    onPointerMove={track(entry.index, entry.item.points)}
                    onPointerLeave={() =>
                      setPointed((current) =>
                        current?.index === entry.index ? null : current,
                      )
                    }
                    // Focus lands on today: a stable, meaningful point to read from.
                    onFocus={() =>
                      setFocused({
                        index: entry.index,
                        day: entry.item.points.length - 1,
                      })
                    }
                    onBlur={() =>
                      setFocused((current) =>
                        current?.index === entry.index ? null : current,
                      )
                    }
                    onKeyDown={onLineKey(entry.index, entry.item.points)}
                  />
                )}
              </For>
            </g>

            {/* The annotation. Last, so it sits over every line, and inert, so the
                line underneath keeps the pointer that summoned it. */}
            <Show when={annotation()}>
              {(tip) => (
                <g class="pointer-events-none" aria-hidden="true" style={{ "--series": tip().colour }}>
                  <Show when={tip().leader}>
                    {(leader) => (
                      <line
                        class="[stroke:var(--series,var(--color-dim))] [stroke-width:1] opacity-50"
                        x1={tip().anchorX}
                        y1={tip().anchorY}
                        x2={leader().x}
                        y2={leader().y}
                      />
                    )}
                  </Show>

                  {/* Keyboard focus needs a mark of its own: an outline round a
                      path would box in the whole chart, so ring the anchor. */}
                  <Show when={tip().keyboard}>
                    <circle
                      class="fill-none stroke-accent [stroke-width:1.25] opacity-80"
                      cx={tip().anchorX}
                      cy={tip().anchorY}
                      r={6.5}
                    />
                  </Show>

                  <circle
                    class="[fill:var(--series,var(--color-dim))] stroke-void [stroke-width:1.5]"
                    cx={tip().anchorX}
                    cy={tip().anchorY}
                    r={3.4}
                  />

                  <rect
                    class="fill-[rgba(8,10,22,0.95)] [stroke:var(--series,var(--color-dim))] [stroke-opacity:0.45] [stroke-width:1]"
                    x={tip().x}
                    y={tip().y}
                    width={tip().width}
                    height={TIP_HEIGHT}
                    rx={6}
                  />
                  <rect
                    class="[fill:var(--series,var(--color-dim))]"
                    x={tip().x + TIP_ACCENT_X}
                    y={tip().y + TIP_PAD_Y}
                    width={TIP_ACCENT_W}
                    height={TIP_HEIGHT - TIP_PAD_Y * 2}
                    rx={1}
                  />
                  <text
                    class="fill-ink font-mono text-[11px] font-medium tracking-[0.01em]"
                    x={tip().x + TIP_TEXT_X}
                    y={tip().y + TIP_NAME_BASELINE}
                  >
                    {tip().name}
                  </text>
                  <text
                    class="fill-dim font-mono text-[10px] tracking-[0.04em]"
                    x={tip().x + TIP_TEXT_X}
                    y={tip().y + TIP_META_BASELINE}
                  >
                    {tip().meta}
                  </text>
                </g>
              )}
            </Show>
          </svg>
        </div>
      </div>

      {/* The key, demoted to whatever the chart didn't already say. With the
          rail up it is the remainder — announced as such — and with three
          accounts or fewer there is no remainder, so it goes away entirely. */}
      <Show when={keyItems().length > 0}>
        <div class="mt-[0.85rem] flex flex-wrap items-start gap-x-[1.1rem] gap-y-[0.6rem]">
          <Show when={chart().rail}>
            <h3 class="pt-px text-[0.6rem] leading-[11px] tracking-[0.2em] text-dimmer uppercase max-phone:basis-full max-phone:tracking-[0.14em]">
              the rest
            </h3>
          </Show>
          <ul
            class="flex min-w-0 flex-1 list-none flex-wrap gap-x-[1.5rem] gap-y-[0.4rem] p-0 max-phone:grid max-phone:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] max-phone:gap-x-4 max-phone:gap-y-[0.45rem]"
            aria-label={
              chart().rail
                ? "Contributions so far, accounts ranked fourth and below"
                : "Contributions so far, by account"
            }
          >
            <For each={keyItems()}>
              {(entry) => (
                <li
                  class="flex min-w-0 items-center gap-[0.6rem] whitespace-nowrap max-phone:justify-start"
                  data-series={entry.index % SERIES_COLOURS.length}
                  style={{ "--series": seriesColour(entry.index) }}
                >
                  <span
                    class="h-5 w-[2px] flex-none rounded-full [background:var(--series,var(--color-dim))]"
                    aria-hidden="true"
                  />
                  <span class="min-w-0">
                    <span class="block overflow-hidden text-ellipsis text-[11px] leading-[11px] font-medium tracking-[0.01em] text-ink">
                      {entry.item.login}
                    </span>
                    <span class="mt-0.5 flex items-baseline gap-[0.5rem] text-[9.5px] leading-[9.5px] tracking-[0.04em]">
                      <span class="text-faint">{formatRank(entry.rank)}</span>
                      <span class="text-dim tabular-nums">{formatNumber(entry.item.total)}</span>
                    </span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}
