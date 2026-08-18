import type { Grid, YearShape } from "../../shared/board.ts";
import { formatDayShort, formatMonth, formatNumber } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";

/* ---------------------------------------------------------------------------
   The README card: one account's year as a standalone SVG document.

   A card is loaded through an <img>, where the SVG is its own document with no
   stylesheet, no script and no permission to fetch anything, so everything it
   needs is inline. Mono type throughout also makes the layout possible: at a
   0.6em advance a label can be measured here rather than by a browser.

   No standing, deliberately: that is a fact about a group, and last of nine is
   not something to hand somebody for their profile.
--------------------------------------------------------------------------- */

export interface CardUser {
  login: string;
  name: string | null;
  /** `data:` URI. Remote hrefs never load inside an <img>, so this or nothing. */
  avatar: string | null;
}

/**
 * `data:` URIs, as Vite's `?inline` hands them over: a remote font URL never
 * loads inside an <img>, but a data URI is not a fetch. Omit them and the card
 * falls back to the system stacks.
 */
export interface CardFonts {
  display: string;
  mono: string;
}

/** The milestone half of `UserGoals`, which satisfies this structurally. */
export interface CardGoal {
  nextMilestone: number | null;
}

export interface CardInput {
  user: CardUser;
  /** The year the grid covers. */
  year: number;
  total: number;
  allTime: number;
  /** First year with any contributions, so the all-time figure has a span. */
  firstYear: number;
  grid: Grid;
  shape: YearShape;
  /** Consecutive contributing days still alive, from `currentStreak`. */
  currentStreak: number;
  goals: CardGoal;
  fonts?: CardFonts;
  /** ISO timestamp the underlying board was generated. */
  generatedAt: string;
  site: string;
}

/* Palette, lifted from the site theme. Inline because the card has no CSS. */
const HEAT = ["#191e38", "#4c2a70", "#9b3273", "#e2603a", "#ffc24d"] as const;
const INK = "#eceaf7";
const DIM = "#918fb4";
const FAINT = "#7a7899";

const PAD = 20;
/** A 7px pitch is what fits two cards side by side in a README column. */
const CELL = 5;
const GAP = 2;
const PITCH = CELL + GAP;
const MONTH_BAND = 13;
const AVATAR = 44;
const BAR_HEIGHT = 5;
/** Matches .scale below, so the track can be measured against it. */
const SCALE_SIZE = 10;

/**
 * The subset woff2s ride inside every card, so each card is a copy of the font
 * software and OFL-1.1 clause 2 asks it to carry the notice.
 */
const LICENCE = html`<!--
    Bricolage Grotesque © 2022 The Bricolage Grotesque Project Authors.
    DM Mono © 2020 The DM Mono Project Authors.
    Both subset and embedded under the SIL Open Font License 1.1:
    https://scripts.sil.org/OFL
  -->`;

const MONO_STACK = "'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const DISPLAY_STACK = "'Bricolage Grotesque', 'Trebuchet MS', system-ui, sans-serif";

/** DM Mono and every fallback in the stack sit at a 0.6em advance. */
const ADVANCE = 0.6;

function fontFaces(fonts: CardFonts | undefined): Html[] {
  if (!fonts) return [];
  // Escaped like everything else. A bare ampersand in a src would be a fatal
  // entity error, and a card that fails to parse is a broken image.
  const face = (family: string, weight: number, source: string) =>
    html`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(${source}) format('woff2');}`;
  return [face("DM Mono", 400, fonts.mono), face("Bricolage Grotesque", 800, fonts.display)];
}
function monoWidth(text: string, size: number): number {
  return cells(text) * size * ADVANCE;
}

/**
 * A display name is whatever GitHub holds. Quotes and angle brackets are
 * escaped for us, but C0 controls are illegal in XML and would take the whole
 * card down with them.
 */
function plain(text: string): string {
  return [...text].filter((character) => character >= " " && character !== "\u007f").join("");
}

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

/** Cells, not characters: CJK is full-width, and a surrogate pair is one glyph. */
function cells(text: string): number {
  return [...text].reduce((width, character) => width + (WIDE.test(character) ? 2 : 1), 0);
}

function clamp(text: string, max: number): string {
  if (max <= 1) return "…";
  if (cells(text) <= max) return text;
  let width = 0;
  const kept: string[] = [];
  for (const character of text) {
    width += WIDE.test(character) ? 2 : 1;
    if (width > max - 1) break;
    kept.push(character);
  }
  return `${kept.join("")}…`;
}

