/**
 * Renders one sample of every Discord notification type, and compares two
 * renderings as images of mock Discord messages for the pull request comment.
 *
 *   node scripts/discord-preview.ts render <root>
 *     Prints a JSON map of type to the webhook requests it posts.
 *   node scripts/discord-preview.ts compare <base.json> <head.json> <outdir> <url-prefix>
 *     Writes <outdir>/comment.md and a PNG per image it shows, linked as <url-prefix><name>.
 *
 * `render` imports the worker modules under `<root>`, so this branch's samples
 * can render another checkout's source. It prints `null` when that checkout
 * predates `worker/notification-embeds.ts`. `compare` draws both sides with
 * this branch's mock, so only the notification data differs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import type * as Discord from "../worker/discord.ts";
import type * as Embeds from "../worker/notification-embeds.ts";
import type { DiscordNotification } from "../worker/discord.ts";

interface Request {
  query: string;
  payload: unknown;
}

/** Each type renders unmapped, then with everyone mapped to Discord if that differs. */
type Rendered = Request[] | { error: string };
type Rendering = Record<string, Rendered> | null;

const YEAR = 2026;
const DAY = "2026-03-14";
const WEBHOOK_URL = "https://discord.example/api/webhooks/0/preview";

function person(login: string, totalContributions: number) {
  return { login, url: `https://github.com/${login}`, avatarUrl: `https://avatars.example/${login}`, totalContributions };
}

const ONE = person("example-one", 1250);
const TWO = person("example-two", 1234);
const THREE = person("example-three", 987);
const DISCORD_IDS = new Map([ONE, TWO, THREE].map(({ login }, index) => [login, `10000000000000000${index + 1}`]));
const LOGINS = new Map([...DISCORD_IDS].map(([login, id]) => [id, login]));

type Yearly = Embeds.YearlyNotification;
type Builders = typeof Discord;
type BuilderName = Extract<keyof Builders, `${string}Notification`>;

/**
 * One sample per notification type: every type `notificationEmbed` accepts and
 * every `*Notification` builder `worker/discord.ts` exports. A new type fails
 * typecheck until it has one.
 */
const SAMPLES: { [K in Yearly["type"]]: Extract<Yearly, { type: K }>["event"] } & {
  [K in BuilderName]: Parameters<Builders[K]>[0];
} = {
  leader: { leader: ONE },
  overtake: { position: 2, mover: TWO, displaced: THREE },
  "personal-best": { ...ONE, date: DAY, count: 1042, previousCount: 87 },
  "board-record": { peak: { ...ONE, date: DAY, count: 1042 }, previousCount: 210 },
  "personal-best-wrap-up": { ...ONE, date: DAY, count: 1100, announcedCount: 1042 },
  "board-record-wrap-up": { ...ONE, date: DAY, count: 1100, announcedCount: 1042 },
  "personal-milestone": { ...ONE, threshold: 1000 },
  "board-milestone": { threshold: 10000 },
  allTimeMilestoneNotification: { ...ONE, threshold: 5000 },
  cakeDayNotification: { ...ONE, createdAt: "2016-03-14T09:30:00Z", years: 10 },
};

