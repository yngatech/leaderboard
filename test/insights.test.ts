import assert from "node:assert/strict";
import test from "node:test";
import { aggregateInsights, agentEvidence, EVIDENCE_KINDS, classifyIntent, excludedPath, type InsightPullRequest } from "../worker/insights.ts";
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
  assert.deepEqual(agentEvidence(input), {
    providers: { bodyFooter: ["OpenAI"], commitTrailer: ["Anthropic"], commitAuthor: ["Anthropic"], prAuthor: [] },
    harnesses: { bodyFooter: ["Codex"], commitTrailer: ["Claude Code"], commitAuthor: ["Claude Code"], prAuthor: [] },
  });
  const data = summarize([input]);
  assert.equal(data.agents.attributed, 1);
  assert.equal(data.agents.share, 1);
  assert.deepEqual(data.agents.providers.map(({ name, count }) => ({ name, count })), [{ name: "Anthropic", count: 1 }, { name: "OpenAI", count: 1 }]);
  assert.deepEqual(data.agents.providers[0].evidence, { bodyFooter: 0, commitTrailer: 1, commitAuthor: 1, prAuthor: 0 });
  assert.deepEqual(data.agents.harnesses[1].evidence, { bodyFooter: 1, commitTrailer: 0, commitAuthor: 0, prAuthor: 0 });
  assert.ok(!JSON.stringify(data).includes("noreply@"));
  assert.ok(!JSON.stringify(data).includes("example-model"));
});

test("agent identities, generated-with links, generic disclosures and bounded commit evidence", () => {
  assert.deepEqual(agentEvidence(pr({ body: "🤖 Generated with [Claude Code](https://example.test/tool)" })).harnesses.bodyFooter, ["Claude Code"]);
  assert.deepEqual(agentEvidence(pr({ body: "Written by an agent (Example Client, example-model)." })).harnesses.bodyFooter, ["unknown harness"]);
  for (const [login, agent] of [["copilot-swe-agent[bot]", "Copilot"], ["chatgpt-codex-connector[bot]", "Codex"], ["devin-ai-integration[bot]", "Devin"], ["google-labs-jules[bot]", "Jules"]]) assert.deepEqual(agentEvidence(pr({ author: { login } })).harnesses.prAuthor, [agent]);
  const input = pr();
  input.commits.totalCount = 51;
  input.commits.nodes[0].commit.authors.totalCount = 6;
  assert.equal(summarize([input]).agents.incompleteCommits, 1);
});

