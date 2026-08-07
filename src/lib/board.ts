import type { AllTimeUser, Board, ContributionWeek } from "../../shared/types";
import { levelFor, quartiles, type Thresholds } from "../../shared/contributions.ts";
import { weekdayIndex, type FirstDayOfWeek } from "./format.ts";

export { levelFor, quartiles };
export type { Thresholds } from "../../shared/contributions.ts";

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
 * A whole calendar year aligned to the locale's week boundaries. Days the API
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
  firstDay: FirstDayOfWeek = 7,
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
  firstDay: FirstDayOfWeek = 7,
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
