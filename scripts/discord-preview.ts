/**
 * Renders every Discord notification from fixed synthetic events, and compares
 * two renderings as Markdown for the pull request preview comment.
 *
 *   node scripts/discord-preview.ts render <root>            JSON map of id to webhook request
 *   node scripts/discord-preview.ts compare <base> <head>    Markdown comparing two renderings
 *
 * `render` imports the worker modules under `<root>`, so this branch's
 * catalogue can render another checkout's source. It prints `null` when that
 * checkout predates `worker/notification-embeds.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Discord from "../worker/discord.ts";
import type * as Embeds from "../worker/notification-embeds.ts";
import type { DiscordNotification } from "../worker/discord.ts";
import type { StandingEntry } from "../worker/notifications.ts";

interface Modules {
  discord: typeof Discord;
  embeds: typeof Embeds;
}

/** The webhook query string and JSON body a notification posts. */
interface Request {
  query: string;
  payload: unknown;
}

type Rendered = Request | { error: string };
type Rendering = Record<string, Rendered> | null;

const YEAR = 2026;
const WEBHOOK_URL = "https://discord.example/api/webhooks/0/preview";
const MAPPED_USER_ID = "100000000000000002";
/** `example-two` is mapped to a Discord user, so its notifications become cards. */
const USER_IDS: ReadonlyMap<string, string> = new Map([["example-two", MAPPED_USER_ID]]);

function person(login: string, totalContributions = 0): StandingEntry {
  return {
    login,
    url: `https://github.com/${login}`,
    avatarUrl: `https://avatars.example/${login}`,
    totalContributions,
  };
}

const ONE = person("example-one", 1234);
const TWO = person("example-two", 1180);
const THREE = person("example-three", 987);

function peak({ login, url, avatarUrl }: StandingEntry, date: string, count: number) {
  return { login, url, avatarUrl, date, count };
}

/*
 * The catalogue is keyed by notification type, so adding a type without a
 * sample fails typecheck. Each type maps sample ids to inputs; add more ids
 * for variants such as a mapped Discord user.
 */

type Yearly = Embeds.YearlyNotification;

/** One group per type `notificationEmbed` accepts. */
const YEARLY: { [K in Yearly["type"]]: Record<string, Extract<Yearly, { type: K }>> } = {
  leader: {
    "standing/leader": { type: "leader", event: { leader: ONE } },
    "standing/leader-mapped": { type: "leader", event: { leader: TWO } },
  },
  overtake: {
    "standing/overtake": { type: "overtake", event: { position: 2, mover: THREE, displaced: ONE } },
    "standing/overtake-mapped": { type: "overtake", event: { position: 1, mover: TWO, displaced: ONE } },
  },
  "personal-best": {
    "daily-record/personal-best": {
      type: "personal-best",
      event: { ...peak(ONE, "2026-03-14", 1042), previousCount: 87 },
    },
    "daily-record/personal-best-first": {
      type: "personal-best",
      event: { ...peak(THREE, "2026-01-02", 12), previousCount: 0 },
    },
    "daily-record/personal-best-mapped": {
      type: "personal-best",
      event: { ...peak(TWO, "2026-03-14", 64), previousCount: 40 },
    },
  },
  "board-record": {
    "daily-record/board-record": {
      type: "board-record",
      event: { peak: peak(ONE, "2026-03-14", 1042), previousCount: 210 },
    },
    "daily-record/board-record-first": {
      type: "board-record",
      event: { peak: peak(THREE, "2026-01-02", 12), previousCount: 0 },
    },
  },
  "personal-best-wrap-up": {
    "daily-record/personal-best-wrap-up": {
      type: "personal-best-wrap-up",
      event: { ...peak(ONE, "2026-03-14", 1100), announcedCount: 1042 },
    },
    // A wrap-up for 31 December is posted in the new year.
    "daily-record/personal-best-wrap-up-new-year": {
      type: "personal-best-wrap-up",
      event: { ...peak(THREE, "2025-12-31", 75), announcedCount: 60 },
    },
  },
  "board-record-wrap-up": {
    "daily-record/board-record-wrap-up": {
      type: "board-record-wrap-up",
      event: { ...peak(ONE, "2026-03-14", 1100), announcedCount: 1042 },
    },
    "daily-record/board-record-wrap-up-mapped": {
      type: "board-record-wrap-up",
      event: { ...peak(TWO, "2026-03-15", 310), announcedCount: 260 },
    },
  },
  "personal-milestone": {
    "milestone/personal": { type: "personal-milestone", event: { ...ONE, threshold: 1000 } },
    "milestone/personal-mapped": { type: "personal-milestone", event: { ...TWO, threshold: 1000 } },
  },
  "board-milestone": {
    "milestone/board": { type: "board-milestone", event: { threshold: 10000 } },
  },
};

