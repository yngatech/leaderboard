import assert from "node:assert/strict";
import test from "node:test";
import { PEOPLE } from "../../worker/github.ts";
import viteConfig from "../../vite.config.ts";
import { config, setup, type State } from "./fixture.ts";

const interval = 10 * 60 * 1000;

function assertNextRun(state: State): void {
  assert.ok(state.alarm !== null);
  assert.ok(state.alarm > Date.now() + interval - 5000);
  assert.ok(state.alarm <= Date.now() + interval);
}

test("a live-board read starts recurring alarms, preserves checkpoints on eviction, and restarts a missing alarm", async (t) => {
  assert.deepEqual(config.triggers.crons, []);
  const app = await setup(t);
  assert.equal((await app.state()).alarm, null);
  const response = await app.mf.dispatchFetch("https://board.test/api/board");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Board-Missing"), "");
  const first = await app.until((state) => state.completed === 1);
  assert.equal(first.values["board-snapshot"]?.board.length, PEOPLE.length);
  assertNextRun(first);
  assert.equal(app.posts.length, 0);

  assert.equal((await app.state("snapshot")).alarm, first.alarm);
  await app.mf.unsafeEvictDurableObject("alarm-test", "TestLeaderState", { name: "leaderboard" });
  const restored = await app.state();
  assert.deepEqual(restored.values, first.values);
  assert.equal(restored.alarm, first.alarm);
  await app.refreshed();
  assert.equal(app.posts.length, 0);

  await app.state("stop");
  const beforeRestart = await app.state();
  await app.state("snapshot");
  const restarted = await app.until((state) => state.completed > beforeRestart.completed);
  assert.notEqual(restarted.values["board-snapshot"]?.generatedAt,
    beforeRestart.values["board-snapshot"]?.generatedAt);
  assertNextRun(restarted);
});

test("missing credentials do not start an alarm", async (t) => {
  const app = await setup(t, { credentials: false });
  assert.equal((await app.state("snapshot")).alarm, null);
  assert.equal(app.queries(), 0);
});

test("dev and local preview configure the same disabled alarm guard", async () => {
  for (const command of ["serve", "build"] as const) {
    const config = await viteConfig({ command, mode: "local-preview" });
    assert.equal(config.define?.__BOARD_ALARMS_ENABLED__, "false");
  }
  const dev = await viteConfig({ command: "serve", mode: "development" });
  assert.equal(dev.define?.__BOARD_ALARMS_ENABLED__, "false");
});

test("a local preview serves the board without starting an alarm, even with a webhook", async (t) => {
  const app = await setup(t, { localPreview: true });
  const response = await app.mf.dispatchFetch("https://board.test/api/board");
  assert.equal(response.status, 200);
  assert.equal((await response.json() as unknown[]).length, PEOPLE.length);
  assert.equal((await app.state("snapshot")).alarm, null);
  assert.equal(app.queries(), 1);
  assert.equal(app.attempts(), 0);
});

test("an existing alarm in a disabled local build stops without fetching or posting", async (t) => {
  const app = await setup(t, { localPreview: true });
  const completed = await app.refreshed();
  assert.equal(completed.alarm, null);
  assert.deepEqual(completed.values, {});
  assert.equal(app.queries(), 0);
  assert.equal(app.attempts(), 0);
});

test("GitHub failures and incomplete boards preserve the last full board and keep another check scheduled", async (t) => {
  const app = await setup(t);
  const first = await app.refreshed();
  for (const mode of ["github-error", "partial"] as const) {
    app.setMode(mode);
    const failed = await app.refreshed();
    assert.deepEqual(failed.values, first.values);
    assertNextRun(failed);
  }
  app.setMode("ok");
  const recovered = await app.refreshed();
  assert.notEqual(recovered.values["board-snapshot"]?.generatedAt,
    first.values["board-snapshot"]?.generatedAt);
  assertNextRun(recovered);
  assert.equal(app.posts.length, 0);
});

test("Discord failure keeps the fresh board and retries undelivered notifications without repeating successful posts", async (t) => {
  const app = await setup(t);
  const first = await app.refreshed();
  app.setCount(42);
  app.setMode("discord-error");
  const failed = await app.refreshed();
  assert.ok(app.attempts() > 0);
  assertNextRun(failed);
  assert.equal(failed.values["board-snapshot"]?.board[0].totalContributions, 42);
  assert.deepEqual(failed.values.leader, first.values.leader);

  app.setMode("ok");
  await app.refreshed();
  assert.equal((await app.state()).values.leader?.order[0], PEOPLE[0].accounts[0]);
  const delivered = app.posts.length;
  assert.ok(delivered > 0);
  await app.refreshed();
  assert.equal(app.posts.length, delivered);
});

test("without a webhook an alarm still refreshes the site's snapshot", async (t) => {
  const app = await setup(t, { webhook: false });
  await app.state("snapshot");
  const result = await app.until((state) => state.completed === 1);
  assertNextRun(result);
  assert.equal(result.values["board-snapshot"]?.board.length, PEOPLE.length);
  assert.equal(result.values.leader, undefined);
  assert.equal(app.attempts(), 0);
});
