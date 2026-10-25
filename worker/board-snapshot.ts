import type { Board } from "../shared/types";

/**
 * The board the alarm check last fetched in full: a partial fetch never
 * replaces it. Pages read the year in progress from here, so the site shows
 * the same numbers Discord was told.
 */
export interface BoardSnapshot {
  year: number;
  board: Board;
  generatedAt: string;
}

/** One storage key, overwritten each check, so finished years never pile up. */
export const BOARD_SNAPSHOT_KEY = "board-snapshot";

/**
 * Three missed checks. Past this the snapshot is no longer the live board, and
 * pages go back to asking GitHub rather than freeze on a stopped alarm.
 */
export const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;

/** The snapshot when it is this year's and recent enough to stand for the live board. */
export function usableSnapshot(
  snapshot: BoardSnapshot | undefined,
  year: number,
  now: number,
): BoardSnapshot | null {
  if (!snapshot || snapshot.year !== year) return null;
  const age = now - Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(age) || age > SNAPSHOT_MAX_AGE_MS) return null;
  return snapshot;
}

/**
 * Whether `next` may overwrite `current`. A check that overran its slot must
 * not land on top of the one that started after it. Strictly newer, so the
 * stored timestamp names one board: the notification queue relies on that to
 * tell whether the board it was handed is still the latest.
 */
export function supersedes(next: BoardSnapshot, current: BoardSnapshot | undefined): boolean {
  if (!current) return true;
  return Date.parse(next.generatedAt) > Date.parse(current.generatedAt);
}
