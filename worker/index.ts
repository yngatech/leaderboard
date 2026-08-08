import type { AllTime, AllTimeUser, Board } from "../shared/types";
import { DurableObject } from "cloudflare:workers";
import type { ArchiveTotals } from "./github";
import { currentYear, fetchArchiveTotals, fetchBoard, GitHubError, MIN_YEAR } from "./github";
import {
  deliverDailyRecords,
  deliverMilestones,
  deliverStandings,
  ordinal,
  planDailyRecords,
  planMilestones,
  planStandings,
  type BoardMilestoneEvent,
  type BoardRecordEvent,
  type DailyRecordState,
  type MilestoneState,
  type PersonalMilestoneEvent,
  type PersonalBestEvent,
  type StandingNotification,
  type StandingState,
  SerialTaskQueue,
  shouldUpdateNotifications,
} from "./notifications";

export interface Env {
  /** Worker secret in production, `.dev.vars` locally. Never sent to the client. */
  GITHUB_TOKEN: string;
  /** Optional locally; production cron checks are enabled when this secret exists. */
  DISCORD_WEBHOOK_URL?: string;
  LEADER_STATE: DurableObjectNamespace<LeaderState>;
  ASSETS: Fetcher;
}

/** Synthetic key prefixes — edge cache entries are not tied to the public URL. */
const JSON_CACHE_PREFIX = "https://ynga-git-board.internal/board/v3/";
const MARKDOWN_CACHE_PREFIX = "https://ynga-git-board.internal/board-md/v2/";
/** Bumped for all-time totals sourced from public contribution fragments. */
const ALL_MARKDOWN_CACHE_KEY = "https://ynga-git-board.internal/board-md/v4/all";
/** Rendered all-time JSON for the SPA. */
const ALL_JSON_CACHE_KEY = "https://ynga-git-board.internal/board-all/v3";
/** Per-person totals for every finished year, in one entry. */
const ARCHIVE_CACHE_PREFIX = "https://ynga-git-board.internal/board-md-src/archive/v3/";

const TOKEN_MISSING = "The board is missing its GitHub token. Set the GITHUB_TOKEN secret.";
/** The year in progress keeps moving. */
const LIVE_TTL_SECONDS = 30 * 60;
/** Finished years only shift if someone retoggles private-contribution visibility. */
const ARCHIVE_TTL_SECONDS = 30 * 24 * 60 * 60;
const BROWSER_TTL_SECONDS = 5 * 60;
const BROWSER_ARCHIVE_TTL_SECONDS = 24 * 60 * 60;

const SITE = "https://leaderboard.ynga.tech";

function edgeTtl(year: number): number {
  return year === currentYear() ? LIVE_TTL_SECONDS : ARCHIVE_TTL_SECONDS;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Accepts only a four-digit year inside the supported range and returns it as a
 * number, so the cache keys below can never be shaped by visitor input.
 */
function parseYear(raw: string | null): number | null {
  if (raw === null) return currentYear();
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > currentYear()) return null;
  return year;
}

function yearOutOfRange(): string {
  return `Year must be a whole number between ${MIN_YEAR} and ${currentYear()}.`;
}

/**
 * The single upstream path: every route reads the board through here, so one
 * GitHub fetch per year serves the JSON API and the markdown views alike.
 * Returns the board response — check `response.ok` before using the body.
 */