type Builders = typeof Discord;
type BuilderName = Extract<keyof Builders, `${string}Notification`>;

/** One group per `*Notification` builder `worker/discord.ts` exports, as its arguments. */
const BUILDERS: { [K in BuilderName]: Record<string, Parameters<Builders[K]>> } = {
  allTimeMilestoneNotification: {
    "all-time-milestone/personal": [{ ...ONE, threshold: 5000 }],
    "all-time-milestone/personal-mapped": [{ ...TWO, threshold: 5000 }],
  },
  cakeDayNotification: {
    "cake-day/unmapped": [{ ...ONE, createdAt: "2025-03-14T09:30:00Z", years: 1 }, USER_IDS],
    "cake-day/mapped": [{ ...TWO, createdAt: "2016-03-14T09:30:00Z", years: 10 }, USER_IDS],
  },
};

type Sample = (modules: Modules) => DiscordNotification;

const CATALOGUE: [id: string, sample: Sample][] = [
  ...Object.values(YEARLY).flatMap((group) =>
    Object.entries(group).map(([id, notification]): [string, Sample] => [
      id,
      ({ embeds }) => ({ kind: "embed", embed: embeds.notificationEmbed(YEAR, notification) }),
    ]),
  ),
  ...Object.entries(BUILDERS).flatMap(([name, group]) =>
    Object.entries(group).map(([id, args]): [string, Sample] => [
      id,
      ({ discord }) =>
        (discord[name as BuilderName] as (...args: unknown[]) => DiscordNotification)(...args),
    ]),
  ),
];

/** Recursively sorts keys, so only content changes show up as differences. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

async function render(root: string): Promise<Rendering> {
  const embedsPath = resolve(root, "worker/notification-embeds.ts");
  if (!existsSync(embedsPath)) return null;
  const modules: Modules = {
    embeds: await import(pathToFileURL(embedsPath).href),
    discord: await import(pathToFileURL(resolve(root, "worker/discord.ts")).href),
  };
  const rendering: Record<string, Rendered> = {};
  for (const [id, build] of CATALOGUE) {
    try {
      const { url, body } = modules.discord.discordWebhookRequest(WEBHOOK_URL, build(modules), USER_IDS);
      rendering[id] = { query: url.search, payload: stable(body) };
    } catch (error) {
      rendering[id] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return rendering;
}

/* ---------------------------------------------------------------------------
   Comparison
--------------------------------------------------------------------------- */

interface Readable {
  title: string;
  fields: [label: string, value: string][];
}

function colour(value: number | undefined): string {
  return value === undefined ? "" : `#${value.toString(16).padStart(6, "0")}`;
}

function cardFields(container: Discord.DiscordContainer): [string, string][] {
  const section = container.components[0];
  const content = section?.components.map((text) => text.content).join("\n") ?? "";
  const match = /^## \[(.*)\]\((.*)\)\n([\s\S]*)$/.exec(content);
  const [title, url, description] = match ? match.slice(1) : ["", "", content];
  return [
    ["Format", "Components card"],
    ["Title", title],
    ["Title link", url],
    ["Description", description],
    ["Colour", colour(container.accent_color)],
    ["Thumbnail", section?.accessory.media.url ?? ""],
  ];
}

function embedFields(embed: Discord.DiscordEmbed | undefined): [string, string][] {
  return [
    ["Format", "Embed"],
    ["Title", embed?.title ?? ""],
    ["Title link", embed?.url ?? ""],
    ["Description", embed?.description ?? ""],
    ["Colour", colour(embed?.color)],
    ["Thumbnail", embed?.thumbnail?.url ?? ""],
  ];
}

/** The fields a Discord reader sees, the same whichever format carries them. */
function readable({ query, payload }: Request): Readable {
  const body = payload as {
    embeds?: Discord.DiscordEmbed[];
    components?: Discord.DiscordContainer[];
    allowed_mentions?: { users?: string[] };
  };
  const container = body.components?.[0];
  const fields = container ? cardFields(container) : embedFields(body.embeds?.[0]);
  fields.push(["Pings", body.allowed_mentions?.users?.join(", ") ?? ""], ["Webhook query", query]);
  return { title: fields[1][1], fields };
}

function cell(label: string, value: string): string {
  if (!value) return "—";
  if (label === "Description" || label === "Title" || label === "Format") {
    return value.replaceAll("<", "&lt;").replaceAll("|", "\\|").replaceAll("\n", "<br>");
  }
  return `\`${value}\``;
}