function facts(input: CardInput): string {
  const lines: string[] = [];
  const { activeDays, bestDay } = input.shape;

  if (activeDays > 0) lines.push(`${activeDays} active ${activeDays === 1 ? "day" : "days"}`);
  if (input.currentStreak > 1) lines.push(`${input.currentStreak}-day streak`);
  else if (bestDay) {
    lines.push(`best day ${formatNumber(bestDay.count)} on ${formatDayShort(bestDay.date)}`);
  }

  return lines.join(" · ");
}

/**
 * One initial a month, centred over the column holding the 1st — not the first
 * column the month owns outright, which is a column to the right of its data.
 */
function monthTicks(grid: Grid): { x: number; label: string }[] {
  const ticks: { x: number; label: string }[] = [];
  grid.forEach((week, index) => {
    for (const day of week) {
      if (day.state === "outside" || day.date.slice(8) !== "01") continue;
      ticks.push({
        x: index * PITCH + CELL / 2,
        label: formatMonth(day.date).charAt(0).toUpperCase(),
      });
    }
  });
  return ticks;
}

/**
 * The total against the next milestone, which is what the numbers at either
 * end of the track say. Measuring across the current rung instead (2,500 →
 * 5,000) moves faster but inverts on a shelf: 2,949 would show less bar than
 * 796, whose rung is four times narrower.
 */
function milestoneProgress(total: number, next: number | null): number {
  if (next === null || next <= 0) return 1;
  return Math.min(1, Math.max(0, total / next));
}

/** Empty rather than throwing: a bad stamp should cost the line, not the card. */
function asOf(generatedAt: string): string {
  const day = generatedAt.slice(0, 10);
  return Number.isNaN(Date.parse(day)) ? "" : `as of ${formatDayShort(day)}`;
}

