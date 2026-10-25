import assert from "node:assert/strict";
import test from "node:test";
import { PEOPLE } from "../../worker/github.ts";
import type { PrInsights } from "../../worker/insights.ts";
import viteConfig from "../../vite.config.ts";
import { config, workerPreviewConfig, setup, type State } from "./fixture.ts";

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
  assert.equal(app.exchanges(), 1);

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

test("the shared Worker selects preview behavior from the Builds branch", async (t) => {
  const keys = ["WORKERS_CI", "WORKERS_CI_BRANCH", "WRANGLER_CI_OVERRIDE_NAME"] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key];
    else process.env[key] = previous[i];
  }));
  process.env.WORKERS_CI = "1";
  process.env.WRANGLER_CI_OVERRIDE_NAME = "leaderboard";
  for (const [branch, preview] of [["main", "false"], ["feature/example", "true"]] as const) {
    process.env.WORKERS_CI_BRANCH = branch;
    const config = await viteConfig({ command: "build", mode: "production" });
    assert.equal(config.define?.__IS_PREVIEW_BUILD__, preview);
    assert.equal(config.define?.__BOARD_ALARMS_ENABLED__, "true");
    assert.equal(config.define?.__LOCAL_DEVELOPMENT__, "false");
  }
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
    assert.deepEqual(failed.values["board-snapshot"], first.values["board-snapshot"]);
    assert.deepEqual(failed.values.leader, first.values.leader);
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

test("an alarm due during a Discord post waits without duplicating notifications", async (t) => {
  const app = await setup(t);
  const baseline = await app.refreshed();
  app.setCount(42);
  app.pauseDiscord();
  await app.state("wake");
  const posting = await app.until((state) => state.active === 1 && app.attempts() > 0);
  assert.equal(posting.values["board-snapshot"]?.board[0].totalContributions, 42);

  await app.state("wake");
  app.resumeDiscord();
  const finished = await app.until((state) => state.completed === baseline.completed + 2);
  assert.equal(finished.maxActive, 1);
  assert.ok(app.posts.length > 0);
  assert.equal(new Set(app.posts.map((post) => JSON.stringify(post))).size, app.posts.length);
  assert.equal(new Set(app.insightQueries).size, app.insightQueries.length);
  assertNextRun(finished);
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

test("a native preview retains isolated DO configuration and runs alarms without notifying Discord", async (t) => {
  // The production deployment enables the parent Worker's native preview hosts.
  assert.equal(config.preview_urls, true);
  assert.equal(workerPreviewConfig.preview_urls, true);
  assert.equal(workerPreviewConfig.name, "leaderboard");
  assert.deepEqual(workerPreviewConfig.previews.durable_objects.bindings,
    [{ name: "LEADER_STATE", class_name: "LeaderState" }]);
  assert.deepEqual(workerPreviewConfig.durable_objects.bindings,
    [{ name: "LEADER_STATE", class_name: "LeaderState" }]);
  assert.deepEqual(workerPreviewConfig.migrations, config.migrations);
  // Routes stay at the top level; native Previews do not take them over.
  assert.deepEqual(workerPreviewConfig.routes, config.routes);
  const preview = await viteConfig({ command: "build", mode: "worker-preview" });
  assert.equal(preview.define?.__BOARD_ALARMS_ENABLED__, "true");
  assert.equal(preview.define?.__IS_PREVIEW_BUILD__, "true");
  assert.equal(preview.define?.__LOCAL_DEVELOPMENT__, "false");

  // Supply a webhook deliberately: the build must suppress notifications itself.
  const app = await setup(t, { workerPreview: true, history: 17480 });
  const response = await app.mf.dispatchFetch("https://board.test/api/board");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const first = await app.until((state) => state.completed === 1);
  assertNextRun(first);
  assert.equal(first.values["board-snapshot"]?.board.length, PEOPLE.length);

  const collected = app.insightQueries.length;
  assert.ok(collected > 0);
  const insights = await app.mf.dispatchFetch(`https://board.test/api/users/${PEOPLE[0].accounts[0]}/insights`);
  assert.equal(insights.status, 200);
  assert.equal(app.insightQueries.length, collected);

  app.setCount(42);
  const second = await app.refreshed();
  assertNextRun(second);
  assert.equal(second.values["board-snapshot"]?.board[0].totalContributions, 42);
  assert.equal(second.values.leader, undefined);
  assert.equal(second.values.milestones, undefined);
  assert.equal(second.values["all-time-milestones"], undefined);
  assert.equal(app.attempts(), 0);
  assert.ok(app.exchanges() > 0);
});

test("alarms populate one due person's insights per run and JSON reads do not collect", async (t) => {
  const app = await setup(t, { webhook: false });
  const firstPerson = PEOPLE[0];
  const secondPerson = PEOPLE[1];
  const url = `https://board.test/api/users/${firstPerson.accounts[0]}/insights`;
  assert.equal((await app.mf.dispatchFetch(url)).status, 202);
  assert.equal(app.insightQueries.length, 0);
  assert.equal((await app.state()).alarm, null);

  const first = await app.refreshed();
  assertNextRun(first);
  const response = await app.mf.dispatchFetch(url);
  assert.equal(response.status, 200);
  const summary = await response.json() as PrInsights;
  assert.equal(summary.login, firstPerson.accounts[0]);
  assert.deepEqual(summary.accounts, firstPerson.accounts);
  assert.equal(summary.year, new Date().getUTCFullYear());
  assert.equal(summary.total, 0);
  assert.ok(Date.now() - Date.parse(summary.generatedAt) < 5000);
  assert.equal((await app.mf.dispatchFetch(`https://board.test/api/users/${secondPerson.accounts[0]}/insights`)).status, 202);
  const months = new Date().getUTCMonth() + 1;
  assert.equal(app.insightQueries.length, firstPerson.accounts.length * months);

  await app.refreshed();
  const next = await app.mf.dispatchFetch(`https://board.test/api/users/${secondPerson.accounts[0]}/insights`);
  assert.equal(next.status, 200);
  assert.deepEqual((await next.json() as PrInsights).accounts, secondPerson.accounts);
  assert.equal(app.insightQueries.length, (firstPerson.accounts.length + secondPerson.accounts.length) * months);
  assert.deepEqual(await (await app.mf.dispatchFetch(url)).json(), summary);
});

test("insights and board failures leave the other refresh and next alarm intact", async (t) => {
  const app = await setup(t, { webhook: false });
  app.setMode("insights-error");
  const first = await app.refreshed();
  assert.equal(first.values["board-snapshot"]?.board.length, PEOPLE.length);
  assertNextRun(first);
  assert.equal((await app.mf.dispatchFetch(`https://board.test/api/users/${PEOPLE[0].accounts[0]}/insights`)).status, 202);
  assert.ok(app.insightQueries.length > 0);
  assert.ok(app.insightQueries.every((query) => query.startsWith(`author:${PEOPLE[0].accounts[0]} `)));

  // The failed person is cooling down; the next person can still be collected.
  app.setMode("board-error");
  const second = await app.refreshed();
  assert.deepEqual(second.values["board-snapshot"], first.values["board-snapshot"]);
  assertNextRun(second);
  const response = await app.mf.dispatchFetch(`https://board.test/api/users/${PEOPLE[1].accounts[0]}/insights`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as PrInsights).accounts, PEOPLE[1].accounts);
});
