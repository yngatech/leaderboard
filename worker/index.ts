import type { AllTime, AllTimeUser, Board } from "../shared/types";
import { DurableObject } from "cloudflare:workers";
import { featuredYear, todayIso, userGrid, userProfile, yearShape } from "../shared/board";
import { formatDayYear } from "../shared/format";
import { nextMilestone, PERSONAL_MILESTONES } from "../shared/milestones";
import { badgeSvg, type BadgeInput, type BadgeKind } from "./views/badge";
import { absentCardSvg, cardSvg } from "./views/card";
import { apiCatalog } from "./api-catalog";
import {
  cakeDayNotification,
  discordWebhookPayload,
  discordWebhookUrl,
  parseDiscordUserIds,
  type DiscordEmbed,
  type DiscordNotification,
} from "./discord";
import {
  archiveCachePrefix,
  browserCacheControl,
  buildCacheKey,
  buildCachePrefix,
  isStaleCopy,
  lastGoodCopy,
  STALE_HEADER,
  staleCopy,
} from "./cache-policy";
import type { ArchiveTotals } from "./github";
import { PEOPLE, currentYear, fetchArchiveTotals, fetchBoard, GitHubError, MIN_YEAR } from "./github";
import { SITE, type SiteChrome } from "./views/layout";
import {
  allPageHtml,
  errorPageHtml,
  notFoundPageHtml,
  unknownUserPageHtml,
  userPageHtml,
  yearPageHtml,
} from "./views/pages";
import displayFont from "./fonts/display.woff2?inline";
import monoFont from "./fonts/mono.woff2?inline";
import enhanceUrl from "./enhance.js?url";
import stylesUrl from "./styles.css?url";
import {
  deliverCakeDays,
  deliverDailyRecords,
  deliverMilestones,
  deliverStandings,
  ordinal,
  planCakeDays,
  planDailyRecords,
  planMilestones,
  planStandings,
  type BoardMilestoneEvent,
  type BoardRecordEvent,
  type CakeDayState,
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
  /** Optional encrypted JSON map from GitHub logins to Discord user IDs. */
  DISCORD_USER_IDS?: string;
  /** Omitted from preview versions, which cannot receive scheduled events. */
  LEADER_STATE: DurableObjectNamespace<LeaderState>;
  ASSETS: Fetcher;
}

/** Synthetic key prefixes — edge cache entries are not tied to the public URL. */
const JSON_CACHE_PREFIX = buildCachePrefix(
  "https://ynga-git-board.internal/board/v4/",
  __IS_PREVIEW_BUILD__,
  __BUILD_COMMIT_SHA__,
);
const MARKDOWN_CACHE_PREFIX = buildCachePrefix(
  "https://ynga-git-board.internal/board-md/v2/",
  __IS_PREVIEW_BUILD__,
  __BUILD_COMMIT_SHA__,
);
/** Bumped for all-time totals sourced from public contribution fragments. */
const ALL_MARKDOWN_CACHE_KEY = buildCacheKey(
  "https://ynga-git-board.internal/board-md/v5/all",
  __IS_PREVIEW_BUILD__,
  __BUILD_COMMIT_SHA__,
);
/** Rendered all-time JSON for the SPA. */
const ALL_JSON_CACHE_KEY = buildCacheKey(
  "https://ynga-git-board.internal/board-all/v4",
  __IS_PREVIEW_BUILD__,
  __BUILD_COMMIT_SHA__,
);
/** Per-person totals for every finished year, in one entry. */
const ARCHIVE_CACHE_PREFIX = archiveCachePrefix(
  "https://ynga-git-board.internal/board-md-src/archive/v3/",
  __IS_PREVIEW_BUILD__,
  PEOPLE,
);
/**
 * The last answer GitHub gave for each feed, kept behind its live entry. Only
 * a failed fetch reads these, so they never shadow a fresh one.
 */
const LAST_GOOD_JSON_PREFIX = buildCachePrefix(
  "https://ynga-git-board.internal/board-last-good/v1/",
  __IS_PREVIEW_BUILD__,
  __BUILD_COMMIT_SHA__,
);
const ARCHIVE_LAST_GOOD_PREFIX = archiveCachePrefix(
  "https://ynga-git-board.internal/board-md-src/archive-last-good/v1/",
  __IS_PREVIEW_BUILD__,
  PEOPLE,
);
/**
 * Rendered pages. The current year sits inside every page key because an
 * archived page's nav and footer are computed against it: on 1 January the
 * keys roll over and no stale navigation can outlive the year that drew it.
 * Cards key on the featured year instead, which is the point of them. The
 * build SHA gives each deployed commit a fresh rendered-page namespace.
 */
const HTML_CACHE_PREFIX =
  `https://ynga-git-board.internal/board-html/v1/${encodeURIComponent(__BUILD_COMMIT_SHA__)}/`;
/**
 * Encoded avatars, outside the build-SHA namespace on purpose: a deploy
 * re-renders every card, and there is no reason for that to re-fetch nine
 * profile pictures that change perhaps once a year.
 */
const AVATAR_CACHE_PREFIX = "https://ynga-git-board.internal/avatar/v1/";

