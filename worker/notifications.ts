import { cakeDayYears } from "../shared/cakeday.ts";
import { BOARD_MILESTONES, milestoneFor, PERSONAL_MILESTONES } from "../shared/milestones.ts";
import type { Board, BoardUser } from "../shared/types";

export interface DailyPeak {
  login: string;
  url: string;
  avatarUrl: string;
  date: string;
  count: number;
}

/**
 * A day announced as a record. Later rises that day are quiet; once the day
 * is over, one wrap-up reports where it finished if that is higher.
 */
export interface AnnouncedDay {
  /** The record as announced. */
  peak: DailyPeak;
  /** The highest count seen for that day since. */
  latest: number;
  wrapped: boolean;
}

/** Durable state for daily records in one leaderboard year. */
export interface DailyRecordState {
  year: number;
  personalBests: Record<string, number>;
  boardBest: number;
  /**
   * Every day announced as a PB, by login then date. Kept for the whole year
   * so a day is never announced twice; an earlier year's days stay only until
   * their wrap-up is sent.
   */
  personalDays: Record<string, Record<string, AnnouncedDay>>;
  /** Every day announced as a board record, by `dayKey`, kept the same way. */
  boardDays: Record<string, AnnouncedDay>;
  /** The finished year's board record, which that year's days are compared with. */
  previousYearBoardBest: number;
}

/** The shape written before announced days were tracked. */
export interface LegacyDailyRecordState {
  year: number;
  personalBests: Record<string, number>;
  boardBest: number;
}

export interface PersonalBestEvent extends DailyPeak {
  previousCount: number;
}

export interface BoardRecordEvent {
  peak: DailyPeak;
  previousCount: number;
}

/** Where an announced record's day finished: `count` is the final figure. */
export interface DailyWrapUpEvent extends DailyPeak {
  announcedCount: number;
}

export interface DailyRecordPlan {
  /** No alerts are sent when durable state is first introduced. */
  baseline: boolean;
  /** Persist before sending, so newly added accounts do not emit historic PBs. */
  stateBeforeEvents: DailyRecordState;
  needsPreparation: boolean;
  personalWrapUps: DailyWrapUpEvent[];
  boardWrapUps: DailyWrapUpEvent[];
  personalBests: PersonalBestEvent[];
  boardRecord: BoardRecordEvent | null;
  /** The state reached after every planned alert succeeds. */
  nextState: DailyRecordState;
}

export type DailyRecordNotification =
  | { type: "personal-best-wrap-up"; event: DailyWrapUpEvent }
  | { type: "board-record-wrap-up"; event: DailyWrapUpEvent }
  | { type: "personal-best"; event: PersonalBestEvent }
  | { type: "board-record"; event: BoardRecordEvent };

/** Durable state for contribution milestones in one leaderboard year. */
export interface MilestoneState {
  year: number;
  personalTotals: Record<string, number>;
  personalMilestones: Record<string, number>;
  boardTotal: number;
  boardMilestone: number;
}

export interface PersonalMilestoneEvent {
  login: string;
  url: string;
  avatarUrl: string;
  threshold: number;
}

export interface BoardMilestoneEvent {
  threshold: number;
}

export interface MilestonePlan {
  /** No alerts are sent when a year's state is first observed. */
  baseline: boolean;
  /** State to save before sending alerts, including quiet corrections. */
  stateBeforeEvents: MilestoneState;
  needsPreparation: boolean;
  personalMilestones: PersonalMilestoneEvent[];
  boardMilestone: BoardMilestoneEvent | null;
  /** The state reached after every planned alert succeeds. */
  nextState: MilestoneState;
}

export type MilestoneNotification =
  | { type: "personal-milestone"; event: PersonalMilestoneEvent }
  | { type: "board-milestone"; event: BoardMilestoneEvent };

