import assert from "node:assert/strict";
import test from "node:test";
import type { Board, BoardUser } from "../shared/types.ts";
import {
  deliverDailyRecords,
  planDailyRecords,
  SerialTaskQueue,
  type DailyRecordNotification,
  type DailyRecordState,
} from "../worker/notifications.ts";

function user(login: string, days: Array<[date: string, count: number]>): BoardUser {
  return {
    login,
    name: login,
    avatarUrl: `https://avatars.example/${login}`,
    url: `https://github.com/${login}`,
    followers: 0,
    following: 0,
    totalContributions: days.reduce((total, [, count]) => total + count, 0),
    weeks: [{
      days: days.map(([date, count]) => ({
        date,
        count,
        level: count === 0 ? 0 : 1,
      })),
    }],
  };
}

function notificationId(notification: DailyRecordNotification): string {
  return notification.type === "personal-best"
    ? `pb:${notification.event.login}`
    : `record:${notification.event.peak.login}`;
}

function updatedBoard(): Board {
  return [
    user("alice", [["2026-01-01", 12], ["2026-02-03", 15]]),
    user("bob", [["2026-01-01", 9], ["2026-02-03", 11]]),
  ];
}

function priorState(): DailyRecordState {
  return {
    year: 2026,
    personalBests: { alice: 12, bob: 9 },
    boardBest: 12,
  };
}

test("records a silent baseline when daily notification state is first created", () => {
  const board: Board = [
    user("alice", [["2025-12-31", 99], ["2026-01-01", 8], ["2026-01-02", 12]]),
    user("bob", [["2026-01-01", 9]]),
  ];

  const plan = planDailyRecords(2026, board);

  assert.equal(plan.baseline, true);
  assert.deepEqual(plan.personalBests, []);
  assert.equal(plan.boardRecord, null);
  assert.deepEqual(plan.nextState, {
    year: 2026,
    personalBests: { alice: 12, bob: 9 },
    boardBest: 12,
  });
});

test("detects personal bests and the new peak daily board record", () => {
  const plan = planDailyRecords(2026, updatedBoard(), priorState());

  assert.deepEqual(
    plan.personalBests.map(({ login, date, count, previousCount }) => ({
      login,
      date,
      count,
      previousCount,
    })),
    [
      { login: "alice", date: "2026-02-03", count: 15, previousCount: 12 },
      { login: "bob", date: "2026-02-03", count: 11, previousCount: 9 },
    ],
  );
  assert.deepEqual(plan.boardRecord && {
    login: plan.boardRecord.peak.login,
    date: plan.boardRecord.peak.date,
    count: plan.boardRecord.peak.count,
    previousCount: plan.boardRecord.previousCount,
  }, {
    login: "alice",
    date: "2026-02-03",
    count: 15,
    previousCount: 12,
  });
  assert.deepEqual(plan.nextState, {
    year: 2026,
    personalBests: { alice: 15, bob: 11 },
    boardBest: 15,
  });
});

test("does not alert for ties, lower corrections, or a newly added account", () => {
  const previous: DailyRecordState = {
    year: 2026,
    personalBests: { alice: 12 },
    boardBest: 20,
  };
  const board: Board = [
    user("alice", [["2026-03-01", 12]]),
    user("new-person", [["2026-02-01", 28]]),
  ];

  const plan = planDailyRecords(2026, board, previous);

  assert.equal(plan.needsPreparation, true);
  assert.deepEqual(plan.personalBests, []);
  assert.equal(plan.boardRecord, null);
  assert.deepEqual(plan.nextState, {
    year: 2026,
    personalBests: { alice: 12, "new-person": 28 },
    boardBest: 28,
  });
});

test("starts records from zero when the calendar year rolls over", () => {
  const previous: DailyRecordState = {
    year: 2025,
    personalBests: { alice: 50 },
    boardBest: 50,
  };
  const board: Board = [user("alice", [["2026-01-01", 3]])];

  const plan = planDailyRecords(2026, board, previous);

  assert.equal(plan.baseline, false);
  assert.equal(plan.needsPreparation, true);
  assert.deepEqual(plan.personalBests.map(({ login, count, previousCount }) => ({
    login,
    count,
    previousCount,
  })), [{ login: "alice", count: 3, previousCount: 0 }]);
  assert.equal(plan.boardRecord?.peak.count, 3);
  assert.equal(plan.boardRecord?.previousCount, 0);
});

