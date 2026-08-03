import type { Board, BoardUser, ContributionDay, ContributionWeek } from "../shared/types";

/** The board. Order here is only a seed — the API sorts by contributions. */
export const LOGINS = [
  "incognitojam",
  "NathanBhanji",
  "P110",
  "stefanTrawicki",
  "gruellan",
  "alex-woodhouse",
  "Mysterypotatoguy",
  "krisdev",
  "booinspace",
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

const LEVELS: Record<string, 0 | 1 | 2 | 3 | 4> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

interface RawDay {
  date: string;
  contributionCount: number;
  contributionLevel: string;
}

interface ContributionCalendar {
  totalContributions: number;
  weeks: { contributionDays: RawDay[] }[];
}

interface RawUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
  followers: { totalCount: number };
  following: { totalCount: number };
}

interface RawCalendarUser {
  contributionsCollection: {
    contributionCalendar: ContributionCalendar;
  };
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

/** One batched query: nine aliased `user` lookups sharing a fragment. */
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
  followers { totalCount }
  following { totalCount }
}`;
}

function toWeeks(weeks: { contributionDays: RawDay[] }[]): ContributionWeek[] {
  return weeks.map((week) => ({
    days: week.contributionDays.map<ContributionDay>((day) => ({
      date: day.date,
      count: day.contributionCount,
      level: LEVELS[day.contributionLevel] ?? 0,
    })),
  }));
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

function buildCalendarQuery(logins: readonly string[], from: string, to: string): string {
  const aliases = logins
    .map(
      (login, i) => `  u${i}: user(login: ${JSON.stringify(login)}) {
    contributionsCollection(from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }`,
    )
    .join("\n");
  return `query ContributionFallback {\n${aliases}\n}`;
}

async function fetchContributionHtml(login: string, from: string, to: string): Promise<HtmlCalendar | null> {
  const url = new URL(`https://github.com/users/${encodeURIComponent(login)}/contributions`);
  url.searchParams.set("from", from.slice(0, 10));
  url.searchParams.set("to", to.slice(0, 10));

  try {
    const res = await fetch(url, { headers: { "User-Agent": "ynga-git-board", Accept: "text/html" } });
    if (!res.ok) {
      console.error("github contributions html error", { login, status: res.status });
      return null;
    }
    const calendar = parseContributionHtml(await res.text());
    if (!calendar) console.error("github contributions html parse error", { login });
    return calendar;
  } catch (error) {
    console.error("github contributions html fetch error", {
      login,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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
  logins: readonly string[] = LOGINS,
): Promise<BoardResult> {
  const { from, to } = yearRange(year);

  // The profile request and all public calendar fragments can run independently.
  const [payload, htmlCalendars] = await Promise.all([
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

  const board: Board = [];
  const missing: string[] = [];

  const fallbackIndexes = logins.flatMap((_, index) => (data[`u${index}`] && !htmlCalendars[index] ? [index] : []));
  const fallbackCalendars = new Map<number, ContributionCalendar>();
  if (fallbackIndexes.length > 0) {
    const fallbackLogins = fallbackIndexes.map((index) => logins[index]);
    console.error("github contributions html fallback", { logins: fallbackLogins });
    const fallback = await graphql<RawCalendarUser>(token, {
      query: buildCalendarQuery(fallbackLogins, from, to),
    });
    if (!fallback.data) {
      throw new GitHubError(fallback.errors?.[0]?.message ?? "GitHub returned no contribution data.", 502);
    }
    fallbackIndexes.forEach((index, fallbackIndex) => {
      const raw = fallback.data?.[`u${fallbackIndex}`];
      if (raw) fallbackCalendars.set(index, raw.contributionsCollection.contributionCalendar);
    });
  }

  logins.forEach((login, i) => {
    const raw = data[`u${i}`];
    if (!raw) {
      missing.push(login);
      return;
    }
    const htmlCalendar = htmlCalendars[i];
    const fallbackCalendar = fallbackCalendars.get(i);
    if (!htmlCalendar && !fallbackCalendar) {
      throw new GitHubError(`GitHub returned no contribution data for ${login}.`, 502);
    }
    const user: BoardUser = {
      login: raw.login,
      name: raw.name,
      avatarUrl: raw.avatarUrl,
      url: raw.url,
      followers: raw.followers.totalCount,
      following: raw.following.totalCount,
      totalContributions: htmlCalendar?.totalContributions ?? fallbackCalendar!.totalContributions,
      weeks: htmlCalendar?.weeks ?? toWeeks(fallbackCalendar!.weeks),
    };
    board.push(user);
  });

  if (board.length === 0) {
    const message = payload.errors?.[0]?.message ?? "GitHub returned no users.";
    throw new GitHubError(message, 502);
  }

  board.sort((a, b) => b.totalContributions - a.totalContributions || a.login.localeCompare(b.login));

  return { board, missing };
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
 * Workers Paid permits 1,000 subrequests per invocation. Keep the public HTML
 * fan-out at 12 concurrent requests so an archive refresh is kinder to GitHub.
 */
const ARCHIVE_HTML_CONCURRENCY = 6;
/** Only two archive users run together, for at most 12 GitHub fetches. */
const ARCHIVE_USER_CONCURRENCY = 2;

interface RawArchiveUser {
  login: string;
  url: string;
  /** `y2019`, `y2020`, … aliases. */
  [alias: string]: unknown;
}

/** GraphQL retains its role as a batched fallback for failed HTML years. */
function buildArchiveQuery(logins: readonly string[], years: readonly number[]): string {
  const collections = years
    .map((year) => {
      const { from, to } = yearRange(year);
      // Both bounds are derived from a validated integer, never from input.
      return `    y${year}: contributionsCollection(from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}) { contributionCalendar { totalContributions } }`;
    })
    .join("\n");

  const users = logins
    .map(
      (login, i) =>
        `  u${i}: user(login: ${JSON.stringify(login)}) {\n    login\n    url\n${collections}\n  }`,
    )
    .join("\n");

  return `query Archive {\n${users}\n}`;
}

function yearTotal(raw: RawArchiveUser, year: number): number {
  const collection = raw[`y${year}`] as
    | { contributionCalendar?: { totalContributions?: number } }
    | undefined;
  return collection?.contributionCalendar?.totalContributions ?? 0;
}

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
  token: string,
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
  const fallbackYears = years.filter((_, index) => !calendars[index]);
  let fallback: RawArchiveUser | null = null;

  if (fallbackYears.length > 0) {
    console.error("github archive contributions html fallback", { login, years: fallbackYears });
    const payload = await graphql<RawArchiveUser>(token, {
      query: buildArchiveQuery([login], fallbackYears),
    });
    if (!payload.data) {
      throw new GitHubError(payload.errors?.[0]?.message ?? "GitHub returned no contribution data.", 502);
    }
    fallback = payload.data.u0;
    if (!fallback) return null;
  }

  const raw = fallback;
  const entry: ArchiveUser = {
    login: raw?.login ?? login,
    url: raw?.url ?? `https://github.com/${encodeURIComponent(login)}`,
    byYear: {},
  };
  years.forEach((year, index) => {
    entry.byYear[String(year)] = calendars[index]?.totalContributions ?? yearTotal(raw!, year);
  });
  return entry;
}

/**
 * Per-login totals for every year in `firstYear..lastYear`, inclusive. Two
 * users are fetched at once, each with six concurrent public HTML requests.
 */
export async function fetchArchiveTotals(
  token: string,
  firstYear: number,
  lastYear: number,
  logins: readonly string[] = LOGINS,
): Promise<ArchiveTotals> {
  const users = await mapWithConcurrency(logins, ARCHIVE_USER_CONCURRENCY, (login) =>
    fetchArchiveUserTotals(token, login, firstYear, lastYear),
  );
  const knownUsers = users.filter((user): user is ArchiveUser => user !== null);
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
