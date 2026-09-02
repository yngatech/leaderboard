import type { Grid, YearCell } from "../../shared/board.ts";
import {
  formatDayLong,
  formatMonth,
  formatNumber,
  formatOrdinal,
  weekdayIndex,
} from "../../shared/format.ts";
import { html, type Html } from "../html.ts";

/* ---------------------------------------------------------------------------
   Static counterparts to the old Heatmap and YearStrip components: the same
   arithmetic, rendered once into markup. Day and year tooltips are native SVG
   <title> elements, so they need no script at all.
--------------------------------------------------------------------------- */

export interface HeatmapOptions {
  /** Square edge in px at 1:1. The SVG scales down below that. */
  cell?: number;
  gap?: number;
  months?: boolean;
  /** Accessible summary of the strip. */
  label: string;
  /** Noun used in day tooltips. */
  unit?: string;
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

function dayTitle(count: number, date: string, unit: string): string {
  if (count === 0) return `No ${unit} on ${formatDayLong(date)}`;
  return `${count} ${count === 1 ? unit.replace(/s$/, "") : unit} on ${formatDayLong(date)}`;
}

export function heatmapSvg(weeks: Grid, options: HeatmapOptions): Html {
  const cell = options.cell ?? 9;
  const gap = options.gap ?? 3;
  const pitch = cell + gap;
  const unit = options.unit ?? "contributions";

  const width = Math.max(0, weeks.length * pitch - gap);
  const top = options.months ? MONTH_BAND : 0;
  const height = 7 * pitch - gap + top;
  const rx = Math.max(1, Math.round(cell * 0.22));

  const parts: Html[] = [];

  if (options.months) {
    const ticks: { x: number; label: string }[] = [];
    let previous = "";
    weeks.forEach((week, index) => {
      // Label from the first day of the week that belongs to the year.
      const first = week.find((day) => day.state !== "outside") ?? week[0];
      if (!first) return;
      const label = formatMonth(first.date);
      if (label !== previous && index <= weeks.length - 3) {
        ticks.push({ x: index * pitch, label });
        previous = label;
      }
    });
    // The grid opens mid-week, so drop a stub label that would collide.
    if (ticks.length > 1 && ticks[1].x - ticks[0].x < 3 * pitch) ticks.shift();
    for (const tick of ticks) {
      parts.push(
        html`<text
          class="fill-dimmer font-mono text-[10px] tracking-[0.06em]"
          x="${tick.x}"
          y="${MONTH_BAND - 6}"
          >${tick.label}</text
        >`,
      );
    }
  }

  /** Where the star goes, if this strip has a peak worth marking. */
  let peakMark: { level: number; points: string } | null = null;

  weeks.forEach((week, weekIndex) => {
    for (const day of week) {
      if (day.state === "outside") continue;
      const y = top + weekdayIndex(day.date) * pitch;
      const level = day.state === "day" ? html` data-level="${day.level}"` : null;
      const title =
        day.state === "day" ? html`<title>${dayTitle(day.count, day.date, unit)}</title>` : null;
      parts.push(
        // Level drives the ramp; "future" days are an outline rather than a
        // filled square, and only real days light up on hover.
        html`<rect
          class="heat-cell"
          data-state="${day.state}"${level}
          x="${weekIndex * pitch}"
          y="${y}"
          width="${cell}"
          height="${cell}"
          rx="${rx}"
          >${title}</rect
        >`,
      );

      if (
        options.peakDate &&
        day.date === options.peakDate &&
        day.state === "day" &&
        day.count > 0
      ) {
        peakMark = {
          level: day.level,
          points: starPoints(weekIndex * pitch + cell / 2, y + cell / 2, cell * STAR_RADIUS),
        };
      }
    }
  });

  // Drawn after the squares so the star sits on its own cell. It stays out
  // of the way of the pointer, so the cell keeps its hover and tooltip.
  if (peakMark !== null) {
    const mark: { level: number; points: string } = peakMark;
    parts.push(
      // The two brightest steps of the ramp need a dark marker to read.
      html`<polygon
        class="pointer-events-none fill-ink [shape-rendering:geometricPrecision] data-[level=3]:fill-void data-[level=4]:fill-void"
        data-level="${mark.level}"
        points="${mark.points}"
        aria-hidden="true"
      ></polygon>`,
    );
  }

  return html`<svg
    class="block h-auto w-full"
    viewBox="0 0 ${width} ${height}"
    width="${width}"
    height="${height}"
    role="img"
    aria-label="${options.label}"
    style="max-width:${width}px"
  >
    ${parts}
  </svg>`;
}

export interface YearStripOptions {
  /** Square edge in px at 1:1. The SVG scales down below that. */
  cell?: number;
  gap?: number;
  /** Print the year above each cell. */
  labels?: boolean;
  /** Print 1, 2, 3 inside the cells that placed that year. */
  podium?: boolean;
  /** Accessible summary of the strip. */
  label: string;
  /** Wrap each cell in a link to that year's board page. */
  hrefFor?: (year: number) => string;
}

const LABEL_BAND = 17;
const PODIUM = 3;

function yearTooltip(item: YearCell): string {
  const count = item.count === 1 ? "1 contribution" : `${formatNumber(item.count)} contributions`;
  const placing = item.rank ? ` · ${formatOrdinal(item.rank)} that year` : "";
  return `${count} in ${item.year}${placing}`;
}

/** The all-time counterpart to the heatmap: one row, one cell per year. */
export function yearStripSvg(cells: YearCell[], options: YearStripOptions): Html {
  const cell = options.cell ?? 30;
  const gap = options.gap ?? 4;
  const pitch = cell + gap;
  const top = options.labels ? LABEL_BAND : 0;

  const width = Math.max(0, cells.length * pitch - gap);
  const height = cell + top;
  const rx = Math.max(1, Math.round(cell * 0.22));

  const parts: Html[] = [];

  if (options.labels) {
    cells.forEach((item, index) => {
      parts.push(
        html`<text
          class="fill-dimmer font-mono text-[10px] tracking-[0.06em]"
          x="${index * pitch}"
          y="${LABEL_BAND - 6}"
          >${item.year}</text
        >`,
      );
    });
  }

  cells.forEach((item, index) => {
    const tooltip = yearTooltip(item);
    const rect = html`<rect
      class="heat-cell${options.hrefFor
        ? " cursor-pointer"
        : ""}"
      data-state="day"
      data-level="${item.level}"
      x="${index * pitch}"
      y="${top}"
      width="${cell}"
      height="${cell}"
      rx="${rx}"
      ><title>${tooltip}</title></rect
    >`;
    // A native SVG link, so keyboard access and new-tab clicks come for free.
    parts.push(
      options.hrefFor
        ? html`<a
            href="${options.hrefFor(item.year)}"
            aria-label="Show ${item.year}: ${tooltip}"
            >${rect}</a
          >`
        : rect,
    );
  });

  // Drawn after the squares so the digits sit on top of their own cell.
  if (options.podium) {
    cells.forEach((item, index) => {
      if (!item.rank || item.rank > PODIUM) return;
      parts.push(
        // The two brightest steps of the ramp need a dark digit to read.
        // pointer-events-none keeps the cell's own hover and tooltip.
        html`<text
          class="pointer-events-none fill-ink font-mono font-medium data-[level=3]:fill-void data-[level=4]:fill-void"
          data-level="${item.level}"
          x="${index * pitch + cell / 2}"
          y="${top + cell / 2}"
          font-size="${Math.round(cell * 0.46)}"
          text-anchor="middle"
          dominant-baseline="central"
          >${item.rank}</text
        >`,
      );
    });
  }

  const role = options.hrefFor ? "group" : "img";
  return html`<svg
    class="block h-auto w-full"
    viewBox="0 0 ${width} ${height}"
    width="${width}"
    height="${height}"
    role="${role}"
    aria-label="${options.label}"
    style="max-width:${width}px"
  >
    ${parts}
  </svg>`;
}