test("resumes after a personal-best webhook fails without reposting prior successes", async () => {
  const board = updatedBoard();
  let stored = priorState();
  let failBob = true;
  const delivered: string[] = [];
  const notify = async (notification: DailyRecordNotification) => {
    if (notificationId(notification) === "pb:bob" && failBob) {
      failBob = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(notificationId(notification));
  };
  const save = async (state: DailyRecordState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverDailyRecords(planDailyRecords(2026, board, stored), notify, save),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, {
    year: 2026,
    personalBests: { alice: 15, bob: 9 },
    boardBest: 12,
  });

  await deliverDailyRecords(planDailyRecords(2026, board, stored), notify, save);
  assert.deepEqual(delivered, ["pb:alice", "pb:bob", "record:alice"]);
  assert.deepEqual(stored, {
    year: 2026,
    personalBests: { alice: 15, bob: 11 },
    boardBest: 15,
  });
});

test("retries only the board record when its webhook fails after the PBs", async () => {
  const board = updatedBoard();
  let stored = priorState();
  let failRecord = true;
  const delivered: string[] = [];
  const notify = async (notification: DailyRecordNotification) => {
    if (notification.type === "board-record" && failRecord) {
      failRecord = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(notificationId(notification));
  };
  const save = async (state: DailyRecordState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverDailyRecords(planDailyRecords(2026, board, stored), notify, save),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, {
    year: 2026,
    personalBests: { alice: 15, bob: 11 },
    boardBest: 12,
  });

  await deliverDailyRecords(planDailyRecords(2026, board, stored), notify, save);
  assert.deepEqual(delivered, ["pb:alice", "pb:bob", "record:alice"]);
  assert.equal(stored.boardBest, 15);
});

test("checkpoints a year rollover before sending and resumes mid-cycle", async () => {
  const board: Board = [
    user("alice", [["2026-01-01", 3]]),
    user("bob", [["2026-01-01", 2]]),
  ];
  let stored: DailyRecordState = {
    year: 2025,
    personalBests: { alice: 50, bob: 40 },
    boardBest: 50,
  };
  let failBob = true;
  const delivered: string[] = [];
  const notify = async (notification: DailyRecordNotification) => {
    if (notificationId(notification) === "pb:bob" && failBob) {
      failBob = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(notificationId(notification));
  };
  const save = async (state: DailyRecordState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverDailyRecords(planDailyRecords(2026, board, stored), notify, save),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, {
    year: 2026,
    personalBests: { alice: 3, bob: 0 },
    boardBest: 0,
  });

  await deliverDailyRecords(planDailyRecords(2026, board, stored), notify, save);
  assert.deepEqual(delivered, ["pb:alice", "pb:bob", "record:alice"]);
});

test("serialises overlapping updates so they cannot post duplicate alerts", async () => {
  const board = updatedBoard();
  const queue = new SerialTaskQueue();
  let stored = priorState();
  let active = 0;
  let highestConcurrency = 0;
  const delivered: string[] = [];

  const update = () =>
    queue.run(async () => {
      active += 1;
      highestConcurrency = Math.max(highestConcurrency, active);
      try {
        const plan = planDailyRecords(2026, board, stored);
        await deliverDailyRecords(
          plan,
          async (notification) => {
            await Promise.resolve();
            delivered.push(notificationId(notification));
          },
          async (state) => {
            stored = structuredClone(state);
          },
        );
      } finally {
        active -= 1;
      }
    });

  await Promise.all([update(), update()]);

  assert.equal(highestConcurrency, 1);
  assert.deepEqual(delivered, ["pb:alice", "pb:bob", "record:alice"]);
});

test("steady state sends no notifications and performs no storage writes", async () => {
  let notifications = 0;
  let writes = 0;
  const state = priorState();
  const board: Board = [
    user("alice", [["2026-01-01", 12]]),
    user("bob", [["2026-01-01", 9]]),
  ];

  await deliverDailyRecords(
    planDailyRecords(2026, board, state),
    async () => {
      notifications += 1;
    },
    async () => {
      writes += 1;
    },
  );

  assert.equal(notifications, 0);
  assert.equal(writes, 0);
});

test("preserves a missing person's PB and compares against it when they return", () => {
  const previous = priorState();
  const absent = planDailyRecords(
    2026,
    [user("alice", [["2026-01-01", 12]])],
    previous,
  );
  assert.equal(absent.nextState.personalBests.bob, 9);

  const returned = planDailyRecords(
    2026,
    [
      user("alice", [["2026-01-01", 12]]),
      user("bob", [["2026-01-01", 9], ["2026-03-01", 11]]),
    ],
    absent.nextState,
  );
  assert.deepEqual(
    returned.personalBests.map(({ login, count, previousCount }) => ({
      login,
      count,
      previousCount,
    })),
    [{ login: "bob", count: 11, previousCount: 9 }],
  );
});