/**
 * Serialises work without poisoning later calls when one task rejects. Durable
 * Object requests can interleave while an external webhook fetch is pending.
 */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run(task: () => Promise<void>): Promise<void> {
    const pending = this.tail.then(task);
    this.tail = pending.catch(() => undefined);
    return pending;
  }
}

function peakFor(user: BoardUser, year: number): DailyPeak | null {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  let peak: DailyPeak | null = null;
  for (const week of user.weeks) {
    for (const day of week.days) {
      if (
        day.date >= first &&
        day.date <= last &&
        day.count > 0 &&
        (!peak || day.count > peak.count)
      ) {
        peak = {
          login: user.login,
          url: user.url,
          avatarUrl: user.avatarUrl,
          date: day.date,
          count: day.count,
        };
      }
    }
  }
  return peak;
}

export function dailyPeaks(board: Board, year: number): DailyPeak[] {
  return board.flatMap((user) => {
    const peak = peakFor(user, year);
    return peak ? [peak] : [];
  });
}

function peakCounts(board: Board, peaks: DailyPeak[]): Record<string, number> {
  const counts = Object.fromEntries(board.map((user) => [user.login, 0]));
  for (const peak of peaks) counts[peak.login] = peak.count;
  return counts;
}

function highestPeak(peaks: DailyPeak[]): DailyPeak | null {
  let highest: DailyPeak | null = null;
  for (const peak of peaks) {
    if (!highest || peak.count > highest.count) highest = peak;
  }
  return highest;
}

function announcedDay(peak: DailyPeak): AnnouncedDay {
  const { login, url, avatarUrl, date, count } = peak;
  return { peak: { login, url, avatarUrl, date, count }, latest: count, wrapped: false };
}

function dayKey(login: string, date: string): string {
  return `${login} ${date}`;
}

function inYear(date: string, year: number): boolean {
  return date.startsWith(`${year}-`);
}

function dayCounts(user: BoardUser): Map<string, number> {
  return new Map(user.weeks.flatMap((week) => week.days.map((day) => [day.date, day.count])));
}

function personalWrapUp(day: AnnouncedDay, today: string): DailyWrapUpEvent | null {
  if (day.wrapped || day.peak.date >= today || day.latest <= day.peak.count) return null;
  return { ...day.peak, count: day.latest, announcedCount: day.peak.count };
}

function personalWrapUps(state: DailyRecordState, today: string): DailyWrapUpEvent[] {
  return Object.values(state.personalDays).flatMap((days) =>
    Object.values(days).flatMap((day) => {
      const wrapUp = personalWrapUp(day, today);
      return wrapUp ? [wrapUp] : [];
    }),
  );
}

/**
 * At most one per finished date: the day's highest board record, when it
 * rose past every record announced that day and still is the record. A day
 * from the finished year is compared with that year's record.
 */
function boardWrapUps(state: DailyRecordState, today: string): DailyWrapUpEvent[] {
  const byDate = new Map<string, AnnouncedDay[]>();
  for (const day of Object.values(state.boardDays)) {
    if (day.peak.date >= today) continue;
    byDate.set(day.peak.date, [...(byDate.get(day.peak.date) ?? []), day]);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([date, days]) => {
      if (days.some((day) => day.wrapped)) return [];
      const announcedCount = Math.max(...days.map((day) => day.peak.count));
      const top = days.reduce((best, day) => (day.latest > best.latest ? day : best));
      const record = inYear(date, state.year) ? state.boardBest : state.previousYearBoardBest;
      const stillRecord = top.latest >= record;
      return top.latest > announcedCount && stillRecord
        ? [{ ...top.peak, count: top.latest, announcedCount }]
        : [];
    });
}

/**
 * Follows every announced day through the full calendar, saving rises into
 * `state` without alerting, so a new record says what it really beat and the
 * wrap-up has the final figure. Returns whether anything changed.
 */