async function boardJson(
  year: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<{ response: Response; cache: "HIT" | "MISS" }> {
  const cache = caches.default;
  // `year` is a validated integer, so the key set is bounded and enumerable.
  const cacheKey = new Request(`${JSON_CACHE_PREFIX}${year}`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return { response: hit, cache: "HIT" };

  if (!env.GITHUB_TOKEN) {
    return {
      response: json(
        { error: TOKEN_MISSING, status: 500 },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      ),
      cache: "MISS",
    };
  }

  try {
    const { board, missing } = await fetchBoard(env.GITHUB_TOKEN, year);

    const fresh = json(board, {
      headers: {
        // Drives how long `caches.default` keeps the entry.
        "Cache-Control": `public, max-age=${edgeTtl(year)}`,
        "X-Board-Generated": new Date().toISOString(),
        "X-Board-Missing": missing.join(","),
        "X-Board-Year": String(year),
      },
    });

    ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
    return { response: fresh, cache: "MISS" };
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : 500;
    const message = error instanceof Error ? error.message : "The board could not be assembled.";
    console.error("board failed", { message, status, year });
    return {
      response: json({ error: message, status }, { status, headers: { "Cache-Control": "no-store" } }),
      cache: "MISS",
    };
  }
}

async function handleBoard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const year = parseYear(new URL(request.url).searchParams.get("year"));
  if (year === null) {
    return json(
      { error: yearOutOfRange(), status: 400 },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { response, cache } = await boardJson(year, env, ctx);
  if (!response.ok) return response;
  return withBrowserHeaders(response, cache, year);
}

/** Rankings and totals only — no daily breakdown. */
function renderMarkdown(board: Board, year: number, generatedAt: string, missing: string[]): string {
  const total = board.reduce((sum, user) => sum + user.totalContributions, 0);
  const count = (value: number) => value.toLocaleString("en-GB");

  const lines = [
    `# git board — ${year}`,
    "",
    `${count(total)} contributions from ${board.length} accounts in ${year}.`,
    "",
    "| # | user | contributions |",
    "| --: | --- | --: |",
    ...board.map(
      (user, index) =>
        `| ${index + 1} | [${user.login}](${user.url}) | ${count(user.totalContributions)} |`,
    ),
  ];

  if (missing.length > 0) {
    lines.push("", `No GitHub data for: ${missing.join(", ")}.`);
  }

  lines.push(
    "",
    `Generated ${generatedAt}.`,
    `${SITE}${year === currentYear() ? "/" : `/${year}`}`,
    "",
  );

  return lines.join("\n");
}

interface AllTimeRow {
  login: string;
  url: string;
  /** Profile fields come from the live board; null for archive-only accounts. */
  name: string | null;
  avatarUrl: string;
  followers: number | null;
  following: number | null;
  byYear: Map<number, number>;
  total: number;
}

/** One row per account, one column per year that anyone was active in. */
function renderAllTimeMarkdown(
  rows: AllTimeRow[],
  years: number[],
  generatedAt: string,
  missing: string[],
): string {
  const count = (value: number) => value.toLocaleString("en-GB");
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const span = years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : "no recorded years";

  const lines = [
    "# git board — all time",
    "",
    `${count(grandTotal)} contributions from ${rows.length} accounts, ${span}.`,
    "",
    `| # | user | ${years.join(" | ")} | total |`,
    `| --: | --- |${years.map(() => " --: |").join("")} --: |`,
    ...rows.map((row, index) => {
      const cells = years.map((year) => count(row.byYear.get(year) ?? 0));
      return `| ${index + 1} | [${row.login}](${row.url}) | ${cells.join(" | ")} | ${count(row.total)} |`;
    }),
  ];

  if (missing.length > 0) {
    lines.push("", `No GitHub data for: ${missing.join(", ")}.`);
  }

  lines.push("", `Generated ${generatedAt}.`, `${SITE}/`, "");

  return lines.join("\n");
}

/**
 * Every finished year in one cached aggregate. On a cache miss, bounded public
 * HTML fetches stay well inside this Workers Paid plan's 1,000-subrequest limit.
 */
async function archiveTotals(
  env: Env,
  ctx: ExecutionContext,
): Promise<{ ok: true; archive: ArchiveTotals } | { ok: false; status: number; message: string }> {
  const lastYear = currentYear() - 1;
  if (lastYear < MIN_YEAR) {
    return {
      ok: true,
      archive: {
        generatedAt: new Date().toISOString(),
        firstYear: MIN_YEAR,
        lastYear,
        users: [],
        missing: [],
      },
    };
  }

  const cache = caches.default;
  // The last finished year is in the key, so the aggregate rolls over on Jan 1
  // instead of serving a stale span for up to a week.
  const cacheKey = new Request(`${ARCHIVE_CACHE_PREFIX}${lastYear}`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return { ok: true, archive: (await hit.json()) as ArchiveTotals };

  if (!env.GITHUB_TOKEN) return { ok: false, status: 500, message: TOKEN_MISSING };

  try {
    const archive = await fetchArchiveTotals(env.GITHUB_TOKEN, MIN_YEAR, lastYear);
    const fresh = json(archive, {
      headers: { "Cache-Control": `public, max-age=${ARCHIVE_TTL_SECONDS}` },
    });
    ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
    return { ok: true, archive };
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : 500;
    const message = error instanceof Error ? error.message : "The archive could not be assembled.";
    console.error("archive failed", { message, status, lastYear });
    return { ok: false, status, message };
  }
}

interface AllTimeData {
  /** Ranked by all-time total, then login. */
  rows: AllTimeRow[];
  /** Every year, oldest first, that anyone was active in. */
  activeYears: number[];
  /** First active year through the current one, with no gaps. */
  spanYears: number[];
  missing: string[];
  generatedAt: string;
}

/**
 * The archive aggregate plus the year in progress, merged by login. Shared by
 * `/all.md` and `/api/all` so both read exactly the same numbers.
 */
async function allTimeData(
  env: Env,
  ctx: ExecutionContext,
): Promise<{ ok: true; data: AllTimeData } | { ok: false; status: number; message: string }> {
  // A partial table would quietly understate someone's all-time total, so any
  // failure fails the whole page.
  const archiveResult = await archiveTotals(env, ctx);
  if (!archiveResult.ok) return archiveResult;

  // The year in progress still comes through the shared per-year JSON cache.
  const live = await boardJson(currentYear(), env, ctx);
  if (!live.response.ok) {
    const body = (await live.response.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      status: live.response.status,
      message: body?.error ?? "The board could not be assembled.",
    };
  }

  const { archive } = archiveResult;
  const liveBoard = (await live.response.json()) as Board;
  const liveStamp = live.response.headers.get("X-Board-Generated");

  const missing = new Set(archive.missing);
  for (const login of (live.response.headers.get("X-Board-Missing") ?? "").split(",").filter(Boolean)) {
    missing.add(login);
  }

  const years: number[] = [];
  for (let year = MIN_YEAR; year <= currentYear(); year += 1) years.push(year);

  // Year boards rank differently, so rows are keyed by login, not position.
  const rows = new Map<string, AllTimeRow>();
  const rowFor = (login: string, url: string) => {
    let row = rows.get(login);
    if (!row) {
      row = {
        login,
        url,
        name: null,
        // Archive-only accounts still get an avatar from GitHub's redirect.
        avatarUrl: `https://github.com/${login}.png`,
        followers: null,
        following: null,
        byYear: new Map(),
        total: 0,
      };
      rows.set(login, row);
    }
    row.url = url;
    return row;
  };

  for (const user of archive.users) {
    const row = rowFor(user.login, user.url);
    for (const [year, total] of Object.entries(user.byYear)) {
      row.byYear.set(Number(year), total);
      row.total += total;
    }
  }

  for (const user of liveBoard) {
    const row = rowFor(user.login, user.url);
    row.name = user.name;
    row.avatarUrl = user.avatarUrl;
    row.followers = user.followers;
    row.following = user.following;
    row.byYear.set(currentYear(), user.totalContributions);
    row.total += user.totalContributions;
  }

  const ranked = [...rows.values()].sort(
    (a, b) => b.total - a.total || a.login.localeCompare(b.login),
  );
  const activeYears = years.filter((year) =>
    ranked.some((row) => (row.byYear.get(year) ?? 0) > 0),
  );
  const spanYears =
    activeYears.length > 0 ? years.filter((year) => year >= activeYears[0]) : [];

  // The oldest stamp, so the line never overstates freshness.
  const generatedAt =
    liveStamp && liveStamp < archive.generatedAt ? liveStamp : archive.generatedAt;

  return { ok: true, data: { rows: ranked, activeYears, spanYears, missing: [...missing], generatedAt } };
}

async function handleAllMarkdown(env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(ALL_MARKDOWN_CACHE_KEY, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  const result = await allTimeData(env, ctx);
  if (!result.ok) {
    return text(`${result.message}\n`, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { rows, activeYears, missing, generatedAt } = result.data;
  const fresh = new Response(renderAllTimeMarkdown(rows, activeYears, generatedAt, missing), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // Includes the year in progress, so it expires on the live schedule.
      "Cache-Control": `public, max-age=${LIVE_TTL_SECONDS}`,
      "X-Board-Generated": generatedAt,
      "X-Board-Year": "all",
    },
  });

  ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  return withBrowserHeaders(fresh, "MISS");
}

async function handleAllApi(env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(ALL_JSON_CACHE_KEY, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  const result = await allTimeData(env, ctx);
  if (!result.ok) {
    return json(
      { error: result.message, status: result.status },
      { status: result.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { rows, spanYears, missing, generatedAt } = result.data;
  const body: AllTime = {
    years: spanYears,
    firstYear: spanYears[0] ?? currentYear(),
    lastYear: currentYear(),
    users: rows.map<AllTimeUser>((row) => ({
      login: row.login,
      name: row.name,
      avatarUrl: row.avatarUrl,
      url: row.url,
      followers: row.followers,
      following: row.following,
      byYear: Object.fromEntries([...row.byYear].map(([year, total]) => [String(year), total])),
      total: row.total,
    })),
  };

  const fresh = json(body, {
    headers: {
      "Cache-Control": `public, max-age=${LIVE_TTL_SECONDS}`,
      "X-Board-Generated": generatedAt,
      "X-Board-Missing": missing.join(","),
      "X-Board-Year": "all",
    },
  });

  ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  return withBrowserHeaders(fresh, "MISS");
}

async function handleMarkdown(year: number, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(`${MARKDOWN_CACHE_PREFIX}${year}`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT", year);

  const { response } = await boardJson(year, env, ctx);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return text(`${body?.error ?? "The board could not be assembled."}\n`, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const generatedAt = response.headers.get("X-Board-Generated") ?? new Date().toISOString();
  const missing = (response.headers.get("X-Board-Missing") ?? "").split(",").filter(Boolean);
  const board = (await response.json()) as Board;

  const fresh = new Response(renderMarkdown(board, year, generatedAt, missing), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": `public, max-age=${edgeTtl(year)}`,
      "X-Board-Generated": generatedAt,
      "X-Board-Year": String(year),
    },
  });

  ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  return withBrowserHeaders(fresh, "MISS", year);
}

/**
 * Re-issue a cached/fresh response with client-facing cache headers. Finished
 * years can sit in the visitor's browser for a day; anything touching the year
 * in progress stays on the short schedule.
 */
function withBrowserHeaders(
  response: Response,
  cacheState: "HIT" | "MISS",
  year: number | null = null,
): Response {
  const archived = year !== null && year !== currentYear();
  const maxAge = archived ? BROWSER_ARCHIVE_TTL_SECONDS : BROWSER_TTL_SECONDS;
  const staleFor = archived ? ARCHIVE_TTL_SECONDS : LIVE_TTL_SECONDS;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${staleFor}`);
  headers.set("X-Board-Cache", cacheState);
  return new Response(response.body, { status: response.status, headers });
}

async function refreshNotifications(env: Env): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  if (!env.GITHUB_TOKEN) throw new Error(TOKEN_MISSING);

  const year = currentYear();
  const { board, missing } = await fetchBoard(env.GITHUB_TOKEN, year);
  if (!shouldUpdateNotifications(missing)) {
    console.warn("notifications skipped for incomplete board", { year, missing });
    return;
  }
  await env.LEADER_STATE.getByName("leaderboard").update(year, board);
}

interface DiscordEmbed {
  title: string;
  url: string;
  description: string;
  color: number;
  thumbnail?: { url: string };
}

function count(value: number): string {
  return value.toLocaleString("en-GB");
}

function displayDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function personalBestEmbed(year: number, event: PersonalBestEvent): DiscordEmbed {
  const improvement =
    event.previousCount > 0
      ? `, beating their previous best of **${count(event.previousCount)}**`
      : "";
  return {
    title: "New daily contributions PB",
    url: `${SITE}/${year}`,
    description: `[${event.login}](${event.url}) recorded **${count(event.count)} contributions** on **${displayDate(event.date)}**${improvement}.`,
    color: 0x58a6ff,
    thumbnail: { url: event.avatarUrl },
  };
}

function boardRecordEmbed(year: number, event: BoardRecordEvent): DiscordEmbed {
  const previous =
    event.previousCount > 0
      ? `, beating the previous record of **${count(event.previousCount)}**`
      : "";
  return {
    title: "New peak daily contributions record",
    url: `${SITE}/${year}`,
    description: `[${event.peak.login}](${event.peak.url}) set a new board record with **${count(event.peak.count)} contributions** on **${displayDate(event.peak.date)}**${previous}.`,
    color: 0xf0b429,
    thumbnail: { url: event.peak.avatarUrl },
  };
}

function personalMilestoneEmbed(year: number, event: PersonalMilestoneEvent): DiscordEmbed {
  return {
    title: "Contribution milestone",
    url: `${SITE}/${year}`,
    description: `[${event.login}](${event.url}) has passed **${count(event.threshold)} contributions** in ${year}.`,
    color: 0x58a6ff,
    thumbnail: { url: event.avatarUrl },
  };
}

function boardMilestoneEmbed(year: number, event: BoardMilestoneEvent): DiscordEmbed {
  return {
    title: "Board contribution milestone",
    url: `${SITE}/${year}`,
    description: `The board has passed **${count(event.threshold)} contributions** in ${year}.`,
    color: 0xf0b429,
  };
}

function leaderEmbed(year: number, notification: Extract<StandingNotification, { type: "leader" }>): DiscordEmbed {
  const { leader } = notification.event;
  return {
    title: "New git board leader",
    url: `${SITE}/${year}`,
    description: `[${leader.login}](${leader.url}) has taken the lead for **${year}** with **${count(leader.totalContributions)} contributions**.`,
    color: 0xf0b429,
    thumbnail: { url: leader.avatarUrl },
  };
}

function standingOvertakeEmbed(
  year: number,
  notification: Extract<StandingNotification, { type: "overtake" }>,
): DiscordEmbed {
  const { position, mover, displaced } = notification.event;
  return {
    title: "Git board position change",
    url: `${SITE}/${year}`,
    description: `[${mover.login}](${mover.url}) has overtaken [${displaced.login}](${displaced.url}) for **${ordinal(position)} place** in ${year} with **${count(mover.totalContributions)} contributions**.`,
    color: 0x58a6ff,
    thumbnail: { url: mover.avatarUrl },
  };
}

/** Stores notification checkpoints, so scheduled checks cannot post duplicates. */
export class LeaderState extends DurableObject<Env> {
  /** External webhook fetches open the DO input gate, so queue whole updates. */
  private readonly updates = new SerialTaskQueue();

  private async notify(embed: DiscordEmbed): Promise<void> {
    if (!this.env.DISCORD_WEBHOOK_URL) return;
    const response = await fetch(this.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "git board",
        allowed_mentions: { parse: [] },
        embeds: [embed],
      }),
    });
    if (!response.ok) throw new Error(`Discord rejected the notification (${response.status}).`);
  }

  private async updateStandings(year: number, board: Board): Promise<void> {
    const leader = board[0];
    if (!leader || leader.totalContributions === 0) return;
    const previous = await this.ctx.storage.get<StandingState | { year: number; login: string }>("leader");
    const plan = planStandings(year, board, previous);
    await deliverStandings(
      plan,
      (notification) =>
        this.notify(
          notification.type === "leader"
            ? leaderEmbed(year, notification)
            : standingOvertakeEmbed(year, notification),
        ),
      (state) => this.ctx.storage.put("leader", state),
    );
  }

  private async updateDailyRecords(year: number, board: Board): Promise<void> {
    const previous = await this.ctx.storage.get<DailyRecordState>("daily-records");
    const plan = planDailyRecords(year, board, previous);
    await deliverDailyRecords(
      plan,
      (notification) =>
        this.notify(
          notification.type === "personal-best"
            ? personalBestEmbed(year, notification.event)
            : boardRecordEmbed(year, notification.event),
        ),
      (state) => this.ctx.storage.put("daily-records", state),
    );
  }

  private async updateMilestones(year: number, board: Board): Promise<void> {
    const previous = await this.ctx.storage.get<MilestoneState>("milestones");
    const plan = planMilestones(year, board, previous);
    await deliverMilestones(
      plan,
      (notification) =>
        this.notify(
          notification.type === "personal-milestone"
            ? personalMilestoneEmbed(year, notification.event)
            : boardMilestoneEmbed(year, notification.event),
        ),
      (state) => this.ctx.storage.put("milestones", state),
    );
  }

  async update(year: number, board: Board): Promise<void> {
    return this.updates.run(async () => {
      await this.updateStandings(year, board);
      await this.updateDailyRecords(year, board);
      await this.updateMilestones(year, board);
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const readOnly = request.method === "GET" || request.method === "HEAD";

    if (url.pathname === "/api/board") {
      if (!readOnly) {
        return json({ error: "Use GET for /api/board.", status: 405 }, { status: 405 });
      }
      return handleBoard(request, env, ctx);
    }

    if (url.pathname === "/api/all") {
      if (!readOnly) {
        return json({ error: "Use GET for /api/all.", status: 405 }, { status: 405 });
      }
      try {
        return await handleAllApi(env, ctx);
      } catch (error) {
        console.error("all-time api failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return json(
          { error: "The board could not be assembled.", status: 500 },
          { status: 500, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: `No API route at ${url.pathname}.`, status: 404 }, { status: 404 });
    }

    if (url.pathname.endsWith(".md")) {
      if (!readOnly) {
        return text("Use GET for markdown views.\n", { status: 405 });
      }
      // An unexpected throw here would surface as a bare 1101 page.
      const guard = async (render: () => Promise<Response>) => {
        try {
          return await render();
        } catch (error) {
          console.error("markdown failed", {
            path: url.pathname,
            message: error instanceof Error ? error.message : String(error),
          });
          return text("The board could not be assembled.\n", {
            status: 500,
            headers: { "Cache-Control": "no-store" },
          });
        }
      };

      if (url.pathname === "/all.md") return guard(() => handleAllMarkdown(env, ctx));

      const match = /^\/(\d{4})\.md$/.exec(url.pathname);
      const year = match ? parseYear(match[1]) : null;
      if (year === null) {
        return text(`${yearOutOfRange()} Try ${SITE}/${currentYear()}.md\n`, {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return guard(() => handleMarkdown(year, env, ctx));
    }

    // Static assets (and the SPA fallback) are served by the assets binding.
    return env.ASSETS.fetch(request);
  },

  scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    return refreshNotifications(env);
  },
} satisfies ExportedHandler<Env>;
