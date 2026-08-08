import type { Board, BoardUser } from "../shared/types";

export interface DailyPeak {
  login: string;
  url: string;
  avatarUrl: string;
  date: string;
  count: number;
}

/** Durable state for daily records in one leaderboard year. */
export interface DailyRecordState {
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

export interface DailyRecordPlan {
  /** No alerts are sent when durable state is first introduced. */
  baseline: boolean;
  /** Persist before sending, so newly added accounts do not emit historic PBs. */
  stateBeforeEvents: DailyRecordState;
  needsPreparation: boolean;
  personalBests: PersonalBestEvent[];
  boardRecord: BoardRecordEvent | null;
  /** The state reached after every planned alert succeeds. */
  nextState: DailyRecordState;
}

export type DailyRecordNotification =
  | { type: "personal-best"; event: PersonalBestEvent }
  | { type: "board-record"; event: BoardRecordEvent };

const PERSONAL_MILESTONES = [
  100, 250, 500, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000,
];
const BOARD_MILESTONES = [
  1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000, 100000,
];

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

/**
 * Compares a fresh board with durable record state. A year rollover starts the
 * new year's records from zero; a brand-new Durable Object starts silently.
 */
export function planDailyRecords(
  year: number,
  board: Board,
  previous?: DailyRecordState,
): DailyRecordPlan {
  const peaks = dailyPeaks(board, year);
  const currentCounts = peakCounts(board, peaks);
  const boardPeak = highestPeak(peaks);

  if (!previous) {
    const baseline: DailyRecordState = {
      year,
      personalBests: currentCounts,
      boardBest: boardPeak?.count ?? 0,
    };
    return {
      baseline: true,
      stateBeforeEvents: baseline,
      needsPreparation: true,
      personalBests: [],
      boardRecord: null,
      nextState: baseline,
    };
  }

  const rolledOver = previous.year !== year;
  const stateBeforeEvents: DailyRecordState = rolledOver
    ? {
        year,
        personalBests: Object.fromEntries(board.map((user) => [user.login, 0])),
        boardBest: 0,
      }
    : {
        year,
        personalBests: { ...previous.personalBests },
        boardBest: previous.boardBest,
      };

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

  const personalBests = peaks.flatMap<PersonalBestEvent>((peak) => {
    const previousCount = stateBeforeEvents.personalBests[peak.login];
    return peak.count > previousCount ? [{ ...peak, previousCount }] : [];
  });
  const boardRecord =
    boardPeak && boardPeak.count > stateBeforeEvents.boardBest
      ? { peak: boardPeak, previousCount: stateBeforeEvents.boardBest }
      : null;

  const nextState: DailyRecordState = {
    year,
    personalBests: { ...stateBeforeEvents.personalBests },
    boardBest: boardRecord?.peak.count ?? stateBeforeEvents.boardBest,
  };
  for (const event of personalBests) nextState.personalBests[event.login] = event.count;

  return {
    baseline: false,
    stateBeforeEvents,
    needsPreparation,
    personalBests,
    boardRecord,
    nextState,
  };
}

function stateSnapshot(state: DailyRecordState): DailyRecordState {
  return {
    ...state,
    personalBests: { ...state.personalBests },
  };
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

  for (const event of plan.personalBests) {
    await notify({ type: "personal-best", event });
    progress.personalBests[event.login] = event.count;
    await save(stateSnapshot(progress));
  }

  if (plan.boardRecord) {
    await notify({ type: "board-record", event: plan.boardRecord });
    progress.boardBest = plan.boardRecord.peak.count;
    await save(stateSnapshot(progress));
  }
}

function milestoneFor(total: number, thresholds: number[]): number {
  let milestone = 0;
  for (const threshold of thresholds) {
    if (total < threshold) break;
    milestone = threshold;
  }
  return milestone;
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

export interface PodiumEntry {
  login: string;
  url: string;
  avatarUrl: string;
  totalContributions: number;
}

export interface LeaderEvent {
  leader: PodiumEntry;
}

export interface PodiumOvertakeEvent {
  position: 2 | 3;
  mover: PodiumEntry;
  displaced: PodiumEntry;
}

export type PodiumNotification =
  | { type: "leader"; event: LeaderEvent }
  | { type: "podium-overtake"; event: PodiumOvertakeEvent };

interface PendingPodiumNotifications {
  top: PodiumEntry[];
  notifications: PodiumNotification[];
}

/** Durable top-three state for one leaderboard year. */
export interface PodiumState {
  year: number;
  top: PodiumEntry[];
  pending?: PendingPodiumNotifications;
}

/** The shape written by the former leader-only implementation. */
export interface LegacyLeaderState {
  year: number;
  login: string;
}

export interface PodiumPlan {
  /** No alerts are sent when state is first introduced or the year changes. */
  baseline: boolean;
  /** State to save before sending a batch of position-change alerts. */
  stateBeforeEvents: PodiumState;
  needsPreparation: boolean;
  notifications: PodiumNotification[];
  /** The state reached after every planned alert succeeds. */
  nextState: PodiumState;
}

function podiumEntry(user: BoardUser): PodiumEntry {
  return {
    login: user.login,
    url: user.url,
    avatarUrl: user.avatarUrl,
    totalContributions: user.totalContributions,
  };
}

function podiumStateSnapshot(state: PodiumState): PodiumState {
  return {
    ...state,
    top: state.top.map((entry) => ({ ...entry })),
    ...(state.pending
      ? {
          pending: {
            top: state.pending.top.map((entry) => ({ ...entry })),
            notifications: structuredClone(state.pending.notifications),
          },
        }
      : {}),
  };
}

function isPodiumState(state: PodiumState | LegacyLeaderState): state is PodiumState {
  return Object.hasOwn(state, "top");
}

function samePodium(left: PodiumEntry[], right: PodiumEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry.login === other.login && entry.totalContributions === other.totalContributions;
  });
}

