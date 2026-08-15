import type { AllTimeUser, Board, ContributionWeek, UserProfile } from "./types";
import { levelFor, quartiles, type Thresholds } from "./contributions.ts";
import { BOARD_MILESTONES, nextMilestone, PERSONAL_MILESTONES } from "./milestones.ts";
import { parseDay, weekdayIndex, type FirstDayOfWeek } from "./format.ts";

export { levelFor, quartiles };
export type { Thresholds } from "./contributions.ts";

/** Combine the same two feeds used by the account page into its JSON form. */
export function userProfile(user: AllTimeUser, board: Board, year: number): UserProfile {
  const current = board.find((other) => other.login === user.login);
  return {
    ...user,
    currentYear: year,
    current: current
      ? { totalContributions: current.totalContributions, weeks: current.weeks }
      : null,
  };
}

export type CellState =
  /** A day in the year that has already happened. */
  | "day"
  /** A day in the year that hasn't happened yet. */
  | "future"
  /** Padding from the neighbouring year, so weeks stay aligned. */
  | "outside";

export interface Cell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  state: CellState;
}

export type Grid = Cell[][];

export interface PeakDay {
  date: string;
  count: number;
}

export interface CumulativePoint {
  date: string;
  total: number;
}

export interface CumulativeSeries {
  login: string;
  name: string | null;
  total: number;
  points: CumulativePoint[];
}

interface DayValue {
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

const DAY_MS = 86_400_000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function currentYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/**
 * A whole calendar year aligned to Monday-first week boundaries. Days the API
 * hasn't reported yet stay in the grid so the year fills in as it runs.
 */
function buildGrid(
  year: number,
  values: Map<string, DayValue>,
  today: string,
  firstWeekday: FirstDayOfWeek,
): Grid {
  const jan1 = Date.UTC(year, 0, 1);
  const dec31 = Date.UTC(year, 11, 31);
  const jan1Index = weekdayIndex(isoDate(jan1), firstWeekday);
  const dec31Index = weekdayIndex(isoDate(dec31), firstWeekday);
  const start = jan1 - jan1Index * DAY_MS;
  const end = dec31 + (6 - dec31Index) * DAY_MS;

  const firstDay = `${year}-01-01`;
  const lastDay = `${year}-12-31`;
  const weeks: Grid = [];

  for (let cursor = start; cursor <= end; ) {
    const days: Cell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const date = isoDate(cursor);
      const value = values.get(date);
      const state: CellState =
        date < firstDay || date > lastDay ? "outside" : date > today ? "future" : "day";
      days.push({ date, count: value?.count ?? 0, level: value?.level ?? 0, state });
      cursor += DAY_MS;
    }
    weeks.push(days);
  }

  return weeks;
}

/** One account's year, using GitHub's own per-account intensity levels. */
export function userGrid(
  weeks: ContributionWeek[],
  year: number,
  today: string,
  firstDay: FirstDayOfWeek = 1,
): Grid {
  const values = new Map<string, DayValue>();
  for (const week of weeks) {
    for (const day of week.days) values.set(day.date, { count: day.count, level: day.level });
  }
  return buildGrid(year, values, today, firstDay);
}

/** Every account's year summed into one strip, levelled across the group. */
export function groupGrid(
  board: Board,
  year: number,
  today: string,
  firstDay: FirstDayOfWeek = 1,
): Grid {
  const totals = new Map<string, number>();
  for (const user of board) {
    for (const week of user.weeks) {
      for (const day of week.days) {
        totals.set(day.date, (totals.get(day.date) ?? 0) + day.count);
      }
    }
  }

  const thresholds = quartiles([...totals.values()]);

  const values = new Map<string, DayValue>();
  for (const [date, count] of totals) values.set(date, { count, level: levelFor(count, thresholds) });

  return buildGrid(year, values, today, firstDay);
}

/**
 * One factual cumulative line per account. The live year stops at `today`;
 * finished years run through 31 December. Missing days are filled with the
 * previous total so every series shares the same x-axis.
 */
export function cumulativeSeries(board: Board, year: number, today: string): CumulativeSeries[] {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const through = today < last ? today : last;
  if (through < first) return [];

  const start = Date.UTC(year, 0, 1);
  const end = Date.parse(`${through}T00:00:00Z`);

  return board.map((user) => {
    const daily = new Map<string, number>();
    for (const week of user.weeks) {
      for (const day of week.days) {
        if (day.date >= first && day.date <= through) daily.set(day.date, day.count);
      }
    }

    let total = 0;
    const points: CumulativePoint[] = [];
    for (let cursor = start; cursor <= end; cursor += DAY_MS) {
      const date = isoDate(cursor);
      total += daily.get(date) ?? 0;
      points.push({ date, total });
    }

    return { login: user.login, name: user.name, total, points };
  });
}

/* ---------- all-time: one cell per year ---------- */

export interface YearCell {
  year: number;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** Placing among the accounts that were active that year. Zero years have none. */
  rank?: number;
}

export interface PeakYear {
  year: number;
  count: number;
}

/**
 * Levels are quartiles over every account's yearly totals, so cells compare
 * across the whole board — a 34-contribution career shouldn't glow gold.
 */
export function boardYearThresholds(users: AllTimeUser[]): Thresholds {
  return quartiles(users.flatMap((user) => Object.values(user.byYear)));
}

/** Each year's non-zero totals, high to low — enough to place any count in it. */
export type YearRanks = Map<number, number[]>;

export function boardYearRanks(users: AllTimeUser[], years: number[]): YearRanks {
  const ranks: YearRanks = new Map();
  for (const year of years) {
    const counts = users
      .map((user) => user.byYear[String(year)] ?? 0)
      .filter((count) => count > 0)
      .sort((a, b) => b - a);
    ranks.set(year, counts);
  }
  return ranks;
}