function followAnnouncedDays(state: DailyRecordState, board: Board): boolean {
  let changed = false;
  const follow = (day: AnnouncedDay, counts: Map<string, number>): AnnouncedDay => {
    const count = counts.get(day.peak.date) ?? 0;
    if (count <= day.latest) return day;
    changed = true;
    return { ...day, latest: count };
  };
  const users = new Map(board.map((user) => [user.login, dayCounts(user)]));

  for (const [login, days] of Object.entries(state.personalDays)) {
    const counts = users.get(login);
    if (!counts) continue;
    for (const [date, day] of Object.entries(days)) {
      days[date] = follow(day, counts);
      if (inYear(date, state.year) && days[date].latest > state.personalBests[login]) {
        state.personalBests[login] = days[date].latest;
      }
    }
  }
  for (const [key, day] of Object.entries(state.boardDays)) {
    const counts = users.get(day.peak.login);
    if (!counts) continue;
    state.boardDays[key] = follow(day, counts);
    const { latest } = state.boardDays[key];
    if (inYear(day.peak.date, state.year)) state.boardBest = Math.max(state.boardBest, latest);
    else state.previousYearBoardBest = Math.max(state.previousYearBoardBest, latest);
  }
  return changed;
}

/**
 * Drops the finished year's announced days once they are wrapped up, or once
 * its first week is over and nothing is left to send: until then the board's
 * first week can still show late contributions landing on late December.
 */
function dropFinishedYears(state: DailyRecordState, today: string): boolean {
  const graceOver = today >= `${state.year}-01-08`;
  let changed = false;
  for (const [login, days] of Object.entries(state.personalDays)) {
    for (const [date, day] of Object.entries(days)) {
      const finished = day.wrapped || (graceOver && !personalWrapUp(day, today));
      if (!inYear(date, state.year) && finished) {
        delete days[date];
        changed = true;
      }
    }
    if (Object.keys(days).length === 0) delete state.personalDays[login];
  }
  // Board days go by date: one wrapped holder settles the whole date.
  const pending = new Set(boardWrapUps(state, today).map((event) => event.date));
  const wrapped = new Set(
    Object.values(state.boardDays).flatMap((day) => (day.wrapped ? [day.peak.date] : [])),
  );
  for (const [key, day] of Object.entries(state.boardDays)) {
    const { date } = day.peak;
    const finished = wrapped.has(date) || (graceOver && !pending.has(date));
    if (!inYear(date, state.year) && finished) {
      delete state.boardDays[key];
      changed = true;
    }
  }
  return changed;
}

function applyPersonalWrapUp(state: DailyRecordState, event: DailyWrapUpEvent): void {
  const days = state.personalDays[event.login];
  days[event.date] = { ...days[event.date], wrapped: true };
}

function applyBoardWrapUp(state: DailyRecordState, event: DailyWrapUpEvent): void {
  for (const [key, day] of Object.entries(state.boardDays)) {
    if (day.peak.date === event.date) state.boardDays[key] = { ...day, wrapped: true };
  }
}

function applyPersonalBest(state: DailyRecordState, event: PersonalBestEvent): void {
  state.personalBests[event.login] = event.count;
  state.personalDays[event.login] = {
    ...state.personalDays[event.login],
    [event.date]: announcedDay(event),
  };
}

function applyBoardRecord(state: DailyRecordState, event: BoardRecordEvent): void {
  state.boardBest = event.peak.count;
  state.boardDays[dayKey(event.peak.login, event.peak.date)] = announcedDay(event.peak);
}

function keptDays<T>(days: Record<string, T>, keep: (key: string, value: T) => boolean) {
  return Object.fromEntries(Object.entries(days).filter(([key, value]) => keep(key, value)));
}

