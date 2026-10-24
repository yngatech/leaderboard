import assert from "node:assert/strict";
import test from "node:test";
import { aggregateInsights, agentEvidence, classifyIntent, excludedPath, type InsightPullRequest } from "../worker/insights.ts";
import { fetchInsights, insightMonths } from "../worker/insights-fetch.ts";
import { cachedInsights, refreshInsights, type InsightsCache } from "../worker/insights-cache.ts";

function pr(overrides: Partial<InsightPullRequest> = {}): InsightPullRequest {
  return {
    id: "pr-1", title: "Update widget", url: "https://github.com/example/widgets/pull/1", headRefName: "topic/widget", createdAt: "2026-02-03T12:00:00Z", mergedAt: null, state: "OPEN",
    additions: 20, deletions: 10, changedFiles: 1, body: "", author: { login: "example-user" }, repository: { nameWithOwner: "example/widgets", isPrivate: false },
    files: { nodes: [{ path: "src/widget.ts", additions: 20, deletions: 10 }], pageInfo: { hasNextPage: false } },
    commits: { totalCount: 1, nodes: [{ commit: { message: "Update widget", authors: { totalCount: 1, nodes: [{ name: "Example Developer", email: "developer@example.test", user: { login: "example-user" } }] } } }] },
    ...overrides,
  };
}
function summarize(prs: InsightPullRequest[]) {
  return aggregateInsights("example-user", ["example-user", "example-alt"], 2026, prs, "2026-03-01T00:00:00Z");
}