/** A full-context line diff; payloads are a few dozen lines. */
function lineDiff(before: string[], after: string[]): string[] {
  const lengths = Array.from({ length: before.length + 1 }, () =>
    Array.from({ length: after.length + 1 }, () => 0),
  );
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lengths[i][j] = before[i] === after[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push(`  ${before[i++]}`);
      j++;
    } else if (j < after.length && (i === before.length || lengths[i][j + 1] > lengths[i + 1][j])) {
      lines.push(`+ ${after[j++]}`);
    } else {
      lines.push(`- ${before[i++]}`);
    }
  }
  return lines;
}

function json(request: Request): string[] {
  return JSON.stringify(request, null, 2).split("\n");
}

function details(summary: string, body: string[]): string[] {
  return ["<details>", `<summary>${summary}</summary>`, "", ...body, "", "</details>", ""];
}

function changedSection(id: string, before: Request, after: Request): string[] {
  const was = readable(before);
  const now = readable(after);
  const rows = now.fields.flatMap(([label, value], index) => {
    const previous = was.fields[index]?.[1] ?? "";
    return previous === value ? [] : [`| ${label} | ${cell(label, previous)} | ${cell(label, value)} |`];
  });
  return [
    `### \`${id}\` · ${now.title}`,
    "",
    ...(rows.length
      ? ["| | Before | After |", "| --- | --- | --- |", ...rows]
      : ["Only the raw request changed."]),
    "",
    ...details("Request diff", ["```diff", ...lineDiff(json(before), json(after)), "```"]),
  ];
}

function renderedSection(id: string, request: Request): string[] {
  const { title, fields } = readable(request);
  return [
    `### \`${id}\` · ${title}`,
    "",
    "| | |",
    "| --- | --- |",
    ...fields.map(([label, value]) => `| ${label} | ${cell(label, value)} |`),
    "",
    ...details("Request", ["```json", ...json(request), "```"]),
  ];
}

function compare(base: Rendering, head: Rendering): string {
  if (!head) return "The notification preview could not render this branch.\n";
  const changed: string[][] = [];
  const added: string[][] = [];
  const failed: string[] = [];
  const unchanged: string[] = [];
  for (const [id, after] of Object.entries(head)) {
    const before = base?.[id];
    if ("error" in after) {
      failed.push(`- \`${id}\`: ${after.error.replaceAll("\n", " ")}`);
    } else if (!before || "error" in before) {
      added.push(renderedSection(id, after));
    } else if (JSON.stringify(before) === JSON.stringify(after)) {
      unchanged.push(`- \`${id}\` · ${readable(after).title}`);
    } else {
      changed.push(changedSection(id, before, after));
    }
  }
  const removed = Object.keys(base ?? {}).filter((id) => !(id in head));
  const total = Object.keys(head).length;

  const lines = ["## Discord notification preview", ""];
  if (!base) {
    lines.push(
      "The base branch has no `worker/notification-embeds.ts`, so there is nothing to compare against yet.",
      "",
      ...details(`${added.length} notifications as rendered by this branch`, added.flat()),
    );
  } else {
    const summary = [
      changed.length ? `**${changed.length === 1 ? "1 notification" : `${changed.length} notifications`} changed**` : "",
      added.length ? `${added.length} new` : "",
      failed.length ? `${failed.length} failed to render` : "",
      removed.length ? `${removed.length} removed from the catalogue` : "",
    ].filter(Boolean);
    lines.push(
      summary.length ? `${summary.join(", ")} out of ${total}.` : `No notification changed (${total} rendered).`,
      "",
      ...changed.flat(),
      ...(added.length ? ["## New notifications", "", ...added.flat()] : []),
    );
  }
  if (failed.length) lines.push("## Failed to render", "", ...failed, "");
  if (removed.length) lines.push("## Removed", "", ...removed.map((id) => `- \`${id}\``), "");
  if (unchanged.length) lines.push(...details(`${unchanged.length} unchanged notifications`, unchanged));
  return `${lines.join("\n").trimEnd()}\n`;
}

const [command, ...args] = process.argv.slice(2);
if (command === "render" && args.length === 1) {
  process.stdout.write(`${JSON.stringify(await render(args[0]), null, 2)}\n`);
} else if (command === "compare" && args.length === 2) {
  const [base, head] = args.map((path) => JSON.parse(readFileSync(path, "utf8")) as Rendering);
  process.stdout.write(compare(base, head));
} else {
  console.error("usage: discord-preview.ts render <root> | compare <base.json> <head.json>");
  process.exit(2);
}
