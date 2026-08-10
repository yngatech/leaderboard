import assert from "node:assert/strict";
import test from "node:test";
import type { Board } from "../shared/types.ts";
import { boardGoal, cumulativeSeries, userGoals, userGrid } from "../shared/board.ts";
import { weekdayIndex } from "../shared/format.ts";

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

test("defaults calendar weeks to the Monday through Sunday layout", () => {
  const grid = userGrid([], 2026, "2026-08-05");

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
  assert.equal(weekdayIndex("2026-01-05"), 0);
  assert.equal(weekdayIndex("2026-01-11"), 6);
});

function rankedBoard(totals: [string, number][]): Board {
  return totals.map(([login, totalContributions]) => ({
    login,
    name: null,
    avatarUrl: `https://avatars.example/${login}`,
    url: `https://github.com/${login}`,
    followers: 0,
    following: 0,
    totalContributions,
    weeks: [],
  }));
}

test("reports the next milestone and the gap to the rank above", () => {
  const board = rankedBoard([
    ["alice", 4820],
    ["bob", 4790],
    ["carol", 900],
  ]);

  assert.deepEqual(userGoals(board, 1), {
    nextMilestone: 5000,
    toMilestone: 210,
    above: { login: "alice", name: null, rank: 1, behind: 30 },
    leadMargin: null,
  });
  assert.deepEqual(userGoals(board, 2), {
    nextMilestone: 1000,
    toMilestone: 100,
    above: { login: "bob", name: null, rank: 2, behind: 3890 },
    leadMargin: null,
  });
});

test("gives the leader a margin instead of a gap", () => {
  const board = rankedBoard([
    ["alice", 4820],
    ["bob", 4790],
  ]);

  assert.deepEqual(userGoals(board, 0), {
    nextMilestone: 5000,
    toMilestone: 180,
    above: null,
    leadMargin: 30,
  });
});

test("marks level totals and a solo board", () => {
  const tied = rankedBoard([
    ["alice", 100],
    ["bob", 100],
  ]);
  assert.equal(userGoals(tied, 1).above?.behind, 0);

  const solo = rankedBoard([["alice", 100]]);
  assert.deepEqual(userGoals(solo, 0), {
    nextMilestone: 250,
    toMilestone: 150,
    above: null,
    leadMargin: null,
  });
});

test("drops the milestone goal past the top of the ladder", () => {
  const board = rankedBoard([["alice", 60000]]);
  const goals = userGoals(board, 0);
  assert.equal(goals.nextMilestone, null);
  assert.equal(goals.toMilestone, null);
});

test("tracks the board-wide goal from the summed totals", () => {
  assert.deepEqual(
    boardGoal(
      rankedBoard([
        ["alice", 4000],
        ["bob", 3830],
      ]),
    ),
    { total: 7830, nextMilestone: 10000, remaining: 2170 },
  );
  assert.deepEqual(boardGoal(rankedBoard([["alice", 200000]])), {
    total: 200000,
    nextMilestone: null,
    remaining: null,
  });
});
