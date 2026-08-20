import { formatNumber } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { MONO_STACK, monoWidth } from "./mono.ts";

/* ---------------------------------------------------------------------------
   README badges: one number each, in the shape a README already expects.

   Shields geometry — 20px tall, label left, value right — because these sit in
   a row beside real shields.io badges, and a taller or rounder pill breaks the
   line. Only the palette is ours, which is the entire reason to draw them here
   rather than point shields at /api/users/{login}.

   Nothing in a badge comes from GitHub except the number, so unlike the card
   there is no display name to escape, no avatar to inline and nothing to
   measure against a typeface we would have to embed to be sure of. A badge is
   under a kilobyte, and the system mono stack is enough.
--------------------------------------------------------------------------- */

/** The year in progress, or the whole career. Two badges, no third. */
export type BadgeKind = "year" | "all";

export interface BadgeInput {
  kind: BadgeKind;
  /** The year `total` covers. */
  year: number;
  /** First year with any contributions, so the all-time badge has a span. */
  firstYear: number;
  /** Null for a roster account GitHub currently has no data for. */
  total: number | null;
  allTime: number | null;
}

const HEIGHT = 20;
const FONT = 11;
/** Optical centre of a 20px pill, not its half: the descender rides low. */
const BASELINE = 14;
const PAD_X = 7;
const RADIUS = 3;

const LABEL_BG = "#191e38";
const LABEL_INK = "#eceaf7";
/**
 * The value takes heat-4 flat rather than the card's ramp. Across a ramp from
 * heat-2 to heat-4 no single ink clears 4.5:1 at both ends — dark text dies on
 * the magenta, light text dies on the amber.
 */
const VALUE_BG = "#ffc24d";
const VALUE_INK = "#12162b";
const ABSENT_BG = "#262c4c";
const ABSENT_INK = "#918fb4";
/** GitHub's dark theme is close enough to the label that it needs an edge. */
const EDGE = "rgba(236,234,247,0.09)";

interface Wording {
  label: string;
  value: string;
  alt: string;
}

/**
 * "All time" alone says nothing about how long, so the span is the label — and
 * the year takes a preposition to read as its pair rather than as a version.
 */
function wording({ kind, year, firstYear, total, allTime }: BadgeInput): Wording {
  const label = kind === "year" ? `contributions in ${year}` : `contributions since ${firstYear}`;
  const count = kind === "year" ? total : allTime;

  if (count === null) {
    return { label, value: "no data", alt: `No GitHub contribution data for this account.` };
  }

  const value = formatNumber(count);
  const alt =
    kind === "year"
      ? `${value} GitHub contributions in ${year}.`
      : `${value} GitHub contributions since ${firstYear}.`;
  return { label, value, alt };
}

export function badgeSvg(input: BadgeInput): string {
  const { label, value, alt } = wording(input);
  const absent = value === "no data";

  const labelWidth = Math.round(monoWidth(label, FONT)) + PAD_X * 2;
  const valueWidth = Math.round(monoWidth(value, FONT)) + PAD_X * 2;
  const width = labelWidth + valueWidth;

  /* Centred in its own half rather than set from a padded edge: the badge does
     not ship the font it measured, so a viewer's mono absorbs the difference
     symmetrically instead of pushing the value into the corner. */
  const parts: Html[] = [
    html`<text x="${labelWidth / 2}" y="${BASELINE}" fill="${LABEL_INK}" text-anchor="middle">${label}</text>`,
    html`<text
      x="${labelWidth + valueWidth / 2}"
      y="${BASELINE}"
      fill="${absent ? ABSENT_INK : VALUE_INK}"
      text-anchor="middle"
    >${value}</text>`,
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n${html`<svg
    xmlns="http://www.w3.org/2000/svg"
    width="${width}"
    height="${HEIGHT}"
    viewBox="0 0 ${width} ${HEIGHT}"
    role="img"
    aria-label="${alt}"
    font-family="${MONO_STACK}"
    font-size="${FONT}"
  >
    <title>${alt}</title>
    <clipPath id="pill">
      <rect width="${width}" height="${HEIGHT}" rx="${RADIUS}"></rect>
    </clipPath>
    <g clip-path="url(#pill)">
      <rect width="${labelWidth}" height="${HEIGHT}" fill="${LABEL_BG}"></rect>
      <rect x="${labelWidth}" width="${valueWidth}" height="${HEIGHT}" fill="${absent ? ABSENT_BG : VALUE_BG}"></rect>
    </g>
    <rect
      x="0.5"
      y="0.5"
      width="${width - 1}"
      height="${HEIGHT - 1}"
      rx="${RADIUS}"
      fill="none"
      stroke="${EDGE}"
    ></rect>
    ${parts}
  </svg>`}\n`;
}
