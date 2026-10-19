import assert from "node:assert/strict";
import test from "node:test";
import {
  breakdownFromCollections,
  breakdownTtl,
  dayWindow,
  parseBreakdownDate,
  reconcileBreakdown,
  yearWindow,
  type RawCollection,
} from "../worker/breakdown.ts";
import { fetchBreakdown, GitHubError } from "../worker/github.ts";
import { breakdownHtml, dayBreakdownHtml } from "../worker/views/breakdown.ts";

const now = new Date("2026-10-19T12:00:00Z");
const window = dayWindow("2026-10-10");
export function collection(overrides: Partial<RawCollection> = {}): RawCollection {
  return {
    login: "example",
    contributionCalendar: { totalContributions: 0 },
    restrictedContributionsCount: 0,
    totalCommitContributions: 0,
    totalPullRequestContributions: 0,
    totalIssueContributions: 0,
    totalPullRequestReviewContributions: 0,
    totalRepositoryContributions: 0,
    commitContributionsByRepository: [],
    pullRequestContributionsByRepository: [],
    issueContributionsByRepository: [],
    pullRequestReviewContributionsByRepository: [],
    ...overrides,
  };
}
const repo = (name: string, count: number, isPrivate = false) => ({
  repository: {
    nameWithOwner: name,
    url: `https://github.com/${name}`,
    isPrivate,
  },
  contributions: { totalCount: count },
});
const map = (...collections: RawCollection[]) =>
  breakdownFromCollections("example", window, collections, now.toISOString());

