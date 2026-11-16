import assert from "node:assert/strict";
import test from "node:test";
import { aggregateInsights, agentCredits, classifyIntent, excludedPath, type InsightPullRequest, type PrCredit, type PrInsights } from "../worker/insights.ts";
import { fetchInsights, insightMonths } from "../worker/insights-fetch.ts";
import { INSIGHTS_SCHEMA_VERSION, storedInsights, storeInsights, refreshInsights, type InsightsStorage } from "../worker/insights-storage.ts";
import { PEOPLE } from "../worker/github.ts";

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
  assert.deepEqual(summarize([]).agents.credits, []);
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


/** Compact credit for readable expectations: model (or provider) | harness | roles. */
function show(credit: PrCredit): string {
  return `${credit.model ?? `${credit.provider ?? "unknown"} (model not stated)`} | ${credit.harness ?? "-"} | ${credit.roles.join("+")}`;
}
function credits(input: InsightPullRequest | string): string[] {
  return agentCredits(typeof input === "string" ? pr({ body: input }) : input).credits.map(show);
}
function withCommit(message: string, authors: { name: string | null; email: string | null; user: { login: string } | null }[] = [], body = ""): InsightPullRequest {
  return pr({ body, commits: { totalCount: 1, nodes: [{ commit: { message, authors: { totalCount: authors.length, nodes: authors } } }] } });
}
const NONE = { credits: [], hosts: [], evidence: [] };

test("attribution keeps body and commit evidence apart and counts each PR once despite repeated trailers", () => {
  const input = withCommit("Update widget\n\nCo-authored-by: Claude (Example Model) <noreply@anthropic.com>\nCo-Authored-By: Claude <noreply@anthropic.com>",
    [{ name: "Claude", email: "noreply@anthropic.com", user: null }], "Description\n\n---\nWritten by an agent (Codex, example-model).");
  assert.deepEqual(agentCredits(input), { hosts: [], evidence: ["bodyFooter", "commitTrailer", "commitAuthor"], credits: [
    { provider: "Anthropic", model: null, harness: null, roles: ["unspecified"], evidence: ["commitTrailer", "commitAuthor"] },
    { provider: "OpenAI", model: null, harness: "Codex", roles: ["writing"], evidence: ["bodyFooter"] },
  ] });
  const data = summarize([input]);
  assert.equal(data.agents.attributed, 1);
  assert.deepEqual(data.agents.providers.map(({ name, count, evidence }) => ({ name, count, evidence })), [
    { name: "Anthropic", count: 1, evidence: { bodyFooter: 0, commitTrailer: 1, commitAuthor: 1, prAuthor: 0 } },
    { name: "OpenAI", count: 1, evidence: { bodyFooter: 1, commitTrailer: 0, commitAuthor: 0, prAuthor: 0 } },
  ]);
  assert.deepEqual(data.agents.harnesses, [{ name: "Codex", count: 1, evidence: { bodyFooter: 1, commitTrailer: 0, commitAuthor: 0, prAuthor: 0 } }]);
  assert.deepEqual(data.agents.evidence, { bodyFooter: 1, commitTrailer: 1, commitAuthor: 1, prAuthor: 0 });
  assert.ok(!JSON.stringify(data).includes("noreply@"));
  assert.ok(!JSON.stringify(data).includes("example-model"));
});

test("agent identities, generated-with links, generic disclosures and bounded commit evidence", () => {
  assert.deepEqual(credits("🤖 Generated with [Claude Code](https://example.test/tool)"), ["Anthropic (model not stated) | Claude Code | unspecified"]);
  assert.deepEqual(credits("Written by an agent (Example Client, example-model)."), ["unknown (model not stated) | - | writing"]);
  for (const [login, agent] of [["copilot-swe-agent[bot]", "Copilot"], ["chatgpt-codex-connector[bot]", "Codex"], ["devin-ai-integration[bot]", "Devin"], ["google-labs-jules[bot]", "Jules"]]) {
    const found = agentCredits(pr({ author: { login } }));
    assert.deepEqual(found.credits.map(({ harness, roles, evidence }) => ({ harness, roles, evidence })), [{ harness: agent, roles: ["unspecified"], evidence: ["prAuthor"] }]);
  }
  const input = pr();
  input.commits.totalCount = 51;
  input.commits.nodes[0].commit.authors.totalCount = 6;
  assert.equal(summarize([input]).agents.incompleteCommits, 1);
});

