/* ---------------------------------------------------------------------------
   Cake day: the anniversary of the day a GitHub account was created. Dates are
   UTC throughout, like the contribution calendar, so the board and the
   notifications always agree about which day it is.
--------------------------------------------------------------------------- */

/** Null when GitHub's timestamp is unparseable, so a bad value cannot throw. */
function createdOn(createdAt: string | null | undefined): Date | null {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  return Number.isNaN(created.getTime()) ? null : created;
}

/**
 * The ISO day the anniversary falls on in `year`. A 29 February account rolls
 * forward to 1 March in a common year, so an anniversary never lands early.
 */
function anniversary(created: Date, year: number): string {
  return new Date(Date.UTC(year, created.getUTCMonth(), created.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** The creation timestamp as the UTC calendar day the board displays. */
export function joinDay(createdAt: string): string {
  return createdAt.slice(0, 10);
}

/** Whole years on GitHub as of `on`, counting the anniversary itself. */
export function yearsOnGitHub(createdAt: string | null | undefined, on: string): number {
  const created = createdOn(createdAt);
  if (!created) return 0;
  const year = Number(on.slice(0, 4));
  const elapsed = year - created.getUTCFullYear();
  return anniversary(created, year) <= on ? elapsed : elapsed - 1;
}

/**
 * The years to celebrate when `on` is the account's anniversary, and null on
 * every other day. An account created on `on` has no cake day.
 */
export function cakeDayYears(createdAt: string | null | undefined, on: string): number | null {
  const created = createdOn(createdAt);
  const year = Number(on.slice(0, 4));
  if (!created || anniversary(created, year) !== on) return null;
  const years = year - created.getUTCFullYear();
  return years > 0 ? years : null;
}
