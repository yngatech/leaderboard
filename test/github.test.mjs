import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchBoard, parseContributionHtml } from "../worker/github.ts";

const fixtureUrl = new URL("./fixtures/contributions-fragment.html", import.meta.url);

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

test("falls back to GraphQL when a public contribution fragment fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const errors = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.github.com/graphql") {
      const { query } = JSON.parse(String(init?.body));
      if (query.includes("ContributionFallback")) {
        return Response.json({
          data: {
            u0: {
              contributionsCollection: {
                contributionCalendar: {
                  totalContributions: 3,
                  weeks: [
                    {
                      contributionDays: [
                        { date: "2026-01-01", contributionCount: 3, contributionLevel: "FIRST_QUARTILE" },
                      ],
                    },
                  ],
                },
              },
            },
          },
        });
      }
      assert.equal(query.includes("contributionsCollection"), false);
      return Response.json({
        data: {
          u0: {
            login: "alice",
            name: "Alice",
            avatarUrl: "https://avatars.example/alice",
            url: "https://github.com/alice",
            followers: { totalCount: 2 },
            following: { totalCount: 1 },
          },
        },
      });
    }

    assert.match(url, /^https:\/\/github\.com\/users\/alice\/contributions\?/);
    assert.equal(new Headers(init?.headers).get("User-Agent"), "ynga-git-board");
    return new Response("unavailable", { status: 503 });
  };
  console.error = (...args) => errors.push(args);

  try {
    const { board, missing } = await fetchBoard("token", 2026, ["alice"]);
    assert.deepEqual(missing, []);
    assert.equal(board[0].totalContributions, 3);
    assert.deepEqual(board[0].weeks, [
      { days: [{ date: "2026-01-01", count: 3, level: 1 }] },
    ]);
    assert.ok(errors.some(([message]) => message === "github contributions html fallback"));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
