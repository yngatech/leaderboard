import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import type { TestContext } from "node:test";
import { Log, LogLevel, Miniflare, type Request as MiniflareRequest } from "miniflare";
import type { BoardSnapshot } from "../../worker/board-snapshot.ts";
import { PEOPLE } from "../../worker/github.ts";
import type { MilestoneState, StandingState } from "../../worker/notifications.ts";

const buildRoot = fileURLToPath(new URL("../../dist/leaderboard/", import.meta.url));
const bundle = await readFile(`${buildRoot}index.js`, "utf8");
const localPreviewBundle = await readFile(
  new URL("../../dist/alarm-local-preview/leaderboard/index.js", import.meta.url),
  "utf8",
);
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

// Only this test subclass exposes storage controls; the real alarm and RPC
// methods run unchanged in workerd against SQLite storage and fake upstreams.
const driver = `
import worker, { LeaderState } from "./index.js";
export class TestLeaderState extends LeaderState {
  completed = 0;
  async alarm() {
    await super.alarm();
    this.completed++;
  }
  async fetch(request) {
    const action = new URL(request.url).pathname;
    if (action === "/wake") await this.ctx.storage.setAlarm(Date.now());
    if (action === "/stop") await this.ctx.storage.deleteAlarm();
    if (action === "/snapshot") await this.boardSnapshot(new Date().getUTCFullYear());
    if (action === "/seed-milestones") await this.ctx.storage.put("milestones", await request.json());
    return Response.json({
      completed: this.completed,
      alarm: await this.ctx.storage.getAlarm(),
      values: Object.fromEntries(await this.ctx.storage.list()),
    });
  }
}
export default worker;
`;

export interface State {
  completed: number;
  alarm: number | null;
  values: { "board-snapshot"?: BoardSnapshot; leader?: StandingState; milestones?: MilestoneState } & Record<string, unknown>;
}

export async function setup(
  t: TestContext,
  options: {
    credentials?: false | "app" | "personal" | "partial-app";
    webhook?: boolean;
    localPreview?: boolean;
  } = {},
) {
  let mode: "ok" | "github-error" | "partial" | "discord-error" = "ok";
  let leadingCount = 10;
  let queries = 0;
  let attempts = 0;
  let exchanges = 0;
  const personal = options.credentials === "personal" || options.credentials === "partial-app";
  const credentials = options.credentials === false ? {} : {
    app: { ...appCredentials, GITHUB_TOKEN: personalToken },
    personal: { GITHUB_TOKEN: personalToken },
    "partial-app": { GITHUB_TOKEN: personalToken, GITHUB_APP_ID: "12345" },
  }[options.credentials ?? "app"];
  const posts: unknown[] = [];
  const mf = new Miniflare({
    name: "alarm-test",
    modulesRoot: buildRoot,
    modules: [
      { type: "ESModule", path: `${buildRoot}alarm-test.js`, contents: driver },
      {
        type: "ESModule", path: `${buildRoot}index.js`,
        contents: options.localPreview ? localPreviewBundle : bundle,
      },
    ],
    compatibilityDate: config.compatibility_date,
    durableObjects: { LEADER_STATE: { className: "TestLeaderState", useSQLite: true } },
    bindings: {
      ...credentials,
      ...(options.webhook !== false ? { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" } : {}),
    },
    log: new Log(LogLevel.NONE),
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
        if (mode === "discord-error") return new Response("unavailable", { status: 503 });
        posts.push(await request.json());
        return new Response(null, { status: 204 });
      }
      if (url.href === "https://api.github.com/graphql") {
        queries++;
        assert.equal(request.headers.get("Authorization"), `Bearer ${personal ? personalToken : installationToken}`);
        if (mode === "github-error") return new Response("unavailable", { status: 503 });
        return Response.json({ data: Object.fromEntries(logins.map((login, i) => [
          `u${i}`,
          mode === "partial" && i === 0 ? null : {
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
      assert.equal(url.hostname, "github.com");
      assert.match(url.pathname, /^\/users\/[^/]+\/contributions$/);
      const count = url.pathname.includes(`/users/${logins[0]}/`) ? leadingCount : 10;
      const date = `${url.searchParams.get("from")!.slice(0, 4)}-01-01`;
      return new Response(`<h2 id="js-contribution-activity-description">${count} contributions in ${year}</h2>
        <td data-date="${date}" data-level="1" id="contribution-day-component-0-0"></td>
        <tool-tip for="contribution-day-component-0-0">${count} contributions on January 1.</tool-tip>`);
    },
  });
  t.after(() => mf.dispose());
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
    mf, state, until, refreshed, posts,
    seedMilestones: async (milestones: MilestoneState) => {
      await stub.fetch("https://alarm.test/seed-milestones", {
        method: "POST", body: JSON.stringify(milestones),
      });
    },
    setMode: (next: typeof mode) => { mode = next; },
    setCount: (count: number) => { leadingCount = count; },
    queries: () => queries,
    attempts: () => attempts,
    exchanges: () => exchanges,
  };
}
