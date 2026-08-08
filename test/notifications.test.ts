import assert from "node:assert/strict";
import test from "node:test";
import type { Board, BoardUser } from "../shared/types.ts";
import {
  deliverDailyRecords,
  deliverMilestones,
  deliverStandings,
  ordinal,
  planDailyRecords,
  planMilestones,
  planStandings,
  SerialTaskQueue,
  shouldUpdateNotifications,
  type DailyRecordNotification,
  type DailyRecordState,
  type MilestoneNotification,
  type MilestoneState,
  type StandingNotification,
  type StandingState,
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

function totalUser(login: string, totalContributions: number): BoardUser {
  return {
    login,
    name: login,
    avatarUrl: `https://avatars.example/${login}`,
    url: `https://github.com/${login}`,
    followers: 0,
    following: 0,
    totalContributions,
    weeks: [],
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

function milestoneState(
  personalTotals: Record<string, number>,
  personalMilestones: Record<string, number>,
  boardTotal: number,
  boardMilestone: number,
): MilestoneState {
  return { year: 2026, personalTotals, personalMilestones, boardTotal, boardMilestone };
}

function milestoneNotificationId(notification: MilestoneNotification): string {
  return notification.type === "personal-milestone"
    ? `personal:${notification.event.login}:${notification.event.threshold}`
    : `board:${notification.event.threshold}`;
}

test("seeds contribution milestones without backfilling notifications", () => {
  const plan = planMilestones(2026, [totalUser("alice", 12_000), totalUser("bob", 900)]);

  assert.equal(plan.baseline, true);
  assert.deepEqual(plan.personalMilestones, []);
  assert.equal(plan.boardMilestone, null);
  assert.deepEqual(plan.nextState, milestoneState(
    { alice: 12_000, bob: 900 },
    { alice: 10_000, bob: 500 },
    12_900,
    10_000,
  ));
});

test("detects one personal and board contribution milestone", () => {
  const plan = planMilestones(
    2026,
    [totalUser("alice", 100), totalUser("bob", 900)],
    milestoneState({ alice: 99, bob: 900 }, { alice: 0, bob: 500 }, 999, 0),
  );

  assert.deepEqual(plan.personalMilestones, [{
    login: "alice",
    url: "https://github.com/alice",
    avatarUrl: "https://avatars.example/alice",
    threshold: 100,
  }]);
  assert.deepEqual(plan.boardMilestone, { threshold: 1000 });
});

test("collapses multiple contribution milestones to the highest newly passed threshold", () => {
  const plan = planMilestones(
    2026,
    [totalUser("alice", 12_000), totalUser("bob", 1)],
    milestoneState({ alice: 99, bob: 1 }, { alice: 0, bob: 0 }, 100, 0),
  );

  assert.deepEqual(plan.personalMilestones.map(({ login, threshold }) => ({ login, threshold })), [
    { login: "alice", threshold: 10_000 },
  ]);
  assert.deepEqual(plan.boardMilestone, { threshold: 10_000 });
});

test("resets contribution milestone state silently on a year rollover", () => {
  const previous: MilestoneState = {
    ...milestoneState({ alice: 50_000 }, { alice: 50_000 }, 50_000, 50_000),
    year: 2025,
  };
  const plan = planMilestones(2026, [totalUser("alice", 1_000)], previous);

  assert.equal(plan.baseline, true);
  assert.deepEqual(plan.personalMilestones, []);
  assert.equal(plan.boardMilestone, null);
  assert.deepEqual(plan.nextState, milestoneState({ alice: 1_000 }, { alice: 1_000 }, 1_000, 1_000));
});

test("lowers contribution totals silently without repeating passed milestones", () => {
  const initial = milestoneState({ alice: 1_000 }, { alice: 1_000 }, 1_000, 1_000);
  const decreased = planMilestones(2026, [totalUser("alice", 400)], initial);

  assert.equal(decreased.needsPreparation, true);
  assert.deepEqual(decreased.personalMilestones, []);
  assert.equal(decreased.boardMilestone, null);
  assert.deepEqual(decreased.nextState, milestoneState({ alice: 400 }, { alice: 1_000 }, 400, 1_000));

  const recovered = planMilestones(2026, [totalUser("alice", 900)], decreased.nextState);
  assert.deepEqual(recovered.personalMilestones, []);
  assert.equal(recovered.boardMilestone, null);

  const exceeded = planMilestones(2026, [totalUser("alice", 2_500)], recovered.nextState);
  assert.deepEqual(exceeded.personalMilestones.map(({ threshold }) => threshold), [2_500]);
  assert.equal(exceeded.boardMilestone?.threshold, 2_500);
});

test("checkpoints contribution milestones after each successful webhook", async () => {
  const board = [totalUser("alice", 100), totalUser("bob", 2_500)];
  let stored = milestoneState({ alice: 99, bob: 99 }, { alice: 0, bob: 0 }, 198, 0);
  let failBob = true;
  const delivered: string[] = [];
  const notify = async (notification: MilestoneNotification) => {
    if (milestoneNotificationId(notification) === "personal:bob:2500" && failBob) {
      failBob = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(milestoneNotificationId(notification));
  };
  const save = async (state: MilestoneState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverMilestones(planMilestones(2026, board, stored), notify, save),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, milestoneState(
    { alice: 100, bob: 2_500 },
    { alice: 100, bob: 0 },
    2_600,
    0,
  ));

  await deliverMilestones(planMilestones(2026, board, stored), notify, save);
  assert.deepEqual(delivered, ["personal:alice:100", "personal:bob:2500", "board:2500"]);
  assert.deepEqual(stored, milestoneState(
    { alice: 100, bob: 2_500 },
    { alice: 100, bob: 2_500 },
    2_600,
    2_500,
  ));
});

test("retries only the board milestone when its webhook fails after personal milestones", async () => {
  const board = [totalUser("alice", 100), totalUser("bob", 2_500)];
  let stored = milestoneState({ alice: 99, bob: 99 }, { alice: 0, bob: 0 }, 198, 0);
  let failBoard = true;
  const delivered: string[] = [];
  const notify = async (notification: MilestoneNotification) => {
    if (notification.type === "board-milestone" && failBoard) {
      failBoard = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(milestoneNotificationId(notification));
  };
  const save = async (state: MilestoneState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverMilestones(planMilestones(2026, board, stored), notify, save),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, milestoneState(
    { alice: 100, bob: 2_500 },
    { alice: 100, bob: 2_500 },
    2_600,
    0,
  ));

  await deliverMilestones(planMilestones(2026, board, stored), notify, save);
  assert.deepEqual(delivered, ["personal:alice:100", "personal:bob:2500", "board:2500"]);
  assert.equal(stored.boardMilestone, 2_500);
});

function standingsState(order: Array<[login: string, totalContributions: number]>): StandingState {
  return {
    year: 2026,
    order: order.map(([login]) => login),
  };
}

function standingsNotificationId(notification: StandingNotification): string {
  return notification.type === "leader"
    ? `leader:${notification.event.leader.login}`
    : `overtake:${notification.event.position}:${notification.event.mover.login}`;
}

function standingStepId(step: { notification: StandingNotification }): string {
  return standingsNotificationId(step.notification);
}

test("seeds the full standings silently when standings state is first created", () => {
  const plan = planStandings(2026, [totalUser("alice", 100), totalUser("bob", 90), totalUser("carol", 80)]);

  assert.equal(plan.baseline, true);
  assert.deepEqual(plan.notifications, []);
  assert.deepEqual(plan.nextState, standingsState([
    ["alice", 100],
    ["bob", 90],
    ["carol", 80],
  ]));
});

test("announces a clean overtake into second place", () => {
  const plan = planStandings(
    2026,
    [totalUser("alice", 100), totalUser("dave", 91), totalUser("bob", 90), totalUser("carol", 80)],
    standingsState([["alice", 100], ["bob", 90], ["carol", 80], ["dave", 70]]),
  );

  assert.deepEqual(plan.notifications.map(standingStepId), ["overtake:3:dave", "overtake:2:dave"]);
});

test("announces a clean overtake into third place", () => {
  const plan = planStandings(
    2026,
    [totalUser("alice", 100), totalUser("bob", 90), totalUser("dave", 81), totalUser("carol", 80)],
    standingsState([["alice", 100], ["bob", 90], ["carol", 80], ["dave", 70]]),
  );

  assert.deepEqual(plan.notifications.map(standingStepId), ["overtake:3:dave"]);
});

test("announces a mid-board overtake into fourth place", () => {
  const plan = planStandings(
    2026,
    [
      totalUser("alice", 100),
      totalUser("bob", 90),
      totalUser("carol", 80),
      totalUser("erin", 71),
      totalUser("dave", 70),
    ],
    standingsState([
      ["alice", 100],
      ["bob", 90],
      ["carol", 80],
      ["dave", 70],
      ["erin", 60],
    ]),
  );

  assert.deepEqual(plan.notifications.map(standingStepId), ["overtake:4:erin"]);
});

test("formats rank ordinals correctly", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "24th"],
  );
});

test("a leader change does not also announce the displaced former leader", () => {
  const plan = planStandings(
    2026,
    [totalUser("bob", 110), totalUser("alice", 100), totalUser("carol", 80)],
    standingsState([["alice", 100], ["bob", 90], ["carol", 80]]),
  );

  assert.deepEqual(plan.notifications.map(standingStepId), ["leader:bob"]);
});

test("does not announce tied totals that only change ordering", () => {
  const plan = planStandings(
    2026,
    [totalUser("alice", 100), totalUser("dave", 90), totalUser("bob", 90), totalUser("carol", 80)],
    standingsState([["alice", 100], ["bob", 90], ["carol", 80]]),
  );

  assert.deepEqual(plan.notifications, []);
});

test("does not announce simultaneous growth that ends in a tie", () => {
  const plan = planStandings(
    2026,
    [totalUser("alice", 101), totalUser("dave", 100), totalUser("bob", 100), totalUser("carol", 80)],
    standingsState([["alice", 100], ["bob", 90], ["carol", 80]]),
  );

  assert.deepEqual(plan.notifications, []);
});

test("does not announce a leader change caused by a tied reordering", () => {
  const plan = planStandings(
    2026,
    [totalUser("bob", 100), totalUser("alice", 100), totalUser("carol", 80)],
    standingsState([["alice", 100], ["bob", 100], ["carol", 80]]),
  );

  assert.deepEqual(plan.notifications, []);
});

test("attributes simultaneous moves to the person the mover actually passed", () => {
  const plan = planStandings(
    2026,
    [totalUser("bob", 120), totalUser("dave", 110), totalUser("alice", 100), totalUser("carol", 80)],
    standingsState([["alice", 100], ["bob", 90], ["carol", 80], ["dave", 70]]),
  );

  assert.deepEqual(plan.notifications.map(standingStepId), [
    "leader:bob",
    "overtake:3:dave",
    "overtake:2:dave",
  ]);
});

test("notifies each existing user in a multi-position cascade with the right displaced user", () => {
  const plan = planStandings(
    2026,
    [
      totalUser("alice", 100),
      totalUser("erin", 99),
      totalUser("dave", 95),
      totalUser("bob", 90),
      totalUser("carol", 80),
    ],
    standingsState([
      ["alice", 100],
      ["bob", 90],
      ["carol", 80],
      ["dave", 70],
      ["erin", 60],
    ]),
  );

  assert.deepEqual(plan.notifications.map(({ notification }) => {
    assert.equal(notification.type, "overtake");
    return {
      position: notification.event.position,
      mover: notification.event.mover.login,
      displaced: notification.event.displaced.login,
    };
  }), [
    { position: 4, mover: "erin", displaced: "dave" },
    { position: 3, mover: "erin", displaced: "carol" },
    { position: 2, mover: "erin", displaced: "bob" },
    { position: 4, mover: "dave", displaced: "carol" },
    { position: 3, mover: "dave", displaced: "bob" },
  ]);
  assert.equal(plan.notifications.length, 5);
});

test("does not announce an ex-leader as a mover during simultaneous upward moves", () => {
  const plan = planStandings(
    2026,
    [totalUser("bob", 120), totalUser("carol", 110), totalUser("alice", 100)],
    standingsState([["alice", 100], ["bob", 90], ["carol", 80]]),
  );

  assert.deepEqual(plan.notifications.map(standingStepId), ["leader:bob", "overtake:2:carol"]);
});

test("seeds changes silently when a standing user disappears or the board shrinks", () => {
  const previous = standingsState([["alice", 100], ["bob", 90], ["carol", 80]]);
  const disappeared = planStandings(
    2026,
    [totalUser("dave", 110), totalUser("bob", 90), totalUser("carol", 80)],
    previous,
  );
  const fewerUsers = planStandings(2026, [totalUser("alice", 101), totalUser("bob", 90)], previous);

  assert.deepEqual(disappeared.notifications, []);
  assert.equal(disappeared.needsPreparation, true);
  assert.deepEqual(fewerUsers.notifications, []);
  assert.equal(fewerUsers.needsPreparation, true);
});

test("resets full-standings state silently on a year rollover", () => {
  const previous: StandingState = { ...standingsState([["alice", 100], ["bob", 90]]), year: 2025 };
  const plan = planStandings(2026, [totalUser("dave", 10), totalUser("alice", 9)], previous);

  assert.equal(plan.baseline, true);
  assert.deepEqual(plan.notifications, []);
  assert.deepEqual(plan.nextState, standingsState([["dave", 10], ["alice", 9]]));
});

test("migrates legacy leader-only state without posting a rank alert", () => {
  const plan = planStandings(
    2026,
    [totalUser("alice", 100), totalUser("dave", 91), totalUser("bob", 90)],
    { year: 2026, login: "alice" },
  );

  assert.equal(plan.baseline, true);
  assert.deepEqual(plan.notifications, []);
  assert.deepEqual(plan.nextState, standingsState([["alice", 100], ["dave", 91], ["bob", 90]]));
});

test("migrates the old top-three state without posting a rank alert", () => {
  const plan = planStandings(
    2026,
    [totalUser("alice", 100), totalUser("dave", 91), totalUser("bob", 90), totalUser("carol", 80)],
    {
      year: 2026,
      top: ["alice", "bob", "carol"].map((login, index) => ({
        login,
        url: `https://github.com/${login}`,
        avatarUrl: `https://avatars.example/${login}`,
        totalContributions: [100, 90, 80][index],
      })),
    },
  );

  assert.equal(plan.baseline, true);
  assert.deepEqual(plan.notifications, []);
  assert.deepEqual(plan.nextState, standingsState([
    ["alice", 100],
    ["dave", 91],
    ["bob", 90],
    ["carol", 80],
  ]));
});

test("checkpoints each successful rank alert when a later webhook fails", async () => {
  const board = [
    totalUser("alice", 100),
    totalUser("dave", 99),
    totalUser("erin", 98),
    totalUser("bob", 90),
    totalUser("carol", 80),
  ];
  let stored = standingsState([
    ["alice", 100],
    ["bob", 90],
    ["carol", 80],
    ["dave", 70],
    ["erin", 60],
  ]);
  let failErin = true;
  const delivered: string[] = [];
  const notify = async (notification: StandingNotification) => {
    if (standingsNotificationId(notification) === "overtake:4:erin" && failErin) {
      failErin = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(standingsNotificationId(notification));
  };
  const save = async (state: StandingState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverStandings(planStandings(2026, board, stored), notify, save),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, standingsState([
    ["alice", 100],
    ["dave", 99],
    ["bob", 90],
    ["carol", 80],
    ["erin", 60],
  ]));

  await deliverStandings(planStandings(2026, board, stored), notify, save);
  assert.deepEqual(delivered, ["overtake:3:dave", "overtake:2:dave", "overtake:4:erin", "overtake:3:erin"]);
  assert.deepEqual(stored, standingsState([
    ["alice", 100],
    ["dave", 99],
    ["erin", 98],
    ["bob", 90],
    ["carol", 80],
  ]));
});

test("does not repeat a checkpointed leader after a later rank alert fails", async () => {
  const board = [
    totalUser("bob", 120),
    totalUser("carol", 110),
    totalUser("alice", 100),
  ];
  let stored = standingsState([["alice", 100], ["bob", 90], ["carol", 80]]);
  let failCarol = true;
  const delivered: string[] = [];
  const notify = async (notification: StandingNotification) => {
    if (standingsNotificationId(notification) === "overtake:2:carol" && failCarol) {
      failCarol = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(standingsNotificationId(notification));
  };
  const save = async (state: StandingState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverStandings(planStandings(2026, board, stored), notify, save),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, standingsState([["bob", 120], ["alice", 100], ["carol", 110]]));

  await deliverStandings(planStandings(2026, board, stored), notify, save);
  assert.deepEqual(delivered, ["leader:bob", "overtake:2:carol"]);
  assert.deepEqual(stored, standingsState([["bob", 120], ["carol", 110], ["alice", 100]]));
});

test("preserves the stored order through a failed pass and a tie", async () => {
  let stored = standingsState([["top", 120], ["bob", 100], ["alice", 90]]);
  const delivered: string[] = [];
  const save = async (state: StandingState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverStandings(
      planStandings(2026, [totalUser("top", 120), totalUser("alice", 101), totalUser("bob", 100)], stored),
      async () => {
        throw new Error("Discord unavailable");
      },
      save,
    ),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, standingsState([["top", 120], ["bob", 100], ["alice", 90]]));

  await deliverStandings(
    planStandings(2026, [totalUser("top", 120), totalUser("alice", 100), totalUser("bob", 100)], stored),
    async (notification) => {
      delivered.push(standingsNotificationId(notification));
    },
    save,
  );
  assert.equal(delivered.length, 0);
  assert.deepEqual(stored, standingsState([["top", 120], ["bob", 100], ["alice", 90]]));

  await deliverStandings(
    planStandings(2026, [totalUser("top", 120), totalUser("alice", 101), totalUser("bob", 100)], stored),
    async (notification) => {
      delivered.push(standingsNotificationId(notification));
    },
    save,
  );
  assert.deepEqual(delivered, ["overtake:2:alice"]);
  assert.deepEqual(stored, standingsState([["top", 120], ["alice", 101], ["bob", 100]]));
});

test("allows a pass, re-pass, and later genuine re-pass", async () => {
  let stored = standingsState([["alice", 100], ["bob", 90]]);
  const delivered: string[] = [];
  const save = async (state: StandingState) => {
    stored = structuredClone(state);
  };
  const notify = async (notification: StandingNotification) => {
    delivered.push(standingsNotificationId(notification));
  };

  for (const board of [
    [totalUser("bob", 110), totalUser("alice", 100)],
    [totalUser("alice", 120), totalUser("bob", 110)],
    [totalUser("bob", 130), totalUser("alice", 120)],
  ]) {
    await deliverStandings(planStandings(2026, board, stored), notify, save);
  }

  assert.deepEqual(delivered, ["leader:bob", "leader:alice", "leader:bob"]);
});

test("does not duplicate a checkpointed pass when another user moves above the mover", async () => {
  let stored = standingsState([["alice", 100], ["bob", 90], ["carol", 80]]);
  const delivered: string[] = [];
  const save = async (state: StandingState) => {
    stored = structuredClone(state);
  };
  const notify = async (notification: StandingNotification) => {
    delivered.push(standingsNotificationId(notification));
  };

  await deliverStandings(
    planStandings(2026, [totalUser("bob", 110), totalUser("alice", 100), totalUser("carol", 80)], stored),
    notify,
    save,
  );
  await deliverStandings(
    planStandings(2026, [totalUser("carol", 120), totalUser("bob", 110), totalUser("alice", 100)], stored),
    notify,
    save,
  );

  assert.deepEqual(delivered, ["leader:bob", "overtake:2:carol", "leader:carol"]);
});

test("replans an unfinished multi-overtake batch from its delivered swap", async () => {
  let stored = standingsState([["alice", 100], ["bob", 90], ["carol", 80], ["dave", 70]]);
  const delivered: string[] = [];
  let failDave = true;
  const notify = async (notification: StandingNotification) => {
    if (standingsNotificationId(notification) === "overtake:3:dave" && failDave) {
      failDave = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(standingsNotificationId(notification));
  };
  const save = async (state: StandingState) => {
    stored = structuredClone(state);
  };

  await assert.rejects(
    deliverStandings(
      planStandings(2026, [totalUser("alice", 100), totalUser("carol", 95), totalUser("dave", 92), totalUser("bob", 90)], stored),
      notify,
      save,
    ),
    /Discord unavailable/,
  );
  assert.deepEqual(stored, standingsState([["alice", 100], ["carol", 95], ["bob", 90], ["dave", 70]]));

  await deliverStandings(
    planStandings(2026, [totalUser("alice", 100), totalUser("carol", 95), totalUser("bob", 90), totalUser("dave", 70)], stored),
    notify,
    save,
  );
  assert.deepEqual(delivered, ["overtake:2:carol"]);
  assert.deepEqual(stored, standingsState([["alice", 100], ["carol", 95], ["bob", 90], ["dave", 70]]));
});

test("skips notification updates for incomplete boards", () => {
  assert.equal(shouldUpdateNotifications([]), true);
  assert.equal(shouldUpdateNotifications(["secondary-account"]), false);
});
