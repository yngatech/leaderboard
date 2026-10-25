import assert from "node:assert/strict";
import test from "node:test";
import { achievementFeed, achievementsForYear } from "../shared/achievements.ts";
import type { Board, BoardUser } from "../shared/types.ts";

function user(login: string, days: Record<string, number>, createdAt?: string): BoardUser {
  return {
    login, createdAt, name: null, url: `https://github.com/${login}`,
    avatarUrl: "https://avatars.example/contributor", followers: 0, following: 0,
    totalContributions: Object.values(days).reduce((sum, count) => sum + count, 0),
    weeks: [{ days: Object.entries(days).map(([date, count]) => ({ date, count, level: 0 })) }],
  };
}

test("calendar order dates every crossed rung and offsets lifetime totals by finished years only", () => {
  const events = achievementsForYear({
    board: [user("example-one", { "2026-01-03": 920, "2026-01-01": 90 })],
    year: 2026, today: "2026-01-04",
    history: [{ login: "example-one", byYear: { 2024: 10_000, 2025: 9_350, 2026: 99_999 } }],
  });
  const yearly = events.filter((event) => event.kind === "yearly-milestone");
  assert.deepEqual(yearly.map((event) => event.threshold).sort((a, b) => a - b), [100, 250, 500, 750, 1000]);
  assert(yearly.every((event) => event.date === "2026-01-03"));
  assert.deepEqual(events.filter((event) => event.kind === "lifetime-milestone").map((event) => ({
    date: event.date, threshold: event.threshold,
  })), [{ date: "2026-01-03", threshold: 20_000 }]);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
});

test("records require a strict improvement and tied board holders share one event", () => {
  const board = [
    user("example-one", { "2026-01-01": 20, "2026-01-02": 10, "2026-01-03": 20, "2026-01-04": 30 }),
    user("example-two", { "2026-01-01": 25, "2026-01-04": 30 }),
  ];
  const events = achievementsForYear({ board, year: 2026, today: "2026-01-05" });
  const personal = events.filter((event) => event.kind === "personal-best");
  assert.deepEqual(personal.map((event) => [event.login, event.date, event.previousCount, event.count]), [
    ["example-one", "2026-01-04", 20, 30], ["example-two", "2026-01-04", 25, 30],
  ]);
  const record = events.find((event) => event.kind === "board-record");
  assert(record?.kind === "board-record");
  assert.deepEqual(record.logins, ["example-one", "example-two"]);
  assert.equal(record.previousCount, 25);
  assert.equal(record.count, 30);
  assert.equal(achievementFeed(events).filter((event) => event.kind === "personal-best").length, 0);
  assert.equal(achievementFeed(events, "example-one").filter((event) => event.kind === "board-record").length, 1);
});

test("board milestones sum all accounts while board records use one person's day", () => {
  const events = achievementsForYear({
    board: [
      user("example-one", { "2026-01-01": 400, "2026-01-02": 100 }),
      user("example-two", { "2026-01-01": 300, "2026-01-02": 200 }),
    ], year: 2026, today: "2026-01-03",
  });
  assert.equal(events.find((event) => event.kind === "board-milestone")?.date, "2026-01-02");
  assert.equal(events.filter((event) => event.kind === "board-record").length, 0);
  assert.equal(achievementFeed(events, "example-one").filter((event) => event.kind === "board-milestone").length, 0);
});

test("adjacent years and future days do not create achievements; yearly records reset", () => {
  const events = achievementsForYear({
    board: [user("example-one", {
      "2025-12-31": 5000, "2026-01-01": 10, "2026-01-02": 20,
      "2026-01-04": 5000, "2027-01-01": 5000,
    })], year: 2026, today: "2026-01-03",
  });
  assert.equal(events.filter((event) => event.kind === "yearly-milestone").length, 0);
  assert.deepEqual(events.filter((event) => event.kind === "personal-best").map((event) => event.count), [20]);
  assert(events.every((event) => event.year === 2026 && event.date <= "2026-01-03"));
});

test("incomplete sources suppress unsupported lifetime and board claims without hiding personal progress", () => {
  const board = [user("example-one", { "2026-01-01": 20, "2026-01-02": 1000 })];
  const events = achievementsForYear({ board, year: 2026, today: "2026-01-03", complete: false });
  assert(events.some((event) => event.kind === "yearly-milestone"));
  assert(events.some((event) => event.kind === "personal-best"));
  assert(!events.some((event) => ["lifetime-milestone", "board-record", "board-milestone"].includes(event.kind)));
  const unknown = achievementsForYear({
    board, year: 2026, today: "2026-01-03", history: [{ login: "example-two", byYear: {} }],
  });
  assert(!unknown.some((event) => event.kind === "lifetime-milestone"));
});

test("today's counts are provisional, while leap-day anniversaries are fixed on 1 March", () => {
  const options = {
    board: [user("example-one", { "2026-02-28": 20, "2026-03-01": 100 }, "2020-02-29T12:00:00Z")],
    year: 2026, today: "2026-03-01",
  };
  const events = achievementsForYear(options);
  const anniversary = events.find((event) => event.kind === "anniversary");
  assert.equal(anniversary?.date, "2026-03-01");
  assert.equal(anniversary?.provisional, false);
  assert(events.filter((event) => event.kind !== "anniversary").every((event) => event.provisional));
  assert(!achievementsForYear({ ...options, today: "2026-02-28" }).some((event) => event.kind === "anniversary"));
});

test("reconstruction is deterministic, does not mutate inputs and stops at the final lifetime rung", () => {
  const board: Board = [
    user("example-two", { "2026-01-03": 100, "2026-01-01": 20 }),
    user("example-one", { "2026-01-01": 30, "2026-01-03": 100 }),
  ];
  const before = structuredClone(board);
  const options = { board, year: 2026, today: "2026-01-04", history: [
    { login: "example-one", byYear: { 2025: 100_000 } },
  ] };
  const events = achievementsForYear(options);
  assert.deepEqual(board, before);
  assert.deepEqual(achievementsForYear({ ...options, board: [...board].reverse() }), events);
  assert(!events.some((event) => event.kind === "lifetime-milestone"));
  assert.deepEqual(achievementFeed(events, "unknown"), []);
});