test("ordinary agent mentions, quoted/fenced examples and dependency bots are not attribution", () => {
  const body = "Discuss Claude Code and Codex.\n> Generated with Claude Code\n\n```text\nWritten by an agent (Codex, example).\n```\n\n    Generated with Claude Code";
  assert.deepEqual(agentCredits(pr({ body })), NONE);
  for (const login of ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"]) assert.deepEqual(agentCredits(pr({ author: { login } })), NONE);
  assert.deepEqual(agentCredits(withCommit("Document trailers\n\n```text\nCo-authored-by: Codex <noreply@openai.com>\n```")), NONE);
});

test("structured credits keep exact models, harnesses and declared roles, with hosts apart", () => {
  for (const [body, expected, hosts] of [
    ["Written by `claude/claude-opus-x`, reviewed by `claude/claude-fable-x`, in [styal 🧵](https://example.test/styal).",
      ["claude-fable-x | Claude Code | review", "claude-opus-x | Claude Code | writing"], ["styal"]],
    ["Written by `claude/claude-opus-x`, reviewed by `codex/gpt-6-example`.", ["claude-opus-x | Claude Code | writing", "gpt-6-example | Codex | review"], []],
    ["Written by `claude/claude-opus-x`, and reviewed by `codex/gpt-6-example`.", ["claude-opus-x | Claude Code | writing", "gpt-6-example | Codex | review"], []],
    ["Written by `claude/claude-opus-x` and reviewed by `codex/gpt-6-example`.", ["claude-opus-x | Claude Code | writing", "gpt-6-example | Codex | review"], []],
    ["Written by `codex/gpt-6-example`, reviewed by `codex/gpt-6-example` and `claude/claude-fable-x`, in styal.",
      ["claude-fable-x | Claude Code | review", "gpt-6-example | Codex | writing+review"], ["styal"]],
    ["Written by `codex/gpt-6-example`, reviewed and fixed by `claude/claude-opus-x`, in styal.", ["claude-opus-x | Claude Code | writing+review", "gpt-6-example | Codex | writing"], ["styal"]],
    ["Written by `codex/gpt-6-example`, designed and reviewed by `claude/claude-opus-x`, in styal.", ["claude-opus-x | Claude Code | review+other", "gpt-6-example | Codex | writing"], ["styal"]],
    ["Written by `claude/claude-opus-x`, with the leak diagnosed by `codex/gpt-6-example`, in styal.", ["claude-opus-x | Claude Code | writing", "gpt-6-example | Codex | other"], ["styal"]],
    ["Written by `claude/claude-opus-x`, planned and tested by `codex/gpt-6-example`, verified by `pi/deepseek-v3`.",
      ["claude-opus-x | Claude Code | writing", "deepseek-v3 | Pi | other", "gpt-6-example | Codex | other"], []],
    ["Written by `codex/gpt-6-example`, implemented by `claude/claude-opus-x`, revised by `cursor/gpt-6-example`.",
      ["claude-opus-x | Claude Code | writing", "gpt-6-example | Codex | writing", "gpt-6-example | Cursor | writing"], []],
    ["Written by `opencode/anthropic/claude-opus-x`, `pi/deepseek-v3`, and `cursor/gpt-6-example` in T3 Code.",
      ["claude-opus-x | OpenCode | writing", "deepseek-v3 | Pi | writing", "gpt-6-example | Cursor | writing"], ["T3 Code"]],
    ["Written by `codex/claude-opus-x`", ["claude-opus-x | Codex | writing"], []],
    ["Written by `example-client/gpt-6-example`.", ["gpt-6-example | - | writing"], []],
    ["Written by `example-client/example-model`, reviewed by `codex/gpt-6-example`.", ["gpt-6-example | Codex | review"], []],
    ["Written by `styal/gpt-6-example`.", ["gpt-6-example | - | writing"], ["styal"]],
  ] as const) {
    const found = agentCredits(pr({ body }));
    assert.deepEqual(found.credits.map(show), expected, body);
    assert.deepEqual(found.hosts, hosts, body);
  }
});

test("a stated model decides the provider; unnamed models fall back to a single-vendor client", () => {
  const providers = (body: string) => agentCredits(pr({ body })).credits.map(({ model, provider, harness }) => ({ model, provider, harness }));
  assert.deepEqual(providers("Written by `codex/claude-opus-x`."), [{ model: "claude-opus-x", provider: "Anthropic", harness: "Codex" }]);
  // An unrecognized model is kept exactly, without borrowing the client's usual vendor.
  assert.deepEqual(providers("Written by `codex/example-model-9`."), [{ model: "example-model-9", provider: null, harness: "Codex" }]);
  assert.deepEqual(providers("Written by `claude/example-model-9`, reviewed by `codex/gpt-6`."),
    [{ model: "gpt-6", provider: "OpenAI", harness: "Codex" }, { model: "example-model-9", provider: null, harness: "Claude Code" }]);
  assert.deepEqual(providers("Written by an agent (Codex)."), [{ model: null, provider: "OpenAI", harness: "Codex" }]);
  assert.deepEqual(providers("Written by an agent (Cursor)."), [{ model: null, provider: null, harness: "Cursor" }]);
  // Known spellings and registry prefixes normalize; versions and variants stay.
  for (const [field, model] of [["Claude Opus 4.6", "claude-opus-4-6"], ["claude-opus-4.6", "claude-opus-4-6"], ["GPT-6.1 Sol", "gpt-6.1-sol"],
    ["openrouter/anthropic/claude-sonnet-4-5-20250929", "claude-sonnet-4-5-20250929"], ["codex-mini-latest", "codex-mini-latest"], ["gpt-5.1-codex-max", "gpt-5.1-codex-max"],
    ["claude-opus-5-5.preview", "claude-opus-5-5.preview"], ["claude-opus-4.6.preview", "claude-opus-4-6.preview"]]) {
    assert.deepEqual(providers(`Written by an agent (${field}).`).map(({ model }) => model), [model], field);
  }
  // Unrecognized identifiers keep their registry segments, and only within a recognized footer.
  assert.deepEqual(providers("Written by `example-client/openrouter/example-model`."), []);
  assert.deepEqual(providers("Written by `scripts/generate.ts`, reviewed by `codex/gpt-6`."), [{ model: "gpt-6", provider: "OpenAI", harness: "Codex" }]);
  assert.equal(providers("Written by `opencode/openrouter/example-model`.")[0].model, "openrouter/example-model");
  assert.deepEqual(credits(`Written by \`codex/${"x".repeat(81)}\`.`), []);
});

test("structured credits must consume the entire footer and never read examples or link targets", () => {
  const footer = "Written by `codex/gpt-6-example`.";
  for (const body of [
    `For example: ${footer}`, `> ${footer}`, `    ${footer}`, `\t${footer}`, `\`\`\`text\n${footer}\n\`\`\``, `~~~text\n${footer}\n~~~`,
    "Written by `claude`.", "Written by `https://example.test/gpt-6`.", "Written by `<harness>/<model id>`.",
    "Written by `scripts/generate.ts`.", "Written by `example/project`.", "Written by `tools/codegen` in styal.",
    "Written by `" + " ".repeat(60_000) + "x",
    "Written by `codex/gpt-6-example`" + " ".repeat(60_000) + "x",
    "Written by `codex/gpt-6-example`," + " ".repeat(60_000) + "in styal",
    "Written by `codex/gpt-6-example` fixtures; no model was used.",
    "Written by `codex/gpt-6-example`, not reviewed by `claude/claude-opus-x`.",
    "Written by `codex/gpt-6-example`, reviewed by a person.",
    "Written by `codex/gpt-6-example`, reviewed by ",
    "Written by `codex/gpt-6-example`, ",
    "Written by `codex/gpt-6-example` in production.",
    "Written by [a person](https://example.test/codex/gpt-6-example).",
    "Written by `codex/gpt-6-example`, in [Example fixtures](https://example.test/styal).",
  ]) {
    const started = performance.now();
    assert.deepEqual(agentCredits(pr({ body })), body.length > 1024 ? { ...NONE, limited: true } : NONE, body.slice(0, 80));
    assert.ok(performance.now() - started < 500, "bounded footer matching");
  }
  assert.deepEqual(credits("Written by [`example-client/claude-opus-x`](https://example.test/codex/gpt-6-example)."), ["claude-opus-x | - | writing"]);
});

test("repeated credits across footers, disclosures and identities count once and never move roles", () => {
  const body = "Written by `opencode/claude-opus-x`, reviewed by `opencode/claude-fable-x`, in styal.\nWritten by an agent (OpenCode, claude-opus-x).\nGenerated with claude-opus-x via OpenCode.\nWritten by `opencode/claude-opus-x`, reviewed by `opencode/claude-fable-x`, in styal.";
  const input = withCommit("Update widget\n\nCo-authored-by: Example Agent <noreply@anthropic.com>", [], body);
  const found = agentCredits(input);
  // The provider-only trailer fits both credits, so it adds evidence to neither.
  assert.deepEqual(found.credits.map(show), ["claude-fable-x | OpenCode | review", "claude-opus-x | OpenCode | writing"]);
  assert.deepEqual(found.evidence, ["bodyFooter", "commitTrailer"]);
  const summary = summarize([input]);
  assert.equal(summary.agents.attributed, 1);
  assert.deepEqual(summary.agents.credits.map(({ model, prs, roles }) => [model, prs, roles]), [
    ["claude-fable-x", 1, { writing: 0, review: 1, other: 0, unspecified: 0 }], ["claude-opus-x", 1, { writing: 1, review: 0, other: 0, unspecified: 0 }],
  ]);
  assert.deepEqual(summary.agents.harnesses.map(({ name, count }) => [name, count]), [["OpenCode", 1]]);
  assert.deepEqual(summary.agents.hosts.map(({ name, count }) => [name, count]), [["styal", 1]]);
  assert.deepEqual(summary.agents.pairs, [{ writer: "claude-opus-x", reviewer: "claude-fable-x", prs: 1 }]);
  // A vague credit with a declared role that no specific credit shares stays visible.
  assert.deepEqual(credits("Written by `claude/claude-opus-x`, reviewed by `claude/claude-fable-x`.\nWritten by an agent (Claude Code)."),
    ["claude-fable-x | Claude Code | review", "claude-opus-x | Claude Code | writing", "Anthropic (model not stated) | Claude Code | writing"]);
  // A matching vague credit from another line folds into its single specific credit.
  assert.deepEqual(credits("Written by `claude/claude-opus-x`.\nWritten by an agent (styal).\n🤖 Generated with Claude Code"), ["claude-opus-x | Claude Code | writing"]);
  // Agents named separately in one marker stay separate, however vague.
  assert.deepEqual(credits("Written by an agent (OpenCode, claude-opus-x; Example Client, example-model)."),
    ["claude-opus-x | OpenCode | writing", "unknown (model not stated) | - | writing"]);
});

test("negated legacy agent clauses do not establish credits or reviewer pairs", () => {
  for (const phrase of ["not reviewed", "never reviewed", "wasn't reviewed", "not independently reviewed", "without being reviewed"]) {
    const input = pr({ body: `Written by an agent (Codex, gpt-6); ${phrase} by an agent (Claude Code, claude-opus-x).` });
    assert.deepEqual(agentCredits(input).credits.map(show), ["gpt-6 | Codex | writing"], phrase);
    assert.deepEqual(summarize([input]).agents.pairs, [], phrase);
  }
});

test("credit parsing bounds participant expansion and reports limited coverage", () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => `\`pi/model-${i}\``).join(", ");
  const supported = agentCredits(pr({ body: `Written by ${list(8)}.` }));
  assert.equal(supported.credits.length, 8);
  assert.equal(supported.limited, undefined);
  assert.deepEqual(agentCredits(pr({ body: `Written by ${list(9)}.` })), { ...NONE, limited: true });
  assert.deepEqual(agentCredits(pr({ body: `Written by an agent (${Array.from({ length: 9 }, (_, i) => `o${i}`).join(", ")}).` })), { ...NONE, limited: true });
  const excessive = pr({ body: `Written by ${list(1000)}, reviewed by ${list(1000)}.` });
  const summary = summarize([excessive]);
  assert.equal(summary.agents.incompleteCredits, 1);
  assert.equal(summary.agents.attributed, 0);
  assert.deepEqual(summary.agents.pairs, []);
  assert.ok(JSON.stringify(summary).length < 2000);
  const manyLines = pr({ body: Array.from({ length: 20 }, (_, i) => `Written by \`pi/w${i}\`, reviewed by \`pi/r${i}\`.`).join("\n") });
  const bounded = summarize([manyLines]);
  assert.equal(bounded.agents.incompleteCredits, 1);
  assert.equal(bounded.agents.attributed, 1);
  assert.equal(bounded.agents.credits.length, 16);
  assert.ok(bounded.agents.pairs.length <= 256);
  const repeated = agentCredits(pr({ body: Array(100).fill("Written by `codex/gpt-6`.").join("\n") }));
  assert.equal(repeated.credits.length, 1);
  assert.equal(repeated.limited, undefined);
  const longTrailer = withCommit(`Update widget\n\nCo-authored-by: ${"x".repeat(2000)} <noreply@anthropic.com>`);
  assert.deepEqual(agentCredits(longTrailer), { ...NONE, limited: true });
});