/** Competition ranking: two accounts tied for first are both 1st, the next 3rd. */
function rankIn(counts: number[] | undefined, count: number): number | undefined {
  if (!counts || count <= 0) return undefined;
  return counts.filter((other) => other > count).length + 1;
}

export function userYearStrip(
  user: AllTimeUser,
  years: number[],
  thresholds: Thresholds,
  ranks?: YearRanks,
): YearCell[] {
  return years.map((year) => {
    const count = user.byYear[String(year)] ?? 0;
    return {
      year,
      count,
      level: levelFor(count, thresholds),
      rank: rankIn(ranks?.get(year), count),
    };
  });
}

/** Every account summed per year, levelled against its own spread. */
export function groupYearStrip(users: AllTimeUser[], years: number[]): YearCell[] {
  const totals = years.map((year) =>
    users.reduce((sum, user) => sum + (user.byYear[String(year)] ?? 0), 0),
  );
  const thresholds = quartiles(totals);
  return years.map((year, index) => ({
    year,
    count: totals[index],
    level: levelFor(totals[index], thresholds),
  }));
}

export function peakYear(cells: YearCell[]): PeakYear | null {
  let best: PeakYear | null = null;
  for (const cell of cells) {
    if (cell.count > 0 && (!best || cell.count > best.count)) {
      best = { year: cell.year, count: cell.count };
    }
  }
  return best;
}

export function peakDay(grid: Grid): PeakDay | null {
  let best: PeakDay | null = null;
  for (const week of grid) {
    for (const cell of week) {
      if (cell.state === "day" && cell.count > 0 && (!best || cell.count > best.count)) {
        best = { date: cell.date, count: cell.count };
      }
    }
  }
  return best;
}

/**
 * A card is one calendar year, which on 2 January is an empty grid and a zero.
 * So it keeps showing the finished year until the second Monday of January.
 *
 * Monday because the grid's weeks start there, so the switch lands on a column
 * boundary rather than mid-week. The second because the first can fall on the
 * 1st itself — in a year that opens on a Monday that rule would be no rule at
 * all — and the second is never sooner than the 8th or later than the 14th.
 */
const ROLLOVER_WEEK = 2;

export function featuredYear(today: string): number {
  const date = parseDay(today);
  const year = date.getUTCFullYear();
  if (date.getUTCMonth() > 0) return year;

  // Intl's Monday=1…Sunday=7, so this is how far 1 January sits from a Monday.
  const opensOn = parseDay(`${year}-01-01`).getUTCDay() || 7;
  const firstMonday = 1 + ((8 - opensOn) % 7);
  return date.getUTCDate() < firstMonday + 7 * (ROLLOVER_WEEK - 1) ? year - 1 : year;
}

export interface YearShape {
  activeDays: number;
  bestDay: PeakDay | null;
  /** Active days running back from the most recent elapsed day. */
  currentStreak: number;
  longestStreak: number;
}

/**
 * What one account's year looks like from the inside: no other account is
 * involved, so a card can carry these without ranking anybody.
 */
export function yearShape(grid: Grid): YearShape {
  // Weeks are chronological and so are the days inside them, so this flattens
  // back into the order the year actually happened in.
  const days = grid.flat().filter((cell) => cell.state === "day");

  let activeDays = 0;
  let longestStreak = 0;
  let running = 0;
  for (const day of days) {
    if (day.count > 0) {
      activeDays += 1;
      running += 1;
      if (running > longestStreak) longestStreak = running;
    } else {
      running = 0;
    }
  }

  // The trailing run: `running` is exactly that, since the loop ends on the
  // most recent elapsed day.
  return {
    activeDays,
    bestDay: peakDay(grid),
    currentStreak: running,
    longestStreak,
  };
}

export interface RankGap {
  login: string;
  name: string | null;
  /** 1-based position of the account directly above. */
  rank: number;
  /** Their total minus ours; 0 means level on totals. */
  behind: number;
}

export interface UserGoals {
  /** Next personal milestone threshold, or null past the top of the ladder. */
  nextMilestone: number | null;
  /** Contributions remaining to the next milestone. */
  toMilestone: number | null;
  /** The account directly above, or null for the leader. */
  above: RankGap | null;
  /** For the leader only: margin over second place, or null with no runner-up. */
  leadMargin: number | null;
}

/**
 * Forward-looking goals for one row of the live-year board. `index` is the
 * user's 0-based position in the board, which arrives ranked from the API.
 */
export function userGoals(board: Board, index: number): UserGoals {
  const user = board[index];
  const next = nextMilestone(user.totalContributions, PERSONAL_MILESTONES);
  const aboveUser = index > 0 ? board[index - 1] : null;
  const runnerUp = index === 0 && board.length > 1 ? board[1] : null;
  return {
    nextMilestone: next,
    toMilestone: next === null ? null : next - user.totalContributions,
    above: aboveUser
      ? {
          login: aboveUser.login,
          name: aboveUser.name,
          rank: index,
          behind: aboveUser.totalContributions - user.totalContributions,
        }
      : null,
    leadMargin: runnerUp ? user.totalContributions - runnerUp.totalContributions : null,
  };
}

export interface BoardGoal {
  total: number;
  /** Next board-wide milestone, or null past the top of the ladder. */
  nextMilestone: number | null;
  remaining: number | null;
}

export function boardGoal(board: Board): BoardGoal {
  const total = board.reduce((sum, user) => sum + user.totalContributions, 0);
  const next = nextMilestone(total, BOARD_MILESTONES);
  return { total, nextMilestone: next, remaining: next === null ? null : next - total };
}