/** `cakeDayNotification` is shown as `cake-day`. */
function sampleId(key: string): string {
  return key.replace(/Notification$/, "").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function notification(
  { discord, embeds }: { discord: Builders; embeds: typeof Embeds },
  key: string,
  event: unknown,
  userIds: ReadonlyMap<string, string>,
): DiscordNotification {
  if (key.endsWith("Notification")) {
    const build = discord[key as BuilderName] as (event: unknown, userIds: ReadonlyMap<string, string>) => DiscordNotification;
    return build(event, userIds);
  }
  return { kind: "embed", embed: embeds.notificationEmbed(YEAR, { type: key, event } as Yearly) };
}

/** Recursively sorts keys, so only content changes count as differences. */
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
  const modules = {
    embeds: await import(pathToFileURL(embedsPath).href),
    discord: await import(pathToFileURL(resolve(root, "worker/discord.ts")).href),
  };
  const rendering: Record<string, Rendered> = {};
  for (const [key, event] of Object.entries(SAMPLES)) {
    try {
      const requests = [new Map<string, string>(), DISCORD_IDS].map((userIds) => {
        const { url, body } = modules.discord.discordWebhookRequest(
          WEBHOOK_URL,
          notification(modules, key, event, userIds),
          userIds,
        );
        return stable({ query: url.search, payload: body }) as Request;
      });
      const same = JSON.stringify(requests[0]) === JSON.stringify(requests[1]);
      rendering[sampleId(key)] = same ? requests.slice(0, 1) : requests;
    } catch (error) {
      rendering[sampleId(key)] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return rendering;
}

/* ---------------------------------------------------------------------------
   Mock Discord messages
--------------------------------------------------------------------------- */

interface Payload {
  embeds?: Discord.DiscordEmbed[];
  components?: Discord.DiscordContainer[];
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** The Markdown subset notifications use: a heading, bold, links and mentions. */
function markdown(text: string): string {
  return escape(text)
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a>$1</a>")
    .replace(/&lt;@(\d+)&gt;/g, (_, id: string) => `<span class="mention">@${LOGINS.get(id) ?? id}</span>`)
    .replace(/<\/h2>\n/g, "</h2>")
    .replaceAll("\n", "<br>");
}

/** Avatars are drawn from the login so screenshots need no network. */
function thumbnail(url: string | undefined): string {
  if (!url) return "";
  const login = url.split("/").pop() ?? "";
  const initials = (login.split("-").pop() ?? "").slice(0, 2).toUpperCase();
  const hue = [...login].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return `<div class="thumb" style="background:hsl(${hue} 45% 45%)">${escape(initials)}</div>`;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function message({ payload }: Request, label: string): string {
  const { embeds, components } = payload as Payload;
  let content = "";
  let link = "";
  if (components?.[0]) {
    const container = components[0];
    const section = container.components[0];
    const text = section.components.map((part) => part.content).join("\n");
    link = /^## \[.*?\]\((.*?)\)/.exec(text)?.[1] ?? "";
    content = `<div class="card" style="border-left-color:${hex(container.accent_color)}">
      <div class="text">${markdown(text)}</div>${thumbnail(section.accessory.media.url)}</div>`;
  } else if (embeds?.[0]) {
    const embed = embeds[0];
    link = embed.url;
    content = `<div class="embed" style="border-left-color:${hex(embed.color)}">
      <div class="text"><a class="title">${escape(embed.title)}</a>
      ${embed.description ? `<div>${markdown(embed.description)}</div>` : ""}</div>${thumbnail(embed.thumbnail?.url)}</div>`;
  }
  return `${label ? `<div class="label">${label}</div>` : ""}
  <div class="message"><div class="avatar">gb</div><div class="body">
    <div class="header"><span class="name">git board</span><span class="app">APP</span><span class="time">Today at 09:30</span></div>
    ${content}
    <div class="caption">Title link: ${escape(link) || "none"}</div>
  </div></div>`;
}

function mockHtml(requests: Request[]): string {
  const labels = requests.length > 1 ? ["Unmapped GitHub login", "Login mapped to a Discord user"] : [""];
  return `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #313338; color: #dbdee1; font: 15px/1.375 "Noto Sans", "Helvetica Neue", Arial, sans-serif; }
  main { width: 540px; padding: 12px 16px; }
  .label { color: #949ba4; font-size: 12px; text-transform: uppercase; letter-spacing: .02em; margin: 8px 0 4px; }
  .message { display: flex; gap: 16px; padding: 4px 0 8px; }
  .avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; background: #5865f2; color: #fff; display: grid; place-items: center; font-weight: 600; }
  .body { min-width: 0; flex: 1; }
  .name { color: #f2f3f5; font-weight: 500; }
  .app { background: #5865f2; color: #fff; font-size: 10px; font-weight: 600; border-radius: 3px; padding: 1px 4px; margin: 0 6px; vertical-align: 1px; }
  .time { color: #949ba4; font-size: 12px; }
  .embed, .card { display: flex; gap: 16px; margin-top: 4px; background: #2b2d31; border-left: 4px solid; border-radius: 4px; padding: 8px 16px 16px 12px; font-size: 14px; }
  .card { border: 1px solid #3f4147; border-left: 4px solid; border-radius: 8px; padding: 16px; }
  .text { flex: 1; min-width: 0; }
  .title { display: block; font-weight: 600; margin: 8px 0; }
  a { color: #00a8fc; }
  h2 { font-size: 20px; margin: 0 0 8px; color: #f2f3f5; }
  strong { color: #f2f3f5; }
  .mention { background: rgb(88 101 242 / .3); color: #c9cdfb; border-radius: 3px; padding: 0 2px; font-weight: 500; }
  .thumb { flex: none; width: 80px; height: 80px; border-radius: 4px; margin-top: 8px; color: #fff; font-size: 26px; font-weight: 700; display: grid; place-items: center; }
  .caption { color: #949ba4; font: 12px/1.4 ui-monospace, "DejaVu Sans Mono", monospace; margin-top: 6px; word-break: break-all; }
  </style><main>${requests.map((request, index) => message(request, labels[index])).join("")}</main>`;
}

/* ---------------------------------------------------------------------------
   Comparison
--------------------------------------------------------------------------- */

async function compare(base: Rendering, head: Rendering, outdir: string, urlPrefix: string): Promise<string> {
  if (!head) return "## Discord notification preview\n\nThe notification preview could not render this branch.\n";
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  async function image(side: "before" | "after", id: string, requests: Request[]): Promise<string> {
    const name = `${side}-${id}.png`;
    await page.setContent(mockHtml(requests));
    await page.locator("main").screenshot({ path: join(outdir, basename(urlPrefix + name)) });
    return `<img alt="${id} ${side}" src="${urlPrefix}${name}" width="420">`;
  }

  const changed: string[] = [];
  const added: string[] = [];
  const failed: string[] = [];
  const unchanged: string[] = [];
  for (const [id, after] of Object.entries(head)) {
    const before = base?.[id];
    if ("error" in after) {
      failed.push(`- \`${id}\`: ${after.error.replaceAll("\n", " ")}`);
    } else if (!before || "error" in before) {
      added.push(`#### \`${id}\``, "", await image("after", id, after), "");
    } else if (JSON.stringify(before) === JSON.stringify(after)) {
      unchanged.push(`#### \`${id}\``, "", await image("after", id, after), "");
    } else {
      changed.push(
        `### \`${id}\``, "",
        "| Before | After |", "| --- | --- |",
        `| ${await image("before", id, before)} | ${await image("after", id, after)} |`, "",
      );
    }
  }
  const removed: string[] = [];
  for (const [id, before] of Object.entries(base ?? {})) {
    if (!(id in head) && !("error" in before)) {
      removed.push(`#### \`${id}\``, "", await image("before", id, before), "");
    }
  }
  await browser.close();

  const count = (lines: string[]) => lines.filter((line) => line.startsWith("#")).length;
  const details = (summary: string, body: string[]) =>
    body.length ? ["<details>", `<summary>${summary}</summary>`, "", ...body, "</details>", ""] : [];
  const lines = ["## Discord notification preview", ""];
  if (!base) {
    lines.push(
      "The base branch has no `worker/notification-embeds.ts`, so there is nothing to compare against yet.",
      "",
      ...details(`${count(added)} notifications as rendered by this branch`, added),
    );
  } else {
    const summary = [
      [count(changed), "**{} changed**"],
      [count(added), "{} added"],
      [count(removed), "{} removed"],
      [failed.length, "{} failed to render"],
    ].flatMap(([total, text]) => (total ? [String(text).replace("{}", String(total))] : []));
    lines.push(
      summary.length ? `${summary.join(", ")} out of ${Object.keys(head).length}.` : "No notification changed.",
      "",
      ...changed,
      ...(added.length ? ["### Added", "", ...added] : []),
      ...(removed.length ? ["### Removed", "", ...removed] : []),
      ...details(`${count(unchanged)} unchanged`, unchanged),
    );
  }
  if (failed.length) lines.push("### Failed to render", "", ...failed, "");
  return `${lines.join("\n").trimEnd()}\n`;
}

const [command, ...args] = process.argv.slice(2);
if (command === "render" && args.length === 1) {
  process.stdout.write(`${JSON.stringify(await render(args[0]), null, 2)}\n`);
} else if (command === "compare" && args.length === 4) {
  const [basePath, headPath, outdir, urlPrefix] = args;
  const [base, head] = [basePath, headPath].map((path) => JSON.parse(readFileSync(path, "utf8")) as Rendering);
  writeFileSync(join(outdir, "comment.md"), await compare(base, head, outdir, urlPrefix));
} else {
  console.error("usage: discord-preview.ts render <root> | compare <base.json> <head.json> <outdir> <url-prefix>");
  process.exit(2);
}
