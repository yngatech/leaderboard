import { PEOPLE } from "./github.ts";
import { fetchInsights } from "./insights-fetch.ts";
import { compareCredits, CREDIT_ROLES, EVIDENCE_KINDS, HOSTS, INTENTS, KNOWN_HARNESSES, KNOWN_PROVIDERS, MODEL_ID, providerForModel, SIZE_BUCKETS, type CreditRow, type PrInsights } from "./insights.ts";

// Bump when the summary shape or classification rules change.
export const INSIGHTS_SCHEMA_VERSION = 3;
const DAY_MS = 86400_000;
const COOLDOWN_MS = 3600_000;
export interface InsightsStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<unknown>;
}
function key(login: string, year: number): string {
  return `insights:${year}:${login}`;
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

const sum = (values: Record<string, unknown>) => Object.values(values).reduce<number>((total, n) => total + (n as number), 0);
/** Per-kind PR counts for `prs` PRs: each at most `prs`, and every PR has at least one kind. */
function validEvidence(value: unknown, prs: number): value is Record<string, number> {
  return record(value) && Object.keys(value).length === EVIDENCE_KINDS.length &&
    EVIDENCE_KINDS.every((kind) => count(value[kind]) && value[kind] <= prs) && sum(value) >= prs;
}
const modelId = (value: unknown): value is string => typeof value === "string" && MODEL_ID.test(value);

/** Named provider/harness/host counts, consistent with the credit rows they summarize. */
function validNames(value: unknown, attributed: number, names: ReadonlySet<string>, rows: CreditRow[] | null, field?: "provider" | "harness"): boolean {
  return Array.isArray(value) && (!rows || !field || value.length === new Set(rows.map((row) => row[field]).filter((name) => name !== null)).size) &&
    new Set(value.map((entry) => record(entry) ? entry.name : null)).size === value.length &&
    value.every((entry) => {
      if (!record(entry) || Object.keys(entry).length !== 3 || typeof entry.name !== "string" || !names.has(entry.name) || !count(entry.count) || entry.count < 1 || entry.count > attributed) return false;
      const evidence = entry.evidence;
      if (!validEvidence(evidence, entry.count)) return false;
      if (!rows || !field) return true;
      const matching = rows.filter((row) => row[field] === entry.name);
      return matching.length > 0 && entry.count >= Math.max(...matching.map((row) => row.prs)) && entry.count <= matching.reduce((n, row) => n + row.prs, 0) &&
        EVIDENCE_KINDS.every((kind) => evidence[kind] >= Math.max(...matching.map((row) => row.evidence[kind])) &&
          evidence[kind] <= matching.reduce((n, row) => n + row.evidence[kind], 0));
    });
}

function validRoles(value: unknown, prs: number): boolean {
  if (!record(value) || Object.keys(value).length !== CREDIT_ROLES.length) return false;
  const { writing, review, other, unspecified } = value;
  return count(writing) && count(review) && count(other) && count(unspecified) &&
    unspecified + Math.max(writing, review, other) <= prs && sum(value) >= prs;
}

function validCreditRow(row: unknown, attributed: number): row is CreditRow {
  if (!record(row) || Object.keys(row).length !== 6) return false;
  const { model, provider, harness, prs, roles } = row;
  const name = (value: unknown, names: ReadonlySet<string>) => value === null || (typeof value === "string" && names.has(value));
  // A stated model decides its provider, recognized or not.
  const identity = model === null ? name(provider, KNOWN_PROVIDERS) : modelId(model) && provider === providerForModel(model);
  return identity && name(harness, KNOWN_HARNESSES) && count(prs) && prs >= 1 && prs <= attributed && validEvidence(row.evidence, prs) &&
    validRoles(roles, prs);
}

/** Unique, sorted rows; every attributed PR has at least one. */
function validCredits(value: unknown, attributed: number): value is CreditRow[] {
  return Array.isArray(value) && (attributed > 0) === (value.length > 0) && value.every((row) => validCreditRow(row, attributed)) &&
    new Set(value.map((row) => JSON.stringify([row.provider, row.model, row.harness]))).size === value.length &&
    value.reduce((n, row) => n + row.prs, 0) >= attributed && value.every((row, i) => i === 0 || compareCredits(value[i - 1], row) <= 0);
}

function validPairs(value: unknown, credits: CreditRow[], attributed: number): boolean {
  if (!Array.isArray(value)) return false;
  const declared = (model: string, role: "writing" | "review") => credits.reduce((n, row) => n + (row.model === model ? row.roles[role] : 0), 0);
  return new Set(value.map((pair) => record(pair) ? JSON.stringify([pair.writer, pair.reviewer]) : null)).size === value.length &&
    value.every((pair) => record(pair) && Object.keys(pair).length === 3 && modelId(pair.writer) && modelId(pair.reviewer) &&
      count(pair.prs) && pair.prs >= 1 && pair.prs <= attributed &&
      pair.prs <= declared(pair.writer, "writing") && pair.prs <= declared(pair.reviewer, "review"));
}

function validAgents(agents: unknown, total: number): boolean {
  if (!record(agents) || Object.keys(agents).length !== 9) return false;
  const { attributed, evidence, credits } = agents;
  return count(attributed) && attributed <= total && count(agents.incompleteCommits) && agents.incompleteCommits <= total &&
    count(agents.incompleteCredits) && agents.incompleteCredits <= total &&
    validCredits(credits, attributed) && validPairs(agents.pairs, credits, attributed) &&
    validNames(agents.providers, attributed, KNOWN_PROVIDERS, credits, "provider") &&
    validNames(agents.harnesses, attributed, KNOWN_HARNESSES, credits, "harness") &&
    validNames(agents.hosts, attributed, new Set(HOSTS), null) &&
    (agents.hosts as { evidence: Record<string, number>; count: number }[]).every((host) => host.evidence.bodyFooter === host.count &&
      EVIDENCE_KINDS.every((kind) => kind === "bodyFooter" || host.evidence[kind] === 0)) &&
    record(evidence) && Object.keys(evidence).length === EVIDENCE_KINDS.length &&
    EVIDENCE_KINDS.every((kind) => count(evidence[kind]) && evidence[kind] <= attributed && credits.every((row) => row.evidence[kind] <= (evidence[kind] as number)) &&
      [...agents.providers as { evidence: Record<string, number> }[], ...agents.harnesses as { evidence: Record<string, number> }[], ...agents.hosts as { evidence: Record<string, number> }[]]
        .every((entry) => entry.evidence[kind] <= (evidence[kind] as number))) &&
    (attributed === 0 || sum(evidence) >= attributed);
}

/** Validate the rendered shape and denominators before trusting a stored summary. */
function validSummary(value: unknown, login: string, year: number): value is PrInsights {
  return record(value) && value.login === login && value.year === year &&
    typeof value.generatedAt === "string" && Number.isFinite(Date.parse(value.generatedAt)) &&
    Array.isArray(value.accounts) && value.accounts.length > 0 && value.accounts.every((account) => typeof account === "string" && account.length > 0) &&
    count(value.total) && validSize(value.size, value.total) && validIntent(value.intent, value.total) && validAgents(value.agents, value.total);
}

export async function storedInsights(storage: InsightsStorage, login: string, year: number): Promise<PrInsights | null> {
  try {
    const hit = await storage.get(key(login, year));
    if (!hit) return null;
    if (!record(hit) || hit.schemaVersion !== INSIGHTS_SCHEMA_VERSION) return null;
    const summary = hit.summary;
    if (!validSummary(summary, login, year)) throw new Error("Invalid insights summary");
    // Account changes invalidate this person's summary without changing storage keys.
    const accounts = PEOPLE.find((person) => person.accounts[0] === login)?.accounts;
    if (accounts && (accounts.length !== summary.accounts.length || accounts.some((account, i) => account !== summary.accounts[i]))) return null;
    return summary;
  } catch {
    // Optional panel: neither storage outages nor corrupt entries can take down a profile.
    console.error("insights storage read failed", { login });
    return null;
  }
}

export async function storeInsights(storage: InsightsStorage, summary: PrInsights): Promise<void> {
  await storage.put(key(summary.login, summary.year), { schemaVersion: INSIGHTS_SCHEMA_VERSION, summary });
}

/** One due person per tick; failed fetches retain the old summary and cool down for an hour. */
export async function refreshInsights(storage: InsightsStorage, token: string, now = new Date()): Promise<void> {
  if (!token) return;
  const year = now.getUTCFullYear();
  for (const person of PEOPLE) {
    const login = person.accounts[0];
    const summary = await storedInsights(storage, login, year);
    if (summary && now.getTime() - Date.parse(summary.generatedAt) < DAY_MS) continue;
    const attemptKey = `insights-attempt:${year}:${login}`;
    const attemptedAt = await storage.get<number>(attemptKey);
    if (typeof attemptedAt === "number" && now.getTime() - attemptedAt < COOLDOWN_MS) continue;
    await storage.put(attemptKey, now.getTime());
    const fresh = await fetchInsights(token, login, person.accounts, now);
    await storeInsights(storage, fresh);
    return;
  }
}
