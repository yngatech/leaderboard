/** Public PR metadata only. No raw bodies, author emails or messages enter the summary. */
export interface InsightPullRequest {
  id: string;
  title: string;
  url: string;
  headRefName: string;
  createdAt: string;
  mergedAt: string | null;
  state: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string; isPrivate: boolean };
  files: { nodes: { path: string; additions: number; deletions: number }[]; pageInfo: { hasNextPage: boolean } } | null;
  commits: {
    totalCount: number;
    nodes: { commit: { message: string; authors: {
      totalCount: number;
      nodes: { name: string | null; email: string | null; user: { login: string } | null }[];
    } } }[];
  };
}

export const MIN_INSIGHT_PRS = 10;
export const SIZE_BUCKETS = [
  { label: "XS", max: 9 }, { label: "S", max: 99 }, { label: "M", max: 499 },
  { label: "L", max: 999 }, { label: "XL", max: Infinity },
] as const;

/** Deliberately small path heuristic, shared by all adjusted size calculations. */
export const EXCLUDED_PATHS = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|uv\.lock|poetry\.lock|bun\.lockb?|dist|build|vendor|generated|node_modules|__snapshots__)(?:\/|$)|(?:\.min\.js|\.map|\.snap)$/i;

export function excludedPath(path: string): boolean {
  return EXCLUDED_PATHS.test(path);
}

export type Intent = "feat" | "fix" | "refactor" | "docs" | "test" | "chore" | "perf" | "ci" | "deps" | "unknown";
export const INTENTS: Intent[] = ["feat", "fix", "refactor", "docs", "test", "chore", "perf", "ci", "deps", "unknown"];
const ALIASES = new Map<string, Intent>(Object.entries({
  feat: "feat", feature: "feat", fix: "fix", bugfix: "fix", hotfix: "fix", refactor: "refactor",
  docs: "docs", doc: "docs", documentation: "docs", readme: "docs",
  test: "test", tests: "test", e2e: "test", chore: "chore", release: "chore", perf: "perf",
  ci: "ci", workflows: "ci", actions: "ci", "github-actions": "ci", build: "ci", bundle: "ci", tooling: "ci",
  deps: "deps", dependencies: "deps", dependabot: "deps", renovate: "deps",
} as const));

export function completeFiles(pr: InsightPullRequest): boolean {
  return !!pr.files && !pr.files.pageInfo.hasNextPage && pr.files.nodes.length === pr.changedFiles;
}

/** Title > branch > exclusive paths. An arbitrary Scoped Commit scope is an area, not an intent. */
export function classifyIntent(pr: InsightPullRequest): { intent: Intent; source: "title" | "branch" | "paths" | "unknown" } {
  const prefix = /^([\w./-]+(?:,\s*[\w./-]+)*)(?:\([^\n)]+\))?!?:\s*\S/.exec(pr.title);
  const tag = /^\[([\w-]+)\]\s*\S/.exec(pr.title);
  const titleType = ALIASES.get((prefix?.[1] ?? tag?.[1] ?? "").toLowerCase());
  if (titleType) return { intent: titleType, source: "title" };
  const branch = /^([\w-]+)\//.exec(pr.headRefName);
  const branchPrefix = /^(\w+)[/-]/.exec(pr.headRefName);
  const branchType = ALIASES.get(branch?.[1].toLowerCase() ?? "") ?? ALIASES.get(branchPrefix?.[1].toLowerCase() ?? "");
  if (branchType) return { intent: branchType, source: "branch" };
  const paths = pr.files?.nodes.map((f) => f.path) ?? [];
  if (completeFiles(pr) && paths.length) {
    const rules: [Intent, RegExp][] = [
      ["docs", /(?:^|\/)(?:docs?|README[^/]*|CHANGELOG[^/]*|LICENSE[^/]*|AGENTS\.md|CLAUDE\.md)(?:\/|$)|\.(?:md|mdx|rst)$/i],
      ["test", /(?:^|\/)(?:tests?|__tests__|__snapshots__|spec)(?:\/|$)|\.(?:test|spec)\.[^/]+$|\.snap$/i],
      ["deps", /(?:^|\/)(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|uv\.lock|poetry\.lock|pyproject\.toml|requirements[^/]*\.txt|bun\.lockb?|\.npmrc)$/i],
      ["ci", /^(?:\.github\/workflows\/|\.circleci\/|\.gitlab-ci\.yml$|Jenkinsfile$)/i],
    ];
    for (const [intent, rule] of rules) {
      if (paths.every((path) => rule.test(path))) return { intent, source: "paths" };
    }
  }
  return { intent: "unknown", source: "unknown" };
}

