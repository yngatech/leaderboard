import assert from "node:assert/strict";
import test from "node:test";
import type { AllTimeUser, Board } from "../shared/types.ts";
import {
  boardGoal,
  cumulativeSeries,
  featuredYear,
  userGoals,
  userGrid,
  userProfile,
  yearShape,
} from "../shared/board.ts";
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

test("builds a user API profile from the page's all-time and current feeds", () => {
  const board = boardWithDays([{ date: "2026-01-01", count: 2, level: 1 }]);
  const user: AllTimeUser = {
    login: "alice",
    name: "Alice Example",
    avatarUrl: "https://avatars.example/alice",
    url: "https://github.com/alice",
    followers: 12,
    following: 3,
    byYear: { "2025": 10, "2026": 2 },
    total: 12,
  };

  assert.deepEqual(userProfile(user, board, 2026), {
    ...user,
    currentYear: 2026,
    current: {
      totalContributions: 2,
      weeks: board[0].weeks,
    },
  });
  assert.equal(userProfile(user, [], 2026).current, null);
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

test("reads a year's shape from the days that have already happened", () => {
  const grid = userGrid(
    [
      {
        days: [
          { date: "2026-01-01", count: 3, level: 1 },
          { date: "2026-01-02", count: 0, level: 0 },
          { date: "2026-01-03", count: 9, level: 4 },
          { date: "2026-01-04", count: 1, level: 1 },
          { date: "2026-01-05", count: 2, level: 1 },
        ],
      },
    ],
    2026,
    "2026-01-05",
  );

  assert.deepEqual(yearShape(grid, "2026-01-05"), {
    activeDays: 4,
    bestDay: { date: "2026-01-03", count: 9 },
    currentStreak: 3,
  });
});

test("counts a silent today as a day in progress, not a broken streak", () => {
  const days = [
    { date: "2026-01-01", count: 5, level: 2 as const },
    { date: "2026-01-02", count: 5, level: 2 as const },
    { date: "2026-01-03", count: 0, level: 0 as const },
  ];

  // Nobody has committed yet today, which is not the same as stopping.
  assert.equal(yearShape(userGrid([{ days }], 2026, "2026-01-03"), "2026-01-03").currentStreak, 2);
  // A day later the silence is settled and the streak really has ended.
  assert.equal(yearShape(userGrid([{ days }], 2026, "2026-01-04"), "2026-01-04").currentStreak, 0);
});

test("runs a streak across a week boundary and the December straddle", () => {
  // 2026 opens on a Thursday, so the first column carries three days of 2025.
  const grid = userGrid(
    [
      {
        days: [
          { date: "2025-12-31", count: 9, level: 4 },
          { date: "2026-01-01", count: 2, level: 1 },
          { date: "2026-01-02", count: 2, level: 1 },
          { date: "2026-01-03", count: 2, level: 1 },
          { date: "2026-01-04", count: 2, level: 1 },
          { date: "2026-01-05", count: 2, level: 1 },
        ],
      },
    ],
    2026,
    "2026-01-05",
  );

  const shape = yearShape(grid, "2026-01-05");
  // The five days of 2026 only, in order, across two week columns.
  assert.equal(shape.currentStreak, 5);
  assert.equal(shape.activeDays, 5);
  assert.deepEqual(shape.bestDay, { date: "2026-01-01", count: 2 });
});

test("reports a year with no contributions", () => {
  assert.deepEqual(yearShape(userGrid([], 2026, "2026-01-10"), "2026-01-10"), {
    activeDays: 0,
    bestDay: null,
    currentStreak: 0,
  });
});

test("holds the finished year until the second Monday of January", () => {
  // 1 January 2027 is a Friday, so the Mondays are the 4th and the 11th.
  assert.equal(featuredYear("2026-12-31"), 2026);
  assert.equal(featuredYear("2027-01-01"), 2026);
  assert.equal(featuredYear("2027-01-10"), 2026);
  assert.equal(featuredYear("2027-01-11"), 2027);
  assert.equal(featuredYear("2027-02-01"), 2027);

  // 2024 opens on a Monday, where a first-Monday rule would grant no grace.
  assert.equal(featuredYear("2024-01-07"), 2023);
  assert.equal(featuredYear("2024-01-08"), 2024);

  // 2023 opens on a Sunday: the Mondays are the 2nd and the 9th.
  assert.equal(featuredYear("2023-01-08"), 2022);
  assert.equal(featuredYear("2023-01-09"), 2023);

  // 2025 opens on a Wednesday, the longest grace the rule can give.
  assert.equal(featuredYear("2025-01-12"), 2024);
  assert.equal(featuredYear("2025-01-13"), 2025);
});
