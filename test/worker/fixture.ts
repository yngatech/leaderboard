import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import type { TestContext } from "node:test";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, type Request as MiniflareRequest } from "miniflare";
import type { BoardSnapshot } from "../../worker/board-snapshot.ts";
import { archiveCachePrefix } from "../../worker/cache-policy.ts";
import { PEOPLE } from "../../worker/github.ts";
import type { AllTimeMilestoneState, MilestoneState, StandingState } from "../../worker/notifications.ts";

const buildRoot = fileURLToPath(new URL("../../dist/leaderboard/", import.meta.url));
const bundle = await readFile(`${buildRoot}index.js`, "utf8");
const localPreviewBundle = await readFile(
  new URL("../../dist/alarm-local-preview/leaderboard/index.js", import.meta.url),
  "utf8",
);
const workerPreviewRoot = new URL("../../dist/worker-preview/leaderboard/", import.meta.url);
const workerPreviewBundle = await readFile(new URL("index.js", workerPreviewRoot), "utf8");
export const workerPreviewConfig = JSON.parse(await readFile(new URL("wrangler.json", workerPreviewRoot), "utf8"));
export const config = JSON.parse(await readFile(`${buildRoot}wrangler.json`, "utf8"));
const year = new Date().getUTCFullYear();
const logins = PEOPLE.flatMap((person) => person.accounts);
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const appCredentials = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_INSTALLATION_ID: "678",
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const personalToken = "synthetic-personal-token";
const installationToken = "synthetic-installation-token";
const archiveKey = `${archiveCachePrefix("https://ynga-git-board.internal/board-md-src/archive/v3/", false, PEOPLE)}${year - 1}`;

// Only this test subclass exposes storage controls; the real alarm and RPC
// methods run unchanged in workerd against SQLite storage and fake upstreams.
const driver = `
import worker, { LeaderState } from "./index.js";
export class TestLeaderState extends LeaderState {
  completed = 0;
  active = 0;
  maxActive = 0;
  async alarm() {
    this.maxActive = Math.max(this.maxActive, ++this.active);
    try {
      await super.alarm();
    } finally {
      this.active--;
      this.completed++;
    }
  }
  async fetch(request) {
    const action = new URL(request.url).pathname;
    if (action === "/wake") await this.ctx.storage.setAlarm(Date.now());
    if (action === "/stop") await this.ctx.storage.deleteAlarm();
    if (action === "/snapshot") await this.boardSnapshot(new Date().getUTCFullYear());
    if (action === "/seed-milestones") await this.ctx.storage.put("milestones", await request.json());
    if (action === "/stale-archive") {
      const hit = await caches.default.match(${JSON.stringify(archiveKey)});
      if (!hit) throw new Error("No archive to mark stale");
      const headers = new Headers(hit.headers);
      headers.set("X-Board-Stale", "1");
      await caches.default.put(${JSON.stringify(archiveKey)}, new Response(hit.body, { headers }));
    }
    return Response.json({
      completed: this.completed,
      active: this.active,
      maxActive: this.maxActive,
      alarm: await this.ctx.storage.getAlarm(),
      values: Object.fromEntries(await this.ctx.storage.list()),
    });
  }
}
export default worker;
`;

export interface State {
  completed: number;
  active: number;
  maxActive: number;
  alarm: number | null;
  values: {
    "board-snapshot"?: BoardSnapshot;
    leader?: StandingState;
    milestones?: MilestoneState;
    "all-time-milestones"?: AllTimeMilestoneState;
  } & Record<string, unknown>;
}