function notificationKey(notification: PodiumNotification): string {
  return notification.type === "leader"
    ? `leader:${notification.event.leader.login}`
    : `podium:${notification.event.position}:${notification.event.mover.login}:${notification.event.displaced.login}`;
}

/**
 * Plans leader and lower-podium alerts from a durable top-three snapshot.
 * Legacy leader-only state deliberately becomes a quiet baseline on upgrade.
 */
export function planPodium(
  year: number,
  board: Board,
  previous?: PodiumState | LegacyLeaderState,
): PodiumPlan {
  const top = board.slice(0, 3).map(podiumEntry);
  const baseline: PodiumState = { year, top };

  if (!previous || !isPodiumState(previous) || previous.year !== year) {
    return {
      baseline: true,
      stateBeforeEvents: baseline,
      needsPreparation: true,
      notifications: [],
      nextState: baseline,
    };
  }

  if (previous.pending) {
    return {
      baseline: false,
      stateBeforeEvents: podiumStateSnapshot(previous),
      needsPreparation: false,
      notifications: previous.pending.notifications,
      nextState: { year, top: previous.pending.top.map((entry) => ({ ...entry })) },
    };
  }

  const currentUsers = new Map(board.map((user) => [user.login, user]));
  // Without a complete, continuous podium snapshot, an apparent position gain
  // could merely be the result of an account disappearing from the board.
  if (
    top.length < 3 ||
    previous.top.length < 3 ||
    previous.top.some((entry) => !currentUsers.has(entry.login))
  ) {
    const needsPreparation = !samePodium(previous.top, top);
    return {
      baseline: false,
      stateBeforeEvents: baseline,
      needsPreparation,
      notifications: [],
      nextState: baseline,
    };
  }

  const notifications: PodiumNotification[] = [];
  const leader = top[0];
  const previousLeader = previous.top[0];
  const displacedLeader = previousLeader && currentUsers.get(previousLeader.login);
  if (
    leader &&
    leader.totalContributions > 0 &&
    previousLeader &&
    displacedLeader &&
    leader.login !== previousLeader.login &&
    leader.totalContributions > displacedLeader.totalContributions
  ) {
    notifications.push({ type: "leader", event: { leader } });
  }

  for (const position of [2, 3] as const) {
    const mover = top[position - 1];
    const previousPosition = previous.top.findIndex((entry) => entry.login === mover?.login) + 1;
    const displacedUser = board.slice(position).find((user) => {
      const displacedPosition = previous.top.findIndex((entry) => entry.login === user.login) + 1;
      return (
        displacedPosition > 0 &&
        (previousPosition === 0 || displacedPosition < previousPosition)
      );
    });
    const displaced = displacedUser && podiumEntry(displacedUser);
    if (
      mover &&
      displaced &&
      (previousPosition === 0 || previousPosition > position) &&
      mover.totalContributions > displaced.totalContributions
    ) {
      notifications.push({ type: "podium-overtake", event: { position, mover, displaced } });
    }
  }

  if (notifications.length === 0) {
    const needsPreparation = !samePodium(previous.top, top);
    return {
      baseline: false,
      stateBeforeEvents: baseline,
      needsPreparation,
      notifications,
      nextState: baseline,
    };
  }

  const stateBeforeEvents: PodiumState = {
    year,
    top: previous.top.map((entry) => ({ ...entry })),
    pending: { top, notifications: structuredClone(notifications) },
  };
  return {
    baseline: false,
    stateBeforeEvents,
    needsPreparation: true,
    notifications,
    nextState: baseline,
  };
}

/**
 * Sends a podium plan and records each successful alert. Pending transitions
 * survive webhook failures so retries do not repeat already delivered posts.
 */
export async function deliverPodium(
  plan: PodiumPlan,
  notify: (notification: PodiumNotification) => Promise<void>,
  save: (state: PodiumState) => Promise<void>,
): Promise<void> {
  if (plan.baseline) {
    await save(podiumStateSnapshot(plan.nextState));
    return;
  }

  const progress = podiumStateSnapshot(plan.stateBeforeEvents);
  if (plan.needsPreparation) await save(podiumStateSnapshot(progress));

  for (const notification of plan.notifications) {
    await notify(notification);
    const pending = progress.pending;
    if (!pending) throw new Error("Podium notification checkpoint is missing.");
    const key = notificationKey(notification);
    pending.notifications = pending.notifications.filter(
      (candidate) => notificationKey(candidate) !== key,
    );
    if (pending.notifications.length === 0) {
      progress.top = pending.top;
      delete progress.pending;
    }
    await save(podiumStateSnapshot(progress));
  }
}
