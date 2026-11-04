import type { Board } from "../shared/types";

/**
 * What each complete board check saw, so a jump in someone's total can be
 * traced to the check that first saw it, and to the calendar days that moved.
 *
 * Four tables in the Durable Object's SQLite storage:
 *
 * - `board_history_checks`: one row per recorded check.
 * - `board_history_totals`: each person's total at that check.
 * - `board_history_changes`: the `(login, date)` day counts that differ from
 *   the previous recorded check, with both the old and the new count.
 * - `board_history_days`: the diff baseline, the latest non-zero count for
 *   each person's days in the year in progress. It is written in the same
 *   transaction as the check, so a check that fails to record leaves the
 *   baseline at the last recorded one and the next check reports the
 *   combined change rather than losing it.
 *
 * Checks, totals and changes older than `HISTORY_RETENTION_DAYS` are pruned
 * as each check is recorded.
 */

/**
 * About 1,450 rows a day (144 checks, 9 totals each, and a handful of
 * changed days), so roughly 45,000 rows, a few megabytes, at steady state.
 * A month covers the question this answers, which is always about recent
 * days, and leaves a few weeks of normal activity to compare it with.
 */
export const HISTORY_RETENTION_DAYS = 30;
/** One request covers at most a week: about 1,000 checks for the board. */
export const HISTORY_MAX_RANGE_MS = 7 * 86_400_000;
/** The window a request without `from` reads, ending at `to`. */
export const HISTORY_DEFAULT_RANGE_MS = 86_400_000;

const DAY_MS = 86_400_000;

/** Values the store binds and reads; the subset both workerd and node:sqlite share. */
export type SqlValue = string | number | null;

/** The part of `SqlStorage` the store uses, so tests can back it with node:sqlite. */
export interface HistorySql {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): { toArray(): T[] };
}

/** Runs `fn` atomically, rolling back if it throws (`transactionSync` in workerd). */
export type HistoryTransaction = <T>(fn: () => T) => T;

/** login → date → count, non-zero days only. */
export type DayCounts = Map<string, Map<string, number>>;

export interface DayChange {
  login: string;
  date: string;
  previous: number;
  count: number;
}

/**
 * Where a change landed relative to the UTC date of the check that saw it.
 * `same-day` is activity on the check's own date, `backfill` is GitHub
 * catching up on an earlier date, and `ahead` a date after the check's,
 * which the calendar's UTC days should never produce.
 */
export type ChangeKind = "same-day" | "backfill" | "ahead";

export interface ClassifiedChange extends DayChange {
  delta: number;
  kind: ChangeKind;
  /** Days between the change's date and the check's date; negative when ahead. */
  daysBack: number;
}

export interface HistoryCheck {
  checkedAt: string;
  /** The recorded check before this one: anything new appeared between the two. */
  previousCheckedAt: string | null;
  /** The check's UTC date, which `kind` is measured against. */
  checkDate: string;
  /** The first recorded check, which seeds the baseline and lists no changes. */
  baseline: boolean;
  totals: Record<string, number>;
  changes: ClassifiedChange[];
}

export interface HistorySummary {
  login: string;
  /** The last total seen in the range. */
  total: number;
  /** Net change in the range, by where it landed. */
  sameDay: number;
  backfill: number;
  ahead: number;
}

export interface BoardHistory {
  /** The account asked for, or null for the whole board. */
  login: string | null;
  from: string;
  to: string;
  retentionDays: number;
  checks: HistoryCheck[];
  summary: HistorySummary[];
}

export interface HistoryRange {
  from: number;
  to: number;
}

export interface HistoryQuery extends HistoryRange {
  login?: string | null;
}

export interface RecordedCheck {
  checkedAt: number;
  baseline: boolean;
  changes: number;
}

/** Each person's non-zero day counts within `year`. */
export function boardDays(board: Board, year: number): DayCounts {
  const prefix = `${year}-`;
  const days: DayCounts = new Map();
  for (const user of board) {
    const counts = new Map<string, number>();
    for (const week of user.weeks) {
      for (const day of week.days) {
        if (day.count > 0 && day.date.startsWith(prefix)) counts.set(day.date, day.count);
      }
    }
    days.set(user.login, counts);
  }
  return days;
}

/**
 * The days whose count moved between two checks, for people the previous
 * check already knew; anyone else is seeded silently, like the first check.
 * Only `year`'s dates compare, so a new year never reads last year's days
 * as falling to zero.
 */
export function diffDays(
  previous: DayCounts,
  next: DayCounts,
  known: ReadonlySet<string>,
  year: number,
): DayChange[] {
  const prefix = `${year}-`;
  const changes: DayChange[] = [];
  for (const [login, counts] of next) {
    if (!known.has(login)) continue;
    const before = previous.get(login) ?? new Map<string, number>();
    const dates = new Set([...counts.keys(), ...[...before.keys()].filter((date) => date.startsWith(prefix))]);
    for (const date of [...dates].sort()) {
      const was = before.get(date) ?? 0;
      const now = counts.get(date) ?? 0;
      if (was !== now) changes.push({ login, date, previous: was, count: now });
    }
  }
  return changes;
}

