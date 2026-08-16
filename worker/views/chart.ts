import type { CumulativePoint, CumulativeSeries } from "../../shared/board.ts";
import {
  formatDayLong,
  formatDayShort,
  formatMonth,
  formatNumber,
  formatRank,
} from "../../shared/format.ts";
import { html, type Html, jsonForScript } from "../html.ts";

/* ---------------------------------------------------------------------------
   The cumulative chart, drawn once at a fixed width. The SVG is width:100%
   height:auto, so it scales in the browser like any other image; what a
   resize can no longer do is re-decide the layout, so the geometry below is
   solved for CHART_WIDTH and stays solved. The hover readout lives in the
   enhancement script, fed by the JSON block this module emits — the page is
   complete without it.
--------------------------------------------------------------------------- */

export interface CumulativeChartOptions {
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

/** The one width the chart is drawn at. */
const CHART_WIDTH = 960;

/**
 * DM Mono advances 0.6em a glyph, so the width of a monospaced string is
 * arithmetic rather than a measurement. The extra covers tracking, the 500
 * weight and any fallback face: over-estimating pads the panel, which is
 * harmless, while under-estimating would push text through its own border.
 */
const NAME_ADVANCE = 11 * 0.62;

/* ---------------------------------------------------------------------------
   Label rail
   The accounts in front are worth naming permanently, but a name dropped on
   the plot would sit on top of the very lines it describes. So the rail is
   real reserved canvas: the plot gives the width up, the labels take it, and a
   connector ties each label back to the end of its line.
--------------------------------------------------------------------------- */

const LABEL_COUNT = 5;
const RAIL_MIN_WIDTH = 116;
const RAIL_MAX_WIDTH = 188;
/** Clear space between the plot edge and the labels, where connectors bend. */
const RAIL_GUTTER = 24;
/** The colour rule that stands in for the line, echoing the old tooltip accent. */
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
  /** Position in the series: the colour and the key both key off it. */
  index: number;
  rank: number;
  rankText: string;
  colour: string;
  total: string;
}

/** Clamps, but gives up to the low bound when there is no room at all. */
function clamp(value: number, low: number, high: number): number {
  return high <= low ? low : Math.min(Math.max(value, low), high);
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 1) return "…";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

/** The widest a label's two lines can be, by monospace arithmetic. */
function railTextWidth(entry: RailEntry): number {
  return Math.max(
    entry.item.login.length * NAME_ADVANCE,
    (entry.rankText.length + entry.total.length) * RAIL_META_ADVANCE + RANK_DX,
  );
}

/**
 * How much canvas to hand over: enough for the longest label it has to hold,
 * never enough to starve the plot.
 */