const TOKEN_MISSING = "The board is missing its GitHub token. Set the GITHUB_TOKEN secret.";
/** A fresh fetch, an edge cache entry, or the last good copy standing in. */
type CacheState = "HIT" | "MISS" | "STALE";
/** The year in progress keeps moving. */
const LIVE_TTL_SECONDS = 30 * 60;
/** Finished years only shift if someone retoggles private-contribution visibility. */
const ARCHIVE_TTL_SECONDS = 30 * 24 * 60 * 60;
const BROWSER_TTL_SECONDS = 5 * 60;
const BROWSER_ARCHIVE_TTL_SECONDS = 24 * 60 * 60;
/**
 * A public contribution fragment has no second source, so when GitHub stops
 * answering the last numbers it gave stand in for a day past the entry they
 * replace, rather than the board going blank over a bad afternoon.
 */
const LAST_GOOD_GRACE_SECONDS = 24 * 60 * 60;
/** How long a stale answer holds the live key before GitHub is asked again. */
const STALE_RETRY_SECONDS = 5 * 60;

/** Drawn at 44px, fetched at 96 so it holds up on a retina screen. */
const AVATAR_PIXELS = 96;
const AVATAR_MAX_BYTES = 256 * 1024;
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const AVATAR_TTL_SECONDS = 7 * 24 * 60 * 60;
const CARD_FONTS = { display: displayFont, mono: monoFont };
const API_CATALOG_PATH = "/.well-known/api-catalog";
const API_CATALOG_PROFILE = "https://www.rfc-editor.org/info/rfc9727";

/**
 * The featured year, not the calendar one: through the January grace window a
 * card still reads the finished year, and pinning it for 30 days would freeze
 * whatever GitHub had settled on at 00:30 on 1 January.
 */
function edgeTtl(year: number): number {
  return year >= featuredYear(todayIso()) ? LIVE_TTL_SECONDS : ARCHIVE_TTL_SECONDS;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...init.headers,
    },
  });
}

function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
}

function catalogLink(): string {
  return `<${API_CATALOG_PATH}>; rel="api-catalog"; type="application/linkset+json"`;
}

function pageLinks(alternate: string): string {
  return `<${alternate}>; rel="alternate"; type="application/json", ${catalogLink()}`;
}

function handleApiCatalog(request: Request): Response {
  const origin = new URL(request.url).origin;
  const body = apiCatalog(
    origin,
    PEOPLE.map((person) => person.accounts[0]),
  );
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    headers: {
      "Content-Type": `application/linkset+json; charset=utf-8; profile="${API_CATALOG_PROFILE}"`,
      "Cache-Control": __IS_PREVIEW_BUILD__
        ? "no-store"
        : `public, max-age=${BROWSER_ARCHIVE_TTL_SECONDS}`,
      "X-Board-Build": __BUILD_COMMIT_SHA__,
      Link: catalogLink(),
    },
  });
}

