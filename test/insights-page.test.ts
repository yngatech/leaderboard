import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { githubToken } from "../worker/github-app.ts";
import { INSIGHTS_SCHEMA_VERSION, storedInsights, refreshInsights, type InsightsStorage } from "../worker/insights-storage.ts";
import { aggregateInsights } from "../worker/insights.ts";
import { SerialTaskQueue } from "../worker/notifications.ts";
import { userPageHtml } from "../worker/views/pages.ts";

// index.ts imports workerd bindings and Vite assets. Execute its actual handlers and
// DO methods with synthetic dependencies, retaining the real storage helpers/renderer.
const source = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
function handler(name: string, bindings: Record<string, unknown>) {
  const body = source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`))![0];
  return new Function(...Object.keys(bindings), `${stripTypeScriptTypes(body)}\nreturn ${name};`)(...Object.values(bindings));
}
const userInsights = handler("userInsights", {
  currentYear: () => 2026,
  leaderState: (env: { LEADER_STATE: { getByName: (name: string) => unknown } }) => env.LEADER_STATE.getByName("leaderboard"),
});
const methods = ["insightsSummary", "refreshInsights"].map((name) =>
  source.match(new RegExp(`  async ${name}\\([\\s\\S]*?\\n  \\}`))![0]).join("\n");
const TestLeaderState = new Function("storedInsights", "refreshInsights", "SerialTaskQueue", "githubToken", `return (${stripTypeScriptTypes(`
  class TestLeaderState {
    private readonly insightsUpdates = new SerialTaskQueue();
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    ${methods}
  }
`)})`)(storedInsights, refreshInsights, SerialTaskQueue, githubToken);

test("DO errors, missing and malformed summaries preserve the profile and return pending JSON", async (t) => {
  t.mock.method(console, "error", () => {});
  let failure: "none" | "rpc" | "storage" | "shape" | "version" | "missing" | "binding" = "none";
  const user = {
    login: "example-user", name: "Example Developer", avatarUrl: "https://example.test/avatar.png", url: "https://github.com/example-user",
    followers: 0, following: 0, total: 1, byYear: { "2026": 1 }, createdAt: "2026-01-01T00:00:00Z",
  };
  const summary = aggregateInsights(user.login, [user.login], 2026, [], "2026-03-01T00:00:00Z");
  const state = new TestLeaderState({ storage: {
    get: async () => {
      if (failure === "storage") throw new Error("synthetic storage outage");
      if (failure === "missing") return undefined;
      return { schemaVersion: failure === "version" ? INSIGHTS_SCHEMA_VERSION - 1 : INSIGHTS_SCHEMA_VERSION, summary: failure === "shape" ? { total: 10 } : summary };
    },
  } }, {});
  const env = { LEADER_STATE: { getByName: (name: string) => {
    assert.equal(name, "leaderboard");
    if (failure === "rpc") return { insightsSummary: async () => { throw new Error("synthetic DO outage"); } };
    return state;
  } } };
  const bindings = {
    HTML_CACHE_PREFIX: "https://example.test/page/", currentYear: () => 2026,
    renderedPageHit: async () => undefined,
    boardJson: async () => ({ response: Response.json([{ ...user, totalContributions: 1, weeks: [{ days: [{ date: "2026-03-01", count: 1, level: 1 }] }] }]), cache: "HIT" }),
    allTimeJson: async () => ({ response: Response.json({ users: [user], years: [2026] }), cache: "HIT" }),
    breakdownJson: async () => Response.json({ login: user.login, accounts: [user.login], window: { kind: "year", year: 2026, from: "2026-01-01", to: "2026-12-31" }, calendarTotal: 1, kinds: [], private: 1, other: 0, generatedAt: summary.generatedAt }),
    yearWindow: () => ({}), userInsights,
    userPageHtml, siteChrome: () => ({ thisYear: 2026, stylesUrl: "/assets/styles.css", enhanceUrl: "/assets/enhance.js", buildSha: "example" }),
    todayIso: () => "2026-03-01", html: (body: string, init: ResponseInit) => new Response(String(body), init),
    LIVE_TTL_SECONDS: 60, pageLinks: () => "", renderedState: () => "HIT", cacheRenderedPage: () => {},
    breakdownBrowserResponse: (response: Response) => response,
  };
  const page = handler("handleUserPage", bindings);
  const api = handler("handleInsightsApi", {
    userInsights, rosterLogin: (login: string) => login.toLowerCase() === user.login ? user.login : undefined,
    json: Response.json, __IS_PREVIEW_BUILD__: false,
  });
  const url = new URL(`https://example.test/api/users/${user.login}/insights`);
  assert.ok((await (await page(user.login, env, {})).text()).includes('id="pr-insights"'));
  const populated = await api(user.login, url, true, env);
  assert.equal(populated.status, 200);
  assert.deepEqual(await populated.json(), summary);
  for (const mode of ["rpc", "storage", "shape", "version", "missing", "binding"] as const) {
    failure = mode;
    const currentEnv = mode === "binding" ? {} : env;
    const response: Response = await page(user.login, currentEnv, {});
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes("Example Developer"));
    assert.ok(body.includes('aria-label="example-user made 1 contributions in 2026"'));
    assert.ok(!body.includes('id="pr-insights"'));
    const pending = await api(user.login, url, true, currentEnv);
    assert.equal(pending.status, 202);
    assert.deepEqual(await pending.json(), { login: user.login, status: "pending" });
    assert.equal(pending.headers.get("Cache-Control"), "no-store");
  }
});

test("overlapping DO cron refreshes serialize and collect different people", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-10T12:00:00Z") });
  const entries = new Map<string, unknown>();
  const storage: InsightsStorage = {
    get: async <T>(key: string) => entries.get(key) as T | undefined,
    put: async (key, value) => { entries.set(key, value); },
  };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    await Promise.resolve();
    return Response.json({ data: { search: { nodes: [], issueCount: 0, pageInfo: { hasNextPage: false } } } });
  });
  const state = new TestLeaderState({ storage }, { GITHUB_TOKEN: "synthetic-token" });
  await Promise.all([state.refreshInsights(), state.refreshInsights()]);
  assert.equal([...entries.keys()].filter((key) => key.startsWith("insights:")).length, 2);
  const summaries = [...entries.entries()].filter(([key]) => key.startsWith("insights:")).map(([, record]) => (record as { summary: { accounts: string[] } }).summary);
  // One monthly query per account, with no duplicate collection of the first person.
  assert.equal(calls, summaries.reduce((sum, summary) => sum + summary.accounts.length, 0));
});
