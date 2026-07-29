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
  totalContributions: number;
  weeks: ContributionWeek[];
}

export type Board = BoardUser[];

export interface BoardError {
  error: string;
  status: number;
}