export async function setup(
  t: TestContext,
  options: {
    credentials?: false | "app" | "personal" | "partial-app";
    webhook?: boolean;
    discordUserIds?: string;
    localPreview?: boolean;
    history?: number;
    workerPreview?: boolean;
  } = {},
) {
  let mode: "ok" | "github-error" | "board-error" | "insights-error" | "partial" | "partial-secondary" | "discord-error" | "yearly-discord-error" |
    "lifetime-discord-error" | "archive-error" | "archive-partial" = "ok";
  let leadingCount = 10;
  let queries = 0;
  const insightQueries: string[] = [];
  let attempts = 0;
  let discordPaused: Promise<void> | undefined;
  let resumeDiscord: (() => void) | undefined;
  let exchanges = 0;
  const personal = options.credentials === "personal" || options.credentials === "partial-app";
  const credentials = options.credentials === false ? {} : {
    app: { ...appCredentials, GITHUB_TOKEN: personalToken },
    personal: { GITHUB_TOKEN: personalToken },
    "partial-app": { GITHUB_TOKEN: personalToken, GITHUB_APP_ID: "12345" },
  }[options.credentials ?? "app"];
  const posts: unknown[] = [];
  const discordFailure = (lifetime: boolean) => mode === "discord-error" ||
    mode === (lifetime ? "lifetime-discord-error" : "yearly-discord-error");
  async function graphqlResponse(request: MiniflareRequest): Promise<Response> {
    assert.equal(request.headers.get("Authorization"), `Bearer ${personal ? personalToken : installationToken}`);
    const body = await request.json() as { query: string; variables?: { q: string } };
    if (body.query.includes("query PrInsights")) {
      insightQueries.push(body.variables!.q);
      if (mode === "github-error" || mode === "insights-error") return new Response("unavailable", { status: 503 });
      return Response.json({ data: { search: {
        nodes: [], issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null },
      } } });
    }
    queries++;
    if (mode === "github-error" || mode === "board-error") return new Response("unavailable", { status: 503 });
    return Response.json({ data: Object.fromEntries(logins.map((login, i) => [
      `u${i}`,
      ((mode === "partial" && i === 0) ||
        (mode === "partial-secondary" && login === PEOPLE.find((person) => person.accounts.length > 1)!.accounts[1])) ? null : {
        login,
        name: "Test contributor",
        url: `https://github.com/${login}`,
        avatarUrl: "https://avatars.example/contributor.png",
        // Yesterday's anniversary avoids cake-day messages in the baseline.
        createdAt: new Date(Date.now() - 86400000).toISOString().replace(/^\d{4}/, "2020"),
        followers: { totalCount: 0 },
        following: { totalCount: 0 },
      },
    ])) });
  }
  const mf = new Miniflare(convertV4MiniflareOptions({
    log: new Log(LogLevel.NONE),
    name: "alarm-test",
    modulesRoot: buildRoot,
    modules: [
      { type: "ESModule", path: `${buildRoot}alarm-test.js`, contents: driver },
      {
        type: "ESModule", path: `${buildRoot}index.js`,
        contents: options.localPreview ? localPreviewBundle : options.workerPreview ? workerPreviewBundle : bundle,
      },
    ],
    compatibilityDate: config.compatibility_date,
    durableObjects: { LEADER_STATE: { className: "TestLeaderState", useSQLite: true } },
    bindings: {
      ...credentials,
      ...(options.webhook !== false ? { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" } : {}),
      ...(options.discordUserIds !== undefined ? { DISCORD_USER_IDS: options.discordUserIds } : {}),
    },
    outboundService: async (request: MiniflareRequest) => {
      const url = new URL(request.url);
      if (url.href === "https://api.github.com/app/installations/678/access_tokens") {
        exchanges++;
        assert.equal(request.method, "POST");
        return Response.json({
          token: installationToken,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });
      }
      if (url.hostname === "discord.example") {
        attempts++;
        await discordPaused;
        const payload = await request.json() as { embeds?: { title: string }[] };
        const lifetime = payload.embeds?.[0]?.title === "All-time contribution milestone";
        if (discordFailure(lifetime)) {
          return new Response("unavailable", { status: 503 });
        }
        posts.push(payload);
        return new Response(null, { status: 204 });
      }
      if (url.href === "https://api.github.com/graphql") {
        return graphqlResponse(request);
      }
      assert.equal(url.hostname, "github.com");
      assert.match(url.pathname, /^\/users\/[^/]+\/contributions$/);
      const calendarYear = Number(url.searchParams.get("from")!.slice(0, 4));
      const primary = url.pathname.includes(`/users/${logins[0]}/`);
      if (primary && calendarYear < year && mode === "archive-partial") {
        return new Response("not found", { status: 404 });
      }
      if (primary && calendarYear === year - 1 && mode === "archive-error") {
        return new Response("unavailable", { status: 503 });
      }
      const count = calendarYear === year
        ? primary ? leadingCount : 10
        : primary && calendarYear === year - 1 ? options.history ?? 0 : 0;
      const date = `${calendarYear}-01-01`;
      return new Response(`<h2 id="js-contribution-activity-description">${count} contributions in ${calendarYear}</h2>
        <td data-date="${date}" data-level="1" id="contribution-day-component-0-0"></td>
        <tool-tip for="contribution-day-component-0-0">${count} contributions on January 1.</tool-tip>`);
    },
  }));
  t.after(() => {
    resumeDiscord?.();
    return mf.dispose();
  });
  const namespace = await mf.getDurableObjectNamespace("LEADER_STATE");
  const stub = namespace.getByName("leaderboard");
  async function state(action = "status"): Promise<State> {
    const response = await stub.fetch(`https://alarm.test/${action}`);
    return await response.json() as State;
  }
  async function until(predicate: (current: State) => boolean): Promise<State> {
    const deadline = Date.now() + 5000;
    do {
      const current = await state();
      if (predicate(current)) return current;
      await setTimeout(20);
    } while (Date.now() < deadline);
    assert.fail("alarm did not reach the expected state within five seconds");
  }
  async function refreshed(): Promise<State> {
    const previous = await state();
    await state("wake");
    return until((current) => current.completed > previous.completed);
  }
  return {
    mf, state, until, refreshed, posts, insightQueries,
    seedMilestones: async (milestones: MilestoneState) => {
      await stub.fetch("https://alarm.test/seed-milestones", {
        method: "POST", body: JSON.stringify(milestones),
      });
    },
    setMode: (next: typeof mode) => { mode = next; },
    setCount: (count: number) => { leadingCount = count; },
    queries: () => queries,
    attempts: () => attempts,
    pauseDiscord: () => { discordPaused = new Promise((resolve) => { resumeDiscord = resolve; }); },
    resumeDiscord: () => resumeDiscord?.(),
    exchanges: () => exchanges,
  };
}
