import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { cachedInsights } from "../worker/insights-cache.ts";
import { aggregateInsights } from "../worker/insights.ts";
import { userPageHtml } from "../worker/views/pages.ts";

// index.ts imports workerd bindings and Vite assets. Execute its actual handler with
// synthetic feed/cache dependencies, retaining the real insights reader and renderer.
const source = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8")
  .match(/async function handleUserPage\([\s\S]*?\n\}/)![0];

test("a failed insights cache lookup still renders the ordinary profile without the panel", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  let failure: "none" | "lookup" | "json" | "shape" = "none";
  const user = {
    login: "example-user", name: "Example Developer", avatarUrl: "https://example.test/avatar.png", url: "https://github.com/example-user",
    followers: 0, following: 0, total: 1, byYear: { "2026": 1 }, createdAt: "2026-01-01T00:00:00Z",
  };
  const summary = aggregateInsights(user.login, [user.login], 2026, [], "2026-03-01T00:00:00Z");
  const bindings = {
    HTML_CACHE_PREFIX: "https://example.test/page/", currentYear: () => 2026,
    renderedPageHit: async () => undefined,
    boardJson: async () => ({ response: Response.json([{ ...user, totalContributions: 1, weeks: [{ days: [{ date: "2026-03-01", count: 1, level: 1 }] }] }]), cache: "HIT" }),
    allTimeJson: async () => ({ response: Response.json({ users: [user], years: [2026] }), cache: "HIT" }),
    breakdownJson: async () => Response.json({ login: user.login, accounts: [user.login], window: { kind: "year", year: 2026, from: "2026-01-01", to: "2026-12-31" }, calendarTotal: 1, kinds: [], private: 1, other: 0, generatedAt: summary.generatedAt }),
    yearWindow: () => ({}),
    cachedInsights: (cache: Parameters<typeof cachedInsights>[0], login: string) => cachedInsights(cache, login, new Date("2026-03-01T00:00:00Z")),
    caches: { default: { match: async () => {
      if (failure === "lookup") throw new Error("synthetic insights outage");
      if (failure === "json") return new Response("{");
      return Response.json(failure === "shape" ? { total: 10 } : summary);
    } } },
    userPageHtml, siteChrome: () => ({ thisYear: 2026, stylesUrl: "/assets/styles.css", enhanceUrl: "/assets/enhance.js", buildSha: "example" }),
    todayIso: () => "2026-03-01", html: (body: string, init: ResponseInit) => new Response(String(body), init),
    LIVE_TTL_SECONDS: 60, pageLinks: () => "", renderedState: () => "HIT", cacheRenderedPage: () => {},
    breakdownBrowserResponse: (response: Response) => response,
  };
  const handler = new Function(...Object.keys(bindings), `${stripTypeScriptTypes(source)}\nreturn handleUserPage;`)(...Object.values(bindings));
  assert.ok((await (await handler(user.login, {}, {})).text()).includes('id="pr-insights"'));
  for (const mode of ["lookup", "json", "shape"] as const) {
    failure = mode;
    const response: Response = await handler(user.login, {}, {});
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes("Example Developer"));
    assert.ok(body.includes('aria-label="example-user made 1 contributions in 2026"'));
    assert.ok(!body.includes('id="pr-insights"'));
  }
  assert.equal(logged.mock.callCount(), 3);
});
