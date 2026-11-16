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
/** Declared roles. `unspecified` is a credit that names an agent without saying what it did. */
export type CreditRole = "writing" | "review" | "other" | "unspecified";
export const CREDIT_ROLES: CreditRole[] = ["writing", "review", "other", "unspecified"];
/** Where agents ran. Hosts are not harnesses, and a host never implies one. */
export const HOSTS = ["styal", "T3 Code"] as const;
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
// Vendor addresses establish a provider only; they do not say which client or model was used.
const VENDOR_EMAILS = new Map([["noreply@anthropic.com", "Anthropic"], ["noreply@openai.com", "OpenAI"]]);
/** Clients that only run one vendor's models, so name the provider when no model is stated. */
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
// Command names that are unambiguous inside a structured credit, never in prose.
const CREDIT_COMMANDS = new Map([["claude", "Claude Code"], ["pi", "Pi"]]);
const CLIENT_LABELS = [...HARNESS_ALIASES.keys()].sort((a, b) => b.length - a.length);
const isHost = (name: string) => (HOSTS as readonly string[]).includes(name);
export const KNOWN_HARNESSES: ReadonlySet<string> = new Set([...HARNESS_ALIASES.values(), ...CREDIT_COMMANDS.values(),
  ...BOT_HARNESSES.values(), ...AGENT_EMAILS.values()].filter((name) => !isHost(name)));
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
export const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([...MODEL_PROVIDERS.map(([name]) => name), ...SINGLE_VENDOR.values(), ...VENDOR_EMAILS.values()]);
/** Stored model identifiers: lowercase, bounded, with optional registry segments. */
export const MODEL_ID = /^(?=.{1,80}$)[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
export function providerForModel(model: string): string | null {
  return MODEL_PROVIDERS.find(([, rule]) => rule.exec(model)?.[0] === model)?.[0] ?? null;
}
const label = (value: string) => value.trim().replace(/^\[([^\]]+)\]$/, "$1");
/**
 * An exact model identifier. Known spellings normalize ("GPT-6.1 Sol", "Claude Opus 4.6",
 * registry prefixes); versions and variants are kept. Unrecognized identifiers are models
 * only where the surrounding grammar says so (`structured`).
 */