function startingState(
  year: number,
  board: Board,
  previous: DailyRecordState | LegacyDailyRecordState,
): DailyRecordState {
  const rolledOver = previous.year !== year;
  // A rollover keeps only the year just finished: a day from before it would
  // be compared with a record this state no longer holds.
  const current = rolledOver ? previous.year : year;
  const personalDays = "personalDays" in previous ? structuredClone(previous.personalDays) : {};
  const boardDays = "boardDays" in previous ? structuredClone(previous.boardDays) : {};
  return {
    year,
    personalBests: rolledOver
      ? Object.fromEntries(board.map((user) => [user.login, 0]))
      : { ...previous.personalBests },
    boardBest: rolledOver ? 0 : previous.boardBest,
    personalDays: rolledOver
      ? Object.fromEntries(
          Object.entries(personalDays).map(([login, days]) => [
            login,
            keptDays(days, (date) => inYear(date, current)),
          ]),
        )
      : personalDays,
    boardDays: rolledOver
      ? keptDays(boardDays, (_, day) => inYear(day.peak.date, current))
      : boardDays,
    previousYearBoardBest: rolledOver
      ? previous.boardBest
      : "previousYearBoardBest" in previous
        ? previous.previousYearBoardBest
        : 0,
  };
}

/**
 * Compares a fresh board with durable record state. Each day is announced
 * as a record at most once per account: further rises only update state, and
 * the first check after the day ends (UTC, like the board's dates) wraps up
 * where it finished. A year rollover starts the new year's records from zero;
 * a brand-new Durable Object starts silently.
 */
export function planDailyRecords(
  year: number,
  today: string,
  board: Board,
  previous?: DailyRecordState | LegacyDailyRecordState,
): DailyRecordPlan {
  const peaks = dailyPeaks(board, year);
  const currentCounts = peakCounts(board, peaks);
  const boardPeak = highestPeak(peaks);

  if (!previous) {
    const baseline: DailyRecordState = {
      year,
      personalBests: currentCounts,
      boardBest: boardPeak?.count ?? 0,
      personalDays: {},
      boardDays: {},
      previousYearBoardBest: 0,
    };
    return {
      baseline: true,
      stateBeforeEvents: baseline,
      needsPreparation: true,
      personalWrapUps: [],
      boardWrapUps: [],
      personalBests: [],
      boardRecord: null,
      nextState: baseline,
    };
  }

  const rolledOver = previous.year !== year;
  const stateBeforeEvents = startingState(year, board, previous);
  let needsPreparation = rolledOver;
  if (!rolledOver) {
    // A person added during the year gets a quiet baseline: their existing
    // history is not a newly observed PB.
    for (const [login, count] of Object.entries(currentCounts)) {
      if (!Object.hasOwn(stateBeforeEvents.personalBests, login)) {
        stateBeforeEvents.personalBests[login] = count;
        stateBeforeEvents.boardBest = Math.max(stateBeforeEvents.boardBest, count);
        needsPreparation = true;
      }
    }
  }
  if (followAnnouncedDays(stateBeforeEvents, board)) needsPreparation = true;
  if (dropFinishedYears(stateBeforeEvents, today)) needsPreparation = true;

  // Announced days are already counted in the bests, so only a day not yet
  // announced can beat them.
  const personalBests = peaks.flatMap<PersonalBestEvent>((peak) => {
    const previousCount = stateBeforeEvents.personalBests[peak.login];
    return peak.count > previousCount ? [{ ...peak, previousCount }] : [];
  });
  const boardRecord =
    boardPeak && boardPeak.count > stateBeforeEvents.boardBest
      ? { peak: boardPeak, previousCount: stateBeforeEvents.boardBest }
      : null;
  const personal = personalWrapUps(stateBeforeEvents, today);

  const nextState = stateSnapshot(stateBeforeEvents);
  for (const event of personal) applyPersonalWrapUp(nextState, event);
  for (const event of personalBests) applyPersonalBest(nextState, event);
  if (boardRecord) applyBoardRecord(nextState, boardRecord);
  // Chosen after the new record joins its day, so a record set on a day that
  // has already ended is that day's holder and not wrapped up from under it.
  const boardDays = boardWrapUps(nextState, today);
  for (const event of boardDays) applyBoardWrapUp(nextState, event);

  return {
    baseline: false,
    stateBeforeEvents,
    needsPreparation,
    personalWrapUps: personal,
    boardWrapUps: boardDays,
    personalBests,
    boardRecord,
    nextState,
  };
}