test("adjusted sizes exclude lockfiles, generated paths and snapshots, keeping similarly named source", () => {
  for (const path of ["package-lock.json", "nested/yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "go.sum", "uv.lock", "poetry.lock", "bun.lock", "a/dist/main.js", "build/a", "vendor/a", "generated/a", "node_modules/a", "app.min.js", "app.js.map", "__snapshots__/a", "widget.snap"]) assert.ok(excludedPath(path), path);
  for (const path of ["src/build.ts", "src/vendor-helper.ts", "distribution/a", "package.json", "src/map.ts"]) assert.ok(!excludedPath(path), path);
  const data = summarize([pr({ changedFiles: 3, files: { nodes: [
    { path: "src/widget.ts", additions: 10, deletions: 70 },
    { path: "dist/widget.js", additions: 9000, deletions: 0 },
    { path: "package-lock.json", additions: 8000, deletions: 0 },
  ], pageInfo: { hasNextPage: false } } })]);
  assert.equal(data.size.median, 80);
  assert.deepEqual(data.size.biggestNetDeletion, { lines: 60, url: pr().url });
});

test("size boundaries, even medians, small share, and incomplete file lists have honest denominators", () => {
  const prs = [0, 9, 10, 99, 100, 499, 500, 999, 1000, 1001].map((size, i) => pr({ id: String(i), files: { nodes: [{ path: "a.ts", additions: size, deletions: 0 }], pageInfo: { hasNextPage: false } } }));
  const data = summarize([...prs, pr({ id: "missing", files: null }), pr({ id: "truncated", changedFiles: 101 }), pr({ id: "next", files: { ...pr().files!, pageInfo: { hasNextPage: true } } })]);
  assert.equal(data.total, 13);
  assert.equal(data.size.measured, 10);
  assert.equal(data.size.incomplete, 3);
  assert.equal(data.size.median, 299.5);
  assert.equal(data.size.smallShare, 0.4);
  assert.deepEqual(data.size.buckets.map((b) => b.count), [2, 2, 2, 2, 2]);
  assert.equal(data.size.biggestNetDeletion, null);
});

test("merge accounts and dedupe PR IDs; exclude private, other-author and other-year PRs", () => {
  const data = summarize([pr(), pr(), pr({ id: "alt", author: { login: "EXAMPLE-ALT" } }), pr({ id: "private", repository: { nameWithOwner: "example/private", isPrivate: true } }), pr({ id: "old", createdAt: "2025-01-01T00:00:00Z" }), pr({ id: "other", author: { login: "someone-else" } })]);
  assert.equal(data.total, 2);
  assert.equal(data.intent.mix.unknown, 2);
  assert.equal(summarize([]).size.median, null);
  assert.equal(summarize([]).agents.share, null);
});

test("intent precedence, scoped areas, tags, branch prefixes and complete exclusive paths", () => {
  assert.equal(classifyIntent(pr({ title: "FIX(engine)!: repair widget", headRefName: "feat/widget" })).intent, "fix");
  assert.equal(classifyIntent(pr({ title: "[deps] update packages" })).intent, "deps");
  assert.deepEqual(classifyIntent(pr({ title: "board: add widget", headRefName: "fix/widget" })), { intent: "fix", source: "branch" });
  assert.equal(classifyIntent(pr({ title: "[web] new screen" })).intent, "unknown");
  assert.equal(classifyIntent(pr({ title: "board: update widget" })).intent, "unknown");
  for (const [path, intent] of [["README.md", "docs"], ["docs/a.md", "docs"], ["src/a.test.ts", "test"], ["package-lock.json", "deps"], [".github/workflows/test.yml", "ci"]]) {
    const input = pr({ files: { nodes: [{ path, additions: 1, deletions: 0 }], pageInfo: { hasNextPage: false } } });
    assert.equal(classifyIntent(input).intent, intent);
    assert.equal(classifyIntent({ ...input, changedFiles: 101 }).intent, "unknown");
  }
  assert.equal(classifyIntent(pr({ changedFiles: 0, files: { nodes: [], pageInfo: { hasNextPage: false } } })).intent, "unknown");
});

test("common intent scopes share categories without interpreting subsystem names", () => {
  const groups = {
    docs: ["docs", "doc", "documentation", "readme"], test: ["test", "tests", "e2e"],
    deps: ["deps", "dependencies", "dependabot", "renovate"],
    ci: ["ci", "workflows", "actions", "github-actions", "build", "bundle", "tooling"],
    chore: ["release", "chore"], perf: ["perf"], fix: ["fix"], feat: ["feat"],
  };
  const rows: InsightPullRequest[] = [];
  for (const [intent, aliases] of Object.entries(groups)) for (const alias of aliases) {
    for (const title of [`${alias}: update widget`, `${alias}(board)!: update widget`, `[${alias}] update widget`]) {
      assert.deepEqual(classifyIntent(pr({ title, headRefName: "refactor/widget" })), { intent, source: "title" }, title);
    }
    assert.deepEqual(classifyIntent(pr({ headRefName: `${alias}/widget` })), { intent, source: "branch" });
    rows.push(pr({ id: alias, title: `${alias}: update widget` }));
  }
  for (const scope of ["board", "api", "generate", "codex-terminal", "makefile", "readme-badge", "neqmac, nitmac, docs"]) {
    assert.deepEqual(classifyIntent(pr({ title: `${scope}: update widget` })), { intent: "unknown", source: "unknown" });
  }
  assert.equal(classifyIntent(pr({ title: "board: update widget", headRefName: "fix-widget" })).intent, "fix");
  const { mix } = summarize(rows).intent;
  assert.equal(mix.ci, groups.ci.length);
  assert.equal(mix.deps, groups.deps.length);
  assert.ok(!("build" in mix));
  assert.equal(Object.values(mix).reduce((n, count) => n + count, 0), rows.length);
});

test("attribution preserves body vs trailers and counts each PR/agent once despite repeated trailers", () => {
  const input = pr({ body: "Description\n\n---\nWritten by an agent (Codex, example-model).", commits: { totalCount: 1, nodes: [{ commit: { message: "Update widget\n\nCo-authored-by: Claude (Example Model) <noreply@anthropic.com>\nCo-Authored-By: Claude <noreply@anthropic.com>", authors: { totalCount: 1, nodes: [{ name: "Claude", email: "noreply@anthropic.com", user: null }] } } }] } });
  assert.deepEqual(agentEvidence(input), { bodyFooter: ["Codex"], commitTrailer: ["Claude"], commitAuthor: ["Claude"], prAuthor: [] });
  const data = summarize([input]);
  assert.equal(data.agents.attributed, 1);
  assert.equal(data.agents.share, 1);
  assert.deepEqual(data.agents.agents, [{ name: "Claude", count: 1 }, { name: "Codex", count: 1 }]);
  assert.ok(!JSON.stringify(data).includes("noreply@"));
  assert.ok(!JSON.stringify(data).includes("example-model"));
});

test("agent identities, generated-with links, generic disclosures and bounded commit evidence", () => {
  assert.deepEqual(agentEvidence(pr({ body: "🤖 Generated with [Claude Code](https://example.test/tool)" })).bodyFooter, ["Claude"]);
  assert.deepEqual(agentEvidence(pr({ body: "Written by an agent (Example Client, example-model)." })).bodyFooter, ["Other agent"]);
  for (const [login, agent] of [["copilot-swe-agent[bot]", "Copilot"], ["chatgpt-codex-connector[bot]", "Codex"], ["devin-ai-integration[bot]", "Devin"], ["google-labs-jules[bot]", "Jules"]]) assert.deepEqual(agentEvidence(pr({ author: { login } })).prAuthor, [agent]);
  const input = pr();
  input.commits.totalCount = 51;
  input.commits.nodes[0].commit.authors.totalCount = 6;
  assert.equal(summarize([input]).agents.incompleteCommits, 1);
});

test("ordinary agent mentions, quoted/fenced examples and dependency bots are not attribution", () => {
  const body = "Discuss Claude Code and Codex.\n> Generated with Claude Code\n\n```text\nWritten by an agent (Codex, example).\n```\n\n    Generated with Claude Code";
  assert.deepEqual(agentEvidence(pr({ body })).bodyFooter, []);
  for (const login of ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"]) assert.deepEqual(agentEvidence(pr({ author: { login } })).prAuthor, []);
  const input = pr();
  input.commits.nodes[0].commit.message = "Document trailers\n\n```text\nCo-authored-by: Codex <noreply@openai.com>\n```";
  assert.deepEqual(agentEvidence(input).commitTrailer, []);
});

test("month windows include leap days and exclude future months", () => {
  assert.deepEqual(insightMonths(new Date("2024-03-02T10:00:00Z")), [
    { from: "2024-01-01", to: "2024-01-31" }, { from: "2024-02-01", to: "2024-02-29" }, { from: "2024-03-01", to: "2024-03-02" },
  ]);
});

function searchResponse(nodes: InsightPullRequest[], issueCount = nodes.length, hasNextPage = false, endCursor: string | null = null) {
  return Response.json({ data: { search: { nodes, issueCount, pageInfo: { hasNextPage, endCursor } } } });
}

test("collector paginates and splits capped windows without dropping fork PRs or merging account medians", async (t) => {
  const queries: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const { variables } = JSON.parse(String(init.body));
    queries.push(variables.q);
    if (variables.q.includes("01-01..2026-01-31")) return searchResponse([], 1001);
    if (variables.q.includes("01-01..2026-01-16")) {
      return variables.after ? searchResponse([pr({ id: "second", createdAt: "2026-01-03T00:00:00Z" })], 2) : searchResponse([pr({ createdAt: "2026-01-02T00:00:00Z" })], 2, true, "cursor");
    }
    return searchResponse([]);
  });
  const data = await fetchInsights("synthetic-token", "example-user", ["example-user"], new Date("2026-01-31T10:00:00Z"));
  assert.equal(data.total, 2);
  assert.equal(queries.length, 4);
  assert.ok(queries.every((q) => q.includes("is:public") && !q.includes("fork:false")));
});

test("collector refuses silently truncated or errored search results", async (t) => {
  t.mock.method(globalThis, "fetch", async () => searchResponse([pr()], 2));
  await assert.rejects(fetchInsights("synthetic-token", "example-user", ["example-user"], new Date("2026-01-31T00:00:00Z")), /coverage/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: { search: null }, errors: [{ message: "partial result" }] }));
  await assert.rejects(fetchInsights("synthetic-token", "example-user", ["example-user"], new Date("2026-01-31T00:00:00Z")), /complete/);
});