function modelId(value: string, structured: boolean): { model: string; provider: string | null } | null {
  const model = label(value).replace(/^(gpt-\d+(?:\.\d+)?) (sol|astra|terra)$/i, "$1-$2")
    .replace(/^claude (opus|sonnet|haiku) (\d+(?:[.-]\d+)*)$/i, "claude-$1-$2").toLowerCase();
  if (!MODEL_ID.test(model)) return null;
  // Identifier-shaped registry prefixes only; never URLs or Markdown targets.
  const bare = model.replace(/^(?:[a-z0-9][a-z0-9._-]*\/)+/, "");
  const provider = providerForModel(bare);
  // Normalize numeric Claude version aliases without rewriting variant punctuation.
  if (provider) return { model: provider === "Anthropic"
    ? bare.replace(/^(claude-(?:[a-z]+-)?)(\d+(?:\.\d+)+)/, (_match, prefix: string, version: string) => prefix + version.replaceAll(".", "-"))
    : bare, provider };
  return structured ? { model, provider: null } : null;
}
/** At most four client labels, joined by explicit connectors or adjacent exact aliases. */
function clientNames(value: string): string[] | null {
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

/** One credited agent as stated in one marker. Null means not stated or not recognized. */
interface Observation { provider: string | null; model: string | null; harness: string | null; roles: CreditRole[] }
interface Parsed { observations: Observation[]; hosts: string[]; limited?: true }
const MAX_CREDIT_LINE = 1024;
const MAX_MARKER_CREDITS = 8;
const MAX_PR_CREDITS = 16;
interface Fragment { models: { model: string; provider: string | null }[]; harnesses: string[]; hosts: string[] }
function fragment(models: Fragment["models"], clients: string[]): Fragment {
  return { models, harnesses: clients.filter((name) => !isHost(name)), hosts: clients.filter(isHost) };
}
function observation(model: { model: string; provider: string | null } | null, harness: string | null, roles: CreditRole[]): Observation {
  // A stated model decides the provider; only an unnamed model falls back to a single-vendor client.
  return { model: model?.model ?? null, provider: model ? model.provider : SINGLE_VENDOR.get(harness ?? "") ?? null, harness, roles };
}
/** `model via|using|in|through client`; unknown clients may be named, prose may not. */
function modelClientClause(value: string): Fragment | null {
  const clause = /^(.+?)\s+(?:via|using|in|through)\s+(.+)$/i.exec(value);
  if (!clause) return null;
  const model = modelId(clause[1], false);
  if (!model) return null;
  const clients = clientNames(clause[2]);
  if (!clients && !/^(?:the )?[a-z][a-z0-9-]*(?: (?:harness|agent))?$/i.test(clause[2])) return null;
  return fragment([model], clients ?? []);
}
/**
 * A comma-delimited disclosure group describes one agent. A single model and a single
 * harness pair up; anything more is ambiguous and each stays unpaired.
 */
function disclosure(fields: string[], roles: CreditRole[]): Parsed {
  const parts = fields.map((raw) => {
    const value = raw.trim();
    const clients = clientNames(value);
    const model = clients ? null : modelId(value, false);
    return modelClientClause(value) ?? fragment(model ? [model] : [], clients ?? []);
  });
  const models = [...new Map(parts.flatMap((part) => part.models).map((model) => [model.model, model])).values()];
  const harnesses = [...new Set(parts.flatMap((part) => part.harnesses))];
  const hosts = [...new Set(parts.flatMap((part) => part.hosts))];
  if (models.length <= 1 && harnesses.length <= 1) return { observations: [observation(models[0] ?? null, harnesses[0] ?? null, roles)], hosts };
  return { observations: [...models.map((model) => observation(model, null, roles)), ...harnesses.map((harness) =>
    models.length ? { provider: null, model: null, harness, roles } : observation(null, harness, roles))], hosts };
}
/** Generated lines must consist entirely of a label and an optional bounded client clause. */
function generatedCredit(subject: string): Parsed | null {
  const value = subject.trim().replace(/[.!?]$/, "");
  if (!modelClientClause(value) && !modelId(value, false) && !clientNames(value)) return null;
  return disclosure([value], ["unspecified"]);
}
const VERB_ROLES = new Map<string, CreditRole>([
  ["written", "writing"], ["implemented", "writing"], ["fixed", "writing"], ["revised", "writing"],
  ["reviewed", "review"], ["re-checked", "review"], ["rechecked", "review"],
  ["designed", "other"], ["diagnosed", "other"], ["planned", "other"], ["tested", "other"], ["verified", "other"], ["audited", "other"],
]);
function verbRoles(verbs: string): CreditRole[] {
  const roles = new Set(verbs.toLowerCase().split(/\s+and\s+/).map((verb) => VERB_ROLES.get(verb.trim()) ?? "unspecified"));
  if (roles.size > 1) roles.delete("unspecified");
  return [...roles];
}
const CREDIT_VERB = `(?:${[...VERB_ROLES.keys()].join("|")})`;
const CREDIT_CLAUSE = new RegExp(`^(?:,\\s+(?:and\\s+)?|\\s+and\\s+)(?:with (?:the [a-z]+ )?)?(${CREDIT_VERB}(?: and ${CREDIT_VERB})*) by\\s+`, "i");
/** One backticked `client/model` label at the start of `text`. */
function creditParticipant(text: string, roles: CreditRole[]): Parsed & { length: number; recognized: boolean } | null {
  const participant = /^`([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)`/i.exec(text);
  const model = participant && modelId(participant[2], true);
  if (!participant || !model) return null;
  const client = participant[1].toLowerCase();
  const name = CREDIT_COMMANDS.get(client) ?? HARNESS_ALIASES.get(client) ?? null;
  const host = name !== null && isHost(name);
  const recognized = name !== null || model.provider !== null;
  return { length: participant[0].length, recognized, hosts: host ? [name] : [],
    observations: recognized ? [observation(model, host ? null : name, roles)] : [] };
}
/** Consume a whole footer, keeping backticked harness/model labels distinct from prose. */
function creditFooter(line: string): Parsed | null {
  if (!/^Written by\s+`/i.test(line)) return null;
  let rest = line.replace(/^Written by\s+/i, "").trimEnd().replace(/\.$/, "");
  // Bounded whitespace avoids rescanning long runs quadratically at each position.
  const host = /,?[ \t]{1,3}in[ \t]{1,3}(styal(?:[ \t]{0,3}🧵)?|T3 Code)$/iu.exec(rest);
  if (host) rest = rest.slice(0, host.index);
  const hosts = new Set(host ? [/^styal/i.test(host[1]) ? "styal" : "T3 Code"] : []);
  const observations: Observation[] = [];
  let roles: CreditRole[] = ["writing"], recognized = false, participants = 0;
  while (rest) {
    if (++participants > MAX_MARKER_CREDITS) return { observations: [], hosts: [], limited: true };
    const participant = creditParticipant(rest, roles);
    if (!participant) return null;
    recognized ||= participant.recognized;
    participant.hosts.forEach((name) => hosts.add(name));
    observations.push(...participant.observations);
    rest = rest.slice(participant.length);
    if (!rest) break;
    const list = /^(?:,\s*(?:and\s+)?|\s+and\s+)(?=`)/i.exec(rest);
    const clause = list ? null : CREDIT_CLAUSE.exec(rest);
    if (!list && !clause) return null;
    if (clause) roles = verbRoles(clause[1]);
    rest = rest.slice((list ?? clause)![0].length);
    if (!rest) return null;
  }
  // A path-shaped code span alone (e.g. scripts/generate.ts) is not an agent credit.
  return recognized ? { observations, hosts: [...hosts] } : null;
}
/** Ignore fenced examples, block quotes and indented code before anchored marker matching. */
function prose(text: string): string {
  return text.replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, "$1")
    .split("\n").filter((line) => !/^\s*>|^(?: {4}|\t)/.test(line)).join("\n");
}
function harnessIdentity(harness: string): Observation {
  return observation(null, harness, ["unspecified"]);
}
function authorIdentity(author: { name: string | null; email: string | null; user: { login: string } | null }): Observation | null {
  const bot = BOT_HARNESSES.get(author.user?.login.toLowerCase() ?? "");
  if (bot) return harnessIdentity(bot);
  const email = author.email?.trim().toLowerCase() ?? "";
  const vendor = VENDOR_EMAILS.get(email);
  if (vendor) return { provider: vendor, model: null, harness: null, roles: ["unspecified"] };
  const known = AGENT_EMAILS.get(email);
  if (known) return harnessIdentity(known);
  const githubEmail = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email);
  const githubBot = BOT_HARNESSES.get(githubEmail?.[1] ?? "");
  return githubBot ? harnessIdentity(githubBot) : null;
}

