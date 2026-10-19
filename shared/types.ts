export interface ContributionDay {
  /** ISO date, e.g. "2025-03-03" */
  date: string;
  count: number;
  /** GitHub-style intensity, 0 (none) through 4 (fourth quartile) */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface ContributionWeek {
  days: ContributionDay[];
}

export interface BoardUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
  followers: number;
  following: number;
  /**
   * When the account was created — the earliest of them, for a person with
   * more than one. Optional because year boards cached before this shipped are
   * still served from `caches.default` without it.
   */
  createdAt?: string;
  totalContributions: number;
  weeks: ContributionWeek[];
}

export type Board = BoardUser[];

export interface AllTimeUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
  /** Null for accounts that only appear in the archive. */
  followers: number | null;
  following: number | null;
  /** Null in the archive, and absent from aggregates cached before it shipped. */
  createdAt?: string | null;
  /** Year (as a string key) to that year's total. */
  byYear: Record<string, number>;
  total: number;
}

export interface AllTime {
  /** First active year through the current one, oldest first. */
  years: number[];
  firstYear: number;
  lastYear: number;
  /** Unranked — the client sorts. */
  users: AllTimeUser[];
}

/** The machine-readable counterpart of an account page. */
export interface UserProfile extends AllTimeUser {
  /** The year represented by `current`. */
  currentYear: number;
  /** Daily detail for the current year, or null when GitHub omitted the account. */
  current: Pick<BoardUser, "totalContributions" | "weeks"> | null;
}

export interface BoardError {
  error: string;
  status: number;
}

export type ContributionKind = "commits" | "pullRequests" | "issues" | "reviews" | "repositories";
export interface BreakdownRepository {
  nameWithOwner: string;
  url: string;
  count: number;
}
export interface BreakdownKindTotal {
  kind: ContributionKind;
  /** Public contributions only. */
  total: number;
  repositories: BreakdownRepository[];
  /** Public contributions omitted by GitHub's repository cap. */
  unlisted: number;
}
export interface ContributionBreakdown {
  login: string;
  accounts: string[];
  window:
    | { kind: "year"; year: number; from: string; to: string }
    | { kind: "day"; date: string; from: string; to: string };
  calendarTotal: number;
  kinds: BreakdownKindTotal[];
  private: number;
  /** Signed difference between calendar and per-type counts. */
  other: number;
  generatedAt: string;
}