test("inferred client vendors do not create extra model rows or override a named model", () => {
  assert.deepEqual(credits("Generated with Claude Code\nWritten by `claude/example-model-9`."), ["example-model-9 | Claude Code | writing"]);
  const input = pr({ author: { login: "chatgpt-codex-connector[bot]" }, body: "Written by `codex/claude-opus-x`." });
  assert.deepEqual(agentCredits(input).credits.map(({ model, provider, harness }) => ({ model, provider, harness })),
    [{ model: "claude-opus-x", provider: "Anthropic", harness: "Codex" }]);
  const summary = summarize([pr({ body: input.body + "\nGenerated with Codex" })]);
  assert.deepEqual(summary.agents.providers.map(({ name, count }) => [name, count]), [["Anthropic", 1]]);
  assert.equal(summary.agents.credits.length, 1);
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

function memoryStorage() {
  const entries = new Map<string, unknown>();
  const storage: InsightsStorage = {
    get: async <T>(key: string) => structuredClone(entries.get(key)) as T | undefined,
    put: async (key, value) => { entries.set(key, structuredClone(value)); },
  };
  return { entries, storage };
}

test("collected credits survive aggregation and storage as exact models and roles, without footer text", async (t) => {
  const input = pr({ body: "Written by `claude/claude-opus-x`, reviewed by `codex/gpt-6-example`, in [styal 🧵](https://example.test/styal)." });
  t.mock.method(globalThis, "fetch", async () => searchResponse([input]));
  const summary = await fetchInsights("synthetic-token", "example-user", ["example-user"], new Date("2026-02-28T00:00:00Z"));
  const { entries, storage } = memoryStorage();
  await storeInsights(storage, summary);
  assert.equal((entries.get("insights:2026:example-user") as { schemaVersion: number }).schemaVersion, INSIGHTS_SCHEMA_VERSION);
  const stored = await storedInsights(storage, "example-user", 2026);
  assert.equal(stored?.agents.attributed, 1);
  assert.deepEqual(stored?.agents.credits.map(({ model, provider, harness, prs, roles }) => ({ model, provider, harness, prs, roles })), [
    { model: "claude-opus-x", provider: "Anthropic", harness: "Claude Code", prs: 1, roles: { writing: 1, review: 0, other: 0, unspecified: 0 } },
    { model: "gpt-6-example", provider: "OpenAI", harness: "Codex", prs: 1, roles: { writing: 0, review: 1, other: 0, unspecified: 0 } },
  ]);
  assert.deepEqual(stored?.agents.pairs, [{ writer: "claude-opus-x", reviewer: "gpt-6-example", prs: 1 }]);
  assert.deepEqual(stored?.agents.harnesses.map(({ name, count }) => [name, count]), [["Claude Code", 1], ["Codex", 1]]);
  assert.deepEqual(stored?.agents.hosts.map(({ name, count }) => [name, count]), [["styal", 1]]);
  for (const text of ["Written by", "example.test", "🧵"]) assert.ok(!JSON.stringify(stored).includes(text), text);
});

function readSummary(value: unknown) {
  const { entries, storage } = memoryStorage();
  entries.set("insights:2026:example-user", { schemaVersion: INSIGHTS_SCHEMA_VERSION, summary: value });
  return storedInsights(storage, "example-user", 2026);
}

test("stored summaries round trip by person and year; old versions and changed accounts are missing", async () => {
  const { entries, storage } = memoryStorage();
  const summary = summarize([pr()]);
  await storeInsights(storage, summary);
  assert.deepEqual(await storedInsights(storage, summary.login, 2026), summary);
  assert.equal(await storedInsights(storage, "other-user", 2026), null);
  assert.equal(await storedInsights(storage, summary.login, 2025), null);
  entries.set("insights:2026:example-user", { schemaVersion: INSIGHTS_SCHEMA_VERSION - 1, summary });
  assert.equal(await storedInsights(storage, summary.login, 2026), null);
  const login = PEOPLE[1].accounts[0];
  await storeInsights(storage, { ...summary, login, accounts: [login] });
  assert.equal(await storedInsights(storage, login, 2026), null);
});

test("storage miss does no network work; refresh stores one person per tick and refreshes only after a day", async (t) => {
  const { entries, storage } = memoryStorage();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests += 1; return searchResponse([]); });
  const now = new Date("2026-01-10T12:00:00Z");
  assert.equal(await storedInsights(storage, "example-user", 2026), null);
  await refreshInsights(storage, "", now);
  assert.equal(requests, 0);
  for (let i = 0; i < PEOPLE.length; i++) {
    await refreshInsights(storage, "synthetic-token", now);
    assert.equal([...entries.keys()].filter((key) => key.startsWith("insights:")).length, i + 1);
  }
  const collected = PEOPLE.reduce((sum, person) => sum + person.accounts.length, 0);
  assert.equal(requests, collected);
  await refreshInsights(storage, "synthetic-token", new Date("2026-01-11T11:59:59Z"));
  assert.equal(requests, collected);
  await refreshInsights(storage, "synthetic-token", new Date("2026-01-11T12:00:00Z"));
  assert.equal(requests, collected + 1);
  assert.equal((await storedInsights(storage, PEOPLE[0].accounts[0], 2026))?.generatedAt, "2026-01-11T12:00:00.000Z");
});

