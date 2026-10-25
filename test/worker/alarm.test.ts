import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { Log, LogLevel, Miniflare, type Request as MiniflareRequest } from "miniflare";
import type { BoardSnapshot } from "../../worker/board-snapshot.ts";
import { PEOPLE } from "../../worker/github.ts";
import type { StandingState } from "../../worker/notifications.ts";
import viteConfig from "../../vite.config.ts";

const buildRoot = fileURLToPath(new URL("../../dist/leaderboard/", import.meta.url));
const bundle = await readFile(`${buildRoot}index.js`, "utf8");
const localPreviewBundle = await readFile(
  new URL("../../dist/alarm-local-preview/leaderboard/index.js", import.meta.url),
  "utf8",
);
const config = JSON.parse(await readFile(`${buildRoot}wrangler.json`, "utf8"));
const interval = 10 * 60 * 1000;
const year = new Date().getUTCFullYear();
const logins = PEOPLE.flatMap((person) => person.accounts);

// Only this test subclass exposes storage controls; the real alarm and RPC
// methods run unchanged in workerd against SQLite storage and fake upstreams.
const driver = `
import worker, { LeaderState } from "./index.js";
export class TestLeaderState extends LeaderState {
  completed = 0;
  async alarm() {
    await super.alarm();
    this.completed++;
  }
  async fetch(request) {
    const action = new URL(request.url).pathname;
    if (action === "/wake") await this.ctx.storage.setAlarm(Date.now());
    if (action === "/stop") await this.ctx.storage.deleteAlarm();
    if (action === "/snapshot") await this.boardSnapshot(new Date().getUTCFullYear());
    return Response.json({
      completed: this.completed,
      alarm: await this.ctx.storage.getAlarm(),
      values: Object.fromEntries(await this.ctx.storage.list()),
    });
  }
}
export default worker;
`;

interface State {
  completed: number;
  alarm: number | null;
  values: { "board-snapshot"?: BoardSnapshot; leader?: StandingState } & Record<string, unknown>;
}

async function setup(
  t: TestContext,
  options: { credentials?: boolean; webhook?: boolean; localPreview?: boolean } = {},
) {
  let mode: "ok" | "github-error" | "partial" | "discord-error" = "ok";
  let leadingCount = 10;
  let queries = 0;
  let attempts = 0;
  const posts: unknown[] = [];
  const mf = new Miniflare({
    name: "alarm-test",
    modulesRoot: buildRoot,
    modules: [
      { type: "ESModule", path: `${buildRoot}alarm-test.js`, contents: driver },
      {
        type: "ESModule", path: `${buildRoot}index.js`,
        contents: options.localPreview ? localPreviewBundle : bundle,
      },
    ],
    compatibilityDate: config.compatibility_date,
    durableObjects: { LEADER_STATE: { className: "TestLeaderState", useSQLite: true } },
    bindings: {
      ...(options.credentials !== false ? { GITHUB_TOKEN: "synthetic-test-token" } : {}),
      ...(options.webhook !== false ? { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" } : {}),
    },
    log: new Log(LogLevel.NONE),
    outboundService: async (request: MiniflareRequest) => {
      const url = new URL(request.url);
      if (url.hostname === "discord.example") {
        attempts++;
        if (mode === "discord-error") return new Response("unavailable", { status: 503 });
        posts.push(await request.json());
        return new Response(null, { status: 204 });
      }
      if (url.href === "https://api.github.com/graphql") {
        queries++;
        if (mode === "github-error") return new Response("unavailable", { status: 503 });
        return Response.json({ data: Object.fromEntries(logins.map((login, i) => [
          `u${i}`,
          mode === "partial" && i === 0 ? null : {
            login,
            name: "Test contributor",
            url: `https://github.com/${login}`,
            avatarUrl: "https://avatars.example/contributor.png",
            // Yesterday's anniversary avoids cake-day messages in the baseline.
            createdAt: new Date(Date.now() - 86400000).toISOString().replace(/^\d{4}/, "2020"),
            followers: { totalCount: 0 },
            following: { totalCount: 0 },
          },
        ])) });
      }
      assert.equal(url.hostname, "github.com");
      assert.match(url.pathname, /^\/users\/[^/]+\/contributions$/);
      const count = url.pathname.includes(`/users/${logins[0]}/`) ? leadingCount : 10;
      const date = `${url.searchParams.get("from")!.slice(0, 4)}-01-01`;
      return new Response(`<h2 id="js-contribution-activity-description">${count} contributions in ${year}</h2>
        <td data-date="${date}" data-level="1" id="contribution-day-component-0-0"></td>
        <tool-tip for="contribution-day-component-0-0">${count} contributions on January 1.</tool-tip>`);
    },
  });
  t.after(() => mf.dispose());
  const namespace = await mf.getDurableObjectNamespace("LEADER_STATE");
  const stub = namespace.getByName("leaderboard");
  async function state(action = "status"): Promise<State> {
    const response = await stub.fetch(`https://alarm.test/${action}`);
    return await response.json() as State;
  }
  async function until(predicate: (current: State) => boolean): Promise<State> {
    const deadline = Date.now() + 5000;
    do {
      const current = await state();
      if (predicate(current)) return current;
      await setTimeout(20);
    } while (Date.now() < deadline);
    assert.fail("alarm did not reach the expected state within five seconds");
  }
  async function refreshed(): Promise<State> {
    const previous = await state();
    await state("wake");
    return until((current) => current.completed > previous.completed);
  }
  return {
    mf, state, until, refreshed, posts,
    setMode: (next: typeof mode) => { mode = next; },
    setCount: (count: number) => { leadingCount = count; },
    queries: () => queries,
    attempts: () => attempts,
  };
}

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
  assert.equal((await app.state()).values.leader?.order[0], logins[0]);
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