/** One PR's credit for one model/provider/harness combination, after deduplication. */
export interface PrCredit { provider: string | null; model: string | null; harness: string | null; roles: CreditRole[]; evidence: EvidenceKind[] }
interface Cell { provider: string | null; model: string | null; harness: string | null; roles: Set<CreditRole>; evidence: Set<EvidenceKind>; markers: Set<number> }
const FIELDS = ["provider", "model", "harness"] as const;
const cellKey = (cell: Pick<Cell, (typeof FIELDS)[number]>) => JSON.stringify(FIELDS.map((field) => cell[field]));
/** Every field `general` states, `specific` states identically. */
const inferredProvider = (cell: Cell) => cell.model === null && cell.harness !== null && cell.provider === SINGLE_VENDOR.get(cell.harness);
const within = (general: Cell, specific: Cell) => general !== specific && FIELDS.every((field) => general[field] === null ||
  (field === "provider" && inferredProvider(general)) || general[field] === specific[field]);
/** Separate agents named by one marker are distinct; only repeats from other markers fold. */
const elsewhere = (cell: Cell, other: Cell) => [...cell.markers].every((marker) => !other.markers.has(marker));
const stated = (cell: Cell) => FIELDS.filter((field) => cell[field] !== null && (field !== "provider" || !inferredProvider(cell))).length;
function settleRoles(roles: Set<CreditRole>): void {
  if (roles.size > 1) roles.delete("unspecified");
}
/**
 * Fold less specific credits from other markers into the one credit they could only describe. A vague
 * credit that fits several stays separate if it declares a role, and is otherwise
 * already represented. Roles are never moved onto a credit that did not declare them.
 */
