import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fetchArchiveTotals,
  fetchBoard,
  parseContributionHtml,
} from "../worker/github.ts";

const fixtureUrl = new URL("./fixtures/contributions-fragment.html", import.meta.url);

/** A contributions fragment shaped like GitHub's, for one week of a year. */
function fragment(year: number, counts: readonly number[]): string {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const cells = counts
    .map((count, weekday) => {
      const id = `contribution-day-component-${weekday}-0`;
      const day = weekday + 1;
      const tooltip = count === 0 ? "No contributions" : `${count} contributions`;
      return `<td data-date="${year}-01-0${day}" data-level="${count > 0 ? 2 : 0}" id="${id}"></td>` +
        `<tool-tip for="${id}">${tooltip} on January ${day}.</tool-tip>`;
    })
    .join("\n");

  return `<div class="js-yearly-contributions">
  <h2 id="js-contribution-activity-description">${total} contributions in ${year}</h2>
  <table><tbody><tr>${cells}</tr></tbody></table>
</div>`;
}

const PROFILES = {
  data: {
    u0: {
      login: "current",
      name: "Current profile",
      avatarUrl: "https://avatars.example/current",
      url: "https://github.com/current",
      createdAt: "2020-05-01T10:00:00Z",
      followers: { totalCount: 2 },
      following: { totalCount: 1 },
    },
    u1: {
      login: "old",
      name: "Old profile",
      avatarUrl: "https://avatars.example/old",
      url: "https://github.com/old",
      createdAt: "2012-08-14T08:30:00Z",
      followers: { totalCount: 1 },
      following: { totalCount: 0 },
    },
  },
};

/**
 * Swaps in a fetch that answers profile queries from `PROFILES` and hands
 * every contributions request to `page`. Contribution data never comes from
 * GraphQL, so a query asking for one fails the test outright.
 */
async function withGitHub(
  page: (login: string, url: URL) => Response,
  run: (calls: string[], errors: unknown[][]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const calls: string[] = [];
  const errors: unknown[][] = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.href === "https://api.github.com/graphql") {
      const { query } = JSON.parse(String(init?.body));
      assert.equal(query.includes("contributionsCollection"), false);
      return Response.json(PROFILES);
    }

    const login = /^\/users\/(.+)\/contributions$/.exec(url.pathname)?.[1];
    assert.ok(login, `unexpected request to ${url.href}`);
    assert.equal(new Headers(init?.headers).get("User-Agent"), "ynga-git-board");
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    calls.push(login);
    return page(login, url);
  };
  console.error = (...args) => errors.push(args);

  try {
    await run(calls, errors);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
}

test("parses a contribution fragment into ordered weekly days", async () => {
  const calendar = parseContributionHtml(await readFile(fixtureUrl, "utf8"));

  assert.ok(calendar);
  assert.equal(calendar.totalContributions, 1249);
  assert.deepEqual(calendar.weeks, [
    {
      days: [
        { date: "2026-01-01", count: 1234, level: 4 },
        { date: "2026-01-02", count: 13, level: 3 },
        { date: "2026-01-03", count: 2, level: 1 },
      ],
    },
    {
      days: [
        { date: "2026-01-04", count: 0, level: 0 },
        { date: "2026-01-05", count: 0, level: 0 },
      ],
    },
  ]);
  assert.equal(calendar.weeks.flatMap((week) => week.days).reduce((sum, day) => sum + day.count, 0), 1249);
});

test("combines accounts belonging to one person", async () => {
  await withGitHub(
    (login) => new Response(fragment(2026, login === "current" ? [3, 0] : [2, 1])),
    async () => {
      const { board, missing } = await fetchBoard("token", 2026, [{ accounts: ["current", "old"] }]);

      assert.deepEqual(missing, []);
      assert.equal(board[0].login, "current");
      assert.equal(board[0].name, "Current profile");
      // The person's cake day belongs to their oldest account, not the primary one.
      assert.equal(board[0].createdAt, "2012-08-14T08:30:00Z");
      assert.equal(board[0].totalContributions, 6);
      assert.deepEqual(board[0].weeks, [
        {
          days: [
            { date: "2026-01-01", count: 5, level: 2 },
            { date: "2026-01-02", count: 1, level: 1 },
          ],
        },
      ]);
    },
  );
});

test("retries a contributions fragment that GitHub refuses", async () => {
  const attempts = new Map<string, number>();

  await withGitHub(
    (login) => {
      const attempt = (attempts.get(login) ?? 0) + 1;
      attempts.set(login, attempt);
      if (login === "current" && attempt < 3) return new Response("rate limited", { status: 429 });
      return new Response(fragment(2026, login === "current" ? [3, 0] : [2, 1]));
    },
    async (calls) => {
      const { board } = await fetchBoard("token", 2026, [{ accounts: ["current", "old"] }]);

      assert.equal(board[0].totalContributions, 6);
      assert.equal(calls.filter((login) => login === "current").length, 3);
      assert.equal(calls.filter((login) => login === "old").length, 1);
    },
  );
});

test("fails the board rather than counting a login GitHub never answers for", async () => {
  await withGitHub(
    (login) => (login === "old" ? new Response("unavailable", { status: 503 }) : new Response(fragment(2026, [3, 0]))),
    async (calls, errors) => {
      await assert.rejects(
        fetchBoard("token", 2026, [{ accounts: ["current"] }, { accounts: ["old"] }]),
        /GitHub returned no contribution data for old\./,
      );
      assert.equal(calls.filter((login) => login === "old").length, 3);
      assert.ok(errors.some(([message]) => message === "github contributions html unavailable"));
    },
  );
});

test("combines archive accounts across years", async () => {
  const fixture = await readFile(fixtureUrl, "utf8");

  await withGitHub(
    (login, url) => {
      const year = url.searchParams.get("from")!.slice(0, 4);
      if (year === "2024") return new Response(fragment(2024, login === "current" ? [3, 0] : [4, 0]));
      return new Response(fixture.replaceAll("2026", "2025"));
    },
    async () => {
      const archive = await fetchArchiveTotals(2024, 2025, [{ accounts: ["current", "old"] }]);

      assert.deepEqual(archive.users, [{
        login: "current",
        url: "https://github.com/current",
        byYear: { "2024": 7, "2025": 2498 },
      }]);
      assert.deepEqual(archive.missing, []);
    },
  );
});

test("reports a login with no contributions page as missing", async () => {
  await withGitHub(
    (login) => (login === "old" ? new Response("gone", { status: 404 }) : new Response(fragment(2024, [3, 0]))),
    async (calls) => {
      const archive = await fetchArchiveTotals(2024, 2024, [
        { accounts: ["current"] },
        { accounts: ["old"] },
      ]);

      assert.deepEqual(archive.missing, ["old"]);
      assert.deepEqual(archive.users, [{
        login: "current",
        url: "https://github.com/current",
        byYear: { "2024": 3 },
      }]);
      // A page that is gone stays gone, so it is asked for once.
      assert.equal(calls.filter((login) => login === "old").length, 1);
    },
  );
});

test("fails an archive year rather than recording it as no contributions", async () => {
  await withGitHub(
    (_login, url) =>
      url.searchParams.get("from") === "2024-01-01"
        ? new Response("unavailable", { status: 503 })
        : new Response(fragment(2025, [3, 0])),
    async () => {
      await assert.rejects(
        fetchArchiveTotals(2024, 2025, [{ accounts: ["current"] }]),
        /GitHub returned no 2024 contribution data for current\./,
      );
    },
  );
});