function stateSnapshot(state: DailyRecordState): DailyRecordState {
  return structuredClone(state);
}

/**
 * Sends a plan and checkpoints each successful notification. On retry, a new
 * plan built from the last saved snapshot resumes at the first failed event.
 */
export async function deliverDailyRecords(
  plan: DailyRecordPlan,
  notify: (notification: DailyRecordNotification) => Promise<void>,
  save: (state: DailyRecordState) => Promise<void>,
): Promise<void> {
  if (plan.baseline) {
    await save(stateSnapshot(plan.nextState));
    return;
  }

  const progress = stateSnapshot(plan.stateBeforeEvents);
  if (plan.needsPreparation) await save(stateSnapshot(progress));

  for (const event of plan.personalWrapUps) {
    await notify({ type: "personal-best-wrap-up", event });
    applyPersonalWrapUp(progress, event);
    await save(stateSnapshot(progress));
  }

  for (const event of plan.personalBests) {
    await notify({ type: "personal-best", event });
    applyPersonalBest(progress, event);
    await save(stateSnapshot(progress));
  }

  if (plan.boardRecord) {
    await notify({ type: "board-record", event: plan.boardRecord });
    applyBoardRecord(progress, plan.boardRecord);
    await save(stateSnapshot(progress));
  }

  for (const event of plan.boardWrapUps) {
    await notify({ type: "board-record-wrap-up", event });
    applyBoardWrapUp(progress, event);
    await save(stateSnapshot(progress));
  }
}

function milestoneStateSnapshot(state: MilestoneState): MilestoneState {
  return {
    ...state,
    personalTotals: { ...state.personalTotals },
    personalMilestones: { ...state.personalMilestones },
  };
}

function milestoneBaseline(year: number, board: Board): MilestoneState {
  const personalTotals = Object.fromEntries(
    board.map((user) => [user.login, user.totalContributions]),
  );
  return {
    year,
    personalTotals,
    personalMilestones: Object.fromEntries(
      board.map((user) => [
        user.login,
        milestoneFor(user.totalContributions, PERSONAL_MILESTONES),
      ]),
    ),
    boardTotal: board.reduce((total, user) => total + user.totalContributions, 0),
    boardMilestone: milestoneFor(
      board.reduce((total, user) => total + user.totalContributions, 0),
      BOARD_MILESTONES,
    ),
  };
}

/**
 * Finds the highest newly passed contribution milestone for each person and
 * the board. New years and newly observed accounts are seeded silently.
 */