function settle(observations: { kind: EvidenceKind; marker: number; observation: Observation }[]): PrCredit[] {
  const exact = new Map<string, Cell>();
  for (const { kind, marker, observation: { provider, model, harness, roles } } of observations) {
    const key = cellKey({ provider, model, harness });
    const cell = exact.get(key) ?? { provider, model, harness, roles: new Set(), evidence: new Set(), markers: new Set() };
    cell.markers.add(marker);
    roles.forEach((role) => cell.roles.add(role));
    cell.evidence.add(kind);
    settleRoles(cell.roles);
    exact.set(key, cell);
  }
  const kept: Cell[] = [];
  for (const cell of [...exact.values()].sort((a, b) => stated(b) - stated(a))) {
    const candidates = kept.filter((other) => within(cell, other) && elsewhere(cell, other));
    const targets = candidates.filter((other) => !candidates.some((wider) => within(other, wider)));
    const declared = [...cell.roles].filter((role) => role !== "unspecified");
    if (targets.length === 1 && declared.every((role) => targets[0].roles.has(role))) {
      cell.evidence.forEach((kind) => targets[0].evidence.add(kind));
    } else if (!(targets.length > 1 && !declared.length)) kept.push(cell);
  }
  return kept.map((cell) => ({ provider: cell.provider, model: cell.model, harness: cell.harness,
    roles: CREDIT_ROLES.filter((role) => cell.roles.has(role)), evidence: EVIDENCE_KINDS.filter((kind) => cell.evidence.has(kind)) }))
    .sort((a, b) => cellKey(a).localeCompare(cellKey(b)));
}

/** Legacy groups share one credit line, with a declared verb before each clause. */
function legacyCredits(text: string): Parsed {
  const groups: Parsed[] = [];
  for (const match of text.matchAll(/\bby an agent\s*\(([^()\n]+)\)/gi)) {
    const before = text.slice(Math.max(0, match.index - 48), match.index);
    const verbs = /([a-z][a-z-]*(?:\s+and\s+[a-z][a-z-]*)*)\s+$/i.exec(before);
    // A negated clause names an agent that did not do the work, not a credit.
    const qualifier = before.slice(0, verbs?.index ?? before.length);
    if (/\b(?:not|never|no|without|wasn['’]t|isn['’]t|weren['’]t|aren['’]t|didn['’]t|hasn['’]t|haven['’]t|hadn['’]t)\s+(?:[a-z-]+\s+){0,2}$/i.test(qualifier)) continue;
    const roles = verbRoles(verbs?.[1] ?? "");
    for (const group of match[1].split(";")) if (group.trim()) groups.push(disclosure(group.split(","), roles));
  }
  return { observations: groups.flatMap((group) => group.observations), hosts: [...new Set(groups.flatMap((group) => group.hosts))] };
}