test("a failed refresh attempt preserves stored data, skips to the next person, and retries after an hour", async (t) => {
  const { storage } = memoryStorage();
  const login = PEOPLE[0].accounts[0];
  t.mock.method(globalThis, "fetch", async () => searchResponse([]));
  await refreshInsights(storage, "synthetic-token", new Date("2026-01-10T12:00:00Z"));
  const original = await storedInsights(storage, login, 2026);
  t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "unavailable" }] }));
  await assert.rejects(refreshInsights(storage, "synthetic-token", new Date("2026-01-12T12:00:00Z")));
  assert.deepEqual(await storedInsights(storage, login, 2026), original);
  t.mock.method(globalThis, "fetch", async () => searchResponse([]));
  await refreshInsights(storage, "synthetic-token", new Date("2026-01-12T12:59:59Z"));
  assert.deepEqual(await storedInsights(storage, login, 2026), original);
  assert.ok(await storedInsights(storage, PEOPLE[1].accounts[0], 2026));
  await refreshInsights(storage, "synthetic-token", new Date("2026-01-12T13:00:00Z"));
  assert.equal((await storedInsights(storage, login, 2026))?.generatedAt, "2026-01-12T13:00:00.000Z");
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
  assert.ok(!tiny.includes('<table'));
  const mixed = summarize(rows.map((row, i) => i ? row : { ...row, files: null }));
  const rendered = String(insightsHtml(mixed));
  assert.ok(!rendered.includes('aria-label="PR size histogram"'));
  assert.ok(rendered.includes('10</strong>'));
  assert.ok(!rendered.includes('<table'));
  assert.ok(String(insightsHtml(summarize(rows))).includes('aria-label="PR size histogram"'));
});

test("human names and lookalike emails are not agent identities in trailers or authors", () => {
  for (const name of ["Devin Example", "Claude Example", "Jules Example", "Devin", "Claude", "Jules", "Codex", "Cursor Agent", "Copilot", "aider (example-model)", "Amp"]) {
    for (const email of ["human@example.test", "noreply@anthropic.com.example.test", "noreply@openai.com.example.test", "cursoragent@cursor.com.example.test", "aider@aider.chat.example.test", "amp@ampcode.com.example.test", "aider@not-aider.chat", "amp@not-ampcode.com"]) {
      const input = withCommit(`Update widget\n\nCo-authored-by: ${name} <${email}>`, [{ name, email, user: { login: "example-human" } }]);
      assert.deepEqual(agentCredits(input), NONE, `${name} <${email}>`);
    }
  }
});

test("commit identities establish a provider or harness, never a model or a role", () => {
  for (const [name, email, expected] of [
    ["Claude (Example Model)", "noreply@anthropic.com", "Anthropic (model not stated) | - | unspecified"],
    ["Claude Opus 4.6", "noreply@anthropic.com", "Anthropic (model not stated) | - | unspecified"],
    ["Codex", "noreply@openai.com", "OpenAI (model not stated) | - | unspecified"],
    ["Cursor Agent", "cursoragent@cursor.com", "unknown (model not stated) | Cursor | unspecified"],
    ["Cursor Agent", "12345+cursoragent@users.noreply.github.com", "unknown (model not stated) | Cursor | unspecified"],
    ["Copilot", "copilot@github.com", "unknown (model not stated) | Copilot | unspecified"],
    ["Copilot", "12345+Copilot@users.noreply.github.com", "unknown (model not stated) | Copilot | unspecified"],
    ["aider (example-model)", "aider@aider.chat", "unknown (model not stated) | Aider | unspecified"],
    ["Amp", "amp@ampcode.com", "unknown (model not stated) | Amp | unspecified"],
    ["Example bot", "12345+chatgpt-codex-connector[bot]@users.noreply.github.com", "OpenAI (model not stated) | Codex | unspecified"],
  ]) {
    const found = agentCredits(withCommit(`Update widget\n\nCo-authored-by: ${name} <${email}>`, [{ name, email, user: null }]));
    assert.deepEqual(found.credits.map(show), [expected], email);
    assert.deepEqual(found.credits[0].evidence, ["commitTrailer", "commitAuthor"], email);
  }
  assert.deepEqual(credits(withCommit("Update widget", [{ name: null, email: null, user: { login: "google-labs-jules[bot]" } }])), ["Google (model not stated) | Jules | unspecified"]);
});