export type EvidenceKind = "bodyFooter" | "commitTrailer" | "commitAuthor" | "prAuthor";
export const EVIDENCE_KINDS: EvidenceKind[] = ["bodyFooter", "commitTrailer", "commitAuthor", "prAuthor"];
export const UNKNOWN_MODEL = "unknown model";
export const UNKNOWN_HARNESS = "unknown harness";
const BOT_HARNESSES = new Map<string, string>(Object.entries({
  "copilot-swe-agent[bot]": "Copilot", copilot: "Copilot",
  "chatgpt-codex-connector[bot]": "Codex", "cursor[bot]": "Cursor", cursoragent: "Cursor",
  "devin-ai-integration[bot]": "Devin", "google-labs-jules[bot]": "Jules",
  "sweep-ai[bot]": "Sweep", "sweep-ai-deprecated[bot]": "Sweep",
}));
// Exact attribution emails, never display names or substrings of human addresses.
// Cursor: https://cursor.com/docs/cloud-agent/security-network
// Copilot: https://github.com/microsoft/vscode/issues/314311
// Aider: https://github.com/Aider-AI/aider/blob/main/aider/repo.py
// Amp: https://github.com/ampcode/amp-examples-and-guides/tree/main/examples/amp%2Bcodesearch
const AGENT_EMAILS = new Map<string, string>(Object.entries({
  "cursoragent@cursor.com": "Cursor", "copilot@github.com": "Copilot",
  "aider@aider.chat": "Aider", "amp@ampcode.com": "Amp",
}));
const VENDOR_EMAILS = new Map([
  ["noreply@anthropic.com", { provider: "Anthropic", harness: "Claude Code" }],
  ["noreply@openai.com", { provider: "OpenAI", harness: "Codex" }],
]);
const SINGLE_VENDOR = new Map([
  ["Claude Code", "Anthropic"], ["Codex", "OpenAI"], ["Jules", "Google"], ["Gemini CLI", "Google"],
]);
const HARNESS_ALIASES = new Map(Object.entries({
  "claude code": "Claude Code", "claude-code": "Claude Code", codex: "Codex",
  "chatgpt-codex-connector": "Codex", "github copilot": "Copilot", copilot: "Copilot",
  cursor: "Cursor", opencode: "OpenCode", "open code": "OpenCode", devin: "Devin",
  jules: "Jules", "google jules": "Jules", aider: "Aider", amp: "Amp",
  "gemini cli": "Gemini CLI", "t3 code": "T3 Code", styal: "styal", sweep: "Sweep", antigravity: "Antigravity",
}));
const CLIENT_LABELS = [...HARNESS_ALIASES.keys()].sort((a, b) => b.length - a.length);
// Whole model identifiers, not arbitrary leading tokens in prose or dependency names.
// Numeric GPT/o-series syntax deliberately excludes gpt-tokenizer, gpt-next, etc.
const MODEL_PROVIDERS: [string, RegExp][] = [
  ["Anthropic", /^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*/i],
  ["OpenAI", /^(?:gpt-\d+(?:\.\d+)?(?:-[a-z0-9]+)*|o\d+(?:-[a-z0-9]+)*|codex-[a-z0-9]+(?:[.-][a-z0-9]+)*)/i],
  ["Google", /^gemini-\d+(?:[.-][a-z0-9]+)*/i],
  ["xAI", /^grok-(?:\d+|code)(?:[.-][a-z0-9]+)*/i],
  ["Mistral", /^(?:mistral|magistral|ministral|mixtral|codestral|devstral|pixtral)-(?:[a-z0-9]+[.-])*[a-z0-9]+/i],
  ["DeepSeek", /^deepseek-(?:v\d+|r\d+|coder|chat|reasoner)(?:[.-][a-z0-9]+)*/i],
  ["Moonshot/Kimi", /^(?:kimi-(?:k\d+|\d+)|moonshot-v\d+)(?:[.-][a-z0-9]+)*/i],
  ["Qwen/Alibaba", /^qwen(?:\d+(?:\.\d+)?)?-[a-z0-9]+(?:[.-][a-z0-9]+)*/i],
  ["Zhipu/GLM", /^glm-\d+(?:[.-][a-z0-9]+)*/i],
  ["Meta", /^llama-?\d+(?:[.-][a-z0-9]+)*/i],
];
interface Marker { providers: string[]; harnesses: string[]; namedClient?: boolean; inferredHarness?: string }
function harnessMarker(harness: string): Marker {
  return { providers: [SINGLE_VENDOR.get(harness) ?? UNKNOWN_MODEL], harnesses: [harness] };
}
const label = (value: string) => value.trim().replace(/^\[([^\]]+)\]$/, "$1");
function modelProvider(value: string): string | undefined {
  // Identifier-shaped registry prefixes only; never URLs or Markdown targets.
  const model = label(value).replace(/^(?:[a-z0-9][a-z0-9._-]*\/)+/i, "")
    .replace(/^(gpt-\d+(?:\.\d+)?) (sol|astra|terra)$/i, "$1-$2")
    .replace(/^claude (opus|sonnet|haiku) (\d+(?:[.-]\d+)*)$/i, "claude-$1-$2");
  return MODEL_PROVIDERS.find(([, rule]) => rule.exec(model)?.[0] === model)?.[0];
}
/** At most four client labels, joined by explicit connectors or adjacent exact aliases. */
function clientHarnesses(value: string): string[] | null {
  const parts = label(value).toLowerCase().split(/\s+(?:in|through|via|using)\s+|\s*[/+]\s*/);
  if (parts.length > 4) return null;
  const names = new Set<string>();
  for (const part of parts) {
    let rest = part.replace(/^the\s+/, "");
    let count = 0;
    while (rest && count < 4) {
      const alias = CLIENT_LABELS.find((name) => rest === name || rest.startsWith(`${name} `));
      if (!alias) return null;
      names.add(HARNESS_ALIASES.get(alias)!);
      rest = rest.slice(alias.length).replace(/^\s+(?:harness|agent)(?=\s|$)/, "").trim();
      count += 1;
    }
    if (rest || !count || names.size > 4) return null;
  }
  return [...names];
}
/** Each comma-delimited group has its own named-model precedence and fallback. */
function disclosureMarker(fields: string[]): Marker {
  const providers = new Set<string>(), harnesses = new Set<string>();
  for (const raw of fields) {
    const clause = modelClientClause(raw.trim());
    if (clause) {
      clause.providers.forEach((provider) => providers.add(provider));
      clause.harnesses.forEach((harness) => harnesses.add(harness));
      continue;
    }
    clientHarnesses(raw)?.forEach((harness) => harnesses.add(harness));
    const provider = modelProvider(raw);
    if (provider) providers.add(provider);
  }
  // A named model takes precedence over a single-vendor client inference in this marker.
  if (!providers.size) for (const harness of harnesses) {
    const provider = SINGLE_VENDOR.get(harness);
    if (provider) providers.add(provider);
  }
  return { providers: providers.size ? [...providers] : [UNKNOWN_MODEL], harnesses: harnesses.size ? [...harnesses] : [UNKNOWN_HARNESS],
    namedClient: harnesses.size > 0 || fields.some((field) => field.trim() && !modelProvider(field)) };
}
function modelClientClause(value: string): Marker | null {
  const clause = /^(.+?)\s+(?:via|using|in|through)\s+(.+)$/i.exec(value);
  if (clause) {
    const provider = modelProvider(clause[1]);
    if (!provider) return null;
    const clients = clientHarnesses(clause[2]);
    // Unknown clients may be named, but arbitrary prose after a client is not a label.
    if (!clients && !/^(?:the )?[a-z][a-z0-9-]*(?: (?:harness|agent))?$/i.test(clause[2])) return null;
    return { providers: [provider], harnesses: clients ?? [UNKNOWN_HARNESS], namedClient: true };
  }
  return null;
}
/** Generated lines must consist entirely of a label and an optional bounded client clause. */
function generatedMarker(subject: string): Marker | null {
  const value = subject.trim().replace(/[.!?]$/, "");
  const clause = modelClientClause(value);
  if (clause) return clause;
  if (!modelProvider(value) && !clientHarnesses(value)) return null;
  return disclosureMarker([value]);
}
/** Ignore fenced examples, block quotes and indented code before anchored marker matching. */
function prose(text: string): string {
  return text.replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, "$1")
    .split("\n").filter((line) => !/^\s*>|^(?: {4}|\t)/.test(line)).join("\n");
}
function authorMarker(author: { name: string | null; email: string | null; user: { login: string } | null }): Marker | null {
  const bot = BOT_HARNESSES.get(author.user?.login.toLowerCase() ?? "");
  if (bot) return harnessMarker(bot);
  const email = author.email?.trim().toLowerCase() ?? "";
  const vendor = VENDOR_EMAILS.get(email);
  if (vendor) return { providers: [vendor.provider], harnesses: [], inferredHarness: vendor.harness };
  const known = AGENT_EMAILS.get(email);
  if (known) return harnessMarker(known);
  const githubEmail = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email);
  const githubBot = BOT_HARNESSES.get(githubEmail?.[1] ?? "");
  return githubBot ? harnessMarker(githubBot) : null;
}

