interface RosterEntry {
  accounts: readonly string[];
}

/** Keep production keys byte-for-byte stable while isolating preview builds. */
export function buildCachePrefix(base: string, preview: boolean, buildSha: string): string {
  return preview ? `${base}${encodeURIComponent(buildSha)}/` : base;
}

/** Variant for singleton cache keys rather than prefixes with a trailing slash. */
export function buildCacheKey(base: string, preview: boolean, buildSha: string): string {
  return preview ? `${base}/${encodeURIComponent(buildSha)}` : base;
}

/**
 * Archive source data is expensive to rebuild, so preview commits share it
 * until the roster (including account grouping) changes.
 */
export function archiveCachePrefix(
  base: string,
  preview: boolean,
  roster: readonly RosterEntry[],
): string {
  if (!preview) return base;
  const rosterKey = roster
    .map((person) => person.accounts.map((account) => encodeURIComponent(account)).join("+"))
    .join(",");
  return `${base}${rosterKey}/`;
}

export function browserCacheControl(
  preview: boolean,
  maxAge: number,
  staleFor: number,
): string {
  return preview ? "no-store" : `public, max-age=${maxAge}, stale-while-revalidate=${staleFor}`;
}

/** Set on a response served from a last good copy instead of a fresh fetch. */
export const STALE_HEADER = "X-Board-Stale";

/** The copy kept aside while GitHub is answering, ready for when it is not. */
export function lastGoodCopy(response: Response, ttlSeconds: number): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * A last good copy on its way out to a visitor. The short life is what paces
 * the retries: the copy is parked on the live key, so one failing minute is
 * not re-fetched by every visitor in it.
 */
export function staleCopy(response: Response, retryTtlSeconds: number): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=${retryTtlSeconds}`);
  headers.set(STALE_HEADER, "1");
  return new Response(response.body, { status: response.status, headers });
}

export function isStaleCopy(response: Response): boolean {
  return response.headers.get(STALE_HEADER) === "1";
}
