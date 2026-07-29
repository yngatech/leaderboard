import type { Board } from "../shared/types";
import { currentYear, fetchBoard, GitHubError, MIN_YEAR } from "./github";

export interface Env {
  /** Worker secret in production, `.dev.vars` locally. Never sent to the client. */
  GITHUB_TOKEN: string;
  ASSETS: Fetcher;
}

/** Synthetic key prefixes — edge cache entries are not tied to the public URL. */
const JSON_CACHE_PREFIX = "https://ynga-git-board.internal/board/v2/";
const MARKDOWN_CACHE_PREFIX = "https://ynga-git-board.internal/board-md/v1/";
/** The year in progress keeps moving. */
const LIVE_TTL_SECONDS = 30 * 60;
/** Finished years never change again. */
const ARCHIVE_TTL_SECONDS = 7 * 24 * 60 * 60;
const BROWSER_TTL_SECONDS = 5 * 60;

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
        { error: "The board is missing its GitHub token. Set the GITHUB_TOKEN secret.", status: 500 },
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
  return withBrowserHeaders(response, cache);
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

async function handleAllMarkdown(env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(`${MARKDOWN_CACHE_PREFIX}all`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  const years: number[] = [];
  for (let year = MIN_YEAR; year <= currentYear(); year += 1) years.push(year);

  // Each year reads through the same per-year cache, so a cold render warms
  // every archive entry and later renders mostly hit the edge.
  const results = await Promise.all(years.map((year) => boardJson(year, env, ctx)));

  // A partial table would quietly understate someone's all-time total.
  const failed = results.find((result) => !result.response.ok);
  if (failed) {
    const body = (await failed.response.json().catch(() => null)) as { error?: string } | null;
    return text(`${body?.error ?? "The board could not be assembled."}\n`, {
      status: failed.response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const missing = new Set<string>();
  let oldestStamp: string | null = null;
  for (const { response } of results) {
    for (const login of (response.headers.get("X-Board-Missing") ?? "").split(",").filter(Boolean)) {
      missing.add(login);
    }
    const stamp = response.headers.get("X-Board-Generated");
    if (stamp && (oldestStamp === null || stamp < oldestStamp)) oldestStamp = stamp;
  }

  const boards = await Promise.all(
    results.map(({ response }) => response.json() as Promise<Board>),
  );

  // Year boards rank differently, so rows are keyed by login, not position.
  const rows = new Map<string, AllTimeRow>();
  boards.forEach((board, index) => {
    const year = years[index];
    for (const user of board) {
      let row = rows.get(user.login);
      if (!row) {
        row = { login: user.login, url: user.url, byYear: new Map(), total: 0 };
        rows.set(user.login, row);
      }
      row.url = user.url;
      row.byYear.set(year, user.totalContributions);
      row.total += user.totalContributions;
    }
  });

  const ranked = [...rows.values()].sort(
    (a, b) => b.total - a.total || a.login.localeCompare(b.login),
  );
  const activeYears = years.filter((year) =>
    ranked.some((row) => (row.byYear.get(year) ?? 0) > 0),
  );

  const generatedAt = oldestStamp ?? new Date().toISOString();
  const fresh = new Response(
    renderAllTimeMarkdown(ranked, activeYears, generatedAt, [...missing]),
    {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        // Includes the year in progress, so it expires on the live schedule.
        "Cache-Control": `public, max-age=${LIVE_TTL_SECONDS}`,
        "X-Board-Generated": generatedAt,
        "X-Board-Year": "all",
      },
    },
  );

  ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  return withBrowserHeaders(fresh, "MISS");
}

async function handleMarkdown(year: number, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(`${MARKDOWN_CACHE_PREFIX}${year}`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

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
  return withBrowserHeaders(fresh, "MISS");
}

/** Re-issue a cached/fresh response with client-facing cache headers. */
function withBrowserHeaders(response: Response, cacheState: "HIT" | "MISS"): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "Cache-Control",
    `public, max-age=${BROWSER_TTL_SECONDS}, stale-while-revalidate=${LIVE_TTL_SECONDS}`,
  );
  headers.set("X-Board-Cache", cacheState);
  return new Response(response.body, { status: response.status, headers });
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

    if (url.pathname.startsWith("/api/")) {
      return json({ error: `No API route at ${url.pathname}.`, status: 404 }, { status: 404 });
    }

    if (url.pathname.endsWith(".md")) {
      if (!readOnly) {
        return text("Use GET for markdown views.\n", { status: 405 });
      }
      if (url.pathname === "/all.md") return handleAllMarkdown(env, ctx);

      const match = /^\/(\d{4})\.md$/.exec(url.pathname);
      const year = match ? parseYear(match[1]) : null;
      if (year === null) {
        return text(`${yearOutOfRange()} Try ${SITE}/${currentYear()}.md\n`, {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return handleMarkdown(year, env, ctx);
    }

    // Static assets (and the SPA fallback) are served by the assets binding.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