test("ordinary agent mentions, quoted/fenced examples and dependency bots are not attribution", () => {
  const body = "Discuss Claude Code and Codex.\n> Generated with Claude Code\n\n```text\nWritten by an agent (Codex, example).\n```\n\n    Generated with Claude Code";
  assert.deepEqual(agentEvidence(pr({ body })).harnesses.bodyFooter, []);
  for (const login of ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"]) assert.deepEqual(agentEvidence(pr({ author: { login } })).harnesses.prAuthor, []);
  const input = pr();
  input.commits.nodes[0].commit.message = "Document trailers\n\n```text\nCo-authored-by: Codex <noreply@openai.com>\n```";
  assert.deepEqual(agentEvidence(input).harnesses.commitTrailer, []);
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
  assert.ok(!tiny.includes('aria-label="Model providers"'));
  const mixed = summarize(rows.map((row, i) => i ? row : { ...row, files: null }));
  const rendered = String(insightsHtml(mixed));
  assert.ok(!rendered.includes('aria-label="PR size histogram"'));
  assert.ok(rendered.includes('10</strong>'));
  assert.ok(!rendered.includes('aria-label="Model providers"'));
  assert.ok(String(insightsHtml(summarize(rows))).includes('aria-label="PR size histogram"'));
});

test("human names and lookalike emails are not agent identities in trailers or authors", () => {
  for (const name of ["Devin Example", "Claude Example", "Jules Example", "Devin", "Claude", "Jules", "Codex", "Cursor Agent", "Copilot", "aider (example-model)", "Amp"]) {
    for (const email of ["human@example.test", "noreply@anthropic.com.example.test", "noreply@openai.com.example.test", "cursoragent@cursor.com.example.test", "aider@aider.chat.example.test", "amp@ampcode.com.example.test", "aider@not-aider.chat", "amp@not-ampcode.com"]) {
      const input = pr();
      input.commits.nodes[0].commit = {
        message: `Update widget\n\nCo-authored-by: ${name} <${email}>`,
        authors: { totalCount: 1, nodes: [{ name, email, user: { login: "example-human" } }] },
      };
      assert.deepEqual(agentEvidence(input), { providers: { bodyFooter: [], commitTrailer: [], commitAuthor: [], prAuthor: [] }, harnesses: { bodyFooter: [], commitTrailer: [], commitAuthor: [], prAuthor: [] } }, `${name} <${email}>`);
    }
  }
});

test("trailers and commit authors share exact known email and GitHub bot identities", () => {
  for (const [name, email, agent] of [
    ["Claude (Example Model)", "noreply@anthropic.com", "Claude Code"],
    ["Codex", "noreply@openai.com", "Codex"],
    ["Cursor Agent", "cursoragent@cursor.com", "Cursor"],
    ["Cursor Agent", "12345+cursoragent@users.noreply.github.com", "Cursor"],
    ["Copilot", "copilot@github.com", "Copilot"],
    ["Copilot", "12345+Copilot@users.noreply.github.com", "Copilot"],
    ["aider (example-model)", "aider@aider.chat", "Aider"],
    ["Amp", "amp@ampcode.com", "Amp"],
    ["Example bot", "12345+chatgpt-codex-connector[bot]@users.noreply.github.com", "Codex"],
  ]) {
    const input = pr();
    input.commits.nodes[0].commit = {
      message: `Update widget\n\nCo-authored-by: ${name} <${email}>`,
      authors: { totalCount: 1, nodes: [{ name, email, user: null }] },
    };
    const found = agentEvidence(input);
    assert.deepEqual(found.harnesses.commitTrailer, [agent], email);
    assert.deepEqual(found.harnesses.commitAuthor, [agent], email);
  }
  const input = pr();
  input.commits.nodes[0].commit.authors.nodes[0] = { name: null, email: null, user: { login: "google-labs-jules[bot]" } };
  assert.deepEqual(agentEvidence(input).harnesses.commitAuthor, ["Jules"]);
});

test("disclosures separate model providers from client harnesses, including multi-agent markers", () => {
  for (const [fields, providers, harnesses] of [
    ["Claude Code, claude-opus-x", ["Anthropic"], ["Claude Code"]],
    ["Codex, gpt-6-example", ["OpenAI"], ["Codex"]],
    ["styal, gpt-6.1-sol", ["OpenAI"], ["styal"]],
    ["T3 Code, claude-opus-x", ["Anthropic"], ["T3 Code"]],
    ["OpenCode, claude-opus-x", ["Anthropic"], ["OpenCode"]],
    ["Codex, claude-opus-x", ["Anthropic"], ["Codex"]],
    ["Claude Code, claude-opus-x; Codex, gpt-6.1-sol", ["Anthropic", "OpenAI"], ["Claude Code", "Codex"]],
    ["Example Client, example-model", ["unknown model"], ["unknown harness"]],
    ["styal", ["unknown model"], ["styal"]],
    ["claude-opus-x", ["Anthropic"], ["unknown harness"]],
    ["Claude Code", ["Anthropic"], ["Claude Code"]],
    ["Codex", ["OpenAI"], ["Codex"]],
    ["Gemini CLI", ["Google"], ["Gemini CLI"]],
    ["Jules", ["Google"], ["Jules"]],
  ] as const) {
    const found = agentEvidence(pr({ body: `Written by an agent (${fields}).` }));
    assert.deepEqual(found.providers.bodyFooter, providers, fields);
    assert.deepEqual(found.harnesses.bodyFooter, harnesses, fields);
  }
  const found = agentEvidence(pr({ body: "Written by an agent (styal, gpt-6-example); revised by an agent (Claude Code, claude-opus-x)." }));
  assert.deepEqual(found.providers.bodyFooter, ["Anthropic", "OpenAI"]);
  assert.deepEqual(found.harnesses.bodyFooter, ["Claude Code", "styal"]);
});

test("model ids identify additional vendors without guessing a harness", () => {
  for (const [model, provider] of [
    ["claude-opus-4-6", "Anthropic"], ["claude-fable-5", "Anthropic"], ["gpt-6.1-sol", "OpenAI"], ["o3-mini", "OpenAI"], ["codex-mini-latest", "OpenAI"],
    ["gemini-2.5-pro", "Google"], ["grok-4", "xAI"], ["grok-code-fast-1", "xAI"],
    ["mistral-large-latest", "Mistral"], ["codestral-2508", "Mistral"], ["devstral-small-2507", "Mistral"],
    ["deepseek-r1", "DeepSeek"], ["opencode/deepseek-v4-flash-free", "DeepSeek"], ["anthropic/claude-opus-x", "Anthropic"], ["deepseek-v3.2", "DeepSeek"], ["kimi-k2.5", "Moonshot/Kimi"],
    ["moonshot-v1-128k", "Moonshot/Kimi"], ["qwen3-coder", "Qwen/Alibaba"], ["qwen-max", "Qwen/Alibaba"],
    ["glm-4.6", "Zhipu/GLM"], ["llama-3.3-70b-instruct", "Meta"],
  ]) {
    const found = agentEvidence(pr({ body: `Written by an agent (Example Client, ${model}).` }));
    assert.deepEqual(found.providers.bodyFooter, [provider], model);
    assert.deepEqual(found.harnesses.bodyFooter, ["unknown harness"], model);
  }
  for (const harness of ["Copilot", "Cursor", "OpenCode", "Devin", "Aider", "Amp", "T3 Code", "styal"]) {
    const found = agentEvidence(pr({ body: `Written by an agent (${harness}).` }));
    assert.deepEqual(found.providers.bodyFooter, ["unknown model"]);
    assert.deepEqual(found.harnesses.bodyFooter, [harness]);
  }
  const bot = agentEvidence(pr({ author: { login: "copilot-swe-agent[bot]" } }));
  assert.deepEqual(bot.providers.prAuthor, ["unknown model"]);
  assert.deepEqual(bot.harnesses.prAuthor, ["Copilot"]);
});

test("disclosures bound client/model fields and generated tool labels without scanning prose or links", () => {
  for (const body of [
    "Generated with gpt-tokenizer fixtures; no language model was used.",
    "Generated with [gpt-tokenizer](https://example.test/gpt-6).",
    "Generated with [Example Tool](https://example.test/Codex/gpt-6).",
    "Generated with [Example Tool](https://example.test/tool). This updates gpt-6 and Claude fixtures.",
    "Generated with fixtures for gpt-6 and Codex.",
    "Generated with https://example.test/gpt-6.",
    "Generated with gpt-6.invalid fixtures.",
    "Generated with gpt-6-tokenizer.invalid fixtures.",
  ]) {
    const found = agentEvidence(pr({ body }));
    assert.deepEqual(found.providers.bodyFooter, [], body);
    assert.deepEqual(found.harnesses.bodyFooter, [], body);
  }
  for (const suffix of [
    "This changes the gpt-tokenizer dependency.", "This changes gpt-6 fixtures and Claude dependencies.",
    "[gpt-6](https://example.test/Codex)",
  ]) {
    const found = agentEvidence(pr({ body: `Written by an agent (Example Client, example-model). ${suffix}` }));
    assert.deepEqual(found.providers.bodyFooter, ["unknown model"]);
    assert.deepEqual(found.harnesses.bodyFooter, ["unknown harness"]);
  }
  assert.deepEqual(agentEvidence(pr({ body: "Written by an agent ([Example Client](https://example.test/Codex), [example-model](https://example.test/gpt-6))." })).harnesses.bodyFooter, ["unknown harness"]);
  assert.deepEqual(agentEvidence(pr({ body: "Generated with [Claude Code](https://example.test/gpt-6). Also updates Codex fixtures." })).harnesses.bodyFooter, ["Claude Code"]);
  for (const model of ["gpt-6", "gpt-6.1-sol", "GPT-6.1 Sol"]) {
    assert.deepEqual(agentEvidence(pr({ body: `Generated with ${model} via the example harness.` })).providers.bodyFooter, ["OpenAI"]);
  }
});

test("methodology reflects evidence categories and incomplete commit coverage inside collapsed details", async () => {
  const { insightsHtml } = await import("../worker/views/insights.ts");
  const rows = Array.from({ length: 10 }, (_, i) => pr({ id: String(i) }));
  const original = String(insightsHtml(summarize(rows)));
  const input = rows[0];
  input.body = "Written by an agent (Codex, gpt-6).";
  input.author = { login: "copilot-swe-agent[bot]" };
  input.commits.totalCount = 51;
  input.commits.nodes[0].commit.message += "\n\nCo-authored-by: Amp <amp@ampcode.com>";
  input.commits.nodes[0].commit.authors = { totalCount: 6, nodes: [{ name: "aider (example-model)", email: "aider@aider.chat", user: null }] };
  const summary = aggregateInsights("example-user", ["example-user", "copilot-swe-agent[bot]"], 2026, rows, "2026-03-01T00:00:00Z");
  const rendered = String(insightsHtml(summary));
  const details = (html: string) => /<details\b([^>]*)>([\s\S]*?)<\/details>/.exec(html)!;
  assert.ok(!/\bopen\b/.test(details(rendered)[1]));
  assert.notEqual(details(original)[2], details(rendered)[2]);
  for (const label of ["body disclosures", "commit trailers", "commit authors", "PR authors"]) {
    assert.ok(details(original)[2].includes(`${label} 0`));
    assert.ok(details(rendered)[2].includes(`${label} 1`));
  }
  assert.ok(details(original)[2].includes("incomplete for 0 PRs"));
  assert.ok(details(rendered)[2].includes("incomplete for 1 PR;"));
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
    assert.deepEqual(agentEvidence(input), { providers: { bodyFooter: ["OpenAI"], commitAuthor: [], commitTrailer: [], prAuthor: [] }, harnesses: { bodyFooter: ["Codex"], commitAuthor: [], commitTrailer: [], prAuthor: [] } });
    const summary = aggregateInsights(key, [key], 2026, [input], "2026-03-01T00:00:00Z");
    assert.deepEqual(summary.agents.providers.map(({ name, count }) => ({ name, count })), [{ name: "OpenAI", count: 1 }]);
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
    { ...valid, agents: { ...valid.agents, providers: [{ name: {}, count: 1 }] } },
    { ...valid, agents: { ...valid.agents, evidence: null } },
    { ...valid, size: { ...valid.size, biggestNetDeletion: { url: "javascript:alert(1)", lines: 1 } } },
  ]) assert.equal(await read(value), null);
  assert.equal(await cachedInsights({ match: async () => new Response("{"), put: async () => {} }, "example-user", now), null);
  assert.equal(await cachedInsights({ match: async () => { throw new Error("synthetic outage"); }, put: async () => {} }, "example-user", now), null);
  assert.equal(logged.mock.callCount(), 15);
});