export function classifyChange(change: DayChange, checkDate: string): ClassifiedChange {
  const daysBack = Math.round((Date.parse(`${checkDate}T00:00:00Z`) - Date.parse(`${change.date}T00:00:00Z`)) / DAY_MS);
  return {
    ...change,
    delta: change.count - change.previous,
    kind: daysBack === 0 ? "same-day" : daysBack > 0 ? "backfill" : "ahead",
    daysBack,
  };
}

/** Net change per person and kind, with each person's last total in range. */
export function summarize(checks: readonly HistoryCheck[]): HistorySummary[] {
  const byLogin = new Map<string, HistorySummary>();
  for (const check of checks) {
    for (const [login, total] of Object.entries(check.totals)) {
      const entry = byLogin.get(login) ?? { login, total, sameDay: 0, backfill: 0, ahead: 0 };
      entry.total = total;
      byLogin.set(login, entry);
    }
    for (const change of check.changes) {
      const entry = byLogin.get(change.login);
      if (!entry) continue;
      if (change.kind === "same-day") entry.sameDay += change.delta;
      else if (change.kind === "backfill") entry.backfill += change.delta;
      else entry.ahead += change.delta;
    }
  }
  return [...byLogin.values()].sort((a, b) => b.total - a.total || a.login.localeCompare(b.login));
}

function parseInstant(raw: string, end: boolean): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const start = Date.parse(`${raw}T00:00:00Z`);
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== raw) return null;
    // A bare `to` date covers that whole day.
    return end ? start + DAY_MS : start;
  }
  // Offsets are required, so a time never silently means the server's zone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `from` and `to` as UTC dates (`YYYY-MM-DD`, a `to` date being inclusive) or
 * ISO 8601 instants with an offset. Defaults to the 24 hours ending now.
 * Returns an error message for anything unusable.
 */
