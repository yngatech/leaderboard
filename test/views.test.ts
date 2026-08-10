import assert from "node:assert/strict";
import test from "node:test";
import type { AllTime, Board } from "../shared/types.ts";
import { attr, escapeHtml, jsonForScript } from "../worker/html.ts";
import type { SiteChrome } from "../worker/views/layout.ts";
import {
  allPageHtml,
  errorPageHtml,
  notFoundPageHtml,
  unknownUserPageHtml,
  userPageHtml,
  yearPageHtml,
} from "../worker/views/pages.ts";

const chrome: SiteChrome = {
  thisYear: 2026,
  stylesUrl: "/assets/styles-abc123.css",
  enhanceUrl: "/assets/enhance-abc123.js",
  buildSha: "0123456789abcdef0123456789abcdef01234567",
};

function makeBoard(): Board {
  return [
    {
      login: "alice",
      name: "Alice Example",
      avatarUrl: "https://avatars.example/alice",
      url: "https://github.com/alice",
      followers: 12,
      following: 3,
      totalContributions: 320,
      weeks: [
        {
          days: [
            { date: "2026-03-02", count: 200, level: 4 },
            { date: "2026-03-03", count: 120, level: 3 },
          ],
        },
      ],
    },
    {
      login: "bob",
      name: '<img src=x onerror="alert(1)">',
      avatarUrl: "https://avatars.example/bob",
      url: "https://github.com/bob",
      followers: 5,
      following: 8,
      totalContributions: 40,
      weeks: [{ days: [{ date: "2026-01-05", count: 40, level: 2 }] }],
    },
  ];
}

function makeAllTime(): AllTime {
  return {
    years: [2024, 2025, 2026],
    firstYear: 2024,
    lastYear: 2026,
    users: [
      {
        login: "alice",
        name: "Alice Example",
        avatarUrl: "https://avatars.example/alice",
        url: "https://github.com/alice",
        followers: 12,
        following: 3,
        byYear: { "2024": 100, "2025": 400, "2026": 320 },
        total: 820,
      },
      {
        login: "bob",
        name: null,
        avatarUrl: "https://avatars.example/bob",
        url: "https://github.com/bob",
        followers: null,
        following: null,
        byYear: { "2025": 60, "2026": 40 },
        total: 100,
      },
    ],
  };
}

const GENERATED = "2026-08-10T12:00:00.000Z";

function liveYearPage(): string {
  return yearPageHtml({
    chrome,
    board: makeBoard(),
    year: 2026,
    today: "2026-08-10",
    generatedAt: GENERATED,
    missing: [],
  });
}

/** One enhance script reference and one data block; nothing else executable. */
function assertScriptBudget(page: string, withChart: boolean) {
  const withSrc = page.match(/<script[^>]*\bsrc=/g) ?? [];
  assert.equal(withSrc.length, 1);
  assert.ok(withSrc[0].includes("type=\"module\""));
  const dataBlocks = page.match(/<script type="application\/json"/g) ?? [];
  assert.equal(dataBlocks.length, withChart ? 1 : 0);
  const all = page.match(/<script/g) ?? [];
  assert.equal(all.length, withChart ? 2 : 1);
}

test("escapes the five HTML-significant characters", () => {
  assert.equal(
    escapeHtml(`<img src="x" onerror='a&b'>`),
    "&lt;img src=&quot;x&quot; onerror=&#39;a&amp;b&#39;&gt;",
  );
  assert.equal(attr(2026), "2026");
});

test("inline JSON cannot close its own script element", () => {
  const json = jsonForScript({ evil: "</script><script>alert(1)" });
  assert.ok(!json.includes("</script>"));
  assert.deepEqual(JSON.parse(json), { evil: "</script><script>alert(1)" });
});

test("live year page carries goals, future legend, chart and nav targets", () => {
  const page = liveYearPage();

  // The live year gets the forward-looking furniture and chart data.
  assert.ok(page.includes("<details"));
  assert.ok(page.includes('id="climb"'));
  // Nav: previous year is a link, next is the all-time board.
  assert.ok(page.includes('href="/2025"'));
  assert.ok(page.includes('data-prev-href="/2025"'));
  assert.ok(page.includes('data-next-href="/all"'));
  // The enhance script has a machine-readable timestamp to upgrade.
  assert.ok(page.includes('<time datetime="2026-08-10T12:00:00.000Z" data-ago>'));

  assertScriptBudget(page, true);
});

