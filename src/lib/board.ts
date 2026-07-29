import type { Board, ContributionWeek } from "../../shared/types";

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
 * A whole calendar year on a Sunday-first grid: Jan 1 back to the Sunday that
 * starts its week, Dec 31 forward to the Saturday that ends its week. Days the
 * API hasn't reported yet stay in the grid so the year fills in as it runs.
 */
function buildGrid(year: number, values: Map<string, DayValue>, today: string): Grid {
  const jan1 = Date.UTC(year, 0, 1);
  const dec31 = Date.UTC(year, 11, 31);
  const start = jan1 - new Date(jan1).getUTCDay() * DAY_MS;
  const end = dec31 + (6 - new Date(dec31).getUTCDay()) * DAY_MS;

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
export function userGrid(weeks: ContributionWeek[], year: number, today: string): Grid {
  const values = new Map<string, DayValue>();
  for (const week of weeks) {
    for (const day of week.days) values.set(day.date, { count: day.count, level: day.level });
  }
  return buildGrid(year, values, today);
}

/** Quartile thresholds over the non-zero days, mirroring GitHub's own levelling. */
function levelFor(count: number, thresholds: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

/** Every account's year summed into one strip, levelled across the group. */
export function groupGrid(board: Board, year: number, today: string): Grid {
  const totals = new Map<string, number>();
  for (const user of board) {
    for (const week of user.weeks) {
      for (const day of week.days) {
        totals.set(day.date, (totals.get(day.date) ?? 0) + day.count);
      }
    }
  }

  const counts = [...totals.values()].filter((n) => n > 0).sort((a, b) => a - b);
  const at = (fraction: number) =>
    counts.length === 0
      ? 0
      : counts[Math.min(counts.length - 1, Math.floor(counts.length * fraction))];
  const thresholds: [number, number, number] = [at(0.25), at(0.5), at(0.75)];

  const values = new Map<string, DayValue>();
  for (const [date, count] of totals) values.set(date, { count, level: levelFor(count, thresholds) });

  return buildGrid(year, values, today);
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
