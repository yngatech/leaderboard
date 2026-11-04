import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  BoardHistoryStore,
  HISTORY_RETENTION_DAYS,
  boardDays,
  classifyChange,
  diffDays,
  parseHistoryRange,
  type HistorySql,
  type SqlValue,
} from "../worker/board-history.ts";
import type { Board, BoardUser } from "../shared/types.ts";

function user(login: string, days: Record<string, number>): BoardUser {
  const entries = Object.entries(days);
  return {
    login,
    name: null,
    avatarUrl: "https://avatars.example/a.png",
    url: `https://github.com/${login}`,
    followers: 0,
    following: 0,
    totalContributions: entries.reduce((sum, [, count]) => sum + count, 0),
    weeks: [{ days: entries.map(([date, count]) => ({ date, count, level: count > 0 ? 1 : 0 })) }],
  };
}

/** The store over node:sqlite, with a switch that fails one statement. */
function sqliteStore() {
  const db = new DatabaseSync(":memory:");
  let failOn: string | null = null;
  const sql: HistorySql = {
    exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) {
      if (failOn && query.includes(failOn)) throw new Error("synthetic storage failure");
      const rows = db.prepare(query).all(...bindings) as T[];
      return { toArray: () => rows };
    },
  };
  const store = new BoardHistoryStore(sql, (fn) => {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { store, count, fail: (statement: string | null) => { failOn = statement; } };
}

const at = (time: string) => Date.parse(time);
const wholeDay = { from: at("2026-11-04T00:00:00Z"), to: at("2026-11-05T00:00:00Z") };

test("boardDays keeps each person's non-zero days in the board's year", () => {
  const days = boardDays([user("ada", { "2025-12-31": 4, "2026-01-01": 0, "2026-01-02": 3 })], 2026);
  assert.deepEqual([...days.get("ada")!], [["2026-01-02", 3]]);
});

test("diffDays reports moved days for known people only, and ignores last year's dates", () => {
  const previous = new Map([
    ["ada", new Map([["2025-12-31", 9], ["2026-03-01", 2], ["2026-11-03", 5]])],
    ["bea", new Map([["2026-11-04", 1]])],
  ]);
  const next = new Map([
    ["ada", new Map([["2026-11-03", 7], ["2026-11-04", 4]])],
    ["bea", new Map([["2026-11-04", 6]])],
    ["cy", new Map([["2026-11-04", 3]])],
  ]);
  assert.deepEqual(diffDays(previous, next, new Set(["ada", "bea"]), 2026), [
    { login: "ada", date: "2026-03-01", previous: 2, count: 0 },
    { login: "ada", date: "2026-11-03", previous: 5, count: 7 },
    { login: "ada", date: "2026-11-04", previous: 0, count: 4 },
    { login: "bea", date: "2026-11-04", previous: 1, count: 6 },
  ]);
});

test("classifyChange measures a change's date against the check's UTC date", () => {
  const change = (date: string) => ({ login: "ada", date, previous: 2, count: 5 });
  assert.deepEqual(classifyChange(change("2026-11-04"), "2026-11-04"), {
    ...change("2026-11-04"), delta: 3, kind: "same-day", daysBack: 0,
  });
  assert.equal(classifyChange(change("2026-10-28"), "2026-11-04").kind, "backfill");
  assert.equal(classifyChange(change("2026-10-28"), "2026-11-04").daysBack, 7);
  // Across a month and a year boundary, still whole days.
  assert.equal(classifyChange(change("2025-12-31"), "2026-01-01").daysBack, 1);
  assert.equal(classifyChange(change("2026-11-05"), "2026-11-04").kind, "ahead");
  assert.equal(classifyChange({ login: "ada", date: "2026-11-01", previous: 6, count: 0 }, "2026-11-04").delta, -6);
});

test("parseHistoryRange defaults to the last day and validates what it is given", () => {
  const now = at("2026-11-04T12:00:00Z");
  assert.deepEqual(parseHistoryRange(null, null, now), { from: now - 86_400_000, to: now });
  // A bare `to` date includes the whole day.
  assert.deepEqual(parseHistoryRange("2026-11-04", "2026-11-04", now), wholeDay);
  assert.deepEqual(parseHistoryRange("2026-11-04T10:45:00+01:00", "2026-11-04T12:15:00Z", now), {
    from: at("2026-11-04T09:45:00Z"), to: at("2026-11-04T12:15:00Z"),
  });
  for (const [from, to] of [
    ["2026-02-30", null],
    ["2026-11-04T10:45:00", null],
    ["yesterday", null],
    [null, "2026-11-04T12:00"],
    ["2026-11-04", "2026-11-03"],
    ["2026-11-04T12:00:00Z", "2026-11-04T12:00:00Z"],
    ["2026-10-01", "2026-11-04"],
  ] as const) {
    assert.equal(typeof parseHistoryRange(from, to, now), "string", `${from} to ${to}`);
  }
  assert.equal(typeof parseHistoryRange("2026-10-29", "2026-11-04", now), "object");
});

test("the store seeds a baseline, then records totals each check and only the days that moved", () => {
  const { store } = sqliteStore();
  const morning: Board = [
    user("ada", { "2026-10-28": 4, "2026-11-04": 2 }),
    user("bea", { "2026-11-03": 3 }),
  ];
  assert.deepEqual(store.record(morning, 2026, at("2026-11-04T10:45:00Z")), {
    checkedAt: at("2026-11-04T10:45:00Z"), baseline: true, changes: 0,
  });
  // Unchanged: a check that saw nothing still says so.
  store.record(morning, 2026, at("2026-11-04T10:55:00Z"));
  // Same-day work plus GitHub catching up on a week-old day.
  const noon: Board = [
    user("ada", { "2026-10-28": 60, "2026-11-04": 20 }),
    user("bea", { "2026-11-03": 3 }),
  ];
  assert.equal(store.record(noon, 2026, at("2026-11-04T12:10:00Z")).changes, 2);

  const history = store.read(wholeDay);
  assert.equal(history.login, null);
  assert.equal(history.retentionDays, HISTORY_RETENTION_DAYS);
  assert.deepEqual(history.checks.map((check) => [check.checkedAt, check.previousCheckedAt, check.baseline, check.totals]), [
    ["2026-11-04T10:45:00.000Z", null, true, { ada: 6, bea: 3 }],
    ["2026-11-04T10:55:00.000Z", "2026-11-04T10:45:00.000Z", false, { ada: 6, bea: 3 }],
    ["2026-11-04T12:10:00.000Z", "2026-11-04T10:55:00.000Z", false, { ada: 80, bea: 3 }],
  ]);
  assert.deepEqual(history.checks[0].changes, []);
  assert.deepEqual(history.checks[1].changes, []);
  assert.deepEqual(history.checks[2].changes, [
    { login: "ada", date: "2026-10-28", previous: 4, count: 60, delta: 56, kind: "backfill", daysBack: 7 },
    { login: "ada", date: "2026-11-04", previous: 2, count: 20, delta: 18, kind: "same-day", daysBack: 0 },
  ]);
  assert.deepEqual(history.summary, [
    { login: "ada", total: 80, sameDay: 18, backfill: 56, ahead: 0 },
    { login: "bea", total: 3, sameDay: 0, backfill: 0, ahead: 0 },
  ]);

  const ada = store.read({ ...wholeDay, login: "ada" });
  assert.equal(ada.login, "ada");
  assert.deepEqual(ada.checks.map((check) => check.totals), [{ ada: 6 }, { ada: 6 }, { ada: 80 }]);
  assert.equal(ada.checks[2].changes.length, 2);
  assert.deepEqual(store.read({ ...wholeDay, login: "bea" }).checks.flatMap((check) => check.changes), []);
  // The range is half-open and filters by check time.
  assert.equal(store.read({ from: at("2026-11-04T10:55:00Z"), to: at("2026-11-04T12:10:00Z") }).checks.length, 1);
});

test("a failed write records nothing, and the next check reports the combined change", () => {
  const { store, count, fail } = sqliteStore();
  store.record([user("ada", { "2026-11-04": 1 })], 2026, at("2026-11-04T10:00:00Z"));
  fail("INSERT INTO board_history_changes");
  assert.throws(() => store.record([user("ada", { "2026-11-04": 5 })], 2026, at("2026-11-04T10:10:00Z")));
  assert.equal(count("board_history_checks"), 1);
  assert.equal(count("board_history_totals"), 1);
  fail(null);
  store.record([user("ada", { "2026-11-04": 9 })], 2026, at("2026-11-04T10:20:00Z"));
  const [, check] = store.read(wholeDay).checks;
  assert.equal(check.previousCheckedAt, "2026-11-04T10:00:00.000Z");
  assert.deepEqual(check.changes.map((change) => [change.previous, change.count]), [[1, 9]]);
});

test("someone new to the roster is seeded without a burst of changes", () => {
  const { store } = sqliteStore();
  store.record([user("ada", { "2026-11-04": 1 })], 2026, at("2026-11-04T10:00:00Z"));
  store.record([user("ada", { "2026-11-04": 1 }), user("cy", { "2026-02-01": 8, "2026-11-04": 2 })], 2026, at("2026-11-04T10:10:00Z"));
  store.record([user("ada", { "2026-11-04": 1 }), user("cy", { "2026-02-01": 8, "2026-11-04": 3 })], 2026, at("2026-11-04T10:20:00Z"));
  const checks = store.read(wholeDay).checks;
  assert.deepEqual(checks[1].changes, []);
  assert.deepEqual(checks[1].totals, { cy: 10, ada: 1 });
  assert.deepEqual(checks[2].changes.map((change) => [change.login, change.date, change.delta]), [["cy", "2026-11-04", 1]]);
});

test("the new year compares only its own days, and a decrease to zero is recorded", () => {
  const { store, count } = sqliteStore();
  store.record([user("ada", { "2026-12-30": 3, "2026-12-31": 4 })], 2026, at("2026-12-31T23:50:00Z"));
  store.record([user("ada", { "2027-01-01": 2 })], 2027, at("2027-01-01T00:00:00Z"));
  // Last year's baseline is gone once the new year's first check lands.
  assert.equal(count("board_history_days"), 1);
  store.record([user("ada", {})], 2027, at("2027-01-01T00:10:00Z"));
  const checks = store.read({ from: at("2027-01-01T00:00:00Z"), to: at("2027-01-02T00:00:00Z") }).checks;
  assert.deepEqual(checks.map((check) => check.changes.map((change) => [change.date, change.previous, change.count, change.kind])), [
    [["2027-01-01", 0, 2, "same-day"]],
    [["2027-01-01", 2, 0, "same-day"]],
  ]);
  assert.equal(count("board_history_days"), 0);
});

test("checks older than the retention window are pruned as new ones land", () => {
  const { store, count } = sqliteStore();
  const start = at("2026-10-01T00:00:00Z");
  store.record([user("ada", { "2026-10-01": 1 })], 2026, start);
  store.record([user("ada", { "2026-10-01": 2 })], 2026, start + 600_000);
  assert.equal(count("board_history_changes"), 1);
  store.record([user("ada", { "2026-10-01": 2 })], 2026, start + 600_000 + HISTORY_RETENTION_DAYS * 86_400_000 + 1);
  assert.equal(count("board_history_checks"), 1);
  assert.equal(count("board_history_totals"), 1);
  assert.equal(count("board_history_changes"), 0);
  // The diff baseline is kept: it is the latest state, not history.
  assert.equal(count("board_history_days"), 1);
});
