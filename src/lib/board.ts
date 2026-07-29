import type { Board, ContributionDay, ContributionWeek } from "../../shared/types";

export interface PeakDay {
  date: string;
  count: number;
}

export function peakDay(weeks: ContributionWeek[]): PeakDay | null {
  let best: PeakDay | null = null;
  for (const week of weeks) {
    for (const day of week.days) {
      if (day.count > 0 && (!best || day.count > best.count)) {
        best = { date: day.date, count: day.count };
      }
    }
  }
  return best;
}

/** Quartile thresholds over the non-zero days, mirroring GitHub's own levelling. */
function levelFor(count: number, thresholds: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

/**
 * Sums every account's calendar into one strip: the whole group's year, by day.
 * Uses the longest calendar as the grid so partial first/last weeks line up.
 */
export function groupPulse(board: Board): ContributionWeek[] {
  if (board.length === 0) return [];

  const totals = new Map<string, number>();
  for (const user of board) {
    for (const week of user.weeks) {
      for (const day of week.days) {
        totals.set(day.date, (totals.get(day.date) ?? 0) + day.count);
      }
    }
  }

  const grid = board.reduce((longest, user) =>
    user.weeks.length > longest.weeks.length ? user : longest,
  ).weeks;

  const counts = [...totals.values()].filter((n) => n > 0).sort((a, b) => a - b);
  const at = (fraction: number) =>
    counts.length === 0 ? 0 : counts[Math.min(counts.length - 1, Math.floor(counts.length * fraction))];
  const thresholds: [number, number, number] = [at(0.25), at(0.5), at(0.75)];

  return grid.map((week) => ({
    days: week.days.map<ContributionDay>((day) => {
      const count = totals.get(day.date) ?? 0;
      return { date: day.date, count, level: levelFor(count, thresholds) };
    }),
  }));
}