/** Fixed inputs every rendered page shares, resolved once per request. */
function siteChrome(): SiteChrome {
  return {
    thisYear: currentYear(),
    stylesUrl,
    enhanceUrl,
    buildSha: __BUILD_COMMIT_SHA__,
  };
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
): Promise<{ response: Response; cache: CacheState }> {
  const cache = caches.default;
  // `year` is a validated integer, so the key set is bounded and enumerable.
  const cacheKey = new Request(`${JSON_CACHE_PREFIX}${year}`, { method: "GET" });
  const lastGoodKey = new Request(`${LAST_GOOD_JSON_PREFIX}${year}`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return { response: hit, cache: isStaleCopy(hit) ? "STALE" : "HIT" };

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

    ctx.waitUntil(
      Promise.all([
        cache.put(cacheKey, fresh.clone()),
        cache.put(
          lastGoodKey,
          lastGoodCopy(fresh.clone(), edgeTtl(year) + LAST_GOOD_GRACE_SECONDS),
        ),
      ]),
    );
    return { response: fresh, cache: "MISS" };
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : 500;
    const message = error instanceof Error ? error.message : "The board could not be assembled.";
    console.error("board failed", { message, status, year });

    const lastGood = await cache.match(lastGoodKey);
    if (lastGood) {
      const stale = staleCopy(lastGood, STALE_RETRY_SECONDS);
      ctx.waitUntil(cache.put(cacheKey, stale.clone()));
      return { response: stale, cache: "STALE" };
    }

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
  createdAt: string | null;
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
  ctx: ExecutionContext,
): Promise<
  { ok: true; archive: ArchiveTotals; stale: boolean } | { ok: false; status: number; message: string }
> {
  const lastYear = currentYear() - 1;
  if (lastYear < MIN_YEAR) {
    return {
      ok: true,
      stale: false,
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
  const lastGoodKey = new Request(`${ARCHIVE_LAST_GOOD_PREFIX}${lastYear}`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) {
    return { ok: true, archive: (await hit.json()) as ArchiveTotals, stale: isStaleCopy(hit) };
  }

  try {
    const archive = await fetchArchiveTotals(MIN_YEAR, lastYear);
    const fresh = json(archive, {
      headers: { "Cache-Control": `public, max-age=${ARCHIVE_TTL_SECONDS}` },
    });
    ctx.waitUntil(
      Promise.all([
        cache.put(cacheKey, fresh.clone()),
        cache.put(
          lastGoodKey,
          lastGoodCopy(fresh.clone(), ARCHIVE_TTL_SECONDS + LAST_GOOD_GRACE_SECONDS),
        ),
      ]),
    );
    return { ok: true, archive, stale: false };
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : 500;
    const message = error instanceof Error ? error.message : "The archive could not be assembled.";
    console.error("archive failed", { message, status, lastYear });

    const lastGood = await cache.match(lastGoodKey);
    if (lastGood) {
      const stale = staleCopy(lastGood, STALE_RETRY_SECONDS);
      ctx.waitUntil(cache.put(cacheKey, stale.clone()));
      return { ok: true, archive: (await stale.clone().json()) as ArchiveTotals, stale: true };
    }

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
 * What a document rendered from these feeds is worth caching as. A document
 * built on a last good copy is stale in turn, and storing it would outlive the
 * outage that produced it: the feed retries every five minutes, so anything
 * derived from one must not be held for its own, longer life.
 */
function renderedState(...feeds: CacheState[]): CacheState {
  return feeds.some((feed) => feed === "STALE") ? "STALE" : "MISS";
}

function cacheDerived(
  ctx: ExecutionContext,
  cacheKey: Request,
  response: Response,
  state: CacheState,
): void {
  if (state === "STALE") return;
  ctx.waitUntil(caches.default.put(cacheKey, response));
}

/** An in-flight `boardJson` call, so one page can serve it to both feeds. */
type BoardFetch = ReturnType<typeof boardJson>;

/**
 * The archive aggregate plus the year in progress, merged by login. Shared by
 * `/all.md` and `/api/all` so both read exactly the same numbers.
 *
 * A caller that is already fetching the current year passes it in: the edge
 * cache cannot deduplicate two concurrent misses, so without this an account
 * page fetched the year in progress twice over.
 */
async function allTimeData(
  env: Env,
  ctx: ExecutionContext,
  sharedBoard?: BoardFetch,
): Promise<
  { ok: true; data: AllTimeData; stale: boolean } | { ok: false; status: number; message: string }
> {
  // A partial table would quietly understate someone's all-time total, so any
  // failure fails the whole page.
  const archiveResult = await archiveTotals(ctx);
  if (!archiveResult.ok) return archiveResult;

  // The year in progress still comes through the shared per-year JSON cache.
  const live = await (sharedBoard ?? boardJson(currentYear(), env, ctx));
  if (!live.response.ok) {
    const body = (await live.response.clone().json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      status: live.response.status,
      message: body?.error ?? "The board could not be assembled.",
    };
  }

  const { archive } = archiveResult;
  // Cloned, because a shared response is still the caller's to read.
  const liveBoard = (await live.response.clone().json()) as Board;
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
        createdAt: null,
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
    row.createdAt = user.createdAt ?? null;
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

  // The aggregate changes with the live year. Archive totals are intentionally
  // cached for longer and should not make that regularly refreshed feed look stale.
  const generatedAt = liveStamp ?? archive.generatedAt;

  return {
    ok: true,
    stale: archiveResult.stale || live.cache === "STALE",
    data: { rows: ranked, activeYears, spanYears, missing: [...missing], generatedAt },
  };
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

  const state: CacheState = result.stale ? "STALE" : "MISS";
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

  cacheDerived(ctx, cacheKey, fresh.clone(), state);
  return withBrowserHeaders(fresh, state);
}

/**
 * The all-time feed as a cached response, shared by the JSON API and the
 * rendered pages the same way `boardJson` is shared per year.
 */
async function allTimeJson(
  env: Env,
  ctx: ExecutionContext,
  sharedBoard?: BoardFetch,
): Promise<{ response: Response; cache: CacheState }> {
  const cache = caches.default;
  const cacheKey = new Request(ALL_JSON_CACHE_KEY, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return { response: hit, cache: "HIT" };

  const result = await allTimeData(env, ctx, sharedBoard);
  if (!result.ok) {
    return {
      response: json(
        { error: result.message, status: result.status },
        { status: result.status, headers: { "Cache-Control": "no-store" } },
      ),
      cache: "MISS",
    };
  }

  const state: CacheState = result.stale ? "STALE" : "MISS";
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
      createdAt: row.createdAt,
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

  cacheDerived(ctx, cacheKey, fresh.clone(), state);
  return { response: fresh, cache: state };
}

async function handleAllApi(env: Env, ctx: ExecutionContext): Promise<Response> {
  const { response, cache } = await allTimeJson(env, ctx);
  if (!response.ok) return response;
  return withBrowserHeaders(response, cache);
}

/** JSON counterpart of `/u/{login}`, assembled from the same cached feeds. */
async function handleUserApi(login: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  // One fetch of the year in progress, awaited by both feeds. Starting it
  // before the all-time feed keeps the two running side by side.
  const boardFetch = boardJson(currentYear(), env, ctx);
  const [boardResult, allResult] = await Promise.all([
    boardFetch,
    allTimeJson(env, ctx, boardFetch),
  ]);
  if (!boardResult.response.ok) return boardResult.response;
  if (!allResult.response.ok) return allResult.response;

  const board = (await boardResult.response.json()) as Board;
  const data = (await allResult.response.json()) as AllTime;
  const user = data.users.find((other) => other.login === login);
  if (!user) {
    return json(
      { error: `No leaderboard account named ${login}.`, status: 404 },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const generatedAt = allResult.response.headers.get("X-Board-Generated") ?? new Date().toISOString();
  const fresh = json(userProfile(user, board, currentYear()), {
    headers: {
      "Cache-Control": `public, max-age=${LIVE_TTL_SECONDS}`,
      "X-Board-Generated": generatedAt,
      "X-Board-Year": String(currentYear()),
    },
  });
  const cache =
    boardResult.cache === "HIT" && allResult.cache === "HIT"
      ? "HIT"
      : renderedState(boardResult.cache, allResult.cache);
  return withBrowserHeaders(fresh, cache);
}

async function handleMarkdown(year: number, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(`${MARKDOWN_CACHE_PREFIX}${year}`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT", year);

  const { response, cache: feed } = await boardJson(year, env, ctx);

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

  const state = renderedState(feed);
  cacheDerived(ctx, cacheKey, fresh.clone(), state);
  return withBrowserHeaders(fresh, state, year);
}

/* ---------------------------------------------------------------------------
   Rendered pages
   The same pull-based shape as the markdown views: check the edge cache,
   render from the shared JSON feeds on a miss, store the finished document.
   Upstream failures become an error page and are never cached.
--------------------------------------------------------------------------- */

/**
 * Vite's local Cache API persists across restarts while uncommitted builds
 * retain the same Git SHA. Bypass only rendered documents in development so
 * template edits are visible immediately; the data caches can stay warm.
 */
async function renderedPageHit(cacheKey: Request): Promise<Response | undefined> {
  if (__DEV__) return undefined;
  return caches.default.match(cacheKey);
}

function cacheRenderedPage(
  ctx: ExecutionContext,
  cacheKey: Request,
  response: Response,
  state: CacheState,
): void {
  if (!__DEV__) cacheDerived(ctx, cacheKey, response, state);
}

/** Turns a failed feed response into the error page, carrying its status. */
async function pageFromFailure(response: Response): Promise<Response> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return html(errorPageHtml(siteChrome(), body?.error ?? "The board could not be assembled."), {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function handleYearPage(year: number, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(`${HTML_CACHE_PREFIX}${currentYear()}/year/${year}`, {
    method: "GET",
  });

  const hit = await renderedPageHit(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT", year);

  const { response, cache: feed } = await boardJson(year, env, ctx);
  if (!response.ok) return pageFromFailure(response);

  const generatedAt = response.headers.get("X-Board-Generated") ?? new Date().toISOString();
  const missing = (response.headers.get("X-Board-Missing") ?? "").split(",").filter(Boolean);
  const board = (await response.json()) as Board;

  const page = yearPageHtml({
    chrome: siteChrome(),
    board,
    year,
    today: todayIso(),
    generatedAt,
    missing,
  });

  const fresh = html(page, {
    headers: {
      "Cache-Control": `public, max-age=${edgeTtl(year)}`,
      Link: pageLinks(`/api/board?year=${year}`),
      "X-Board-Generated": generatedAt,
      "X-Board-Year": String(year),
    },
  });

  const state = renderedState(feed);
  cacheRenderedPage(ctx, cacheKey, fresh.clone(), state);
  return withBrowserHeaders(fresh, state, year);
}

async function handleAllPage(env: Env, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(`${HTML_CACHE_PREFIX}${currentYear()}/all`, { method: "GET" });

  const hit = await renderedPageHit(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  const { response, cache: feed } = await allTimeJson(env, ctx);
  if (!response.ok) return pageFromFailure(response);

  const generatedAt = response.headers.get("X-Board-Generated") ?? new Date().toISOString();
  const missing = (response.headers.get("X-Board-Missing") ?? "").split(",").filter(Boolean);
  const data = (await response.json()) as AllTime;

  const page = allPageHtml({ chrome: siteChrome(), data, generatedAt, missing });

  const fresh = html(page, {
    headers: {
      // Includes the year in progress, so it expires on the live schedule.
      "Cache-Control": `public, max-age=${LIVE_TTL_SECONDS}`,
      Link: pageLinks("/api/all"),
      "X-Board-Generated": generatedAt,
      "X-Board-Year": "all",
    },
  });

  const state = renderedState(feed);
  cacheRenderedPage(ctx, cacheKey, fresh.clone(), state);
  return withBrowserHeaders(fresh, state);
}

/** A user page draws on both feeds: the live year for the day grid, all time
 *  for the year strip. `login` is a canonical entry from PEOPLE, never raw
 *  visitor input, so the cache key set stays enumerable. */
async function handleUserPage(login: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(`${HTML_CACHE_PREFIX}${currentYear()}/u/${login}`, {
    method: "GET",
  });

  const hit = await renderedPageHit(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  // One fetch of the year in progress, awaited by both feeds. Starting it
  // before the all-time feed keeps the two running side by side.
  const boardFetch = boardJson(currentYear(), env, ctx);
  const [boardResult, allResult] = await Promise.all([
    boardFetch,
    allTimeJson(env, ctx, boardFetch),
  ]);
  if (!boardResult.response.ok) return pageFromFailure(boardResult.response);
  if (!allResult.response.ok) return pageFromFailure(allResult.response);

  const generatedAt =
    boardResult.response.headers.get("X-Board-Generated") ?? new Date().toISOString();
  const board = (await boardResult.response.json()) as Board;
  const data = (await allResult.response.json()) as AllTime;

  const user = data.users.find((other) => other.login.toLowerCase() === login.toLowerCase());
  if (!user) {
    // On the roster but absent from every feed: a 404 with a name in it.
    return html(unknownUserPageHtml(siteChrome(), login), {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const page = userPageHtml({
    chrome: siteChrome(),
    user,
    board,
    allUsers: data.users,
    years: data.years,
    year: currentYear(),
    today: todayIso(),
    generatedAt,
  });

  const fresh = html(page, {
    headers: {
      "Cache-Control": `public, max-age=${LIVE_TTL_SECONDS}`,
      Link: pageLinks(`/api/users/${login}`),
      "X-Board-Generated": generatedAt,
      "X-Board-Year": String(currentYear()),
    },
  });

  const state = renderedState(boardResult.cache, allResult.cache);
  cacheRenderedPage(ctx, cacheKey, fresh.clone(), state);
  return withBrowserHeaders(fresh, state);
}

/**
 * The roster entry a requested login names, whatever its casing. Every image
 * and page route is keyed on the canonical spelling, so the set of URLs that
 * exist stays as small as the roster.
 */
function rosterLogin(requested: string): string | undefined {
  return PEOPLE.map((person) => person.accounts[0]).find(
    (account) => account.toLowerCase() === requested.toLowerCase(),
  );
}

/* ---------------------------------------------------------------------------
   README cards
   An SVG loaded through an <img> may not fetch, so the avatar and both
   typefaces travel inside it. Otherwise the same shape as the rendered pages.
--------------------------------------------------------------------------- */

/** workerd has no Buffer, and spreading 96 KB into fromCharCode overflows. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/** Every failure returns null: a card without a face is worse, not broken. */
async function avatarDataUri(login: string, ctx: ExecutionContext): Promise<string | null> {
  const cache = caches.default;
  const cacheKey = new Request(`${AVATAR_CACHE_PREFIX}${AVATAR_PIXELS}/${login}`, {
    method: "GET",
  });

  // Bypassed in development for the same reason rendered pages are: Vite's
  // local Cache API outlives a restart, and a week is a long time to debug.
  const hit = __DEV__ ? undefined : await cache.match(cacheKey);
  if (hit) return hit.text();

  try {
    const response = await fetch(`https://github.com/${login}.png?size=${AVATAR_PIXELS}`, {
      headers: { Accept: "image/*" },
    });
    if (!response.ok) return null;

    // An allow-list, not an `image/` prefix: image/svg+xml would nest a
    // document inside the card, and parameters would ride into the data URI.
    const type = (response.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!AVATAR_TYPES.includes(type)) return null;

    const declared = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) return null;

    const dataUri = `data:${type};base64,${toBase64(bytes)}`;
    if (!__DEV__) ctx.waitUntil(
      cache.put(
        cacheKey,
        text(dataUri, { headers: { "Cache-Control": `public, max-age=${AVATAR_TTL_SECONDS}` } }),
      ),
    );
    return dataUri;
  } catch (error) {
    console.error("avatar failed", {
      login,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function svg(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      ...init.headers,
    },
  });
}

/**
 * The card for one account. `login` is a canonical PEOPLE entry, so the key set
 * stays enumerable; the year comes from `featuredYear`, not the calendar.
 */
async function handleUserCard(login: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const year = Math.max(MIN_YEAR, featuredYear(todayIso()));
  const cacheKey = new Request(`${HTML_CACHE_PREFIX}${year}/card/${login}`, { method: "GET" });

  const hit = await renderedPageHit(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  const [boardResult, allResult] = await Promise.all([
    boardJson(year, env, ctx),
    allTimeJson(env, ctx),
  ]);
  // No card at all on failure: a non-200 leaves whatever GitHub has cached in
  // place, where an error card would replace someone's README image.
  if (!boardResult.response.ok) return imageFromFailure(boardResult.response);
  if (!allResult.response.ok) return imageFromFailure(allResult.response);

  const generatedAt =
    boardResult.response.headers.get("X-Board-Generated") ?? new Date().toISOString();
  const board = (await boardResult.response.json()) as Board;
  const data = (await allResult.response.json()) as AllTime;

  const avatar = await avatarDataUri(login, ctx);
  const career = data.users.find((other) => other.login === login);
  const user = board.find((other) => other.login === login);

  // Not cached: absence upstream is usually temporary, and a card claiming it
  // should not outlive the outage.
  if (!user || !career) {
    return withBrowserHeaders(
      svg(
        absentCardSvg({
          user: { login, name: career?.name ?? null, avatar },
          site: SITE,
          fonts: CARD_FONTS,
        }),
        { headers: { "Cache-Control": `public, max-age=${BROWSER_TTL_SECONDS}` } },
      ),
      "MISS",
    );
  }

  const activeYears = Object.entries(career.byYear)
    .filter(([, count]) => count > 0)
    .map(([activeYear]) => Number(activeYear));
  const grid = userGrid(user.weeks, year, todayIso());
  const total = user.totalContributions;

  const body = cardSvg({
    user: { login: user.login, name: user.name, avatar },
    year,
    total,
    allTime: career.total,
    firstYear: activeYears.length > 0 ? Math.min(...activeYears) : year,
    grid,
    shape: yearShape(grid, todayIso()),
    goals: { nextMilestone: nextMilestone(total, PERSONAL_MILESTONES) },
    generatedAt,
    site: SITE,
    fonts: CARD_FONTS,
  });

  const fresh = svg(body, {
    headers: {
      "Cache-Control": `public, max-age=${LIVE_TTL_SECONDS}`,
      Link: pageLinks(`/api/users/${login}`),
      "X-Board-Generated": generatedAt,
      "X-Board-Year": String(year),
    },
  });

  const state = renderedState(boardResult.cache, allResult.cache);
  cacheRenderedPage(ctx, cacheKey, fresh.clone(), state);
  return withBrowserHeaders(fresh, state);
}

/* ---------------------------------------------------------------------------
   README badges
   The card's two feeds and none of its weight: no avatar to fetch, no fonts to
   inline, one number out.
--------------------------------------------------------------------------- */

/** What one feed yields a badge, and whether the account was in it at all. */
interface DrawnBadge {
  input: BadgeInput;
  present: boolean;
}

function yearBadge(board: Board, login: string, year: number): DrawnBadge {
  const user = board.find((other) => other.login === login);
  return {
    input: { kind: "year", year, total: user?.totalContributions ?? null },
    present: user !== undefined,
  };
}

/** The span falls back to `year` only when the account has no active year. */
function allTimeBadge(data: AllTime, login: string, year: number): DrawnBadge {
  const career = data.users.find((other) => other.login === login);
  const activeYears = Object.entries(career?.byYear ?? {})
    .filter(([, count]) => count > 0)
    .map(([activeYear]) => Number(activeYear));

  return {
    input: {
      kind: "all",
      firstYear: activeYears.length > 0 ? Math.min(...activeYears) : year,
      allTime: career?.total ?? null,
    },
    present: career !== undefined,
  };
}

/**
 * A badge for one account. Two kinds and a canonical `login`, so the roster
 * still bounds the set of images that exist.
 */
async function handleUserBadge(
  login: string,
  kind: BadgeKind,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const year = Math.max(MIN_YEAR, featuredYear(todayIso()));
  const cacheKey = new Request(`${HTML_CACHE_PREFIX}${year}/badge/${kind}/${login}`, {
    method: "GET",
  });

  const hit = await renderedPageHit(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  /* One feed each. A year badge has no business failing because the archive is
     down, and the card's habit of awaiting both cannot be shared here: the two
     callers that pass a board to `allTimeJson` fetch `currentYear()`, while a
     badge draws `featuredYear`, and those differ for a fortnight each January. */
  const source =
    kind === "year" ? await boardJson(year, env, ctx) : await allTimeJson(env, ctx);
  if (!source.response.ok) return imageFromFailure(source.response);

  const generatedAt =
    source.response.headers.get("X-Board-Generated") ?? new Date().toISOString();

  const drawn =
    kind === "year"
      ? yearBadge((await source.response.json()) as Board, login, year)
      : allTimeBadge((await source.response.json()) as AllTime, login, year);

  const body = badgeSvg(drawn.input);

  // Not cached, for the reason the card gives: absence upstream is usually
  // temporary, and a badge reading "no data" should not outlive the outage.
  if (!drawn.present) {
    return withBrowserHeaders(
      svg(body, { headers: { "Cache-Control": `public, max-age=${BROWSER_TTL_SECONDS}` } }),
      "MISS",
    );
  }

  const fresh = svg(body, {
    headers: {
      "Cache-Control": `public, max-age=${LIVE_TTL_SECONDS}`,
      Link: pageLinks(`/api/users/${login}`),
      "X-Board-Generated": generatedAt,
      // What the badge actually read, matching the feed it came from.
      "X-Board-Year": kind === "year" ? String(year) : "all",
    },
  });

  const state = renderedState(source.cache);
  cacheRenderedPage(ctx, cacheKey, fresh.clone(), state);
  return withBrowserHeaders(fresh, state);
}

async function imageFromFailure(response: Response): Promise<Response> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return text(`${body?.error ?? "The board could not be assembled."}\n`, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Re-issue a cached/fresh response with client-facing cache headers. Finished
 * years can sit in the visitor's browser for a day; anything touching the year
 * in progress stays on the short schedule.
 */
function withBrowserHeaders(
  response: Response,
  cacheState: CacheState,
  year: number | null = null,
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Board-Build", __BUILD_COMMIT_SHA__);
  // The marker belongs to the answer rather than the cache it arrived through,
  // so a document rendered from a last good copy carries it too, in
  // development as well, where every response reads as a bypass.
  if (cacheState === "STALE") headers.set(STALE_HEADER, "1");
  if (__DEV__) {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Board-Cache", "BYPASS");
    return new Response(response.body, { status: response.status, headers });
  }

  const archived = year !== null && year !== currentYear();
  // A stale answer never earns the day-long archive window: it is replaced as
  // soon as GitHub answers again.
  const maxAge =
    archived && cacheState !== "STALE" ? BROWSER_ARCHIVE_TTL_SECONDS : BROWSER_TTL_SECONDS;
  const staleFor = archived ? ARCHIVE_TTL_SECONDS : LIVE_TTL_SECONDS;
  headers.set("Cache-Control", browserCacheControl(__IS_PREVIEW_BUILD__, maxAge, staleFor));
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
  await env.LEADER_STATE.getByName("leaderboard").update(year, todayIso(), board);
}

function count(value: number): string {
  return value.toLocaleString("en-GB");
}

function personalBestEmbed(year: number, event: PersonalBestEvent): DiscordEmbed {
  const improvement =
    event.previousCount > 0
      ? `, beating their previous best of **${count(event.previousCount)}**`
      : "";
  return {
    title: "New daily contributions PB",
    url: `${SITE}/${year}`,
    description: `[${event.login}](${event.url}) recorded **${count(event.count)} contributions** on **${formatDayYear(event.date)}**${improvement}.`,
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
    description: `[${event.peak.login}](${event.peak.url}) set a new board record with **${count(event.peak.count)} contributions** on **${formatDayYear(event.peak.date)}**${previous}.`,
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
    title: "Position change",
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
  /** Parsed once per object instance so a bad secret warns promptly, not twice an hour. */
  private discordUserIds?: ReadonlyMap<string, string>;

  private async notify(notification: DiscordNotification): Promise<void> {
    if (!this.env.DISCORD_WEBHOOK_URL) return;
    const webhookUrl = discordWebhookUrl(this.env.DISCORD_WEBHOOK_URL, notification);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordWebhookPayload(notification)),
    });
    if (!response.ok) throw new Error(`Discord rejected the notification (${response.status}).`);
  }

  private cakeDayUserIds(): ReadonlyMap<string, string> {
    if (this.discordUserIds) return this.discordUserIds;
    try {
      const { users, invalidLogins, duplicateLogins } = parseDiscordUserIds(
        this.env.DISCORD_USER_IDS,
      );
      this.discordUserIds = users;
      if (invalidLogins.length > 0) {
        console.warn("invalid cake-day Discord user mappings ignored", { logins: invalidLogins });
      }
      if (duplicateLogins.length > 0) {
        console.warn("duplicate cake-day GitHub logins ignored", { logins: duplicateLogins });
      }
    } catch (error) {
      this.discordUserIds = new Map();
      console.warn("cake-day Discord user mapping ignored", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return this.discordUserIds;
  }

  private async updateStandings(year: number, board: Board): Promise<void> {
    const leader = board[0];
    if (!leader || leader.totalContributions === 0) return;
    const previous = await this.ctx.storage.get<StandingState | { year: number; login: string }>("leader");
    const plan = planStandings(year, board, previous);
    await deliverStandings(
      plan,
      (notification) =>
        this.notify({
          kind: "embed",
          embed:
            notification.type === "leader"
              ? leaderEmbed(year, notification)
              : standingOvertakeEmbed(year, notification),
        }),
      (state) => this.ctx.storage.put("leader", state),
    );
  }

  private async updateDailyRecords(year: number, board: Board): Promise<void> {
    const previous = await this.ctx.storage.get<DailyRecordState>("daily-records");
    const plan = planDailyRecords(year, board, previous);
    await deliverDailyRecords(
      plan,
      (notification) =>
        this.notify({
          kind: "embed",
          embed:
            notification.type === "personal-best"
              ? personalBestEmbed(year, notification.event)
              : boardRecordEmbed(year, notification.event),
        }),
      (state) => this.ctx.storage.put("daily-records", state),
    );
  }

  private async updateMilestones(year: number, board: Board): Promise<void> {
    const previous = await this.ctx.storage.get<MilestoneState>("milestones");
    const plan = planMilestones(year, board, previous);
    await deliverMilestones(
      plan,
      (notification) =>
        this.notify({
          kind: "embed",
          embed:
            notification.type === "personal-milestone"
              ? personalMilestoneEmbed(year, notification.event)
              : boardMilestoneEmbed(year, notification.event),
        }),
      (state) => this.ctx.storage.put("milestones", state),
    );
  }

  private async updateCakeDays(today: string, board: Board): Promise<void> {
    const previous = await this.ctx.storage.get<CakeDayState>("cake-days");
    const plan = planCakeDays(today, board, previous);
    const userIds = this.cakeDayUserIds();
    await deliverCakeDays(
      plan,
      (event) => this.notify(cakeDayNotification(event, userIds)),
      (state) => this.ctx.storage.put("cake-days", state),
    );
  }

  async update(year: number, today: string, board: Board): Promise<void> {
    return this.updates.run(async () => {
      await this.updateStandings(year, board);
      await this.updateDailyRecords(year, board);
      await this.updateMilestones(year, board);
      await this.updateCakeDays(today, board);
    });
  }
}

async function routeApi(
  request: Request,
  url: URL,
  readOnly: boolean,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  if (url.pathname === API_CATALOG_PATH) {
    if (!readOnly) {
      return json({ error: `Use GET for ${API_CATALOG_PATH}.`, status: 405 }, { status: 405 });
    }
    return handleApiCatalog(request);
  }
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

  const userApiMatch = /^\/api\/users\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/.exec(url.pathname);
  if (userApiMatch) {
    if (!readOnly) {
      return json({ error: "Use GET for user APIs.", status: 405 }, { status: 405 });
    }
    const requested = userApiMatch[1];
    const canonical = rosterLogin(requested);
    if (!canonical) {
      return json(
        { error: `No leaderboard account named ${requested}.`, status: 404 },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (url.pathname !== `/api/users/${canonical}`) {
      return Response.redirect(`${url.origin}/api/users/${canonical}`, 308);
    }
    try {
      return await handleUserApi(canonical, env, ctx);
    } catch (error) {
      console.error("user api failed", {
        login: canonical,
        message: error instanceof Error ? error.message : String(error),
      });
      return json(
        { error: "The board could not be assembled.", status: 500 },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  return url.pathname.startsWith("/api/")
    ? json({ error: `No API route at ${url.pathname}.`, status: 404 }, { status: 404 })
    : null;
}

async function routeImage(
  url: URL,
  readOnly: boolean,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const badgeMatch = /^\/u\/([A-Za-z0-9][A-Za-z0-9-]*)\/(year|all)\.svg$/.exec(url.pathname);
  if (badgeMatch) {
    if (!readOnly) return text("Use GET for badges.\n", { status: 405 });
    const [, requested, kind] = badgeMatch;
    const canonical = rosterLogin(requested);
    // Off the roster is a 404, exactly as it is for a card.
    if (!canonical) {
      return text(`No leaderboard account named ${requested}.\n`, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (url.pathname !== `/u/${canonical}/${kind}.svg`) {
      return Response.redirect(`${url.origin}/u/${canonical}/${kind}.svg`, 308);
    }
    try {
      return await handleUserBadge(canonical, kind as BadgeKind, env, ctx);
    } catch (error) {
      console.error("badge failed", {
        login: canonical,
        kind,
        message: error instanceof Error ? error.message : String(error),
      });
      return text("The badge could not be drawn.\n", {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  const cardMatch = /^\/u\/([A-Za-z0-9][A-Za-z0-9-]*)\.svg$/.exec(url.pathname);
  if (!cardMatch) return null;
  if (!readOnly) return text("Use GET for cards.\n", { status: 405 });
  const requested = cardMatch[1];
  const canonical = rosterLogin(requested);
  // Off the roster is a 404. The set of cards that exist is the roster,
  // which is the whole abuse story — see the README.
  if (!canonical) {
    return text(`No leaderboard account named ${requested}.\n`, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (url.pathname !== `/u/${canonical}.svg`) {
    return Response.redirect(`${url.origin}/u/${canonical}.svg`, 308);
  }
  try {
    return await handleUserCard(canonical, env, ctx);
  } catch (error) {
    console.error("card failed", {
      login: canonical,
      message: error instanceof Error ? error.message : String(error),
    });
    return text("The card could not be drawn.\n", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

async function routeMarkdown(
  url: URL,
  readOnly: boolean,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  if (!url.pathname.endsWith(".md")) return null;
  if (!readOnly) return text("Use GET for markdown views.\n", { status: 405 });

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

async function servePage(url: URL, render: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try {
    response = await render();
  } catch (error) {
    console.error("page failed", {
      path: url.pathname,
      message: error instanceof Error ? error.message : String(error),
    });
    response = html(errorPageHtml(siteChrome(), "The board could not be assembled."), {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
  // `?nojs=1` shows the page exactly as it is without the enhancement
  // script. Stripped after cache retrieval: the key never sees the query.
  if (url.searchParams.has("nojs") && response.body !== null) {
    const body = (await response.text()).replace(/<script type="module"[^>]*><\/script>/, "");
    return new Response(body, { status: response.status, headers: response.headers });
  }
  return response;
}

async function routePage(
  request: Request,
  url: URL,
  readOnly: boolean,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  /* Every route below resolves to a validated year or a canonical PEOPLE
     login before any cache access, so visitor input can never shape a key. */
  if (!readOnly) return text("Use GET for board pages.\n", { status: 405 });
  if (url.pathname === "/") {
    return servePage(url, () => handleYearPage(currentYear(), env, ctx));
  }
  if (url.pathname === "/all" || url.pathname === "/all/") {
    return servePage(url, () => handleAllPage(env, ctx));
  }

  const yearMatch = /^\/(\d{4})\/?$/.exec(url.pathname);
  if (yearMatch) {
    const year = parseYear(yearMatch[1]);
    if (year === null) {
      return servePage(url, async () =>
        html(notFoundPageHtml(siteChrome()), {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        }),
      );
    }
    return servePage(url, () => handleYearPage(year, env, ctx));
  }

  const userMatch = /^\/u\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/.exec(url.pathname);
  if (userMatch) {
    const requested = userMatch[1];
    const canonical = rosterLogin(requested);
    if (!canonical) {
      // The regex has already constrained the echoed login's alphabet, and
      // the renderer escapes it besides.
      return servePage(url, async () =>
        html(unknownUserPageHtml(siteChrome(), requested), {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        }),
      );
    }
    // One casing, no trailing slash: one page, one cache entry.
    if (url.pathname !== `/u/${canonical}`) {
      return Response.redirect(`${url.origin}/u/${canonical}`, 308);
    }
    return servePage(url, () => handleUserPage(canonical, env, ctx));
  }

  // Static assets keep their own router; anything it doesn't know is a
  // real 404 now, not the old SPA shell with a 200 on it.
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;
  return servePage(url, async () =>
    html(notFoundPageHtml(siteChrome()), {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    }),
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const readOnly = request.method === "GET" || request.method === "HEAD";

    const api = await routeApi(request, url, readOnly, env, ctx);
    if (api) return api;
    const image = await routeImage(url, readOnly, env, ctx);
    if (image) return image;
    const markdown = await routeMarkdown(url, readOnly, env, ctx);
    if (markdown) return markdown;
    return routePage(request, url, readOnly, env, ctx);
  },

  scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    return refreshNotifications(env);
  },
} satisfies ExportedHandler<Env>;
