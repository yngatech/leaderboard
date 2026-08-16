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
