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
const BOT_AGENTS = new Map<string, string>(Object.entries({
  "copilot-swe-agent[bot]": "Copilot", copilot: "Copilot",
  "chatgpt-codex-connector[bot]": "Codex", "cursor[bot]": "Cursor", cursoragent: "Cursor",
  "devin-ai-integration[bot]": "Devin", "google-labs-jules[bot]": "Jules",
  "sweep-ai[bot]": "Sweep", "sweep-ai-deprecated[bot]": "Sweep",
}));
// Exact attribution emails, never display names or substrings of human addresses.
// Cursor: https://cursor.com/docs/cloud-agent/security-network
// Copilot: https://github.com/microsoft/vscode/issues/314311
const AGENT_EMAILS = new Map<string, string>(Object.entries({
  "noreply@anthropic.com": "Claude", "noreply@openai.com": "Codex",
  "cursoragent@cursor.com": "Cursor", "copilot@github.com": "Copilot",
}));
/** Client/model labels are interpreted only inside an explicit prose disclosure. */
function disclosureAgents(text: string): string[] {
  const rules: [string, RegExp][] = [
    ["Claude", /\bclaude(?: code|[- ](?:opus|sonnet|haiku))?\b/i], ["Codex", /\bcodex\b|\bgpt-[a-z0-9][\w.-]*/i],
    ["Cursor", /\bcursor(?: agent)?\b/i], ["Copilot", /\bcopilot\b/i], ["Devin", /\bdevin\b/i],
    ["Jules", /\bjules\b/i], ["Aider", /\baider\b/i], ["Amp", /\bamp\b/i],
    ["OpenCode", /\bopencode\b/i], ["Gemini", /\bgemini\b/i],
  ];
  return rules.filter(([, rule]) => rule.test(text)).map(([name]) => name);
}
/** Ignore fenced examples, block quotes and indented code before anchored marker matching. */
function prose(text: string): string {
  return text.replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, "$1")
    .split("\n").filter((line) => !/^\s*>|^(?: {4}|\t)/.test(line)).join("\n");
}
function authorAgents(author: { name: string | null; email: string | null; user: { login: string } | null }): string[] {
  const bot = BOT_AGENTS.get(author.user?.login.toLowerCase() ?? "");
  if (bot) return [bot];
  const email = author.email?.trim().toLowerCase() ?? "";
  const known = AGENT_EMAILS.get(email);
  if (known) return [known];
  const githubEmail = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email);
  const githubBot = BOT_AGENTS.get(githubEmail?.[1] ?? "");
  return githubBot ? [githubBot] : [];
}

export function agentEvidence(pr: InsightPullRequest): Record<EvidenceKind, string[]> {
  const sets = { bodyFooter: new Set<string>(), commitTrailer: new Set<string>(), commitAuthor: new Set<string>(), prAuthor: new Set<string>() };
  const add = (kind: EvidenceKind, names: string[]) => names.forEach((name) => sets[kind].add(name));
  for (const line of prose(pr.body).split("\n")) {
    if (/^\s*(?:[🤖✨]\s*)?(?:Written by an agent\s*\(|(?:Generated|Created|Made) (?:with|by)\s+)/iu.test(line)) {
      const names = disclosureAgents(line);
      if (names.length) add("bodyFooter", names);
      else if (/Written by an agent/i.test(line)) add("bodyFooter", ["Other agent"]);
    }
  }
  const bot = BOT_AGENTS.get(pr.author?.login.toLowerCase() ?? "");
  if (bot) add("prAuthor", [bot]);
  for (const { commit } of pr.commits.nodes) {
    // Only the final paragraph can be a Git trailer block.
    const trailerBlock = prose(commit.message).trim().split(/\n\s*\n/).at(-1) ?? "";
    for (const match of trailerBlock.matchAll(/^co-authored-by:\s*(.+)$/gim)) {
      const identity = /^([^<>]+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(match[1]);
      if (identity) add("commitTrailer", authorAgents({ name: identity[1].trim(), email: identity[2], user: null }));
    }
    for (const author of commit.authors.nodes) {
      add("commitAuthor", authorAgents(author));
    }
  }
  return Object.fromEntries(Object.entries(sets).map(([kind, values]) => [kind, [...values].sort()])) as Record<EvidenceKind, string[]>;
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
    attributed: number; share: number | null; agents: { name: string; count: number }[];
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
  const evidence: Record<EvidenceKind, number> = { bodyFooter: 0, commitTrailer: 0, commitAuthor: 0, prAuthor: 0 };
  const agents = new Map<string, number>();
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
    for (const kind of Object.keys(evidence) as EvidenceKind[]) if (found[kind].length) evidence[kind] += 1;
    const union = new Set(Object.values(found).flat());
    if (union.size) attributed += 1;
    for (const name of union) agents.set(name, (agents.get(name) ?? 0) + 1);
    if (pr.commits.nodes.length < pr.commits.totalCount || pr.commits.nodes.some(({ commit }) => commit.authors.nodes.length < commit.authors.totalCount)) incompleteCommits += 1;
  }
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
      agents: [...agents].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      evidence, incompleteCommits },
  };
}
