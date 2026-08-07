import assert from "node:assert/strict";
import test from "node:test";
import type { Board } from "../shared/types.ts";
import { cumulativeSeries, userGrid } from "../src/lib/board.ts";
import { firstDayForLocale, weekdayIndex } from "../src/lib/format.ts";

function boardWithDays(days: Board[0]["weeks"][0]["days"]): Board {
  return [
    {
      login: "alice",
      name: "Alice",
      avatarUrl: "https://avatars.example/alice",
      url: "https://github.com/alice",
      followers: 0,
      following: 0,
      totalContributions: days.reduce((sum, day) => sum + day.count, 0),
      weeks: [{ days }],
    },
  ];
}

test("builds a daily cumulative series through today", () => {
  const board = boardWithDays([
    { date: "2026-01-01", count: 2, level: 1 },
    { date: "2026-01-03", count: 4, level: 3 },
    { date: "2026-01-05", count: 99, level: 4 },
    { date: "2025-12-31", count: 50, level: 4 },
  ]);

  assert.deepEqual(cumulativeSeries(board, 2026, "2026-01-03"), [
    {
      login: "alice",
      name: "Alice",
      total: 6,
      points: [
        { date: "2026-01-01", total: 2 },
        { date: "2026-01-02", total: 2 },
        { date: "2026-01-03", total: 6 },
      ],
    },
  ]);
});

test("uses the full calendar for a finished leap year", () => {
  const [series] = cumulativeSeries(
    boardWithDays([{ date: "2024-12-31", count: 7, level: 2 }]),
    2024,
    "2026-08-05",
  );

  assert.equal(series.points.length, 366);
  assert.deepEqual(series.points[0], { date: "2024-01-01", total: 0 });
  assert.deepEqual(series.points.at(-1), { date: "2024-12-31", total: 7 });
  assert.equal(series.total, 7);
});

test("returns no points when the requested year has not started", () => {
  assert.deepEqual(cumulativeSeries(boardWithDays([]), 2027, "2026-08-05"), []);
});

test("can lay out locale weeks from Monday through Sunday", () => {
  const grid = userGrid([], 2026, "2026-08-05", 1);

  assert.deepEqual(
    grid[0].map((day) => day.date),
    [
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ],
  );
  assert.deepEqual(
    grid.at(-1)?.map((day) => day.date),
    [
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ],
  );
  assert.equal(weekdayIndex("2026-01-05", 1), 0);
  assert.equal(weekdayIndex("2026-01-11", 1), 6);
});

test("defaults calendar weeks to the original Sunday through Saturday layout", () => {
  const grid = userGrid([], 2026, "2026-08-05");

  assert.deepEqual(
    grid[0].map((day) => day.date),
    [
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ],
  );
  assert.equal(weekdayIndex("2026-01-11"), 0);
  assert.equal(weekdayIndex("2026-01-17"), 6);
});

test("falls back to Sunday when locale week information is unavailable", () => {
  assert.equal(firstDayForLocale("not_a_valid_locale"), 7);
});