export type DimensionEvidence = Record<EvidenceKind, string[]>;
const emptyEvidence = (): Record<EvidenceKind, number> => ({ bodyFooter: 0, commitTrailer: 0, commitAuthor: 0, prAuthor: 0 });
export function agentEvidence(pr: InsightPullRequest): { providers: DimensionEvidence; harnesses: DimensionEvidence } {
  const sets = () => ({ bodyFooter: new Set<string>(), commitTrailer: new Set<string>(), commitAuthor: new Set<string>(), prAuthor: new Set<string>() });
  const providers = sets(), harnesses = sets();
  const inferred: { kind: EvidenceKind; marker: Marker }[] = [];
  let namedClient = false;
  const add = (kind: EvidenceKind, marker: Marker | null) => {
    if (marker?.inferredHarness) {
      inferred.push({ kind, marker });
      return;
    }
    if (marker?.namedClient) namedClient = true;
    marker?.providers.forEach((name) => providers[kind].add(name));
    marker?.harnesses.forEach((name) => harnesses[kind].add(name));
  };
  for (const line of prose(pr.body).split("\n")) {
    // Keep link labels, discard targets before parsing any disclosure fields.
    const marker = line.replace(/\[([^\]\n]+)\]\([^\n)]*\)/g, "$1")
      .replace(/^\s*(?:[🤖✨]\s*)?/u, "");
    if (/^Written by an agent\s*\(/i.test(marker)) {
      for (const match of marker.matchAll(/\bby an agent\s*\(([^()\n]+)\)/gi)) {
        for (const group of match[1].split(";")) if (group.trim()) add("bodyFooter", disclosureMarker(group.split(",")));
      }
    } else {
      const generated = /^(?:Generated|Created|Made) (?:with|by)\s+([^\n]+)$/i.exec(marker);
      if (generated) add("bodyFooter", generatedMarker(generated[1]));
    }
  }
  const bot = BOT_HARNESSES.get(pr.author?.login.toLowerCase() ?? "");
  if (bot) add("prAuthor", harnessMarker(bot));
  for (const { commit } of pr.commits.nodes) {
    const trailerBlock = prose(commit.message).trim().split(/\n\s*\n/).at(-1) ?? "";
    for (const match of trailerBlock.matchAll(/^co-authored-by:\s*(.+)$/gim)) {
      const identity = /^([^<>]+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(match[1]);
      if (identity) add("commitTrailer", authorMarker({ name: identity[1].trim(), email: identity[2], user: null }));
    }
    for (const author of commit.authors.nodes) add("commitAuthor", authorMarker(author));
  }
  // Vendor addresses establish providers. Infer their usual client only when no
  // explicit client is named anywhere on the PR, independent of evidence order.
  const explicitHarness = namedClient || Object.values(harnesses).some((names) => [...names].some((name) => name !== UNKNOWN_HARNESS));
  for (const { kind, marker } of inferred) {
    marker.providers.forEach((name) => providers[kind].add(name));
    if (!explicitHarness) harnesses[kind].add(marker.inferredHarness!);
  }
  const lists = (dimension: ReturnType<typeof sets>) => Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, [...dimension[kind]].sort()])) as DimensionEvidence;
  return { providers: lists(providers), harnesses: lists(harnesses) };
}

