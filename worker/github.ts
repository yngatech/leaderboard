import type { Board, BoardUser, ContributionDay, ContributionWeek } from "../shared/types";
import { levelFor, quartiles } from "../shared/contributions.ts";

interface PersonDefinition {
  accounts: readonly [primary: string, ...others: string[]];
}

/** The board. Order here is only a seed — the API sorts by contributions. */
export const PEOPLE: readonly PersonDefinition[] = [
  { accounts: ["incognitojam"] },
  { accounts: ["NathanBhanji", "Bhanji452"] },
  { accounts: ["P110"] },
  { accounts: ["stefanTrawicki"] },
  { accounts: ["gruellan"] },
  { accounts: ["alex-woodhouse"] },
  { accounts: ["Mysterypotatoguy"] },
  { accounts: ["krisdev"] },
  { accounts: ["booinspace"] },
] as const;

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

/** GitHub contribution graphs start in 2008. */
export const MIN_YEAR = 2008;

export function currentYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/**
 * Jan 1 to Dec 31 of `year`, clamped to now for the year in progress.
 * GitHub rejects ranges that end in the future or span more than a year.
 */
export function yearRange(year: number, now: Date = new Date()): { from: string; to: string } {
  const start = Date.UTC(year, 0, 1, 0, 0, 0);
  const end = Date.UTC(year, 11, 31, 23, 59, 59);
  const to = new Date(Math.min(end, now.getTime()));
  return {
    from: new Date(start).toISOString().replace(".000Z", "Z"),
    to: to.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

interface RawUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
  createdAt: string;
  followers: { totalCount: number };
  following: { totalCount: number };
}

interface GraphQLResponse<T> {
  data?: Record<string, T | null> | null;
  errors?: { message: string; type?: string; path?: (string | number)[] }[];
}

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

function buildQuery(logins: readonly string[]): string {
  const aliases = logins
    .map((login, i) => `  u${i}: user(login: ${JSON.stringify(login)}) { ...Card }`)
    .join("\n");

  return `query Board {
${aliases}
}

fragment Card on User {
  login
  name
  avatarUrl(size: 160)
  url
  createdAt
  followers { totalCount }
  following { totalCount }
}`;
}

interface HtmlCalendar {
  totalContributions: number;
  weeks: ContributionWeek[];
}

/** Attribute values we use from GitHub's server-rendered calendar fragment. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  return match?.[2] ?? null;
}

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function contributionCount(text: string): number | null {
  const match = /^(?:No contributions|([\d,]+)\s+contributions?)\s+on\b/i.exec(text);
  if (!match) return null;
  return match[1] === undefined ? 0 : Number(match[1].replaceAll(",", ""));
}

/**
 * Parses GitHub's public, server-rendered yearly contributions fragment.
 * The table is row-major, while the cell id carries its weekday and week
 * indices; rebuilding from those indices keeps the API's column-per-week shape.
 */
export function parseContributionHtml(html: string): HtmlCalendar | null {
  let totalText = "";
  for (const match of html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi)) {
    if (attribute(match[1], "id") === "js-contribution-activity-description") {
      totalText = plainText(match[2]);
      break;
    }
  }
  const total = /^([\d,]+)\s+contributions?\s+in\s+\d{4}$/i.exec(totalText);
  if (!total) return null;

  const tooltipCounts = new Map<string, number>();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)) {
    const id = attribute(match[1], "for");
    const count = contributionCount(plainText(match[2]));
    if (id && count !== null) tooltipCounts.set(id, count);
  }

  const byWeek = new Map<number, Map<number, ContributionDay>>();
  for (const match of html.matchAll(/<td\b[^>]*>/gi)) {
    const tag = match[0];
    const date = attribute(tag, "data-date");
    const id = attribute(tag, "id");
    const level = attribute(tag, "data-level");
    const coordinates = id && /^contribution-day-component-(\d+)-(\d+)$/.exec(id);
    const count = id ? tooltipCounts.get(id) : undefined;
    const numericLevel = level === null ? NaN : Number(level);
    if (!date || !coordinates) continue;
    if (
      count === undefined ||
      !Number.isInteger(numericLevel) ||
      numericLevel < 0 ||
      numericLevel > 4 ||
      byWeek.get(Number(coordinates[2]))?.has(Number(coordinates[1]))
    ) {
      return null;
    }

    const weekIndex = Number(coordinates[2]);
    const weekday = Number(coordinates[1]);
    let week = byWeek.get(weekIndex);
    if (!week) {
      week = new Map();
      byWeek.set(weekIndex, week);
    }
    week.set(weekday, { date, count, level: numericLevel as ContributionDay["level"] });
  }

  if (byWeek.size === 0) return null;
  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, days]) => ({ days: [...days.entries()].sort(([a], [b]) => a - b).map(([, day]) => day) }));
  const totalContributions = Number(total[1].replaceAll(",", ""));

  return weeks.flatMap((week) => week.days).reduce((sum, day) => sum + day.count, 0) === totalContributions
    ? { totalContributions, weeks }
    : null;
}