export function parseHistoryRange(from: string | null, to: string | null, now: number): HistoryRange | string {
  const end = to ? parseInstant(to, true) : now;
  if (end === null) return "to must be a UTC date (YYYY-MM-DD) or an ISO 8601 time with an offset.";
  const start = from ? parseInstant(from, false) : end - HISTORY_DEFAULT_RANGE_MS;
  if (start === null) return "from must be a UTC date (YYYY-MM-DD) or an ISO 8601 time with an offset.";
  if (start >= end) return "from must be before to.";
  if (end - start > HISTORY_MAX_RANGE_MS) return "A history range can cover at most 7 days.";
  return { from: start, to: end };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS board_history_checks (
    id INTEGER PRIMARY KEY,
    checked_at INTEGER NOT NULL,
    previous_checked_at INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS board_history_checks_checked_at ON board_history_checks (checked_at)",
  `CREATE TABLE IF NOT EXISTS board_history_totals (
    login TEXT NOT NULL,
    check_id INTEGER NOT NULL,
    total INTEGER NOT NULL,
    PRIMARY KEY (login, check_id)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS board_history_changes (
    check_id INTEGER NOT NULL,
    login TEXT NOT NULL,
    date TEXT NOT NULL,
    previous INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (check_id, login, date)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS board_history_days (
    login TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (login, date)
  ) WITHOUT ROWID`,
];

const iso = (ms: number) => new Date(ms).toISOString();

export class BoardHistoryStore {
  private readonly sql: HistorySql;
  private readonly transaction: HistoryTransaction;

  constructor(sql: HistorySql, transaction: HistoryTransaction) {
    this.sql = sql;
    this.transaction = transaction;
  }

  /** Idempotent, so the tables appear on first use in any build. */
  private ensureSchema(): void {
    for (const statement of SCHEMA) this.sql.exec(statement);
  }

  /** Records one complete check atomically: all of it, or nothing. */
  record(board: Board, year: number, checkedAt: number): RecordedCheck {
    this.ensureSchema();
    return this.transaction(() => {
      const last = this.sql
        .exec<{ id: number; checked_at: number }>("SELECT id, checked_at FROM board_history_checks ORDER BY id DESC LIMIT 1")
        .toArray()[0];
      const known = new Set(
        last
          ? this.sql
              .exec<{ login: string }>("SELECT login FROM board_history_totals WHERE check_id = ?", last.id)
              .toArray()
              .map((row) => row.login)
          : [],
      );
      const previous: DayCounts = new Map();
      for (const row of this.sql
        .exec<{ login: string; date: string; count: number }>("SELECT login, date, count FROM board_history_days")
        .toArray()) {
        let counts = previous.get(row.login);
        if (!counts) previous.set(row.login, (counts = new Map()));
        counts.set(row.date, row.count);
      }

      const next = boardDays(board, year);
      const changes = diffDays(previous, next, known, year);

      const id = this.sql
        .exec<{ id: number }>(
          "INSERT INTO board_history_checks (checked_at, previous_checked_at) VALUES (?, ?) RETURNING id",
          checkedAt,
          last?.checked_at ?? null,
        )
        .toArray()[0].id;
      for (const user of board) {
        this.sql.exec("INSERT INTO board_history_totals (login, check_id, total) VALUES (?, ?, ?)", user.login, id, user.totalContributions);
      }
      for (const change of changes) {
        this.sql.exec(
          "INSERT INTO board_history_changes (check_id, login, date, previous, count) VALUES (?, ?, ?, ?, ?)",
          id, change.login, change.date, change.previous, change.count,
        );
        if (change.count === 0) {
          this.sql.exec("DELETE FROM board_history_days WHERE login = ? AND date = ?", change.login, change.date);
        } else {
          this.sql.exec(
            "INSERT INTO board_history_days (login, date, count) VALUES (?, ?, ?) ON CONFLICT (login, date) DO UPDATE SET count = excluded.count",
            change.login, change.date, change.count,
          );
        }
      }
      // People the previous check did not know start from their whole year.
      for (const [login, counts] of next) {
        if (known.has(login)) continue;
        this.sql.exec("DELETE FROM board_history_days WHERE login = ?", login);
        for (const [date, count] of counts) {
          this.sql.exec("INSERT INTO board_history_days (login, date, count) VALUES (?, ?, ?)", login, date, count);
        }
      }

      this.sql.exec("DELETE FROM board_history_days WHERE date < ?", `${year}-01-01`);
      const cutoff = checkedAt - HISTORY_RETENTION_DAYS * DAY_MS;
      const expired = "SELECT id FROM board_history_checks WHERE checked_at < ?";
      this.sql.exec(`DELETE FROM board_history_totals WHERE check_id IN (${expired})`, cutoff);
      this.sql.exec(`DELETE FROM board_history_changes WHERE check_id IN (${expired})`, cutoff);
      this.sql.exec("DELETE FROM board_history_checks WHERE checked_at < ?", cutoff);

      return { checkedAt, baseline: !last, changes: changes.length };
    });
  }

  /** Checks in `[from, to)`, oldest first, optionally narrowed to one login. */
  read(query: HistoryQuery): BoardHistory {
    this.ensureSchema();
    const login = query.login ?? null;
    const rows = this.sql
      .exec<{ id: number; checked_at: number; previous_checked_at: number | null }>(
        "SELECT id, checked_at, previous_checked_at FROM board_history_checks WHERE checked_at >= ? AND checked_at < ? ORDER BY id",
        query.from,
        query.to,
      )
      .toArray();

    const checks = new Map<number, HistoryCheck>();
    for (const row of rows) {
      const checkDate = iso(row.checked_at).slice(0, 10);
      checks.set(row.id, {
        checkedAt: iso(row.checked_at),
        previousCheckedAt: row.previous_checked_at === null ? null : iso(row.previous_checked_at),
        checkDate,
        baseline: row.previous_checked_at === null,
        totals: {},
        changes: [],
      });
    }

    if (rows.length > 0) {
      const first = rows[0].id;
      const lastId = rows[rows.length - 1].id;
      const filter = login === null ? "" : " AND login = ?";
      const bindings: SqlValue[] = login === null ? [first, lastId] : [first, lastId, login];
      for (const row of this.sql
        .exec<{ check_id: number; login: string; total: number }>(
          `SELECT check_id, login, total FROM board_history_totals WHERE check_id BETWEEN ? AND ?${filter} ORDER BY check_id, total DESC, login`,
          ...bindings,
        )
        .toArray()) {
        const check = checks.get(row.check_id);
        if (check) check.totals[row.login] = row.total;
      }
      for (const row of this.sql
        .exec<{ check_id: number; login: string; date: string; previous: number; count: number }>(
          `SELECT check_id, login, date, previous, count FROM board_history_changes WHERE check_id BETWEEN ? AND ?${filter} ORDER BY check_id, login, date`,
          ...bindings,
        )
        .toArray()) {
        const check = checks.get(row.check_id);
        if (check) {
          check.changes.push(
            classifyChange({ login: row.login, date: row.date, previous: row.previous, count: row.count }, check.checkDate),
          );
        }
      }
    }

    const list = [...checks.values()];
    return {
      login,
      from: iso(query.from),
      to: iso(query.to),
      retentionDays: HISTORY_RETENTION_DAYS,
      checks: list,
      summary: summarize(list),
    };
  }
}