export function planMilestones(
  year: number,
  board: Board,
  previous?: MilestoneState,
): MilestonePlan {
  if (!previous || previous.year !== year) {
    const baseline = milestoneBaseline(year, board);
    return {
      baseline: true,
      stateBeforeEvents: baseline,
      needsPreparation: true,
      personalMilestones: [],
      boardMilestone: null,
      nextState: baseline,
    };
  }

  const stateBeforeEvents = milestoneStateSnapshot(previous);
  const newAccounts = new Set<string>();
  let needsPreparation = false;

  for (const user of board) {
    if (!Object.hasOwn(stateBeforeEvents.personalTotals, user.login)) {
      stateBeforeEvents.personalTotals[user.login] = user.totalContributions;
      stateBeforeEvents.personalMilestones[user.login] = milestoneFor(
        user.totalContributions,
        PERSONAL_MILESTONES,
      );
      newAccounts.add(user.login);
      needsPreparation = true;
      continue;
    }

    if (stateBeforeEvents.personalTotals[user.login] !== user.totalContributions) {
      stateBeforeEvents.personalTotals[user.login] = user.totalContributions;
      needsPreparation = true;
    }
    if (!Object.hasOwn(stateBeforeEvents.personalMilestones, user.login)) {
      stateBeforeEvents.personalMilestones[user.login] = milestoneFor(
        user.totalContributions,
        PERSONAL_MILESTONES,
      );
      newAccounts.add(user.login);
      needsPreparation = true;
    }
  }

  const boardTotal = board.reduce((total, user) => total + user.totalContributions, 0);
  if (stateBeforeEvents.boardTotal !== boardTotal) {
    stateBeforeEvents.boardTotal = boardTotal;
    needsPreparation = true;
  }

  const personalMilestones = board.flatMap<PersonalMilestoneEvent>((user) => {
    if (newAccounts.has(user.login)) return [];
    const threshold = milestoneFor(user.totalContributions, PERSONAL_MILESTONES);
    return threshold > stateBeforeEvents.personalMilestones[user.login]
      ? [{ login: user.login, url: user.url, avatarUrl: user.avatarUrl, threshold }]
      : [];
  });
  const boardThreshold = milestoneFor(boardTotal, BOARD_MILESTONES);
  const boardMilestone =
    boardThreshold > stateBeforeEvents.boardMilestone ? { threshold: boardThreshold } : null;

  const nextState = milestoneStateSnapshot(stateBeforeEvents);
  for (const event of personalMilestones) {
    nextState.personalMilestones[event.login] = event.threshold;
  }
  if (boardMilestone) nextState.boardMilestone = boardMilestone.threshold;

  return {
    baseline: false,
    stateBeforeEvents,
    needsPreparation,
    personalMilestones,
    boardMilestone,
    nextState,
  };
}

/**
 * Sends a milestone plan and checkpoints every successful webhook so retries
 * resume at the first failed notification without posting duplicates.
 */
export async function deliverMilestones(
  plan: MilestonePlan,
  notify: (notification: MilestoneNotification) => Promise<void>,
  save: (state: MilestoneState) => Promise<void>,
): Promise<void> {
  if (plan.baseline) {
    await save(milestoneStateSnapshot(plan.nextState));
    return;
  }

  const progress = milestoneStateSnapshot(plan.stateBeforeEvents);
  if (plan.needsPreparation) await save(milestoneStateSnapshot(progress));

  for (const event of plan.personalMilestones) {
    await notify({ type: "personal-milestone", event });
    progress.personalMilestones[event.login] = event.threshold;
    await save(milestoneStateSnapshot(progress));
  }

  if (plan.boardMilestone) {
    await notify({ type: "board-milestone", event: plan.boardMilestone });
    progress.boardMilestone = plan.boardMilestone.threshold;
    await save(milestoneStateSnapshot(progress));
  }
}

export interface CakeDayEvent {
  login: string;
  url: string;
  avatarUrl: string;
  createdAt: string;
  years: number;
}

/**
 * Durable cake-day state: the calendar year each account was last announced
 * in. Accounts that leave the board keep their entry, so one that comes back
 * the same year cannot have its cake day posted twice.
 */
export interface CakeDayState {
  announced: Record<string, number>;
}

export interface CakeDayPlan {
  /** The calendar year to checkpoint against; the anniversaries are all in it. */
  year: number;
  stateBeforeEvents: CakeDayState;
  events: CakeDayEvent[];
  /** The state reached after every planned alert succeeds. */
  nextState: CakeDayState;
}

function cakeDayStateSnapshot(state: CakeDayState): CakeDayState {
  return { announced: { ...state.announced } };
}

/**
 * Finds the accounts whose anniversary is `today`. Unlike the other planners
 * this has no quiet baseline: state exists only to stop the scheduled check
 * repeating itself, so a cake day landing on a fresh Durable Object is still
 * announced. The stored year is what makes the next one fire.
 */