type CalendarResult =
  | { state: "ok"; calendar: HtmlCalendar }
  /** GitHub has no contributions page: a renamed, deleted or suspended login. */
  | { state: "absent" }
  | { state: "failed" };

/**
 * The public fragment has no stand-in. GraphQL counts only the private
 * contributions the board's own token can see, which reads hundreds low for
 * everyone else, so a rate limit or a half-rendered page is retried instead.
 */
const HTML_ATTEMPTS = 3;
const HTML_RETRY_MS = 250;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchContributionHtml(login: string, from: string, to: string): Promise<CalendarResult> {
  const url = new URL(`https://github.com/users/${encodeURIComponent(login)}/contributions`);
  url.searchParams.set("from", from.slice(0, 10));
  url.searchParams.set("to", to.slice(0, 10));

  for (let attempt = 1; attempt <= HTML_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await pause(HTML_RETRY_MS * (attempt - 1));
    try {
      const res = await fetch(url, { headers: { "User-Agent": "ynga-git-board", Accept: "text/html" } });
      if (res.status === 404) return { state: "absent" };
      if (!res.ok) {
        console.error("github contributions html error", { login, status: res.status, attempt });
        continue;
      }
      const calendar = parseContributionHtml(await res.text());
      if (calendar) return { state: "ok", calendar };
      console.error("github contributions html parse error", { login, attempt });
    } catch (error) {
      console.error("github contributions html fetch error", {
        login,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.error("github contributions html unavailable", { login, attempts: HTML_ATTEMPTS });
  return { state: "failed" };
}

export interface BoardResult {
  board: Board;
  /** Logins GitHub returned no data for (renamed, deleted, suspended). */
  missing: string[];
}

/** One GraphQL round trip, with the HTTP-level failures normalised. */
async function graphql<T>(token: string, body: unknown): Promise<GraphQLResponse<T>> {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "ynga-git-board",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Log the body for debugging, but never surface it to the client.
    console.error("github http error", { status: res.status, body: (await res.text()).slice(0, 300) });
    throw new GitHubError(
      res.status === 401 || res.status === 403
        ? `GitHub rejected the board's credentials (${res.status}).`
        : `GitHub is not answering right now (${res.status}).`,
      502,
    );
  }

  return (await res.json()) as GraphQLResponse<T>;
}

export async function fetchBoard(
  token: string,
  year: number,
  people: readonly PersonDefinition[] = PEOPLE,
): Promise<BoardResult> {
  const logins = people.flatMap((person) => person.accounts);
  const { from, to } = yearRange(year);

  // The profile request and all public calendar fragments can run independently.
  const [payload, calendars] = await Promise.all([
    graphql<RawUser>(token, { query: buildQuery(logins) }),
    Promise.all(logins.map((login) => fetchContributionHtml(login, from, to))),
  ]);

  // GraphQL returns partial data alongside errors when one login is missing:
  // keep every user that resolved and report the rest.
  const data = payload.data;
  if (!data) {
    const message = payload.errors?.[0]?.message ?? "GitHub returned no data.";
    throw new GitHubError(message, 502);
  }

  const accounts: (BoardUser | null)[] = Array(logins.length).fill(null);
  const missing: string[] = [];

  logins.forEach((login, i) => {
    const raw = data[`u${i}`];
    if (!raw) {
      missing.push(login);
      return;
    }
    const result = calendars[i];
    // Half a board is worse than yesterday's board: the caller serves its last
    // good copy rather than a total that quietly excludes anyone.
    if (result.state !== "ok") {
      throw new GitHubError(`GitHub returned no contribution data for ${login}.`, 502);
    }
    const user: BoardUser = {
      login: raw.login,
      name: raw.name,
      avatarUrl: raw.avatarUrl,
      url: raw.url,
      createdAt: raw.createdAt,
      followers: raw.followers.totalCount,
      following: raw.following.totalCount,
      totalContributions: result.calendar.totalContributions,
      weeks: result.calendar.weeks,
    };
    accounts[i] = user;
  });

  if (accounts.every((account) => account === null)) {
    const message = payload.errors?.[0]?.message ?? "GitHub returned no users.";
    throw new GitHubError(message, 502);
  }

  const board = accountsByPerson(people, accounts).flatMap<BoardUser>(({ login, accounts: found }) => {
    if (found.length === 0) return [];
    const primary = found[0];
    return [{
      login,
      name: primary.name,
      avatarUrl: primary.avatarUrl,
      url: primary.url,
      createdAt: earliestCreatedAt(found),
      followers: primary.followers,
      following: primary.following,
      totalContributions: found.reduce((sum, account) => sum + account.totalContributions, 0),
      weeks: mergedWeeks(found),
    }];
  });
  board.sort((a, b) => b.totalContributions - a.totalContributions || a.login.localeCompare(b.login));
  return { board, missing };
}

/** A person's cake day belongs to their oldest account, not their primary one. */
function earliestCreatedAt(users: readonly BoardUser[]): string | undefined {
  const dates = users.flatMap((user) => (user.createdAt ? [user.createdAt] : []));
  return dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : undefined;
}

function mergedWeeks(users: readonly BoardUser[]): ContributionWeek[] {
  const totals = new Map<string, number>();
  for (const user of users) {
    for (const week of user.weeks) {
      for (const day of week.days) {
        totals.set(day.date, (totals.get(day.date) ?? 0) + day.count);
      }
    }
  }

  const thresholds = quartiles([...totals.values()]);
  return users[0].weeks.map((week) => ({
    days: week.days.map((day) => {
      const count = totals.get(day.date) ?? 0;
      return { date: day.date, count, level: levelFor(count, thresholds) };
    }),
  }));
}

function accountsByPerson<T>(people: readonly PersonDefinition[], accounts: readonly (T | null)[]) {
  let offset = 0;
  return people.map((person) => {
    const end = offset + person.accounts.length;
    const found = accounts.slice(offset, end).filter((account): account is T => account !== null);
    offset = end;
    return { login: person.accounts[0], accounts: found };
  });
}

/* ---------- archive totals: public HTML ---------- */

export interface ArchiveUser {
  login: string;
  url: string;
  /** Year (as a string key, so the shape survives JSON caching) to total. */
  byYear: Record<string, number>;
}

export interface ArchiveTotals {
  generatedAt: string;
  firstYear: number;
  lastYear: number;
  users: ArchiveUser[];
  missing: string[];
}

/**
 * Workers Paid permits 1,000 subrequests per invocation, which a full rebuild
 * fits inside even when every year needs all its attempts. Keep the public
 * HTML fan-out at 12 concurrent requests so a refresh is kinder to GitHub.
 */
const ARCHIVE_HTML_CONCURRENCY = 6;
/** Only two archive users run together, for at most 12 GitHub fetches. */
const ARCHIVE_USER_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array(values.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await task(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

/**
 * One account's archive, fetched directly from GitHub with bounded concurrency.
 */
export async function fetchArchiveUserTotals(
  login: string,
  firstYear: number,
  lastYear: number,
): Promise<ArchiveUser | null> {
  const years: number[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) years.push(year);

  const calendars = await mapWithConcurrency(years, ARCHIVE_HTML_CONCURRENCY, async (year) => {
    const { from, to } = yearRange(year);
    return fetchContributionHtml(login, from, to);
  });

  // No page in any year is a login that has gone; a page that would not load
  // is an outage, and counting it as a blank year would erase real history.
  if (calendars.every((result) => result.state === "absent")) return null;

  const entry: ArchiveUser = {
    login,
    url: `https://github.com/${encodeURIComponent(login)}`,
    byYear: {},
  };
  years.forEach((year, index) => {
    const result = calendars[index];
    if (result.state !== "ok") {
      throw new GitHubError(`GitHub returned no ${year} contribution data for ${login}.`, 502);
    }
    entry.byYear[String(year)] = result.calendar.totalContributions;
  });
  return entry;
}

/**
 * Per-person totals for every year in `firstYear..lastYear`, inclusive. Two
 * accounts are fetched at once, each with six concurrent public HTML requests.
 */
export async function fetchArchiveTotals(
  firstYear: number,
  lastYear: number,
  people: readonly PersonDefinition[] = PEOPLE,
): Promise<ArchiveTotals> {
  const logins = people.flatMap((person) => person.accounts);
  const users = await mapWithConcurrency(logins, ARCHIVE_USER_CONCURRENCY, (login) =>
    fetchArchiveUserTotals(login, firstYear, lastYear),
  );
  const knownUsers = accountsByPerson(people, users).flatMap<ArchiveUser>(({ login, accounts }) => {
    if (accounts.length === 0) return [];

    const byYear: Record<string, number> = {};
    for (let year = firstYear; year <= lastYear; year += 1) {
      byYear[String(year)] = accounts.reduce((sum, account) => sum + (account.byYear[String(year)] ?? 0), 0);
    }
    return [{
      login,
      url: `https://github.com/${encodeURIComponent(login)}`,
      byYear,
    }];
  });
  if (knownUsers.length === 0 && firstYear <= lastYear) {
    throw new GitHubError("GitHub returned no users.", 502);
  }

  return {
    generatedAt: new Date().toISOString(),
    firstYear,
    lastYear,
    users: knownUsers,
    missing: logins.filter((_, index) => users[index] === null),
  };
}