test("cache miss does no network work; cron stores only one summary and skips fresh people", async (t) => {
  const entries = new Map<string, Response>();
  const cache: InsightsCache = { match: async (key) => entries.get(key.url)?.clone(), put: async (key, response) => { entries.set(key.url, response.clone()); } };
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests += 1; return searchResponse([]); });
  const now = new Date("2026-01-10T12:00:00Z");
  assert.equal(await cachedInsights(cache, "example-user", now), null);
  assert.equal(requests, 0);
  await refreshInsights(cache, "synthetic-token", now);
  assert.equal(requests, 1);
  assert.equal([...entries.keys()].filter((key) => !key.includes("/attempt/")).length, 1);
  await refreshInsights(cache, "synthetic-token", now);
  // Second roster person combines two accounts.
  assert.equal(requests, 3);
  assert.equal([...entries.keys()].filter((key) => !key.includes("/attempt/")).length, 2);
});

test("a failed cron attempt preserves cached data and lets the next person refresh", async (t) => {
  const entries = new Map<string, Response>();
  const cache: InsightsCache = { match: async (key) => entries.get(key.url)?.clone(), put: async (key, response) => { entries.set(key.url, response.clone()); } };
  const now = new Date("2026-01-10T12:00:00Z");
  t.mock.method(globalThis, "fetch", async () => searchResponse([]));
  await refreshInsights(cache, "synthetic-token", now);
  const storedKey = [...entries.keys()].find((key) => !key.includes("/attempt/"))!;
  const original = await entries.get(storedKey)!.clone().text();
  // Simulate an expired cooldown while leaving the last summary available.
  for (const key of entries.keys()) if (key.includes("/attempt/")) entries.delete(key);
  t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "unavailable" }] }));
  await assert.rejects(refreshInsights(cache, "synthetic-token", new Date("2026-01-12T12:00:00Z")));
  assert.equal(await entries.get(storedKey)!.clone().text(), original);
  t.mock.method(globalThis, "fetch", async () => searchResponse([]));
  await refreshInsights(cache, "synthetic-token", new Date("2026-01-12T12:05:00Z"));
  assert.equal([...entries.keys()].filter((key) => !key.includes("/attempt/")).length, 2);
});