test("provider/harness counts deduplicate per PR while preserving evidence and unknown coverage", async () => {
  const { insightsHtml } = await import("../worker/views/insights.ts");
  const rows = Array.from({ length: 10 }, (_, i) => pr({ id: String(i), body: i < 4 ? "Written by an agent (OpenCode, claude-opus-x; styal, gpt-6.1-sol)." : i < 6 ? "Written by an agent (Copilot)." : "" }));
  const summary = summarize(rows);
  assert.equal(summary.agents.attributed, 6);
  assert.equal(summary.agents.share, 0.6);
  assert.deepEqual(summary.agents.providers.map(({ name, count }) => [name, count]), [["Anthropic", 4], ["OpenAI", 4], ["unknown model", 2]]);
  assert.deepEqual(summary.agents.harnesses.map(({ name, count }) => [name, count]), [["OpenCode", 4], ["styal", 4], ["Copilot", 2]]);
  for (const dimension of [summary.agents.providers, summary.agents.harnesses]) for (const entry of dimension) {
    assert.equal(entry.evidence.bodyFooter, entry.count);
    assert.equal(EVIDENCE_KINDS.reduce((sum, kind) => sum + entry.evidence[kind], 0), entry.count);
  }
  const output = String(insightsHtml(summary));
  const bar = /role="img"[^>]*>([\s\S]*?)<\/div>/.exec(output)!;
  assert.ok(bar[1].includes("flex:4 1 0%"));
  assert.ok(bar[1].includes("flex:2 1 0%"));
  assert.ok(output.includes('aria-label="Agent harnesses"'));
  assert.equal((output.match(/role="img"/g) ?? []).length, 1);
  const noMarkers = String(insightsHtml(summarize(rows.map((row) => ({ ...row, body: "" })))));
  assert.ok(!noMarkers.includes('role="img"'));
  assert.ok(!noMarkers.includes("NaN") && !noMarkers.includes("Infinity"));
});

test("cache rejects old attribution schema and malformed provider or harness breakdowns", async (t) => {
  t.mock.method(console, "error", () => {});
  const valid = summarize([pr({ body: "Written by an agent (OpenCode, claude-opus-x)." })]);
  const read = (value: unknown) => cachedInsights({ match: async () => Response.json(value), put: async () => {} }, "example-user", new Date("2026-03-01T00:00:00Z"));
  assert.deepEqual(await read(valid), valid);
  for (const dimension of ["providers", "harnesses"] as const) {
    const entry = valid.agents[dimension][0];
    for (const values of [null, [], [entry, entry], [{ ...entry, count: 2 }], [{ ...entry, count: 0 }],
      [{ ...entry, evidence: null }], [{ ...entry, evidence: { ...entry.evidence, bodyFooter: 2 } }],
      [{ ...entry, evidence: { ...entry.evidence, bodyFooter: 0 } }],
    ]) assert.equal(await read({ ...valid, agents: { ...valid.agents, [dimension]: values } }), null);
  }
  const { providers: _providers, harnesses: _harnesses, ...legacy } = valid.agents;
  assert.equal(await read({ ...valid, agents: { ...legacy, agents: [{ name: "Claude", count: 1 }] } }), null);
});
