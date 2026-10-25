import assert from "node:assert/strict";
import test from "node:test";
import type { BoardUser } from "../shared/types.ts";
import { allTimeMilestoneNotification, discordWebhookPayload } from "../worker/discord.ts";
import type { ArchiveTotals } from "../worker/github.ts";
import {
  allTimeMilestoneUsers,
  deliverAllTimeMilestones,
  planAllTimeMilestones,
  type AllTimeMilestoneState,
  type AllTimeMilestoneUser,
  type PersonalMilestoneEvent,
} from "../worker/notifications.ts";

function user(login: string, total: number): AllTimeMilestoneUser {
  return {
    login,
    url: `https://github.com/${login}`,
    avatarUrl: `https://avatars.example/${login}`,
    total,
  };
}

function boardUser(login: string, totalContributions: number): BoardUser {
  return {
    login,
    name: null,
    url: `https://github.com/${login}`,
    avatarUrl: `https://avatars.example/${login}`,
    followers: 0,
    following: 0,
    totalContributions,
    weeks: [],
  };
}

function archive(totals: Record<string, Record<string, number>>, lastYear = 2025): ArchiveTotals {
  return {
    generatedAt: `${lastYear + 1}-01-01T00:00:00Z`,
    firstYear: 2013,
    lastYear,
    missing: [],
    users: Object.entries(totals).map(([login, byYear]) => ({
      login,
      url: `https://github.com/${login}`,
      byYear,
    })),
  };
}

test("all-time milestones combine each account's archive with the fresh live total by login", () => {
  const history = archive({
    "example-two": { 2025: 50 },
    "example-one": { 2013: 10_000, 2025: 9_000 },
  });
  const board = [boardUser("example-one", 488), boardUser("example-two", 100)];

  assert.deepEqual(allTimeMilestoneUsers(2026, board, history), [
    user("example-one", 19_488),
    user("example-two", 150),
  ]);
  assert.equal(board[0].totalContributions, 488);
  assert.equal(history.users[1].byYear["2025"], 9_000);
});

test("incomplete history or an archive for the wrong year cannot seed lifetime milestones", () => {
  const board = [boardUser("example-one", 1_000)];
  const history = archive({ "example-one": { 2025: 19_000 } });

  assert.equal(allTimeMilestoneUsers(2026, board, { ...history, missing: ["example-alt"] }), null);
  assert.equal(allTimeMilestoneUsers(2027, board, history), null);
  assert.equal(allTimeMilestoneUsers(2026, board, { ...history, users: [] }), null);
});

test("the first lifetime check seeds current thresholds without announcing history", async () => {
  const users = [user("example-one", 19_488), user("example-two", 51_000), user("example-new", 0)];
  const plan = planAllTimeMilestones(users);
  const saved: AllTimeMilestoneState[] = [];
  const delivered: PersonalMilestoneEvent[] = [];

  await deliverAllTimeMilestones(plan, async (event) => { delivered.push(event); }, async (state) => {
    saved.push(state);
  });

  assert.equal(delivered.length, 0);
  assert.deepEqual(saved.at(0), {
    personalMilestones: { "example-one": 17_500, "example-two": 50_000, "example-new": 0 },
  });
  assert.deepEqual(saved[0], plan.nextState);

  await deliverAllTimeMilestones(
    planAllTimeMilestones(users, saved[0]),
    async (event) => { delivered.push(event); },
    async (state) => { saved.push(state); },
  );
  assert.equal(saved.length, 1);
  assert.deepEqual(delivered, []);
});

test("reaching 20,000 lifetime contributions announces once even with a smaller yearly total", async () => {
  const history = archive({ "example-one": { 2013: 10_000, 2025: 9_000 } });
  let stored: AllTimeMilestoneState | undefined;
  const delivered: PersonalMilestoneEvent[] = [];
  for (const total of [488, 999, 1_000, 1_000, 1_001]) {
    const users = allTimeMilestoneUsers(2026, [boardUser("example-one", total)], history);
    assert.ok(users);
    await deliverAllTimeMilestones(
      planAllTimeMilestones(users, stored),
      async (event) => { delivered.push(event); },
      async (state) => { stored = structuredClone(state); },
    );
  }

  assert.deepEqual(delivered, [{
    login: "example-one",
    url: "https://github.com/example-one",
    avatarUrl: "https://avatars.example/example-one",
    threshold: 20_000,
  }]);
  assert.deepEqual(stored, { personalMilestones: { "example-one": 20_000 } });
});