export function cardSvg(input: CardInput): string {
  const { user, year, grid } = input;

  const gridWidth = Math.max(0, grid.length * PITCH - GAP);
  const width = gridWidth + PAD * 2;

  /* Vertical rhythm, top down. The two totals share a row at one size:
     stacked diagonally at different sizes, reading order and hierarchy
     disagreed about which came first. */
  const headerY = PAD;
  const statsTop = headerY + AVATAR + 18;
  const totalBaseline = statsTop + 22;
  const totalLabelBaseline = totalBaseline + 13;
  const barY = totalLabelBaseline + 16;
  const factsBaseline = barY + BAR_HEIGHT + 15;
  const gridTop = factsBaseline + 12;
  const cellsTop = gridTop + MONTH_BAND;
  const gridBottom = cellsTop + 7 * PITCH - GAP;
  // Two pixels up: the descender makes an even gap read as too low.
  const footerBaseline = gridBottom + 17;
  const height = footerBaseline + 10;

  const parts: Html[] = [];

  /* --- header: avatar, name, career total -------------------------------- */

  const textX = PAD + (user.avatar ? AVATAR + 13 : 0);

  if (user.avatar) {
    parts.push(html`<image
      href="${user.avatar}"
      x="${PAD}"
      y="${headerY}"
      width="${AVATAR}"
      height="${AVATAR}"
      clip-path="url(#avatar)"
      preserveAspectRatio="xMidYMid slice"
    ></image>`);
  }

  const nameRoom = Math.floor((width - PAD - textX) / (15 * ADVANCE));

  parts.push(
    html`<text class="name" x="${textX}" y="${headerY + 19}"
      >${clamp(plain(user.name ?? user.login), nameRoom)}</text
    >`,
    html`<text class="sub" x="${textX}" y="${headerY + 36}">@${user.login}</text>`,
  );

  /* --- the number, and what it is chasing ------------------------------- */

  const career = formatNumber(input.allTime);

  parts.push(
    html`<text class="total" x="${PAD}" y="${totalBaseline}">${formatNumber(input.total)}</text>`,
    // Cased here, not in CSS: text-transform is a browser nicety.
    html`<text class="label" x="${PAD}" y="${totalLabelBaseline}">IN ${year}</text>`,
    html`<text class="total" x="${width - PAD}" y="${totalBaseline}" text-anchor="end">${career}</text>`,
    // Stated with its span: "all time" alone says nothing about how long.
    html`<text class="label" x="${width - PAD}" y="${totalLabelBaseline}" text-anchor="end"
      >CONTRIBUTIONS SINCE ${input.firstYear}</text
    >`,
  );

  /* The bar, flanked by the ends of its own scale — unlabelled, a filled bar
     is decoration to anyone who has not seen this board before. */
  const target = input.goals.nextMilestone;
  const progress = milestoneProgress(input.total, target);
  // Past the top of the ladder there is nothing to count towards.
  const scale = target === null ? null : { from: "0", to: formatNumber(target) };

  const trackX = scale === null ? PAD : PAD + monoWidth(scale.from, SCALE_SIZE) + 8;
  const trackEnd = scale === null ? width - PAD : width - PAD - monoWidth(scale.to, SCALE_SIZE) - 8;
  const track = Math.max(0, trackEnd - trackX);
  // Reads on the bar's centre line rather than its baseline.
  const scaleBaseline = barY + BAR_HEIGHT + 1;

  if (scale) {
    parts.push(
      html`<text class="scale" x="${PAD}" y="${scaleBaseline}">${scale.from}</text>`,
      html`<text class="scale" x="${width - PAD}" y="${scaleBaseline}" text-anchor="end"
        >${scale.to}</text
      >`,
    );
  }

  parts.push(
    html`<rect x="${trackX}" y="${barY}" width="${track}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}" fill="#191e38"></rect>`,
  );
  if (progress > 0) {
    parts.push(
      html`<rect
        x="${trackX}"
        y="${barY}"
        width="${Math.max(BAR_HEIGHT, track * progress).toFixed(1)}"
        height="${BAR_HEIGHT}"
        rx="${BAR_HEIGHT / 2}"
        fill="url(#ramp)"
      ></rect>`,
    );
  }

  const summary = facts(input);
  if (summary !== "") {
    parts.push(html`<text class="fact" x="${PAD}" y="${factsBaseline}">${summary}</text>`);
  }

  /* --- the year --------------------------------------------------------- */

  for (const tick of monthTicks(grid)) {
    parts.push(
      html`<text class="month" x="${PAD + tick.x}" y="${gridTop + 8}" text-anchor="middle"
        >${tick.label}</text
      >`,
    );
  }

  grid.forEach((week, weekIndex) => {
    // The row is the day's place in the week, not something to re-derive from
    // the date — `userGrid` can be built from any first weekday.
    week.forEach((day, dayIndex) => {
      if (day.state === "outside") return;
      const future = day.state === "future";
      // An attribute fragment, not a string: interpolated markup would be escaped.
      const stroke = future ? html` stroke="rgba(236,234,247,0.09)"` : null;
      parts.push(
        html`<rect
          x="${PAD + weekIndex * PITCH}"
          y="${cellsTop + dayIndex * PITCH}"
          width="${CELL}"
          height="${CELL}"
          rx="1.5"
          fill="${future ? "none" : HEAT[day.level]}"${stroke}
        ></rect>`,
      );
    });
  });

  /* --- footer ------------------------------------------------------------ */

  parts.push(
    html`<text class="foot" x="${PAD}" y="${footerBaseline}"
      >${input.site.replace(/^https?:\/\//, "")}/u/${user.login}</text
    >`,
    html`<text class="foot" x="${width - PAD}" y="${footerBaseline}" text-anchor="end"
      >${asOf(input.generatedAt)}</text
    >`,
  );

  const alt = `${plain(user.name ?? user.login)}: ${formatNumber(input.total)} GitHub contributions in ${year}, ${career} since ${input.firstYear}.`;

  return document({ width, height, alt, fonts: input.fonts, body: parts });
}

/**
 * A roster account GitHub has no data for: renamed, deleted, suspended. A card
 * rather than a 404, which would be a broken image on somebody's profile, and
 * deliberately not a zero — an empty grid would claim they had a quiet year.
 */
