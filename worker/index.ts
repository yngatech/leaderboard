import { currentYear, fetchBoard, GitHubError, MIN_YEAR } from "./github";

export interface Env {
  /** Worker secret in production, `.dev.vars` locally. Never sent to the client. */
  GITHUB_TOKEN: string;
  ASSETS: Fetcher;
}

/** Synthetic key prefix — edge cache entries are not tied to the public URL. */
const CACHE_PREFIX = "https://ynga-git-board.internal/board/v2/";
/** The year in progress keeps moving. */
const LIVE_TTL_SECONDS = 30 * 60;
/** Finished years never change again. */
const ARCHIVE_TTL_SECONDS = 7 * 24 * 60 * 60;
const BROWSER_TTL_SECONDS = 5 * 60;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Accepts only a four-digit year inside the supported range and returns it as a
 * number, so the cache key below can never be shaped by visitor input.
 */
function parseYear(raw: string | null): number | null {
  if (raw === null) return currentYear();
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > currentYear()) return null;
  return year;
}

async function handleBoard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const year = parseYear(new URL(request.url).searchParams.get("year"));
  if (year === null) {
    return json(
      { error: `Year must be a whole number between ${MIN_YEAR} and ${currentYear()}.`, status: 400 },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const isLive = year === currentYear();
  const cache = caches.default;
  // `year` is a validated integer, so the key set is bounded and enumerable.
  const cacheKey = new Request(`${CACHE_PREFIX}${year}`, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  if (!env.GITHUB_TOKEN) {
    return json(
      { error: "The board is missing its GitHub token. Set the GITHUB_TOKEN secret.", status: 500 },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { board, missing } = await fetchBoard(env.GITHUB_TOKEN, year);

    const fresh = json(board, {
      headers: {
        // Drives how long `caches.default` keeps the entry.
        "Cache-Control": `public, max-age=${isLive ? LIVE_TTL_SECONDS : ARCHIVE_TTL_SECONDS}`,
        "X-Board-Generated": new Date().toISOString(),
        "X-Board-Missing": missing.join(","),
        "X-Board-Year": String(year),
      },
    });

    ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
    return withBrowserHeaders(fresh, "MISS");
  } catch (error) {
    const status = error instanceof GitHubError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "The board could not be assembled.";
    console.error("board failed", { message, status, url: request.url });
    return json(
      { error: message, status },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
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

    if (url.pathname === "/api/board") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "Use GET for /api/board.", status: 405 }, { status: 405 });
      }
      return handleBoard(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: `No API route at ${url.pathname}.`, status: 404 }, { status: 404 });
    }

    // Static assets (and the SPA fallback) are served by the assets binding.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