export interface AttributionCount {
  name: string;
  count: number;
  evidence: Record<EvidenceKind, number>;
}

export interface PrInsights {
  login: string;
  accounts: string[];
  year: number;
  generatedAt: string;
  total: number;
  size: {
    measured: number; incomplete: number; median: number | null; smallShare: number | null;
    buckets: { label: string; count: number }[];
    biggestNetDeletion: { url: string; lines: number } | null;
  };
  intent: { mix: Record<Intent, number>; sources: Record<string, number> };
  agents: {
    attributed: number; share: number | null; providers: AttributionCount[]; harnesses: AttributionCount[];
    evidence: Record<EvidenceKind, number>; incompleteCommits: number;
  };
}

export function aggregateInsights(login: string, accounts: readonly string[], year: number, prs: readonly InsightPullRequest[], generatedAt: string): PrInsights {
  const eligible = [...new Map(prs.filter((pr) => !pr.repository.isPrivate &&
    pr.createdAt.slice(0, 4) === String(year) && accounts.some((account) => account.toLowerCase() === pr.author?.login.toLowerCase()))
    .map((pr) => [pr.id, pr])).values()];
  const sizes: number[] = [];
  const buckets = SIZE_BUCKETS.map(({ label }) => ({ label, count: 0 }));
  let biggestNetDeletion: PrInsights["size"]["biggestNetDeletion"] = null;
  const mix = Object.fromEntries(INTENTS.map((kind) => [kind, 0])) as Record<Intent, number>;
  const sources: Record<string, number> = { title: 0, branch: 0, paths: 0, unknown: 0 };
  const evidence = emptyEvidence();
  const providers = new Map<string, AttributionCount>(), harnesses = new Map<string, AttributionCount>();
  let attributed = 0, incompleteCommits = 0;
  for (const pr of eligible) {
    if (completeFiles(pr)) {
      const files = pr.files!.nodes.filter((file) => !excludedPath(file.path));
      const additions = files.reduce((n, f) => n + f.additions, 0);
      const deletions = files.reduce((n, f) => n + f.deletions, 0);
      const size = additions + deletions;
      sizes.push(size);
      buckets[SIZE_BUCKETS.findIndex((b) => size <= b.max)].count += 1;
      if (deletions > additions && deletions - additions > (biggestNetDeletion?.lines ?? 0))
        biggestNetDeletion = { url: pr.url, lines: deletions - additions };
    }
    const intent = classifyIntent(pr);
    mix[intent.intent] += 1;
    sources[intent.source] += 1;
    const found = agentEvidence(pr);
    for (const kind of EVIDENCE_KINDS) if (found.providers[kind].length) evidence[kind] += 1;
    if (Object.values(found.providers).some((names) => names.length)) attributed += 1;
    for (const [dimension, counts] of [[found.providers, providers], [found.harnesses, harnesses]] as const) {
      for (const name of new Set(Object.values(dimension).flat())) {
        const entry = counts.get(name) ?? { name, count: 0, evidence: emptyEvidence() };
        entry.count += 1;
        for (const kind of EVIDENCE_KINDS) if (dimension[kind].includes(name)) entry.evidence[kind] += 1;
        counts.set(name, entry);
      }
    }
    if (pr.commits.nodes.length < pr.commits.totalCount || pr.commits.nodes.some(({ commit }) => commit.authors.nodes.length < commit.authors.totalCount)) incompleteCommits += 1;
  }
  const sorted = (counts: Map<string, AttributionCount>) => [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  sizes.sort((a, b) => a - b);
  const middle = Math.floor(sizes.length / 2);
  return {
    login, accounts: [...accounts], year, generatedAt, total: eligible.length,
    size: { measured: sizes.length, incomplete: eligible.length - sizes.length,
      median: sizes.length ? (sizes[middle] + sizes[Math.floor((sizes.length - 1) / 2)]) / 2 : null,
      smallShare: sizes.length ? sizes.filter((n) => n < 100).length / sizes.length : null,
      buckets, biggestNetDeletion },
    intent: { mix, sources },
    agents: { attributed, share: eligible.length ? attributed / eligible.length : null,
      providers: sorted(providers), harnesses: sorted(harnesses),
      evidence, incompleteCommits },
  };
}
