import { fetchBoard, GitHubError } from "./github";

export interface Env {
  /** Worker secret in production, `.dev.vars` locally. Never sent to the client. */
  GITHUB_TOKEN: string;
  ASSETS: Fetcher;
}

/** Synthetic key — the edge cache entry is not tied to the public URL. */
const CACHE_KEY = "https://ynga-git-board.internal/board/v1";
const EDGE_TTL_SECONDS = 30 * 60;
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

async function handleBoard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(CACHE_KEY, { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return withBrowserHeaders(hit, "HIT");

  if (!env.GITHUB_TOKEN) {
    return json(
      { error: "The board is missing its GitHub token. Set the GITHUB_TOKEN secret.", status: 500 },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { board, missing } = await fetchBoard(env.GITHUB_TOKEN);

    const fresh = json(board, {
      headers: {
        // Drives how long `caches.default` keeps the entry.
        "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}`,
        "X-Board-Generated": new Date().toISOString(),
        "X-Board-Missing": missing.join(","),
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
    `public, max-age=${BROWSER_TTL_SECONDS}, stale-while-revalidate=${EDGE_TTL_SECONDS}`,
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