test("secondary throttles back off for a minute before retrying; transient failures also retry", async (t) => {
  const { githubGraphql } = await import("../worker/github.ts");
  const { setImmediate } = await import("node:timers/promises");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1 ? Response.json({ message: "You have exceeded a secondary rate limit." }, { status: 403 }) : Response.json({ data: { ok: true } });
  });
  const pending = githubGraphql("synthetic-token", { query: "query { example }" }, true);
  await setImmediate();
  assert.equal(calls, 1);
  t.mock.timers.tick(59_999);
  await setImmediate();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, { data: { ok: true } });
  assert.equal(calls, 2);
  calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1 ? new Response("upstream unavailable", { status: 502 }) : Response.json({ data: { ok: true } });
  });
  const transient = githubGraphql("synthetic-token", {}, true);
  await setImmediate();
  t.mock.timers.tick(1000);
  assert.deepEqual(await transient, { data: { ok: true } });
});

test("panel suppresses tiny cohorts and tiny size subsets while keeping larger-cohort intent visible", async () => {
  const { insightsHtml } = await import("../worker/views/insights.ts");
  const rows = Array.from({ length: 10 }, (_, i) => pr({ id: String(i) }));
  const tiny = String(insightsHtml(summarize(rows.slice(0, 9))));
  assert.ok(!tiny.includes('<dl'));
  assert.ok(!tiny.includes('aria-label="Attributed agents"'));
  const mixed = summarize(rows.map((row, i) => i ? row : { ...row, files: null }));
  const rendered = String(insightsHtml(mixed));
  assert.ok(!rendered.includes('aria-label="PR size histogram"'));
  assert.ok(rendered.includes('10</strong>'));
  assert.ok(rendered.includes('aria-label="Attributed agents"'));
  assert.ok(String(insightsHtml(summarize(rows))).includes('aria-label="PR size histogram"'));
});

test("human names and lookalike emails are not agent identities in trailers or authors", () => {
  for (const name of ["Devin Example", "Claude Example", "Jules Example", "Devin", "Claude", "Jules", "Codex", "Cursor Agent", "Copilot"]) {
    for (const email of ["human@example.test", "noreply@anthropic.com.example.test", "noreply@openai.com.example.test", "cursoragent@cursor.com.example.test"]) {
      const input = pr();
      input.commits.nodes[0].commit = {
        message: `Update widget\n\nCo-authored-by: ${name} <${email}>`,
        authors: { totalCount: 1, nodes: [{ name, email, user: { login: "example-human" } }] },
      };
      assert.deepEqual(agentEvidence(input), { bodyFooter: [], commitTrailer: [], commitAuthor: [], prAuthor: [] }, `${name} <${email}>`);
    }
  }
});