export function planCakeDays(today: string, board: Board, previous?: CakeDayState): CakeDayPlan {
  const year = Number(today.slice(0, 4));
  const stateBeforeEvents = cakeDayStateSnapshot(previous ?? { announced: {} });

  const events = board.flatMap<CakeDayEvent>((user) => {
    if (!user.createdAt || stateBeforeEvents.announced[user.login] === year) return [];
    const years = cakeDayYears(user.createdAt, today);
    return years === null
      ? []
      : [{
          login: user.login,
          url: user.url,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          years,
        }];
  });

  const nextState = cakeDayStateSnapshot(stateBeforeEvents);
  for (const event of events) nextState.announced[event.login] = year;

  return { year, stateBeforeEvents, events, nextState };
}

/**
 * Sends a cake-day plan and checkpoints each account as it succeeds. A day
 * with nothing to announce writes nothing at all.
 */
export async function deliverCakeDays(
  plan: CakeDayPlan,
  notify: (event: CakeDayEvent) => Promise<void>,
  save: (state: CakeDayState) => Promise<void>,
): Promise<void> {
  const progress = cakeDayStateSnapshot(plan.stateBeforeEvents);
  for (const event of plan.events) {
    await notify(event);
    progress.announced[event.login] = plan.year;
    await save(cakeDayStateSnapshot(progress));
  }
}

export interface StandingEntry {
  login: string;
  url: string;
  avatarUrl: string;
  totalContributions: number;
}

export interface LeaderEvent {
  leader: StandingEntry;
}

export interface OvertakeEvent {
  position: number;
  mover: StandingEntry;
  displaced: StandingEntry;
}

export type StandingNotification =
  | { type: "leader"; event: LeaderEvent }
  | { type: "overtake"; event: OvertakeEvent };

/** Durable full-board standing state for one leaderboard year. */
export interface StandingState {
  year: number;
  order: string[];
}

/** The shape written by the former leader-only implementation. */
export interface LegacyLeaderState {
  year: number;
  login: string;
}

/** The unshipped top-three shape from the preceding implementation. */
export interface LegacyTopThreeState {
  year: number;
  top: StandingEntry[];
}

/** The entry-based standings shape written by the preceding implementation. */
export interface LegacyEntryStandingState {
  year: number;
  order: StandingEntry[];
}

export interface StandingNotificationStep {
  notification: StandingNotification;
  /** Ordering to checkpoint immediately after this notification succeeds. */
  nextState: StandingState;
}

export interface StandingPlan {
  /** No alerts are sent when state is first introduced or the year changes. */
  baseline: boolean;
  /** State to save before sending a batch of rank-change alerts. */
  stateBeforeEvents: StandingState;
  needsPreparation: boolean;
  notifications: StandingNotificationStep[];
  /** The state reached after every planned alert succeeds. */
  nextState: StandingState;
}

function standingEntry(user: BoardUser): StandingEntry {
  return {
    login: user.login,
    url: user.url,
    avatarUrl: user.avatarUrl,
    totalContributions: user.totalContributions,
  };
}

function standingStateSnapshot(state: StandingState): StandingState {
  return { ...state, order: [...state.order] };
}

function isStandingState(
  state: StandingState | LegacyLeaderState | LegacyTopThreeState | LegacyEntryStandingState,
): state is StandingState {
  if (!Object.hasOwn(state, "order")) return false;
  return (state as { order: unknown[] }).order.every((login) => typeof login === "string");
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((login, index) => login === right[index]);
}

function currentOrder(board: Board, previousOrder?: string[]): string[] {
  const previousPositions = new Map(previousOrder?.map((login, index) => [login, index]) ?? []);
  const storedLength = previousOrder?.length ?? 0;
  return board
    .map((user, index) => ({
      user,
      incumbencyRank: previousPositions.get(user.login) ?? storedLength + index,
    }))
    .sort((left, right) => {
      const totalDifference = right.user.totalContributions - left.user.totalContributions;
      if (totalDifference !== 0) return totalDifference;
      return left.incumbencyRank - right.incumbencyRank;
    })
    .map(({ user }) => user.login);
}