test("a jump across multiple lifetime thresholds announces only the highest reached", () => {
  const initial = planAllTimeMilestones([user("example-one", 14_999)]).nextState;
  const plan = planAllTimeMilestones([user("example-one", 51_000)], initial);

  assert.deepEqual(plan.events.map(({ threshold }) => threshold), [50_000]);
  assert.deepEqual(initial, { personalMilestones: { "example-one": 12_500 } });
});

test("lifetime milestones continue across year rollover without resetting or repeating", () => {
  const before = allTimeMilestoneUsers(
    2026,
    [boardUser("example-one", 999)],
    archive({ "example-one": { 2025: 19_000 } }),
  );
  assert.ok(before);
  const initial = planAllTimeMilestones(before).nextState;
  const after = allTimeMilestoneUsers(
    2027,
    [boardUser("example-one", 1)],
    archive({ "example-one": { 2025: 19_000, 2026: 999 } }, 2026),
  );
  assert.ok(after);
  const plan = planAllTimeMilestones(after, initial);

  assert.deepEqual(plan.events.map(({ threshold }) => threshold), [20_000]);
  assert.deepEqual(planAllTimeMilestones(after, plan.nextState).events, []);
});

test("downward corrections and recovery do not repeat an announced lifetime threshold", () => {
  let state = planAllTimeMilestones([user("example-one", 19_488)]).nextState;
  state = planAllTimeMilestones([user("example-one", 20_000)], state).nextState;
  for (const total of [18_000, 19_999, 20_001]) {
    const plan = planAllTimeMilestones([user("example-one", total)], state);
    assert.deepEqual(plan.events, []);
    assert.equal(plan.nextState.personalMilestones["example-one"], 20_000);
    state = plan.nextState;
  }
  assert.deepEqual(
    planAllTimeMilestones([user("example-one", 25_001)], state).events.map(({ threshold }) => threshold),
    [25_000],
  );
});

test("new accounts seed silently while returning accounts retain lifetime checkpoints", () => {
  const initial = planAllTimeMilestones([user("example-one", 20_000)]).nextState;
  const removed = planAllTimeMilestones([user("example-new", 50_000)], initial);
  assert.deepEqual(removed.events, []);
  assert.deepEqual(removed.nextState.personalMilestones, { "example-one": 20_000, "example-new": 50_000 });

  const returned = planAllTimeMilestones([user("example-one", 20_100)], removed.nextState);
  assert.deepEqual(returned.events, []);
  assert.deepEqual(
    planAllTimeMilestones([user("example-one", 25_000)], returned.nextState).events.map(({ threshold }) => threshold),
    [25_000],
  );
});

test("webhook retries retain successful lifetime posts and newly seeded accounts", async () => {
  const initial = planAllTimeMilestones([user("example-one", 19_488), user("example-two", 19_488)]).nextState;
  let stored = structuredClone(initial);
  const users = [user("example-one", 20_000), user("example-two", 20_001), user("example-new", 50_000)];
  const delivered: string[] = [];
  let failSecond = true;
  const notify = async (event: PersonalMilestoneEvent) => {
    if (event.login === "example-two" && failSecond) {
      failSecond = false;
      throw new Error("Discord unavailable");
    }
    delivered.push(`${event.login}:${event.threshold}`);
  };
  const save = async (state: AllTimeMilestoneState) => { stored = structuredClone(state); };

  await assert.rejects(deliverAllTimeMilestones(planAllTimeMilestones(users, stored), notify, save), /Discord unavailable/);
  assert.deepEqual(stored.personalMilestones, { "example-one": 20_000, "example-two": 17_500, "example-new": 50_000 });
  await deliverAllTimeMilestones(planAllTimeMilestones(users, stored), notify, save);

  assert.deepEqual(delivered, ["example-one:20000", "example-two:20000"]);
  assert.deepEqual(stored.personalMilestones, { "example-one": 20_000, "example-two": 20_000, "example-new": 50_000 });
  assert.deepEqual(initial.personalMilestones, { "example-one": 17_500, "example-two": 17_500 });
});

test("an all-time milestone posts its lifetime threshold and links to the account page", () => {
  const event = { ...user("example-one", 20_017), threshold: 20_000 };
  const notification = allTimeMilestoneNotification(event);
  assert.equal(notification.embed.url, "https://leaderboard.ynga.tech/u/example-one");
  assert.equal(notification.embed.description, "[example-one](https://github.com/example-one) has reached **20,000 contributions** all time.");
  assert.deepEqual(notification.embed.thumbnail, { url: event.avatarUrl });
  assert.deepEqual(discordWebhookPayload(notification).allowed_mentions, { parse: [] });
});