export function absentCardSvg(input: AbsentCardInput): string {
  const { user } = input;
  const width = ABSENT_WIDTH;
  const headerY = PAD;
  // Usually no avatar to fetch either; holding the band open leaves a hole.
  const messageBaseline = headerY + (user.avatar ? AVATAR : 26) + 26;
  const footerBaseline = messageBaseline + 22;
  const height = footerBaseline + 10;
  const textX = PAD + (user.avatar ? AVATAR + 13 : 0);

  const parts: Html[] = [];

  if (user.avatar) {
    parts.push(html`<image
      href="${user.avatar}"
      x="${PAD}"
      y="${headerY}"
      width="${AVATAR}"
      height="${AVATAR}"
      clip-path="url(#avatar)"
      preserveAspectRatio="xMidYMid slice"
    ></image>`);
  }

  // The board's own wording, so site and card do not differ. No display name
  // either, usually, so the heading takes the handle and the sub line goes.
  const message = "No GitHub data for this account.";
  const heading = plain(user.name ?? `@${user.login}`);

  parts.push(
    html`<text class="name" x="${textX}" y="${headerY + 19}">${clamp(heading, 24)}</text>`,
  );
  if (user.name !== null) {
    parts.push(html`<text class="sub" x="${textX}" y="${headerY + 36}">@${user.login}</text>`);
  }

  parts.push(
    html`<text class="fact" x="${PAD}" y="${messageBaseline}">${message}</text>`,
    html`<text class="foot" x="${PAD}" y="${footerBaseline}"
      >${input.site.replace(/^https?:\/\//, "")}/u/${user.login}</text
    >`,
  );

  return document({ width, height, alt: message, fonts: input.fonts, body: parts });
}

export interface AbsentCardInput {
  user: CardUser;
  site: string;
  fonts?: CardFonts;
}

/** Card width when there is no grid to set it. */
const ABSENT_WIDTH = 409;

interface Document {
  width: number;
  height: number;
  alt: string;
  fonts: CardFonts | undefined;
  body: Html[];
}

/**
 * The shell both cards share. The ramp is pinned to the track in user space,
 * not to the filled rect, so the fill uncovers it rather than squeezing a
 * whole gradient into a tenth of the bar. (In here, not an SVG comment: that
 * would ship in every card.)
 */
function document({ width, height, alt, fonts, body }: Document): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${html`<svg
    xmlns="http://www.w3.org/2000/svg"
    width="${width}"
    height="${height}"
    viewBox="0 0 ${width} ${height}"
    role="img"
    aria-label="${alt}"
    font-family="${MONO_STACK}"
  >
    <title>${alt}</title>
    ${fonts ? LICENCE : null}
    <defs>
      <clipPath id="avatar">
        <rect x="${PAD}" y="${PAD}" width="${AVATAR}" height="${AVATAR}" rx="${AVATAR / 2}"></rect>
      </clipPath>
      <linearGradient
        id="ramp"
        gradientUnits="userSpaceOnUse"
        x1="${PAD}"
        y1="0"
        x2="${width - PAD}"
        y2="0"
      >
        <stop offset="0" stop-color="${HEAT[2]}"></stop>
        <stop offset="1" stop-color="${HEAT[4]}"></stop>
      </linearGradient>
      <radialGradient id="aurora-a" cx="0.36" cy="0" r="0.9">
        <stop offset="0" stop-color="#9b3273" stop-opacity="0.30"></stop>
        <stop offset="1" stop-color="#9b3273" stop-opacity="0"></stop>
      </radialGradient>
      <radialGradient id="aurora-b" cx="0.94" cy="0.06" r="0.7">
        <stop offset="0" stop-color="#ffc24d" stop-opacity="0.13"></stop>
        <stop offset="1" stop-color="#ffc24d" stop-opacity="0"></stop>
      </radialGradient>
    </defs>
    <style>
      ${fontFaces(fonts)}
      .name { fill: ${INK}; font-size: 15px; font-weight: 500; }
      .sub { fill: ${DIM}; font-size: 11px; }
      .label { fill: ${FAINT}; font-size: 9px; letter-spacing: 0.08em; }
      /* No tracking: on a single centred glyph it is a half-pixel of lean. */
      .month { fill: ${FAINT}; font-size: 9px; }
      .total {
        fill: ${INK};
        font-family: ${DISPLAY_STACK};
        font-size: 30px;
        font-weight: 800;
        letter-spacing: -0.03em;
      }
      .scale { fill: ${DIM}; font-size: 10px; }
      .fact { fill: ${DIM}; font-size: 11px; }
      .foot { fill: ${FAINT}; font-size: 9px; }
    </style>
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="#12162b" stroke="#262c4c"></rect>
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="url(#aurora-a)"></rect>
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="url(#aurora-b)"></rect>
    ${body}
  </svg>`}\n`;
}