test("free-form GitHub names are escaped everywhere they appear", () => {
  const page = liveYearPage();
  assert.ok(!page.includes("<img src=x"));
  assert.ok(page.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
});

test("archived year page is plain rows with no goals or chart", () => {
  const page = yearPageHtml({
    chrome,
    board: makeBoard(),
    year: 2020,
    today: "2026-08-10",
    generatedAt: GENERATED,
    missing: ["carol"],
  });

  assert.ok(!page.includes("<details"));
  assert.ok(!page.includes('id="climb"'));
  // Missing accounts are reported rather than silently omitted.
  assert.ok(page.includes("No GitHub data came back for carol."));
  assert.ok(page.includes('data-prev-href="/2019"'));
  assert.ok(page.includes('data-next-href="/2021"'));

  assertScriptBudget(page, false);
});

test("the year range edges drop the dead arrow", () => {
  const first = yearPageHtml({
    chrome,
    board: [],
    year: 2008,
    today: "2026-08-10",
    generatedAt: null,
    missing: [],
  });
  assert.ok(!first.includes("data-prev-href"));
  assert.ok(first.includes('data-next-href="/2009"'));
  assert.ok(!first.includes('href="/2007"'));

  const live = liveYearPage();
  assert.ok(!live.includes('href="/2027"'));
  // The current year routes to "/", not "/2026".
  assert.ok(live.includes('data-prev-href="/2025"'));
});

test("all-time page ranks users and links every year cell", () => {
  const page = allPageHtml({
    chrome,
    data: makeAllTime(),
    generatedAt: GENERATED,
    missing: [],
  });

  // alice (820) ranks above bob (100).
  assert.ok(page.indexOf(">alice<") < page.indexOf(">bob<"));
  // The group strip's cells link to the year boards; the live year is "/".
  assert.ok(page.includes('<a href="/2024"'));
  assert.ok(page.includes('<a href="/2025"'));
  assert.ok(page.includes('aria-label="Show 2026'));
  assert.ok(!page.includes('<a href="/2026"'));
  assertScriptBudget(page, false);
});

test("user page reads from both feeds and links its year strip", () => {
  const data = makeAllTime();
  const page = userPageHtml({
    chrome,
    user: data.users[0],
    board: makeBoard(),
    allUsers: data.users,
    years: data.years,
    year: 2026,
    today: "2026-08-10",
    generatedAt: GENERATED,
  });

  // Rankings and best-year values are derived from the two feeds.
  assert.ok(page.includes("1st on the all-time board"));
  assert.ok(page.includes("1st on the 2026 board"));
  assert.ok(page.includes(">400</strong> contributions in 2025"));
  assert.ok(page.includes('<a href="/2024"'));
  // User pages have no arrow-key routing.
  assert.ok(!page.includes("data-prev-href"));
  assert.ok(!page.includes("data-next-href"));
  assertScriptBudget(page, false);
});

test("a user missing from the live board falls back honestly", () => {
  const data = makeAllTime();
  const page = userPageHtml({
    chrome,
    user: data.users[1],
    board: makeBoard().slice(0, 1),
    allUsers: data.users,
    years: data.years,
    year: 2026,
    today: "2026-08-10",
    generatedAt: GENERATED,
  });

  assert.ok(page.includes("No GitHub data came back for bob in 2026."));
  assert.ok(!page.includes("on the 2026 board"));
});

test("not-found and error pages stand alone", () => {
  const missing = notFoundPageHtml(chrome);
  assert.ok(!missing.includes("<nav"));

  const unknown = unknownUserPageHtml(chrome, '<nobody>');
  assert.ok(unknown.includes("&lt;nobody&gt;"));
  assert.ok(!unknown.includes("<nobody>"));

  const broken = errorPageHtml(chrome, "GitHub data is unavailable (502).");
  assert.ok(broken.includes("GitHub data is unavailable (502)."));
  assertScriptBudget(broken, false);
});
