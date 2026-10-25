import type { AllTimeUser, Board } from "./types.ts";
import { cakeDayYears } from "./cakeday.ts";
import {
  ALL_TIME_PERSONAL_MILESTONES,
  BOARD_MILESTONES,
  PERSONAL_MILESTONES,
} from "./milestones.ts";

export type AchievementHistory = Pick<AllTimeUser, "login" | "byYear">;

interface AchievementDate {
  id: string;
  date: string;
  year: number;
  provisional: boolean;
}

export type Achievement = AchievementDate & (
  | { kind: "yearly-milestone"; login: string; threshold: number }
  | { kind: "lifetime-milestone"; login: string; threshold: number }
  | { kind: "board-milestone"; threshold: number }
  | { kind: "personal-best"; login: string; count: number; previousCount: number }
  | { kind: "board-record"; logins: string[]; count: number; previousCount: number }
  | { kind: "anniversary"; login: string; years: number }
);

export interface AchievementOptions {
  board: Board;
  year: number;
  today: string;
  /** Complete finished-year totals. Omit when the archive is unavailable or partial. */
  history?: readonly AchievementHistory[];
  /** Partial boards can show personal achievements, but cannot establish group records. */
  complete?: boolean;
}

/**
 * Reconstruct achievements from contribution dates, rather than observation
 * times. One year's daily calendars plus finished-year totals are sufficient;
 * no notification state, webhook or historical daily fetch is needed.
 */
export function achievementsForYear(options: AchievementOptions): Achievement[] {
  const { board, year, today, history, complete = true } = options;
  const first = `${year}-01-01`;
  const last = today < `${year}-12-31` ? today : `${year}-12-31`;
  const archived = new Map(history?.map((user) => [user.login, user.byYear]));
  const calendars = board.map((user) => ({
    user,
    // Neighbouring-year cells do not belong to this year's totals. Sort
    // explicitly so cached week order cannot change a crossing date.
    days: [...new Map(user.weeks.flatMap((week) => week.days)
      .filter((day) => day.date >= first && day.date <= last)
      .map((day) => [day.date, day.count])).entries()].sort(([a], [b]) => a.localeCompare(b)),
  }));
  const events = calendars.flatMap(({ user, days }) => [
    ...personalAchievements(user.login, days, archived.get(user.login), year, today),
    ...anniversaryAchievement(user.login, user.createdAt, year, today),
  ]);
  if (complete) events.push(...boardAchievements(calendars, year, today));
  return events.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

function stamp(id: string, date: string, year: number, today: string): AchievementDate {
  return { id, date, year, provisional: date === today };
}

function crossed(before: number, after: number, thresholds: readonly number[]): number[] {
  return thresholds.filter((threshold) => before < threshold && after >= threshold);
}

function personalAchievements(
  login: string, days: [string, number][], byYear: Record<string, number> | undefined,
  year: number, today: string,
): Achievement[] {
  const events: Achievement[] = [];
  let total = 0;
  let peak = 0;
  let lifetime = byYear
    ? Object.entries(byYear).reduce((sum, [key, count]) => +key < year ? sum + count : sum, 0)
    : null;
  for (const [date, count] of days) {
    const before = total;
    total += count;
    for (const threshold of crossed(before, total, PERSONAL_MILESTONES)) events.push({
      ...stamp(`yearly-milestone/${year}/${login}/${threshold}`, date, year, today),
      kind: "yearly-milestone", login, threshold,
    });
    if (lifetime !== null) {
      for (const threshold of crossed(lifetime, lifetime + count, ALL_TIME_PERSONAL_MILESTONES)) events.push({
        ...stamp(`lifetime-milestone/${login}/${threshold}`, date, year, today),
        kind: "lifetime-milestone", login, threshold,
      });
      lifetime += count;
    }
    // The first active day establishes a baseline, not a record improvement.
    if (count > peak && peak > 0) events.push({
      ...stamp(`personal-best/${year}/${login}/${date}`, date, year, today),
      kind: "personal-best", login, count, previousCount: peak,
    });
    peak = Math.max(peak, count);
  }
  return events;
}

function anniversaryAchievement(
  login: string, createdAt: string | undefined, year: number, today: string,
): Achievement[] {
  if (!createdAt) return [];
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return [];
  // Rolls 29 February forward to 1 March in common years, like the shared rule.
  const date = new Date(Date.UTC(year, created.getUTCMonth(), created.getUTCDate()))
    .toISOString().slice(0, 10);
  const years = cakeDayYears(createdAt, date);
  if (!years || years < 1 || date > today) return [];
  return [{
    ...stamp(`anniversary/${login}/${year}`, date, year, today),
    kind: "anniversary", login, years, provisional: false,
  }];
}

function boardAchievements(
  calendars: { user: Board[number]; days: [string, number][] }[], year: number, today: string,
): Achievement[] {
  const days = new Map<string, { total: number; peak: number; logins: string[] }>();
  for (const { user, days: calendar } of calendars) {
    for (const [date, count] of calendar) {
      const group = days.get(date) ?? { total: 0, peak: 0, logins: [] };
      group.total += count;
      if (count > group.peak) {
        group.peak = count;
        group.logins = [user.login];
      } else if (count > 0 && count === group.peak) {
        group.logins.push(user.login);
      }
      days.set(date, group);
    }
  }
  const events: Achievement[] = [];
  let total = 0;
  let peak = 0;
  for (const [date, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    for (const threshold of crossed(total, total + day.total, BOARD_MILESTONES)) events.push({
      ...stamp(`board-milestone/${year}/${threshold}`, date, year, today),
      kind: "board-milestone", threshold,
    });
    total += day.total;
    if (day.peak > peak && peak > 0) events.push({
      ...stamp(`board-record/${year}/${date}`, date, year, today),
      kind: "board-record", logins: day.logins.sort(), count: day.peak, previousCount: peak,
    });
    peak = Math.max(peak, day.peak);
  }
  return events;
}

/** A shared record needs one celebration, while a profile still owns that record. */
export function achievementFeed(events: readonly Achievement[], login?: string): Achievement[] {
  const boardRecords = new Set(events.flatMap((event) => event.kind === "board-record"
    ? event.logins.map((holder) => `${holder}/${event.date}`) : []));
  return events.filter((event) => {
    if (login && !("login" in event ? event.login === login
      : event.kind === "board-record" && event.logins.includes(login))) return false;
    return !(event.kind === "personal-best" && boardRecords.has(`${event.login}/${event.date}`));
  });
}