test("trailers and commit authors share exact known email and GitHub bot identities", () => {
  for (const [name, email, agent] of [
    ["Claude (Example Model)", "noreply@anthropic.com", "Claude"],
    ["Codex", "noreply@openai.com", "Codex"],
    ["Cursor Agent", "cursoragent@cursor.com", "Cursor"],
    ["Cursor Agent", "12345+cursoragent@users.noreply.github.com", "Cursor"],
    ["Copilot", "copilot@github.com", "Copilot"],
    ["Copilot", "12345+Copilot@users.noreply.github.com", "Copilot"],
    ["Example bot", "12345+chatgpt-codex-connector[bot]@users.noreply.github.com", "Codex"],
  ]) {
    const input = pr();
    input.commits.nodes[0].commit = {
      message: `Update widget\n\nCo-authored-by: ${name} <${email}>`,
      authors: { totalCount: 1, nodes: [{ name, email, user: null }] },
    };
    const found = agentEvidence(input);
    assert.deepEqual(found.commitTrailer, [agent], email);
    assert.deepEqual(found.commitAuthor, [agent], email);
  }
  const input = pr();
  input.commits.nodes[0].commit.authors.nodes[0] = { name: null, email: null, user: { login: "google-labs-jules[bot]" } };
  assert.deepEqual(agentEvidence(input).commitAuthor, ["Jules"]);
});

test("disclosures recognize model families across clients without guessing from client alone", () => {
  for (const [marker, agents] of [
    ["Written by an agent (Claude Code, claude-opus-example).", ["Claude"]],
    ["Written by an agent (Codex, gpt-6-example).", ["Codex"]],
    ["Written by an agent (styal, gpt-6-example).", ["Codex"]],
    ["Written by an agent (T3 Code, gpt-6-example).", ["Codex"]],
    ["Written by an agent (styal, claude-sonnet-example).", ["Claude"]],
    ["Written by an agent (OpenCode, claude-opus-example).", ["Claude", "OpenCode"]],
    ["Written by an agent (Example Client, example-model).", ["Other agent"]],
    ["Written by an agent (styal).", ["Other agent"]],
  ] as const) assert.deepEqual(agentEvidence(pr({ body: marker })).bodyFooter, agents);
});

test("inherited object keys stay unknown and never corrupt aggregation", () => {
  for (const key of ["constructor", "__proto__"]) {
    for (const overrides of [{ title: `${key}: handle missing argument` }, { title: `[${key}] update widget` }, { headRefName: `${key}/repair` }]) {
      const input = pr(overrides);
      assert.equal(classifyIntent(input).intent, "unknown");
      const summary = summarize([input]);
      assert.equal(summary.intent.mix.unknown, 1);
      assert.equal(Object.values(summary.intent.mix).reduce((n, count) => n + count, 0), summary.total);
    }
    const input = pr({ author: { login: key }, body: "Written by an agent (Codex, example-model)." });
    input.commits.nodes[0].commit.authors.nodes[0].user = { login: key };
    assert.deepEqual(agentEvidence(input), { bodyFooter: ["Codex"], commitAuthor: [], commitTrailer: [], prAuthor: [] });
    const summary = aggregateInsights(key, [key], 2026, [input], "2026-03-01T00:00:00Z");
    assert.deepEqual(summary.agents.agents, [{ name: "Codex", count: 1 }]);
  }
});

test("optional cache reads reject malformed shapes and isolate lookup/decode failures", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const now = new Date("2026-03-01T00:00:00Z");
  const valid = summarize([pr()]);
  const read = (value: unknown) => cachedInsights({ match: async () => Response.json(value), put: async () => {} }, "example-user", now);
  assert.deepEqual(await read(valid), valid);
  assert.deepEqual(await read(summarize([])), summarize([]));
  for (const value of [null, {}, { ...valid, accounts: null }, { ...valid, login: "other-user" }, { ...valid, year: 2025 },
    { ...valid, generatedAt: "invalid" }, { ...valid, total: -1 }, { ...valid, size: { ...valid.size, median: null } },
    { ...valid, size: { ...valid.size, buckets: [] } }, { ...valid, intent: { ...valid.intent, mix: { constructor: 1 } } },
    { ...valid, agents: { ...valid.agents, agents: [{ name: {}, count: 1 }] } },
    { ...valid, agents: { ...valid.agents, evidence: null } },
    { ...valid, size: { ...valid.size, biggestNetDeletion: { url: "javascript:alert(1)", lines: 1 } } },
  ]) assert.equal(await read(value), null);
  assert.equal(await cachedInsights({ match: async () => new Response("{"), put: async () => {} }, "example-user", now), null);
  assert.equal(await cachedInsights({ match: async () => { throw new Error("synthetic outage"); }, put: async () => {} }, "example-user", now), null);
  assert.equal(logged.mock.callCount(), 15);
});
