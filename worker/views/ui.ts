import { html, type Html } from "../html.ts";

/* ---------------------------------------------------------------------------
   The shared pieces every page is built from. Each has one definition here,
   so a card, a section heading, a button or a link looks the same wherever it
   appears. Class lists are verbatim string literals so the Tailwind scanner
   sees every utility.
--------------------------------------------------------------------------- */

/** Any bordered panel at rest. Pair with `px-card-x py-card-y` or the registers below. */
export const SURFACE = "rounded-card border border-line-soft bg-panel";

/** The card shell. Border colour is chosen per chapter: gold marks a leader,
 *  exactly as it does on a rank-1 row. */
export const CARD = "animate-rise overflow-hidden rounded-card border bg-panel";

/** The edge a leader's card wears instead of `border-line-soft`. */
export const LEAD_EDGE = "border-accent/40";

/** Register two: a plot recessed into its card and still free to scroll. */
export const CARD_WELL = "overflow-x-auto surface-well px-card-x py-card-y";

/** Register three: the ledger, a shade under the well like a row's goals band. */
export const CARD_LEDGER = "border-t border-line-soft bg-scrim px-card-x py-card-y";

/** One label treatment across profile ledgers and contribution breakdowns. */
export const LEDGER_TERM = "text-meta font-medium text-secondary";

/** A number that qualifies another number: milestone, margin, peak. */
export const LEDGER_VALUE = "font-medium tabular-nums text-ink";

/** The account picture, at row (52px) or page (72px) scale. */
export const AVATAR =
  "rounded-avatar border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200";

/** The one call to action: an accent outline that fills on hover. */
export const BUTTON =
  "inline-block cursor-pointer rounded-control border border-accent/40 px-4 py-2.5 text-body font-medium text-accent no-underline transition-colors duration-200 hover:bg-accent/10";

/** A secondary control: copy, show more. */
export const BUTTON_QUIET =
  "inline-block cursor-pointer rounded-control border border-line px-3 py-1.5 text-meta font-medium text-secondary transition-colors duration-200 hover:border-accent/40 hover:text-accent";

/** A link inside a sentence. */
export const LINK =
  "text-ink underline decoration-line underline-offset-4 transition-colors hover:text-accent";

/** A link that is metadata rather than content: footers, "view all". */
export const LINK_QUIET =
  "text-secondary underline decoration-line underline-offset-4 transition-colors hover:text-accent";

/** A name that links to its page: no underline until hovered. */
export const NAME_LINK =
  "text-ink no-underline transition-colors hover:text-accent hover:underline hover:underline-offset-4";

/**
 * Every section's heading: a label, a hairline to the edge, and optionally
 * something on the right of it (a count, a link). The heading element is the
 * label itself, so the hairline and the aside stay out of the outline.
 */
export function sectionHeadingHtml(
  label: string | number | Html,
  options: { id?: string; headingId?: string; aside?: Html | null; first?: boolean } = {},
): Html {
  const { id, headingId, aside, first } = options;
  return html`<div${id ? html` id="${id}"` : null} class="${first ? "" : "mt-section "}mb-4 flex scroll-mt-4 flex-wrap items-center gap-x-3.5 gap-y-2 text-body font-medium text-secondary">
    <h2${headingId ? html` id="${headingId}"` : null}>${label}</h2>
    <span class="h-px min-w-6 flex-[1_1_24px] bg-line-soft" aria-hidden="true"></span>${aside ?? null}
  </div>`;
}
