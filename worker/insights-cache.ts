import { PEOPLE } from "./github.ts";
import { fetchInsights } from "./insights-fetch.ts";
import type { PrInsights } from "./insights.ts";

// Separate source namespace survives deploys. Include the roster so account changes invalidate it.
const PREFIX = `https://ynga-git-board.internal/insights/v1/${encodeURIComponent(JSON.stringify(PEOPLE))}/`;
const DAY_MS = 86400_000;
export interface InsightsCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<unknown>;
}
function key(login: string, year: number): Request {
  return new Request(`${PREFIX}${year}/${login}`);
}
export async function cachedInsights(cache: InsightsCache, login: string, now = new Date()): Promise<PrInsights | null> {
  const hit = await cache.match(key(login, now.getUTCFullYear()));
  return hit ? await hit.json() as PrInsights : null;
}

/** One due person per tick; failed fetches retain the old summary and cool down for an hour. */
export async function refreshInsights(cache: InsightsCache, token: string, now = new Date()): Promise<void> {
  if (!token) return;
  for (const person of PEOPLE) {
    const login = person.accounts[0];
    const summary = await cachedInsights(cache, login, now);
    if (summary && now.getTime() - Date.parse(summary.generatedAt) < DAY_MS) continue;
    const attemptKey = new Request(`${PREFIX}attempt/${now.getUTCFullYear()}/${login}`);
    if (await cache.match(attemptKey)) continue;
    await cache.put(attemptKey, new Response("attempted", { headers: { "Cache-Control": "public, max-age=3600" } }));
    const fresh = await fetchInsights(token, login, person.accounts, now);
    await cache.put(key(login, now.getUTCFullYear()), new Response(JSON.stringify(fresh), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=604800" },
    }));
    return;
  }
}