test("116 example reconciles reported types and restricted work", () => {
  const result = map(
    collection({
      contributionCalendar: { totalContributions: 116 },
      restrictedContributionsCount: 64,
      totalPullRequestContributions: 51,
      totalCommitContributions: 1,
      pullRequestContributionsByRepository: [
        repo("example/app", 27),
        repo("sample/bot", 23),
        repo("example/addons", 1),
      ],
      commitContributionsByRepository: [repo("example/addons", 1)],
    }),
  );
  assert.equal(result.other, 0);
  assert.equal(result.private, 64);
  assert.deepEqual(
    result.kinds.map((k) => k.total),
    [1, 51, 0, 0, 0],
  );
  const markup = String(dayBreakdownHtml("2026-10-10", result, "example", 2026));
  const bar = markup.match(/<div role="img"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const counts = [...bar.matchAll(/data-breakdown-count="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(counts, [1, 51, 64]);
  assert.equal(counts.reduce((a, b) => a + b, 0), result.calendarTotal);
});

test("other preserves signed gaps when mapped or reconciled to the shown total", () => {
  const counts = { totalIssueContributions: 3, restrictedContributionsCount: 2 };
  const base = map(collection(counts));
  for (const [calendar, expected] of [[7, 2], [5, 0], [3, -2]]) {
    const mapped = map(collection({
      ...counts, contributionCalendar: { totalContributions: calendar },
    }));
    assert.equal(mapped.other, expected);
    const reconciled = reconcileBreakdown(base, calendar);
    assert.equal(reconciled.calendarTotal, calendar);
    assert.equal(reconciled.other, expected);
  }
});

test("merges accounts and case-insensitive repositories, sorts ties, preserves unlisted gap", () => {
  const result = map(
    collection({
      totalCommitContributions: 10,
      commitContributionsByRepository: [repo("Example/app", 3), repo("example/zzz", 4)],
    }),
    collection({
      login: "secondary",
      totalCommitContributions: 5,
      commitContributionsByRepository: [repo("example/APP", 1), repo("example/aaa", 4)],
    }),
  );
  assert.deepEqual(result.accounts, ["example", "secondary"]);
  assert.equal(result.kinds[0].total, 15);
  assert.deepEqual(
    result.kinds[0].repositories.map((r) => [r.nameWithOwner, r.count]),
    [
      ["example/aaa", 4],
      ["Example/app", 4],
      ["example/zzz", 4],
    ],
  );
  assert.equal(result.kinds[0].unlisted, 3);
  const capped = map(
    collection({
      totalCommitContributions: 125,
      commitContributionsByRepository: Array.from({ length: 100 }, (_, i) =>
        repo(`example/repo-${i}`, 1),
      ),
    }),
  );
  assert.equal(capped.kinds[0].unlisted, 25);
  assert.equal(
    map(
      collection({
        totalCommitContributions: 1,
        commitContributionsByRepository: [repo("example/app", 2)],
      }),
    ).kinds[0].unlisted,
    0,
  );
});

test("validates real UTC dates, bounds and exact format", () => {
  for (const raw of [
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2007-12-31",
    "2026-10-20",
    "2026-1-01",
    "2026-10-10junk",
    "",
    "0000-01-01",
  ])
    assert.equal(parseBreakdownDate(raw, now), "invalid", raw);
  for (const raw of ["2008-01-01", "2024-02-29", "2026-10-19"])
    assert.equal(parseBreakdownDate(raw, now), raw);
  assert.equal(parseBreakdownDate(null, now), null);
});

test("windows and TTL use today UTC, including a finished day in this year", () => {
  assert.deepEqual(window, {
    kind: "day",
    date: "2026-10-10",
    from: "2026-10-10T00:00:00Z",
    to: "2026-10-10T23:59:59Z",
  });
  assert.equal(yearWindow(2026, now).to, "2026-10-19T12:00:00Z");
  assert.equal(breakdownTtl(yearWindow(2026, now), now), 1800);
  assert.equal(breakdownTtl(dayWindow("2026-10-19"), now), 60);
  assert.equal(breakdownTtl(window, now), 2592000);
  assert.equal(breakdownTtl(yearWindow(2025, now), now), 2592000);
  // Yesterday may still move, and a window built before midnight but cached
  // after it must not be pinned as finished.
  assert.equal(breakdownTtl(dayWindow("2026-10-18"), now), 60);
  const beforeMidnight = new Date("2026-10-19T23:59:59Z");
  const afterMidnight = new Date("2026-10-20T00:00:02Z");
  assert.equal(breakdownTtl(yearWindow(2026, beforeMidnight), afterMidnight), 1800);
  const newYear = new Date("2026-01-01T00:00:30Z");
  assert.equal(breakdownTtl(yearWindow(2025, newYear), newYear), 1800);
});

test("fetchBreakdown aliases accounts with variables, drops null accounts and handles failures", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let errors = [{ type: "NOT_FOUND", message: "No such account" }];
  let data: unknown = {
    a0: {
      login: "example",
      contributionsCollection: collection({ totalIssueContributions: 2 }),
    },
    a1: null,
  };
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.variables.l0, "example");
    assert.equal(body.variables.l1, "secondary");
    assert.equal(body.variables.from, window.from);
    assert.ok(body.query.includes("a0: user(login: $l0)"));
    assert.ok(!body.query.includes('"example"'));
    return Response.json({ data, errors });
  };
  try {
    const result = await fetchBreakdown(
      "synthetic-token",
      "example",
      ["example", "secondary"],
      window,
    );
    assert.equal(calls, 1);
    assert.deepEqual(result.accounts, ["example"]);
    assert.equal(result.kinds[2].total, 2);
    data = { a0: null, a1: null };
    await assert.rejects(
      fetchBreakdown("synthetic-token", "example", ["example", "secondary"], window),
      (error: unknown) => error instanceof GitHubError && error.status === 404,
    );
    data = { a0: { login: "example", contributionsCollection: collection() }, a1: null };
    errors = [{ type: "FORBIDDEN", message: "Access denied" }];
    await assert.rejects(
      fetchBreakdown("synthetic-token", "example", ["example", "secondary"], window),
      (error: unknown) => error instanceof GitHubError && error.status === 502,
    );
    data = null;
    errors = [];
    await assert.rejects(
      fetchBreakdown("synthetic-token", "example", ["example", "secondary"], window),
      (error: unknown) => error instanceof GitHubError && error.status === 502,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("all repository-bearing kinds hide private work; created repositories have no list", () => {
  const entry = repo("secret/repository", 2, true);
  const result = map(
    collection({
      totalCommitContributions: 8,
      totalPullRequestContributions: 2,
      totalIssueContributions: 2,
      totalPullRequestReviewContributions: 2,
      totalRepositoryContributions: 1,
      commitContributionsByRepository: [entry, repo("example/app", 6)],
      pullRequestContributionsByRepository: [entry],
      issueContributionsByRepository: [entry],
      pullRequestReviewContributionsByRepository: [entry],
      restrictedContributionsCount: 3,
      contributionCalendar: { totalContributions: 18 },
    }),
  );
  assert.deepEqual(
    result.kinds.map((k) => k.total),
    [6, 0, 0, 0, 1],
  );
  assert.equal(result.private, 11);
  assert.equal(result.other, 0);
  for (const output of [JSON.stringify(result), String(breakdownHtml(result)),
    String(dayBreakdownHtml("2026-10-10", result, "example", 2026))]) {
    assert.ok(!output.includes(entry.repository.nameWithOwner));
    assert.ok(!output.includes(entry.repository.url));
  }
  assert.deepEqual(result.kinds[4].repositories, []);
  assert.equal(result.kinds[4].unlisted, 0);
});

test("top repositories merge kinds and limit to five, with overflow and unlisted counts", () => {
  const result = map(
    collection({
      totalCommitContributions: 20,
      commitContributionsByRepository: Array.from({ length: 12 }, (_, i) =>
        repo(`example/repo-${String(i).padStart(2, "0")}`, 1),
      ),
      totalPullRequestContributions: 4,
      pullRequestContributionsByRepository: [repo("EXAMPLE/repo-00", 4)],
    }),
  );
  const markup = String(breakdownHtml(result));
  assert.equal([...markup.matchAll(/href="https:\/\/github.com\//g)].length, 5);
  assert.match(markup, /title="4 PRs · 1 commit">5</);
  assert.equal((markup.match(/>example\/repo-00<\/a>/g) ?? []).length, 1);
  assert.ok(markup.includes("and 15 more in other repositories"));
  assert.ok(!markup.includes("example/repo-05"));
  const dayMarkup = String(dayBreakdownHtml("2026-10-10", result, "example", 2026));
  assert.equal([...dayMarkup.matchAll(/href="https:\/\/github.com\//g)].length, 4);
  assert.ok(dayMarkup.includes("and 16 more in other repositories"));
  const complete = { ...result, kinds: result.kinds.map((k) => ({ ...k, unlisted: 0 })) };
  assert.ok(String(breakdownHtml(complete)).includes("and 7 more in 7 other repositories"));
  assert.ok(!String(breakdownHtml(map(collection()))).includes("NaN"));
});

test("year bars separate visibility from public types and omit negative gaps", () => {
  const base = map(collection({
    contributionCalendar: { totalContributions: 12 },
    restrictedContributionsCount: 3,
    totalCommitContributions: 5,
    totalIssueContributions: 2,
  }));
  for (const [total, expected] of [[12, [7, 3, 2]], [8, [7, 3]]] as const) {
    const markup = String(breakdownHtml(reconcileBreakdown(base, total)));
    const bars = [...markup.matchAll(/<div role="img"[^>]*>([\s\S]*?)<\/div>/g)];
    const counts = (bar: string) => [...bar.matchAll(/data-breakdown-count="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(counts(bars[0][1]), expected);
    assert.deepEqual(counts(bars[1][1]), [5, 2]);
    assert.ok(!markup.includes("NaN"));
  }
});

test("a day missing from the calendar reconciles against the zero the heatmap draws", async () => {
  const { userPageHtml } = await import("../worker/views/pages.ts");
  const boardUser = {
    login: "example", name: null, avatarUrl: "https://avatars.example/u", url: "https://github.com/example",
    followers: 0, following: 0, totalContributions: 1,
    weeks: [{ days: [{ date: "2026-03-02", count: 1, level: 1 as const }] }],
  };
  const user = { ...boardUser, total: 1, byYear: { "2026": 1 } };
  const day = map(collection({
    totalCommitContributions: 2,
    commitContributionsByRepository: [repo("example/app", 2)],
  }));
  const markup = userPageHtml({
    chrome: { thisYear: 2026, stylesUrl: "/s.css", enhanceUrl: "/e.js", buildSha: "0".repeat(40) },
    user, board: [boardUser], allUsers: [user], years: [2026], year: 2026, today: "2026-08-10",
    generatedAt: "2026-08-10T12:00:00Z", breakdown: null, day: "2026-03-04",
    dayBreakdown: { ...day, window: dayWindow("2026-03-04") },
  });
  const panel = markup.slice(markup.indexOf('id="day-breakdown"'));
  assert.match(panel, /<strong[^>]*>0<\/strong> contributions on/);
  assert.match(panel, /come to 2 more than/);
});

test("a single contribution reads in the singular", () => {
  const one = map(collection({ contributionCalendar: { totalContributions: 1 }, restrictedContributionsCount: 1 }));
  assert.match(String(dayBreakdownHtml("2026-10-10", one, "example", 2026)), /<\/strong> contribution on/);
});
