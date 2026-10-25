import { PEOPLE } from "./github.ts";
import { fetchInsights } from "./insights-fetch.ts";
import { EVIDENCE_KINDS, INTENTS, SIZE_BUCKETS, type PrInsights } from "./insights.ts";

// Separate source namespace survives deploys. Include the roster so account changes invalidate it.
const PREFIX = `https://ynga-git-board.internal/insights/v6/${encodeURIComponent(JSON.stringify(PEOPLE))}/`;
const DAY_MS = 86400_000;
export interface InsightsCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<unknown>;
}
function key(login: string, year: number): Request {
  return new Request(`${PREFIX}${year}/${login}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const share = (value: unknown): boolean => nonnegative(value) && value <= 1;
function counts(value: unknown, keys: readonly string[], total: number): boolean {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => count(value[key])) &&
    Object.values(value).reduce<number>((sum, n) => sum + (n as number), 0) === total;
}

function validSize(size: unknown, total: number): boolean {
  if (!record(size) || !count(size.measured) || !count(size.incomplete) || size.measured + size.incomplete !== total) return false;
  if (size.measured ? !nonnegative(size.median) || !share(size.smallShare) : size.median !== null || size.smallShare !== null) return false;
  if (!Array.isArray(size.buckets) || size.buckets.length !== SIZE_BUCKETS.length ||
    !size.buckets.every((bucket, i) => record(bucket) && bucket.label === SIZE_BUCKETS[i].label && count(bucket.count)) ||
    size.buckets.reduce((sum, bucket) => sum + bucket.count, 0) !== size.measured) return false;
  const deletion = size.biggestNetDeletion;
  return deletion === null || (record(deletion) && count(deletion.lines) && typeof deletion.url === "string" &&
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(deletion.url));
}

function validIntent(intent: unknown, total: number): boolean {
  return record(intent) && counts(intent.mix, INTENTS, total) && counts(intent.sources, ["title", "branch", "paths", "unknown"], total);
}

function validDimension(value: unknown, attributed: number): boolean {
  return Array.isArray(value) && new Set(value.map((entry) => record(entry) ? entry.name : null)).size === value.length &&
    value.every((entry) => {
      if (!record(entry)) return false;
      const { name, count: prs, evidence } = entry;
      return typeof name === "string" && name.length > 0 && count(prs) && prs > 0 && prs <= attributed &&
        record(evidence) && EVIDENCE_KINDS.every((kind) => count(evidence[kind]) && evidence[kind] <= prs) &&
        Object.values(evidence).reduce<number>((sum, n) => sum + (n as number), 0) >= prs;
    }) &&
    value.reduce((sum, entry) => sum + entry.count, 0) >= attributed && (attributed > 0 || value.length === 0);
}

function validAgents(agents: unknown, total: number): boolean {
  if (!record(agents)) return false;
  const { attributed, evidence } = agents;
  return count(attributed) && attributed <= total && (total ? share(agents.share) && agents.share === attributed / total : agents.share === null) &&
    count(agents.incompleteCommits) && agents.incompleteCommits <= total &&
    validDimension(agents.providers, attributed) && validDimension(agents.harnesses, attributed) &&
    record(evidence) && EVIDENCE_KINDS.every((kind) => count(evidence[kind]) && evidence[kind] <= attributed);
}

/** Validate the entire rendered shape and its denominators before trusting cached JSON. */
function validSummary(value: unknown, login: string, year: number): value is PrInsights {
  return record(value) && value.login === login && value.year === year &&
    typeof value.generatedAt === "string" && Number.isFinite(Date.parse(value.generatedAt)) &&
    Array.isArray(value.accounts) && value.accounts.length > 0 && value.accounts.every((account) => typeof account === "string" && account.length > 0) &&
    count(value.total) && validSize(value.size, value.total) && validIntent(value.intent, value.total) && validAgents(value.agents, value.total);
}

export async function cachedInsights(cache: InsightsCache, login: string, now = new Date()): Promise<PrInsights | null> {
  try {
    const year = now.getUTCFullYear();
    const hit = await cache.match(key(login, year));
    if (!hit) return null;
    const summary: unknown = await hit.json();
    if (!validSummary(summary, login, year)) throw new Error("Invalid insights summary");
    return summary;
  } catch {
    // Optional panel: neither cache outages nor corrupt entries can take down a profile.
    console.error("insights cache read failed", { login });
    return null;
  }
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