test("generic generated lines and identities leave roles unspecified; written disclosures declare writing", () => {
  assert.deepEqual(credits("Generated with claude-opus-x via Claude Code."), ["claude-opus-x | Claude Code | unspecified"]);
  assert.deepEqual(credits("Created by Codex."), ["OpenAI (model not stated) | Codex | unspecified"]);
  assert.deepEqual(credits("Made with gpt-6."), ["gpt-6 | - | unspecified"]);
  assert.deepEqual(credits("Written by an agent (Codex, gpt-6)."), ["gpt-6 | Codex | writing"]);
  assert.deepEqual(credits("Written by an agent (styal, gpt-6); reviewed by an agent (Claude Code, claude-opus-x)."),
    ["claude-opus-x | Claude Code | review", "gpt-6 | - | writing"]);
  assert.deepEqual(credits("Written by an agent (styal, gpt-6), designed and reviewed by an agent (Claude Code, claude-opus-x)."),
    ["claude-opus-x | Claude Code | review+other", "gpt-6 | - | writing"]);
  assert.deepEqual(credits("Written by an agent (styal, gpt-6); assisted by an agent (Claude Code, claude-opus-x)."),
    ["claude-opus-x | Claude Code | unspecified", "gpt-6 | - | writing"]);
  // A role from one PR's footer is never lent to the same model's bare identity elsewhere.
  const summary = summarize([pr({ id: "a", body: "Written by `claude/claude-opus-x`." }), withCommit("Update widget\n\nCo-authored-by: Claude <noreply@anthropic.com>")]);
  assert.deepEqual(summary.agents.credits.map(({ model, provider, roles }) => [model ?? provider, roles.writing, roles.unspecified]), [["claude-opus-x", 1, 0], ["Anthropic", 0, 1]]);
});

test("disclosures separate models, harnesses and hosts, including multi-agent markers", () => {
  for (const [fields, expected, hosts] of [
    ["Claude Code, claude-opus-x", ["claude-opus-x | Claude Code | writing"], []],
    ["Codex, gpt-6-example", ["gpt-6-example | Codex | writing"], []],
    ["styal, gpt-6.1-sol", ["gpt-6.1-sol | - | writing"], ["styal"]],
    ["T3 Code, claude-opus-x", ["claude-opus-x | - | writing"], ["T3 Code"]],
    ["OpenCode, claude-opus-x", ["claude-opus-x | OpenCode | writing"], []],
    ["Codex, claude-opus-x", ["claude-opus-x | Codex | writing"], []],
    ["Claude Code, claude-opus-x; Codex, gpt-6.1-sol", ["claude-opus-x | Claude Code | writing", "gpt-6.1-sol | Codex | writing"], []],
    ["Example Client, example-model", ["unknown (model not stated) | - | writing"], []],
    ["styal", ["unknown (model not stated) | - | writing"], ["styal"]],
    ["claude-opus-x", ["claude-opus-x | - | writing"], []],
    ["Claude Code", ["Anthropic (model not stated) | Claude Code | writing"], []],
    ["Codex", ["OpenAI (model not stated) | Codex | writing"], []],
    ["Gemini CLI", ["Google (model not stated) | Gemini CLI | writing"], []],
    ["Jules", ["Google (model not stated) | Jules | writing"], []],
  ] as const) {
    const found = agentCredits(pr({ body: `Written by an agent (${fields}).` }));
    assert.deepEqual(found.credits.map(show), expected, fields);
    assert.deepEqual(found.hosts, hosts, fields);
  }
  assert.deepEqual(credits("Written by an agent (styal, gpt-6-example); revised by an agent (Claude Code, claude-opus-x)."),
    ["claude-opus-x | Claude Code | writing", "gpt-6-example | - | writing"]);
});

test("ambiguous legacy groups keep every model and harness unpaired", () => {
  const found = agentCredits(pr({ body: "Written by an agent (Claude Code, Codex, claude-opus-x, gpt-6)." }));
  assert.deepEqual(found.credits.map(show), ["claude-opus-x | - | writing", "gpt-6 | - | writing", "unknown (model not stated) | Claude Code | writing", "unknown (model not stated) | Codex | writing"]);
  assert.deepEqual(credits("Written by an agent (Cursor, claude-opus-x, gpt-6)."), ["claude-opus-x | - | writing", "gpt-6 | - | writing", "unknown (model not stated) | Cursor | writing"]);
  // Only explicitly paired roles form writer/reviewer combinations.
  assert.deepEqual(summarize([pr({ body: "Written by an agent (claude-opus-x, gpt-6)." })]).agents.pairs, []);
});

test("model ids identify additional vendors without guessing a harness", () => {
  for (const [model, provider, id] of [
    ["claude-opus-4-6", "Anthropic", "claude-opus-4-6"], ["claude-fable-5", "Anthropic", "claude-fable-5"], ["gpt-6.1-sol", "OpenAI", "gpt-6.1-sol"], ["o3-mini", "OpenAI", "o3-mini"],
    ["codex-mini-latest", "OpenAI", "codex-mini-latest"], ["gemini-2.5-pro", "Google", "gemini-2.5-pro"], ["grok-4", "xAI", "grok-4"], ["grok-code-fast-1", "xAI", "grok-code-fast-1"],
    ["mistral-large-latest", "Mistral", "mistral-large-latest"], ["codestral-2508", "Mistral", "codestral-2508"], ["devstral-small-2507", "Mistral", "devstral-small-2507"],
    ["deepseek-r1", "DeepSeek", "deepseek-r1"], ["opencode/deepseek-v4-flash-free", "DeepSeek", "deepseek-v4-flash-free"], ["anthropic/claude-opus-x", "Anthropic", "claude-opus-x"],
    ["deepseek-v3.2", "DeepSeek", "deepseek-v3.2"], ["kimi-k2.5", "Moonshot/Kimi", "kimi-k2.5"], ["moonshot-v1-128k", "Moonshot/Kimi", "moonshot-v1-128k"],
    ["qwen3-coder", "Qwen/Alibaba", "qwen3-coder"], ["qwen-max", "Qwen/Alibaba", "qwen-max"], ["glm-4.6", "Zhipu/GLM", "glm-4.6"], ["llama-3.3-70b-instruct", "Meta", "llama-3.3-70b-instruct"],
  ]) {
    const found = agentCredits(pr({ body: `Written by an agent (Example Client, ${model}).` }));
    assert.deepEqual(found.credits.map(({ model, provider, harness }) => ({ model, provider, harness })), [{ model: id, provider, harness: null }], model);
  }
  for (const harness of ["Copilot", "Cursor", "OpenCode", "Devin", "Aider", "Amp", "Antigravity"]) {
    assert.deepEqual(credits(`Written by an agent (${harness}).`), [`unknown (model not stated) | ${harness} | writing`]);
  }
  for (const host of ["T3 Code", "styal"]) {
    const found = agentCredits(pr({ body: `Written by an agent (${host}).` }));
    assert.deepEqual(found.credits.map(show), ["unknown (model not stated) | - | writing"]);
    assert.deepEqual(found.hosts, [host]);
  }
  assert.deepEqual(credits(pr({ author: { login: "copilot-swe-agent[bot]" } })), ["unknown (model not stated) | Copilot | unspecified"]);
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
  ]) assert.deepEqual(agentCredits(pr({ body })), NONE, body);
  for (const suffix of [
    "This changes the gpt-tokenizer dependency.", "This changes gpt-6 fixtures and Claude dependencies.",
    "[gpt-6](https://example.test/Codex)",
  ]) assert.deepEqual(credits(`Written by an agent (Example Client, example-model). ${suffix}`), ["unknown (model not stated) | - | writing"]);
  assert.deepEqual(credits("Written by an agent ([Example Client](https://example.test/Codex), [example-model](https://example.test/gpt-6))."), ["unknown (model not stated) | - | writing"]);
  assert.deepEqual(agentCredits(pr({ body: "Generated with [Claude Code](https://example.test/gpt-6). Also updates Codex fixtures." })), NONE);
  for (const [model, id] of [["gpt-6", "gpt-6"], ["gpt-6.1-sol", "gpt-6.1-sol"], ["GPT-6.1 Sol", "gpt-6.1-sol"]]) {
    assert.deepEqual(credits(`Generated with ${model} via the example harness.`), [`${id} | - | unspecified`]);
  }
});

