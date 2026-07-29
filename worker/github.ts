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

interface RawUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
  followers: { totalCount: number };
  following: { totalCount: number };
  contributionsCollection: {
    contributionCalendar: {
      totalContributions: number;
      weeks: { contributionDays: RawDay[] }[];
    };
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

  return `query Board($from: DateTime!, $to: DateTime!) {
${aliases}
}

fragment Card on User {
  login
  name
  avatarUrl(size: 160)
  url
  followers { totalCount }
  following { totalCount }
  contributionsCollection(from: $from, to: $to) {
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

  const payload = await graphql<RawUser>(token, {
    query: buildQuery(logins),
    variables: { from, to },
  });

  // GraphQL returns partial data alongside errors when one login is missing:
  // keep every user that resolved and report the rest.
  const data = payload.data;
  if (!data) {
    const message = payload.errors?.[0]?.message ?? "GitHub returned no data.";
    throw new GitHubError(message, 502);
  }

  const board: Board = [];
  const missing: string[] = [];

  logins.forEach((login, i) => {
    const raw = data[`u${i}`];
    if (!raw) {
      missing.push(login);
      return;
    }
    const calendar = raw.contributionsCollection.contributionCalendar;
    const user: BoardUser = {
      login: raw.login,
      name: raw.name,
      avatarUrl: raw.avatarUrl,
      url: raw.url,
      followers: raw.followers.totalCount,
      following: raw.following.totalCount,
      totalContributions: calendar.totalContributions,
      weeks: toWeeks(calendar.weeks),
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

/* ---------- archive totals: many years, one query per chunk ---------- */

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
 * Years per request. 9 users x 5 aliased collections = 45 collections per
 * query, which keeps each request comfortably cheap.
 */
const ARCHIVE_YEARS_PER_QUERY = 5;

interface RawArchiveUser {
  login: string;
  url: string;
  /** `y2019`, `y2020`, … aliases. */
  [alias: string]: unknown;
}

/**
 * `contributionsCollection` takes from/to per alias, so one user selection can
 * carry a whole run of years — the same range mechanism as the single-year query.
 */
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

/** Per-login totals for every year in `firstYear..lastYear`, inclusive. */
export async function fetchArchiveTotals(
  token: string,
  firstYear: number,
  lastYear: number,
  logins: readonly string[] = LOGINS,
): Promise<ArchiveTotals> {
  const years: number[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) years.push(year);

  const chunks: number[][] = [];
  for (let i = 0; i < years.length; i += ARCHIVE_YEARS_PER_QUERY) {
    chunks.push(years.slice(i, i + ARCHIVE_YEARS_PER_QUERY));
  }

  const payloads = await Promise.all(
    chunks.map(async (chunk) => ({
      chunk,
      payload: await graphql<RawArchiveUser>(token, { query: buildArchiveQuery(logins, chunk) }),
    })),
  );

  const byLogin = new Map<string, ArchiveUser>();
  const missing = new Set<string>();

  for (const { chunk, payload } of payloads) {
    const data = payload.data;
    if (!data) {
      throw new GitHubError(payload.errors?.[0]?.message ?? "GitHub returned no data.", 502);
    }

    logins.forEach((login, i) => {
      const raw = data[`u${i}`];
      if (!raw) {
        missing.add(login);
        return;
      }
      let entry = byLogin.get(raw.login);
      if (!entry) {
        entry = { login: raw.login, url: raw.url, byYear: {} };
        byLogin.set(raw.login, entry);
      }
      entry.url = raw.url;
      for (const year of chunk) entry.byYear[String(year)] = yearTotal(raw, year);
    });
  }

  if (byLogin.size === 0 && years.length > 0) {
    throw new GitHubError("GitHub returned no users.", 502);
  }

  return {
    generatedAt: new Date().toISOString(),
    firstYear,
    lastYear,
    users: [...byLogin.values()],
    missing: [...missing],
  };
}
