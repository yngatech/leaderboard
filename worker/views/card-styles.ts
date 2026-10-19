/** The card shell. Border colour is chosen per chapter: gold marks a leader,
 *  exactly as it does on a rank-1 row. */
export const CARD = "animate-rise overflow-hidden rounded-2xl border bg-panel";

/** Register three: the ledger, a shade under the well like a row's goals band. */
export const CARD_LEDGER =
  "border-t border-line-soft bg-[rgba(10,12,24,0.32)] px-[1.3rem] py-[1rem] max-phone:px-4 max-phone:py-[0.85rem]";

/** Same term type as the row goals band, so the two are one idiom. */
export const LEDGER_TERM = "text-[0.6rem] tracking-[0.16em] text-dimmer uppercase";

/** A number that qualifies another number: milestone, margin, peak. */
export const LEDGER_VALUE = "font-medium tabular-nums text-ink";