test("compound client fields and generated client clauses split harnesses from hosts", () => {
  for (const client of ["Codex in styal", "styal through the Codex harness", "styal via Codex", "Codex using styal", "styal/Codex", "styal / Codex harness", "styal + Codex agent", "styal Codex harness"]) {
    const found = agentCredits(pr({ body: `Written by an agent (${client}, gpt-6).` }));
    assert.deepEqual(found.credits.map(show), ["gpt-6 | Codex | writing"], client);
    assert.deepEqual(found.hosts, ["styal"], client);
  }
  for (const [model, client, harness, hosts] of [
    ["GPT-5.6-sol", "the Codex harness", "Codex", []],
    ["GPT-5.6 Sol", "the T3 Code Codex harness", "Codex", ["T3 Code"]],
    ["gpt-5.6-terra", "Codex in T3 Code", "Codex", ["T3 Code"]],
    ["GPT-5.6 Sol", "the Codex harness in T3 Code", "Codex", ["T3 Code"]],
    ["gpt-6", "example harness", "-", []],
    ["gpt-6", "T3 Code", "-", ["T3 Code"]],
  ] as const) for (const verb of ["Generated with", "Generated by", "Created with", "Created by", "Made with"]) {
    for (const connector of ["via", "using", "in", "through"]) {
      const body = `${verb} ${model} ${connector} ${client}.`;
      const found = agentCredits(pr({ body }));
      assert.deepEqual(found.credits.map((credit) => [credit.provider, credit.harness ?? "-", credit.roles]), [["OpenAI", harness, ["unspecified"]]], body);
      assert.deepEqual(found.hosts, hosts, body);
    }
  }
  const linked = agentCredits(pr({ body: "Generated with [gpt-6](https://example.test/Claude) via [Codex](https://example.test/Cursor) in styal." }));
  assert.deepEqual(linked.credits.map(show), ["gpt-6 | Codex | unspecified"]);
  assert.deepEqual(linked.hosts, ["styal"]);
  for (const [model, client] of [["gpt-6", "Codex"], ["claude-opus-x", "Claude Code"]]) {
    const found = agentCredits(pr({ body: `Written by an agent (T3 Code, ${model} via the ${client} harness).` }));
    assert.deepEqual(found.credits.map(show), [`${model} | ${client} | writing`]);
    assert.deepEqual(found.hosts, ["T3 Code"]);
  }
  assert.deepEqual(credits("Written by an agent (Antigravity, gemini-3.8-flash-high)."), ["gemini-3.8-flash-high | Antigravity | writing"]);
});

test("semicolon groups are separate agents with their own model precedence", () => {
  for (const [groups, expected, hosts] of [
    ["OpenCode, claude-opus-x; Codex", ["claude-opus-x | OpenCode | writing", "OpenAI (model not stated) | Codex | writing"], []],
    ["OpenCode, claude-opus-x; Cursor", ["claude-opus-x | OpenCode | writing", "unknown (model not stated) | Cursor | writing"], []],
    ["Cursor; OpenCode, claude-opus-x", ["claude-opus-x | OpenCode | writing", "unknown (model not stated) | Cursor | writing"], []],
    ["OpenCode, claude-opus-x; Example Client, example-model", ["claude-opus-x | OpenCode | writing", "unknown (model not stated) | - | writing"], []],
    ["Codex, claude-opus-x; styal, gpt-6; Cursor", ["claude-opus-x | Codex | writing", "gpt-6 | - | writing", "unknown (model not stated) | Cursor | writing"], ["styal"]],
  ] as const) {
    const body = `Written by an agent (${groups}).`;
    const found = agentCredits(pr({ body }));
    assert.deepEqual(found.credits.map(show), expected, body);
    assert.deepEqual(found.hosts, hosts, body);
    const separate = agentCredits(pr({ body: `Written by an agent (${groups.replaceAll("; ", "); revised by an agent (")}).` }));
    assert.deepEqual(found, separate);
  }
});

test("generated attribution consumes the whole subject and never leading prose or link targets", () => {
  for (const body of [
    "Generated with o1 fixtures; no language model was used.",
    "Generated with claude fixtures; no language model was used.",
    "Generated with Claude Code fixtures; no language model was used.",
    "Generated with gpt-6 via Codex fixtures.",
    "Generated with gpt-6 via Codex. Also changed Cursor fixtures.",
    "Generated with gpt-6 via the Codex harness for testing.",
    "Generated with gpt-6 via https://example.test/Codex.",
    "Generated with gpt-6 via [example fixtures](https://example.test/Codex).",
    "Generated with [o1 fixtures](https://example.test/Codex).",
    "Generated with claude.",
  ]) {
    assert.deepEqual(agentCredits(pr({ body })), NONE, body);
    assert.equal(summarize([pr({ body })]).agents.attributed, 0, body);
  }
  assert.deepEqual(credits("Written by an agent (claude, example-model)."), ["unknown (model not stated) | - | writing"]);
  for (const client of ["Claude Code", "claude-code"]) assert.deepEqual(credits(`Generated with ${client}.`), ["Anthropic (model not stated) | Claude Code | unspecified"]);
  for (const model of ["o3", "codex-mini", "claude-3-5-sonnet", "gemini-2.5-pro", "grok-4"]) {
    assert.deepEqual(credits(`Written by an agent (${model}).`), [`${model} | - | writing`]);
    assert.deepEqual(credits(`Generated with ${model}.`), [`${model} | - | unspecified`]);
  }
  const bounded = agentCredits(pr({ body: "Written by an agent (Codex in styal, gpt-6). Changed Cursor fixtures and [Claude Code](https://example.test/claude-opus-x)." }));
  assert.deepEqual(bounded.credits.map(show), ["gpt-6 | Codex | writing"]);
  assert.deepEqual(bounded.hosts, ["styal"]);
});

