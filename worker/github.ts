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

interface GraphQLResponse {
  data?: Record<string, RawUser | null> | null;
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
  contributionsCollection {
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

export async function fetchBoard(token: string, logins: readonly string[] = LOGINS): Promise<BoardResult> {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "ynga-git-board",
    },
    body: JSON.stringify({ query: buildQuery(logins) }),
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

  const payload = (await res.json()) as GraphQLResponse;

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