/** Transient per-PR credits. Raw text and identities never leave this function. */
export function agentCredits(pr: InsightPullRequest): { credits: PrCredit[]; hosts: string[]; evidence: EvidenceKind[]; limited?: true } {
  const found: { kind: EvidenceKind; marker: number; observation: Observation }[] = [];
  const hosts = new Set<string>();
  const identities = new Set<string>();
  let limited = false;
  let marker = 0; // Which line, trailer or identity an observation came from.
  const add = (kind: EvidenceKind, parsed: Parsed | null) => {
    if (!parsed) return;
    if (parsed.limited || parsed.observations.length > MAX_MARKER_CREDITS) { limited = true; return; }
    let accepted = false;
    for (const observation of parsed.observations) {
      const key = cellKey(observation);
      if (!identities.has(key) && identities.size >= MAX_PR_CREDITS) { limited = true; continue; }
      identities.add(key);
      found.push({ kind, marker, observation });
      accepted = true;
    }
    if (accepted) parsed.hosts.forEach((host) => hosts.add(host));
  };
  for (const line of prose(pr.body).split("\n")) {
    marker += 1;
    // Limit work before link/model/client regexes, including malformed disclosure lines.
    if (line.length > MAX_CREDIT_LINE) {
      if (/^\s*(?:[🤖✨]\s*)?(?:Written by\b|(?:Generated|Created|Made) (?:with|by)\b)/iu.test(line)) limited = true;
      continue;
    }
    // Keep link labels, discard targets before parsing any disclosure fields.
    const text = line.replace(/\[([^\]\n]+)\]\([^\n)]*\)/g, "$1").replace(/^\s*(?:[🤖✨]\s*)?/u, "");
    if (/^Written by an agent\s*\(/i.test(text)) {
      add("bodyFooter", legacyCredits(text));
    } else {
      add("bodyFooter", creditFooter(text));
      const generated = /^(?:Generated|Created|Made) (?:with|by)\s+([^\n]+)$/i.exec(text);
      if (generated) add("bodyFooter", generatedCredit(generated[1]));
    }
  }
  const single = (observation: Observation | null): Parsed | null => observation && { observations: [observation], hosts: [] };
  const bot = BOT_HARNESSES.get(pr.author?.login.toLowerCase() ?? "");
  marker += 1;
  if (bot) add("prAuthor", single(harnessIdentity(bot)));
  for (const { commit } of pr.commits.nodes) {
    const trailerBlock = prose(commit.message).trim().split(/\n\s*\n/).at(-1) ?? "";
    for (const match of trailerBlock.matchAll(/^co-authored-by:\s*(.+)$/gim)) {
      if (match[1].length > MAX_CREDIT_LINE) { limited = true; continue; }
      const identity = /^([^<>]+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(match[1]);
      marker += 1;
      if (identity) add("commitTrailer", single(authorIdentity({ name: identity[1].trim(), email: identity[2], user: null })));
    }
    for (const author of commit.authors.nodes) {
      marker += 1;
      add("commitAuthor", single(authorIdentity(author)));
    }
  }
  return { credits: settle(found), hosts: [...hosts].sort(), evidence: EVIDENCE_KINDS.filter((kind) => found.some((entry) => entry.kind === kind)),
    ...(limited ? { limited: true as const } : {}) };
}

const emptyEvidence = (): Record<EvidenceKind, number> => ({ bodyFooter: 0, commitTrailer: 0, commitAuthor: 0, prAuthor: 0 });
const emptyRoles = (): Record<CreditRole, number> => ({ writing: 0, review: 0, other: 0, unspecified: 0 });