test("vendor emails add evidence to the one matching credit and never infer a harness", () => {
  for (const [email, provider] of [["noreply@anthropic.com", "Anthropic"], ["noreply@openai.com", "OpenAI"]]) {
    const identity = `${provider} (model not stated) | - | unspecified`;
    for (const [client, expected] of [
      [null, [identity]],
      ["OpenCode", provider === "Anthropic" ? ["claude-opus-x | OpenCode | writing"] : ["claude-opus-x | OpenCode | writing", identity]],
      ["T3 Code", provider === "Anthropic" ? ["claude-opus-x | - | writing"] : ["claude-opus-x | - | writing", identity]],
      ["Example Client", provider === "Anthropic" ? ["claude-opus-x | - | writing"] : ["claude-opus-x | - | writing", identity]],
    ] as const) {
      const input = withCommit(`Update widget\n\nCo-authored-by: Example Agent <${email}>`, [{ name: "Example Agent", email, user: null }],
        client ? `Written by an agent (${client}, claude-opus-x).` : "");
      const found = agentCredits(input);
      assert.deepEqual(found.credits.map(show), expected, `${email} ${client}`);
      assert.deepEqual(found.evidence, client ? ["bodyFooter", "commitTrailer", "commitAuthor"] : ["commitTrailer", "commitAuthor"]);
      assert.deepEqual(summarize([input]).agents.harnesses.map(({ name }) => name), client === "OpenCode" ? ["OpenCode"] : []);
    }
    const input = withCommit(`Update widget\n\nCo-authored-by: Example Agent <${email}>`, [{ name: null, email: "aider@aider.chat", user: null }]);
    // An explicit client elsewhere does not lend the vendor identity a harness either.
    assert.deepEqual(credits(input), [identity, "unknown (model not stated) | Aider | unspecified"]);
  }
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
    const input = pr({ author: { login: key }, body: `Written by an agent (Codex, example-model). Written by \`${key}/${key}\`.` });
    input.commits.nodes[0].commit.authors.nodes[0].user = { login: key };
    assert.deepEqual(credits(input), ["OpenAI (model not stated) | Codex | writing"]);
    // Inherited keys are never client aliases; "__proto__" is not even client-shaped.
    assert.deepEqual(credits(`Written by \`${key}/gpt-6\`.`), key === "constructor" ? ["gpt-6 | - | writing"] : []);
    const summary = aggregateInsights(key, [key], 2026, [input], "2026-03-01T00:00:00Z");
    assert.deepEqual(summary.agents.providers.map(({ name, count }) => ({ name, count })), [{ name: "OpenAI", count: 1 }]);
  }
});

test("optional storage reads reject malformed shapes and isolate lookup failures", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const valid = summarize([pr()]);
  const read = readSummary;
  assert.deepEqual(await read(valid), valid);
  assert.deepEqual(await read(summarize([])), summarize([]));
  for (const value of [null, {}, { ...valid, accounts: null }, { ...valid, login: "other-user" }, { ...valid, year: 2025 },
    { ...valid, generatedAt: "invalid" }, { ...valid, total: -1 }, { ...valid, size: { ...valid.size, median: null } },
    { ...valid, size: { ...valid.size, buckets: [] } }, { ...valid, intent: { ...valid.intent, mix: { constructor: 1 } } },
    { ...valid, agents: { ...valid.agents, providers: [{ name: {}, count: 1 }] } },
    { ...valid, agents: { ...valid.agents, evidence: null } },
    { ...valid, size: { ...valid.size, biggestNetDeletion: { url: "javascript:alert(1)", lines: 1 } } },
  ]) assert.equal(await read(value), null);
  assert.equal(await storedInsights({ get: async () => { throw new Error("synthetic outage"); }, put: async () => {} }, "example-user", 2026), null);
  assert.equal(logged.mock.callCount(), 14);
});

test("credit rows count each PR once per model, harness and role, with overlap and unknowns visible", async () => {
  const { insightsHtml } = await import("../worker/views/insights.ts");
  const rows = Array.from({ length: 10 }, (_, i) => pr({ id: String(i), body: i < 4
    ? "Written by `claude/claude-opus-x`, reviewed and fixed by `claude/claude-fable-x`, in styal.\nWritten by `claude/claude-opus-x`, reviewed by `claude/claude-fable-x`, in styal."
    : i < 6 ? "Written by an agent (Copilot)." : i < 7 ? "Written by `codex/example-model-9`, reviewed by `claude/claude-opus-x` and `codex/gpt-6`, in T3 Code." : "" }));
  const summary = summarize(rows);
  assert.equal(summary.agents.attributed, 7);
  assert.deepEqual(summary.agents.credits.map(({ model, provider, harness, prs, roles }) => [model ?? provider, harness, prs, roles.writing, roles.review, roles.other, roles.unspecified]), [
    ["claude-opus-x", "Claude Code", 5, 4, 1, 0, 0],
    ["claude-fable-x", "Claude Code", 4, 4, 4, 0, 0],
    [null, "Copilot", 2, 2, 0, 0, 0],
    ["example-model-9", "Codex", 1, 1, 0, 0, 0],
    ["gpt-6", "Codex", 1, 0, 1, 0, 0],
  ]);
  // Writers pair with every declared reviewer on the same PR, once per PR.
  assert.deepEqual(summary.agents.pairs, [
    { writer: "claude-fable-x", reviewer: "claude-fable-x", prs: 4 }, { writer: "claude-opus-x", reviewer: "claude-fable-x", prs: 4 },
    { writer: "example-model-9", reviewer: "claude-opus-x", prs: 1 }, { writer: "example-model-9", reviewer: "gpt-6", prs: 1 },
  ]);
  assert.deepEqual(summary.agents.hosts.map(({ name, count }) => [name, count]), [["styal", 4], ["T3 Code", 1]]);
  assert.deepEqual(summary.agents.harnesses.map(({ name, count }) => [name, count]), [["Claude Code", 5], ["Copilot", 2], ["Codex", 1]]);
  assert.deepEqual(summary.agents.providers.map(({ name, count }) => [name, count]), [["Anthropic", 5], ["OpenAI", 1]]);
  for (const row of summary.agents.credits) assert.equal(row.evidence.bodyFooter, row.prs);
  const output = String(insightsHtml(summary));
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(output)![1];
  assert.equal((body.match(/<tr\b/g) ?? []).length, 5);
  assert.ok(!output.includes('role="img"'));
  assert.ok(!output.includes("<details"));
  // Same-model pairs are not listed as cross-model combinations.
  const pairs = /aria-label="Different writer and reviewer models[^"]*">([\s\S]*?)<\/ul>/.exec(output)![1];
  assert.equal((pairs.match(/<li\b/g) ?? []).length, 3);
  assert.ok(!/claude-fable-x<\/span> wrote, <span[^>]*>claude-fable-x/.test(pairs));
  for (const [label, expected] of [["Agent harnesses", 3], ["Agent hosts", 2]] as const) {
    const list = new RegExp(`aria-label="${label}">([\\s\\S]*?)</ul>`).exec(output)![1];
    assert.equal((list.match(/<li\b/g) ?? []).length, expected);
  }
  const noMarkers = summarize(rows.map((row) => ({ ...row, body: "" })));
  assert.deepEqual([noMarkers.agents.credits, noMarkers.agents.pairs, noMarkers.agents.hosts], [[], [], []]);
  const empty = String(insightsHtml(noMarkers));
  assert.ok(!empty.includes("<table") && !empty.includes("Agent harnesses"));
  assert.ok(!empty.includes("NaN") && !empty.includes("Infinity"));
});