function railWidthFor(entries: RailEntry[]): number | null {
  if (entries.length === 0) return null;
  const text = entries.reduce((most, entry) => Math.max(most, railTextWidth(entry)), 0);
  const most = Math.min(RAIL_MAX_WIDTH, Math.round(CHART_WIDTH * 0.26));
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
export function cumulativeChartHtml(options: CumulativeChartOptions): Html {
  const { series, year, today } = options;

  /**
   * The accounts worth naming outright: the current top five by total, with
   * the board's own order breaking a tie so the choice never flickers. A line
   * with nothing drawn isn't a candidate — there is no line end to label.
   */
  const leaders: RailEntry[] = series
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
    }));

  const width = CHART_WIDTH;
  const height = Math.round(Math.min(210, Math.max(150, width * 0.24)));

  const dayCount = Math.round((Date.UTC(year, 11, 31) - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
  const drawnDays = series.reduce((most, item) => Math.max(most, item.points.length), 0);

  const peak = series.reduce((most, item) => Math.max(most, item.total), 0);
  // An all-zero board still needs a valid scale: every line sits on the floor.
  const scaleMax = peak > 0 ? niceMax(peak) : 0;

  const padLeft = Math.max(26, (scaleMax > 0 ? formatNumber(scaleMax).length : 1) * 6 + 12);
  // The rail is width the plot gives up, not width it lends: all data marks
  // stay left of rightEdge while the persistent labels live beyond it.
  const railWidth = railWidthFor(leaders);
  const plotWidth = Math.max(1, width - padLeft - PAD_RIGHT - (railWidth ?? 0));
  const plotHeight = Math.max(1, height - PAD_TOP - PAD_BOTTOM);
  const baseline = PAD_TOP + plotHeight;
  const span = Math.max(1, dayCount - 1);

  const xAt = (index: number) => padLeft + (index / span) * plotWidth;
  const yAt = (value: number) =>
    scaleMax > 0 ? baseline - (value / scaleMax) * plotHeight : baseline;

  const todayX = xAt(Math.max(0, drawnDays - 1));
  const rightEdge = padLeft + plotWidth;
  const dotRadius = 3.2;
  // Late in the year the caption has to flip inside the line, not off the edge.
  const todayTight = rightEdge - todayX < 46;
  const todayLabelX = todayTight ? todayX - 5 : todayX + 5;

  const months = Array.from({ length: 12 }, (_, month) => {
    const index = Math.round((Date.UTC(year, month, 1) - Date.UTC(year, 0, 1)) / DAY_MS);
    return { x: xAt(index), label: formatMonth(`${year}-${String(month + 1).padStart(2, "0")}-01`) };
  });

  // A half-way line only helps when it lands on a whole number.
  const gridValues =
    scaleMax <= 0 ? [0] : Number.isInteger(scaleMax / 2) ? [0, scaleMax / 2, scaleMax] : [0, scaleMax];

  /** The sentence a line answers to in the accessibility tree. */
  const seriesLabel = (item: CumulativeSeries) => {
    const who = identity(item);
    return `${who.name}${who.handle ? ` ${who.handle}` : ""}: ${formatNumber(item.total)} ${
      item.total === 1 ? "contribution" : "contributions"
    } to ${formatDayShort(today)}`;
  };

  /** Draw the leader last so the brightest line sits on top of the pile. */
  const stack = series
    .map((item, index) => ({
      item,
      index,
      colour: seriesColour(index),
      d: linePath(item.points, xAt, yAt),
      label: seriesLabel(item),
    }))
    .reverse();

  /* Where the permanent labels actually sit. Each one wants to be level with
     the end of its line; the solver only ever pushes them apart, never past
     each other, so the order down the rail is always the order of the lines.
     The floor is the last word: a label pushed off the bottom drags the ones
     above it back up instead of leaving the plot. */
  interface RailLabel {
    index: number;
    colour: string;
    name: string;
    total: string;
    rank: string | null;
    y: number;
    link: string;
  }

  let railLabels: RailLabel[] = [];
  const rail =
    railWidth === null
      ? null
      : {
          width: railWidth,
          separatorX: rightEdge + RAIL_SEPARATOR_INSET,
          ruleX: rightEdge + RAIL_GUTTER,
          textX: rightEdge + RAIL_TEXT_INSET,
          textRoom: railWidth - RAIL_TEXT_INSET - 2,
        };

  if (rail) {
    const wanted = leaders
      .map((entry) => ({
        entry,
        endX: xAt(entry.item.points.length - 1),
        anchorY: yAt(entry.item.total),
      }))
      .sort((a, b) => a.anchorY - b.anchorY || a.entry.rank - b.entry.rank);

    if (wanted.length > 0) {
      const ceiling = PAD_TOP + LABEL_UP;
      const floor = Math.max(ceiling, baseline - LABEL_DOWN);
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
      const nameRoom = Math.floor(rail.textRoom / NAME_ADVANCE);
      const at = (value: number) => value.toFixed(1);

      railLabels = wanted.map((slot, i) => {
        const y = ys[i];
        const startX = slot.endX + dotRadius + 4;
        const run = Math.max(0, endX - startX);
        // Leave just enough straight line to clear the endpoint, then fan out
        // across the available space instead of bunching every bend at the rail.
        const bendX = startX + Math.min(run, 12, Math.max(4, run * 0.12));
        const control = Math.max(0, endX - bendX) * 0.28;
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
          // The connector back to the line end: level for as long as it can
          // be, then one bend into the label it was pushed to.
          link:
            Math.abs(y - slot.anchorY) < 0.5
              ? `M${at(startX)} ${at(slot.anchorY)} H${at(endX)}`
              : `M${at(startX)} ${at(slot.anchorY)} H${at(bendX)} C${at(bendX + control)} ${at(
                  slot.anchorY,
                )}, ${at(endX - control)} ${at(y)}, ${at(endX)} ${at(y)}`,
        };
      });
    }
  }

  /** What the key underneath still has to carry: everyone the rail didn't name. */
  const ranked = series
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.total - a.item.total || a.index - b.index)
    .map((entry, place) => ({ ...entry, rank: place + 1 }));
  const named = new Set(leaders.map((entry) => entry.index));
  const keyItems = rail ? ranked.filter((entry) => !named.has(entry.index)) : ranked;

  /** The chart described as it is currently presented, not as it usually is. */
  const namedCount = railLabels.length;
  const descriptionBase =
    `One line per account, adding up day by day from 1 January to ${formatDayLong(today)}. ` +
    "Each line stops at today; the rest of the year is empty.";
  const description =
    namedCount === 0
      ? `${descriptionBase} Every account's current total is listed under the chart.`
      : `${descriptionBase} ${
          namedCount === 1
            ? "The leading account is named beside the end of its line, with its current total."
            : `The top ${namedCount} accounts are named beside the ends of their lines, with their current totals.`
        }${keyItems.length > 0 ? " Every remaining account's total is listed under the chart." : ""}`;

  const svg: Html[] = [];

  svg.push(html`<desc id="climb-chart-desc">${description}</desc>`);

  const backdrop: Html[] = [];
  // The part of the year that hasn't happened, left deliberately bare.
  if (rightEdge - todayX > 1) {
    backdrop.push(
      html`<rect
        class="fill-[rgba(10,12,24,0.5)]"
        x="${todayX.toFixed(1)}"
        y="${PAD_TOP}"
        width="${(rightEdge - todayX).toFixed(1)}"
        height="${baseline - PAD_TOP}"
      ></rect>`,
    );
  }
  for (const month of months) {
    backdrop.push(
      html`<line
        class="stroke-line-soft opacity-[0.55]"
        x1="${month.x.toFixed(1)}"
        x2="${month.x.toFixed(1)}"
        y1="${PAD_TOP}"
        y2="${baseline}"
      ></line>`,
    );
  }
  for (const value of gridValues) {
    const cls = value === 0 ? "stroke-line" : "stroke-line-soft [stroke-dasharray:1_5]";
    backdrop.push(
      html`<line
          class="${cls}"
          x1="${padLeft}"
          x2="${rightEdge.toFixed(1)}"
          y1="${yAt(value).toFixed(1)}"
          y2="${yAt(value).toFixed(1)}"
        ></line
        ><text
          class="fill-dimmer font-mono text-[10px] tracking-[0.06em]"
          x="${padLeft - 8}"
          y="${(yAt(value) + 3).toFixed(1)}"
          text-anchor="end"
          >${formatNumber(value)}</text
        >`,
    );
  }
  for (const month of months) {
    backdrop.push(
      html`<text
        class="fill-dimmer font-mono text-[10px] tracking-[0.06em]"
        x="${(month.x + 2).toFixed(1)}"
        y="${height - 7}"
        >${month.label}</text
      >`,
    );
  }
  backdrop.push(
    html`<line
        class="stroke-[rgba(236,234,247,0.24)] [stroke-dasharray:2_4]"
        x1="${todayX.toFixed(1)}"
        x2="${todayX.toFixed(1)}"
        y1="${PAD_TOP - 6}"
        y2="${baseline}"
      ></line
      ><text
        class="fill-dim font-mono text-[9px] tracking-[0.12em] uppercase"
        x="${todayLabelX.toFixed(1)}"
        y="${PAD_TOP - 8}"
        text-anchor="${todayTight ? "end" : "start"}"
        >today</text
      >`,
  );
  svg.push(html`<g aria-hidden="true">${backdrop}</g>`);

  // The lines. Each drawn path is its own named image, so the chart reads out
  // one account at a time; the old invisible hit copies existed only for the
  // pointer, which the enhancement script now serves from the JSON block.
  const lines = stack
    .map(
      (entry) =>
        html`<path
          class="fill-none [stroke:var(--series,var(--color-dim))] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]"
          data-series="${entry.index % SERIES_COLOURS.length}"
          d="${entry.d}"
          style="--series:${entry.colour}"
          role="img"
          aria-label="${entry.label}"
        ></path>`,
    );
  svg.push(html`<g>${lines}</g>`);

  // A dot on every line's last day, so the stop at today is unmissable.
  const dots = stack
    .filter((entry) => entry.item.points.length > 0)
    .map(
      (entry) =>
        html`<circle
          class="[fill:var(--series,var(--color-dim))] stroke-void [stroke-width:1]"
          data-series="${entry.index % SERIES_COLOURS.length}"
          cx="${xAt(entry.item.points.length - 1).toFixed(1)}"
          cy="${yAt(entry.item.total).toFixed(1)}"
          r="${dotRadius}"
          style="--series:${entry.colour}"
        ></circle>`,
    );
  svg.push(html`<g aria-hidden="true">${dots}</g>`);

  // The label rail. Hidden from assistive technology on purpose: the named
  // line paths already say the name and the total, and a second copy would
  // only make the chart read twice as long.
  if (rail && railLabels.length > 0) {
    const railParts: Html[] = [
      // One hairline is all the separation the rail needs.
      html`<line
        class="stroke-line-soft"
        x1="${rail.separatorX.toFixed(1)}"
        x2="${rail.separatorX.toFixed(1)}"
        y1="${PAD_TOP}"
        y2="${baseline}"
      ></line>`,
    ];
    for (const label of railLabels) {
      const meta = label.rank
        ? html`<tspan class="fill-faint">${label.rank}</tspan
            ><tspan class="fill-dim tabular-nums" dx="${RANK_DX}">${label.total}</tspan>`
        : html`<tspan class="fill-dim tabular-nums">${label.total}</tspan>`;
      railParts.push(
        html`<g style="--series:${label.colour}">
          <path
            class="fill-none [stroke:var(--series,var(--color-dim))] [stroke-linecap:round] [stroke-width:1] opacity-40"
            data-series="${label.index % SERIES_COLOURS.length}"
            d="${label.link}"
          ></path>
          <rect
            class="[fill:var(--series,var(--color-dim))]"
            x="${rail.ruleX.toFixed(1)}"
            y="${(label.y - RAIL_RULE_H / 2).toFixed(1)}"
            width="${RAIL_RULE_W}"
            height="${RAIL_RULE_H}"
            rx="1"
          ></rect>
          <text
            class="fill-ink font-mono text-[11px] font-medium tracking-[0.01em]"
            x="${rail.textX.toFixed(1)}"
            y="${(label.y + RAIL_NAME_DY).toFixed(1)}"
            >${label.name}</text
          ><text
            class="font-mono text-[9.5px] tracking-[0.04em]"
            x="${rail.textX.toFixed(1)}"
            y="${(label.y + RAIL_META_DY).toFixed(1)}"
            >${meta}</text
          >
        </g>`,
      );
    }
    svg.push(html`<g class="pointer-events-none" aria-hidden="true">${railParts}</g>`);
  }

  // The key, demoted to whatever the chart didn't already say. With the rail
  // up it is the remainder — announced as such — and with five accounts or
  // fewer there is no remainder, so it goes away entirely.
  let key: Html | null = null;
  if (keyItems.length > 0) {
    const heading = rail
      ? html`<h3
          class="pt-px text-[0.6rem] leading-[11px] tracking-[0.2em] text-dimmer uppercase max-phone:basis-full max-phone:tracking-[0.14em]"
        >
          the rest
        </h3>`
      : null;
    const listLabel = rail
      ? `Contributions so far, accounts ranked ${formatRank(LABEL_COUNT + 1)} and below`
      : "Contributions so far, by account";
    const items = keyItems
      .map(
        (entry) =>
          html`<li
            class="flex min-w-0 items-center gap-[0.6rem] whitespace-nowrap max-phone:justify-start"
            data-series="${entry.index % SERIES_COLOURS.length}"
            style="--series:${seriesColour(entry.index)}"
          >
            <span
              class="h-5 w-[2px] flex-none rounded-full [background:var(--series,var(--color-dim))]"
              aria-hidden="true"
            ></span
            ><span class="min-w-0"
              ><span
                class="block overflow-hidden text-ellipsis text-[11px] leading-[11px] font-medium tracking-[0.01em] text-ink"
                >${entry.item.login}</span
              ><span
                class="mt-0.5 flex items-baseline gap-[0.5rem] text-[9.5px] leading-[9.5px] tracking-[0.04em]"
                ><span class="text-faint">${formatRank(entry.rank)}</span
                ><span class="text-dim tabular-nums"
                  >${formatNumber(entry.item.total)}</span
                ></span
              ></span
            >
          </li>`,
      );
    key = html`<div
      class="mt-[0.85rem] flex flex-wrap items-start gap-x-[1.1rem] gap-y-[0.6rem]"
    >
      ${heading}<ul
        class="flex min-w-0 flex-1 list-none flex-wrap gap-x-[1.5rem] gap-y-[0.4rem] p-0 max-phone:grid max-phone:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] max-phone:gap-x-4 max-phone:gap-y-[0.45rem]"
        aria-label="${listLabel}"
      >
        ${items}
      </ul>
    </div>`;
  }

  /** Everything the hover readout needs to map a pointer back to a day. */
  const climbData = {
    year,
    padLeft,
    plotWidth,
    span,
    width,
    series: series.map((item, index) => ({
      login: item.login,
      colour: seriesColour(index),
      totals: item.points.map((point) => point.total),
    })),
  };

  return html`<section
    class="mt-[clamp(2.25rem,5vw,3.25rem)] animate-rise"
    aria-labelledby="climb-heading"
  >
    <div
      class="mb-[0.9rem] flex flex-wrap items-center gap-x-[0.85rem] gap-y-2 text-[0.66rem] tracking-[0.2em] text-dimmer uppercase max-phone:tracking-[0.14em]"
    >
      <h2 id="climb-heading">cumulative contributions</h2>
      <span class="h-px min-w-6 flex-[1_1_24px] bg-line-soft" aria-hidden="true"></span>
    </div>
    <div
      class="rounded-2xl border border-line bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-4 pt-[0.9rem] pb-[0.7rem] max-phone:px-[0.65rem] max-phone:pt-[0.7rem] max-phone:pb-2"
    >
      <div class="relative w-full">
        <svg
          id="climb"
          class="block h-auto w-full"
          viewBox="0 0 ${width} ${height}"
          width="${width}"
          height="${height}"
          role="group"
          aria-label="Running contribution totals for ${series.length} accounts in ${year}"
          aria-describedby="climb-chart-desc"
        >
          ${svg}
        </svg>
      </div>
    </div>
    ${key}<script type="application/json" id="climb-data">${jsonForScript(climbData)}</script>
  </section>`;
}