/** PRs naming a provider, harness or host. Unnamed values stay out; credit rows keep them visible. */
export interface AttributionCount {
  name: string;
  count: number;
  evidence: Record<EvidenceKind, number>;
}
/** PRs crediting one exact model/harness combination, once per PR per role. */
export interface CreditRow {
  model: string | null;
  provider: string | null;
  harness: string | null;
  prs: number;
  roles: Record<CreditRole, number>;
  evidence: Record<EvidenceKind, number>;
}
/** PRs on which a declared writer model and a declared reviewer model both appear. */
export interface CreditPair { writer: string; reviewer: string; prs: number }

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
    attributed: number; credits: CreditRow[]; pairs: CreditPair[];
    providers: AttributionCount[]; harnesses: AttributionCount[]; hosts: AttributionCount[];
    evidence: Record<EvidenceKind, number>; incompleteCommits: number; incompleteCredits: number;
  };
}

const byName = (a: string | null, b: string | null) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b);
export function compareCredits(a: CreditRow, b: CreditRow): number {
  return b.prs - a.prs || byName(a.model, b.model) || byName(a.provider, b.provider) || byName(a.harness, b.harness);
}

/** Persistent credit aggregates: PR counts only, never per-PR observations. */
function creditTally() {
  const evidence = emptyEvidence();
  const rows = new Map<string, CreditRow>(), pairs = new Map<string, CreditPair>();
  const named = { providers: new Map<string, AttributionCount>(), harnesses: new Map<string, AttributionCount>(), hosts: new Map<string, AttributionCount>() };
  const tally = (counts: Map<string, AttributionCount>, name: string, kinds: Iterable<EvidenceKind>) => {
    const entry = counts.get(name) ?? { name, count: 0, evidence: emptyEvidence() };
    entry.count += 1;
    for (const kind of kinds) entry.evidence[kind] += 1;
    counts.set(name, entry);
  };
  let attributed = 0;
  const add = (found: ReturnType<typeof agentCredits>) => {
    if (found.credits.length) attributed += 1;
    for (const kind of found.evidence) evidence[kind] += 1;
    for (const credit of found.credits) {
      const key = cellKey(credit);
      const row = rows.get(key) ?? { model: credit.model, provider: credit.provider, harness: credit.harness, prs: 0, roles: emptyRoles(), evidence: emptyEvidence() };
      row.prs += 1;
      for (const role of credit.roles) row.roles[role] += 1;
      for (const kind of credit.evidence) row.evidence[kind] += 1;
      rows.set(key, row);
    }
    for (const [field, counts] of [["provider", named.providers], ["harness", named.harnesses]] as const) {
      const names = new Set(found.credits.map((credit) => credit[field]).filter((name) => name !== null));
      for (const name of names) tally(counts, name, new Set(found.credits.filter((credit) => credit[field] === name).flatMap((credit) => credit.evidence)));
    }
    for (const host of found.hosts) tally(named.hosts, host, ["bodyFooter"]);
    // Only credits that state both a model and a role pair up, once per PR.
    const declared = (role: CreditRole) => new Set(found.credits.filter((credit) => credit.model && credit.roles.includes(role)).map((credit) => credit.model!));
    const reviewers = declared("review");
    for (const writer of declared("writing")) for (const reviewer of reviewers) {
      const key = JSON.stringify([writer, reviewer]);
      const pair = pairs.get(key) ?? { writer, reviewer, prs: 0 };
      pair.prs += 1;
      pairs.set(key, pair);
    }
  };
  const sorted = (counts: Map<string, AttributionCount>) => [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const summary = () => ({ attributed, credits: [...rows.values()].sort(compareCredits),
    pairs: [...pairs.values()].sort((a, b) => b.prs - a.prs || a.writer.localeCompare(b.writer) || a.reviewer.localeCompare(b.reviewer)),
    providers: sorted(named.providers), harnesses: sorted(named.harnesses), hosts: sorted(named.hosts), evidence });
  return { add, summary };
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
  const credits = creditTally();
  let incompleteCommits = 0, incompleteCredits = 0;
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
    const found = agentCredits(pr);
    credits.add(found);
    if (found.limited) incompleteCredits += 1;
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
    agents: { ...credits.summary(), incompleteCommits, incompleteCredits },
  };
}