export function ordinal(position: number): string {
  const lastTwo = position % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${position}th`;
  switch (position % 10) {
    case 1:
      return `${position}st`;
    case 2:
      return `${position}nd`;
    case 3:
      return `${position}rd`;
    default:
      return `${position}th`;
  }
}

/** Partial GitHub responses must not advance any notification checkpoint. */
export function shouldUpdateNotifications(missing: readonly string[]): boolean {
  return missing.length === 0;
}

/**
 * Plans leader and lower-rank alerts from a durable full-board snapshot.
 * Older leader-only and top-three state deliberately become quiet baselines.
 */
export function planStandings(
  year: number,
  board: Board,
  previous?: StandingState | LegacyLeaderState | LegacyTopThreeState | LegacyEntryStandingState,
): StandingPlan {
  const previousOrder = previous && isStandingState(previous) ? previous.order : undefined;
  const order = currentOrder(board, previousOrder);
  const baseline: StandingState = { year, order };

  if (!previous || !isStandingState(previous) || previous.year !== year) {
    return {
      baseline: true,
      stateBeforeEvents: baseline,
      needsPreparation: true,
      notifications: [],
      nextState: baseline,
    };
  }

  const currentUsers = new Map(board.map((user) => [user.login, user]));
  // Joining or leaving accounts are adopted silently so their historic totals
  // cannot be mistaken for a newly observed overtake.
  if (
    previous.order.length !== board.length ||
    previous.order.some((login) => !currentUsers.has(login))
  ) {
    const needsPreparation = !sameOrder(previous.order, order);
    return {
      baseline: false,
      stateBeforeEvents: baseline,
      needsPreparation,
      notifications: [],
      nextState: baseline,
    };
  }

  const workOrder = [...previous.order];
  const notifications: StandingNotificationStep[] = [];
  for (let targetIndex = 0; targetIndex < order.length; targetIndex += 1) {
    const moverLogin = order[targetIndex];
    let moverIndex = workOrder.indexOf(moverLogin);
    while (moverIndex > targetIndex) {
      const displacedLogin = workOrder[moverIndex - 1];
      const mover = standingEntry(currentUsers.get(moverLogin)!);
      const displaced = standingEntry(currentUsers.get(displacedLogin)!);
      workOrder[moverIndex - 1] = moverLogin;
      workOrder[moverIndex] = displacedLogin;
      const position = moverIndex;
      const notification: StandingNotification =
        position === 1
          ? { type: "leader", event: { leader: mover } }
          : { type: "overtake", event: { position, mover, displaced } };
      notifications.push({ notification, nextState: { year, order: [...workOrder] } });
      moverIndex -= 1;
    }
  }

  if (notifications.length === 0) {
    const needsPreparation = !sameOrder(previous.order, order);
    return {
      baseline: false,
      stateBeforeEvents: baseline,
      needsPreparation,
      notifications,
      nextState: baseline,
    };
  }

  return {
    baseline: false,
    stateBeforeEvents: standingStateSnapshot(previous),
    needsPreparation: false,
    notifications,
    nextState: baseline,
  };
}

/**
 * Sends a standings plan and checkpoints the ordering after each successful
 * crossing, so retries naturally re-plan only transitions still outstanding.
 */
export async function deliverStandings(
  plan: StandingPlan,
  notify: (notification: StandingNotification) => Promise<void>,
  save: (state: StandingState) => Promise<void>,
): Promise<void> {
  if (plan.baseline) {
    await save(standingStateSnapshot(plan.nextState));
    return;
  }

  const progress = standingStateSnapshot(plan.stateBeforeEvents);
  if (plan.needsPreparation) await save(standingStateSnapshot(progress));

  for (const step of plan.notifications) {
    // This is deliberately at-least-once: a webhook can succeed just before a
    // checkpoint write fails, in which case retrying may repeat that alert.
    // Notify first so an outage cannot silently lose a genuine crossing.
    await notify(step.notification);
    await save(standingStateSnapshot(step.nextState));
  }
}