test("long credit tables keep six rows in view and the rest in a native disclosure", async () => {
  const { insightsHtml } = await import("../worker/views/insights.ts");
  const models = ["claude-opus-x", "claude-fable-x", "gpt-6", "gpt-6.1-sol", "gemini-2.5-pro", "deepseek-r1", "kimi-k2.5", "grok-4", "glm-4.6"];
  const summary = summarize(models.map((model, i) => pr({ id: String(i), body: `Written by \`opencode/${model}\`.` })).concat(Array.from({ length: 4 }, (_, i) => pr({ id: `plain-${i}` }))));
  const output = String(insightsHtml(summary));
  const tables = [...output.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)].map((match) => (match[1].match(/<tr\b/g) ?? []).length);
  assert.deepEqual(tables, [6, 3]);
  assert.ok(/<details[^>]*>\s*<summary[^>]*>[\s\S]*?3[\s\S]*?<\/summary>[\s\S]*<table/.test(output));
  // Exactly seven rows render in a single table rather than hiding one.
  const seven = String(insightsHtml(summarize(models.slice(0, 7).map((model, i) => pr({ id: String(i), body: `Written by \`opencode/${model}\`.` })).concat(Array.from({ length: 3 }, (_, i) => pr({ id: `plain-${i}` }))))));
  assert.deepEqual([...seven.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)].map((match) => (match[1].match(/<tr\b/g) ?? []).length), [7]);
});

test("storage requires the new schema and rejects malformed credit rows, roles, pairs and hosts", async (t) => {
  t.mock.method(console, "error", () => {});
  const valid = summarize([
    pr({ id: "footer", body: "Written by `codex/gpt-6`, reviewed by `claude/claude-opus-x`, in styal." }),
    withCommit("Update widget\n\nCo-authored-by: Example Agent <noreply@anthropic.com>"),
  ]);
  const read = readSummary;
  assert.deepEqual(await read(valid), valid);
  const agents = valid.agents;
  const [row] = agents.credits;
  const [pair] = agents.pairs;
  const [host] = agents.hosts;
  const invalid: Partial<PrInsights["agents"]>[] = [
    { credits: [] }, { credits: [row, row] }, { credits: [...agents.credits].reverse() },
    { credits: [{ ...row, prs: 0 }, ...agents.credits.slice(1)] }, { credits: [{ ...row, prs: 4 }, ...agents.credits.slice(1)] },
    { credits: [{ ...row, model: "GPT 6" }, ...agents.credits.slice(1)] }, { credits: [{ ...row, model: "x".repeat(81) }, ...agents.credits.slice(1)] },
    { credits: [{ ...row, provider: "OpenAI" }, ...agents.credits.slice(1)] }, { credits: [{ ...row, harness: "styal" }, ...agents.credits.slice(1)] },
    { credits: [{ ...row, harness: "Example Harness" }, ...agents.credits.slice(1)] }, { credits: [{ ...row, roles: { ...row.roles, writing: 2 } }, ...agents.credits.slice(1)] },
    { credits: [{ ...row, roles: { writing: 0, review: 0, other: 0, unspecified: 0 } }, ...agents.credits.slice(1)] },
    { credits: [{ ...row, roles: { ...row.roles, unspecified: 1 } }, ...agents.credits.slice(1)] },
    { credits: [{ ...row, roles: { ...row.roles, constructor: 1 } as never }, ...agents.credits.slice(1)] },
    { credits: [{ ...row, evidence: { ...row.evidence, bodyFooter: 0 } }, ...agents.credits.slice(1)] },
    { credits: [{ ...row, extra: "raw text" } as never, ...agents.credits.slice(1)] },
    { pairs: [pair, pair] }, { pairs: [{ ...pair, prs: 2 }] }, { pairs: [{ ...pair, prs: 0 }] }, { pairs: [{ writer: pair.reviewer, reviewer: pair.writer, prs: 1 }] },
    { pairs: [{ ...pair, writer: "Written by" }] }, { pairs: null as never },
    { hosts: [{ ...host, name: "Codex" }] }, { hosts: [{ ...host, count: 3 }] }, { hosts: [host, host] },
    { hosts: [{ ...host, evidence: { ...host.evidence, bodyFooter: 0, commitTrailer: 1 } }] },
    { hosts: [{ ...host, evidence: { ...host.evidence, commitTrailer: 1 } }] },
    { hosts: [{ ...host, count: 2, evidence: { ...host.evidence, bodyFooter: 2 } }] },
    { harnesses: [] }, { providers: [] },
    { harnesses: agents.harnesses.map((entry, i) => i ? entry : { ...entry, evidence: { ...entry.evidence, bodyFooter: 0, commitTrailer: 1 } }) },
    { harnesses: [{ ...agents.harnesses[0], name: "styal" }] }, { harnesses: [{ ...agents.harnesses[0], count: 2 }] },
    { providers: [{ ...agents.providers[0], name: "unknown model" }] },
    { evidence: { ...agents.evidence, commitTrailer: 0 } }, { attributed: 0 },
    { incompleteCredits: -1 }, { incompleteCredits: valid.total + 1 },
  ];
  for (const change of invalid) assert.equal(await read({ ...valid, agents: { ...agents, ...change } }), null, JSON.stringify(change));
  const { credits: _credits, pairs: _pairs, hosts: _hosts, ...legacy } = agents;
  assert.equal(await read({ ...valid, agents: { ...legacy, share: 1 } }), null);
  const { entries, storage } = memoryStorage();
  entries.set("insights:2026:example-user", { schemaVersion: 2, summary: valid });
  assert.equal(await storedInsights(storage, "example-user", 2026), null);
});
