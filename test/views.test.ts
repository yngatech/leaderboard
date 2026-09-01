import assert from "node:assert/strict";
import test from "node:test";
import type { AllTime, Board } from "../shared/types.ts";
import { html, jsonForScript } from "../worker/html.ts";
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
      createdAt: "2016-03-12T09:33:21Z",
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
      createdAt: "2019-07-04T00:00:00Z",
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
        createdAt: "2016-03-12T09:33:21Z",
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
        createdAt: null,
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

function assertApiCatalogDiscovery(page: string) {
  assert.ok(
    page.includes(
      '<link rel="api-catalog" type="application/linkset+json" href="/.well-known/api-catalog">',
    ),
  );
}

test("templates escape interpolated text and attributes", () => {
  const unsafe = `<img src="x" onerror='a&b'>`;
  assert.equal(
    html`<p data-value="${unsafe}">${unsafe}</p>`.toString(),
    '<p data-value="&lt;img src=&quot;x&quot; onerror=&#39;a&amp;b&#39;&gt;">&lt;img src=&quot;x&quot; onerror=&#39;a&amp;b&#39;&gt;</p>',
  );
});

test("templates compose trusted fragments and reject promises", () => {
  const items = [html`<li>${"one & only"}</li>`, html`<li>two</li>`];
  assert.equal(
    html`<ul>${items}</ul>`.toString(),
    "<ul><li>one &amp; only</li><li>two</li></ul>",
  );
  // Pretend this Promise is a valid value so we can verify the runtime check rejects it.
  const asyncValue = Promise.resolve("later") as unknown as string;
  assert.throws(
    () => html`<p>${asyncValue}</p>`,
    /must not interpolate promises/,
  );
});

test("inline JSON cannot close its own script element", () => {
  const json = jsonForScript({ evil: "</script><script>alert(1)" });
  assert.ok(!json.includes("</script>"));
  assert.deepEqual(JSON.parse(json), { evil: "</script><script>alert(1)" });
});

test("live year page carries goals, future legend, chart and nav targets", () => {
  const page = liveYearPage();

  // The live year gets the forward-looking furniture and chart data.
  assert.ok(page.includes(">next milestone</dt>"));
  assert.ok(page.includes('id="climb"'));
  assert.ok(page.includes("Data is cached for about 30 minutes."));
  assert.ok(page.includes("Today's counts may lag GitHub activity."));
  // Nav: previous year is a link, next is the all-time board.
  assert.ok(page.includes('href="/2025"'));
  assert.ok(page.includes('data-prev-href="/2025"'));
  assert.ok(page.includes('data-next-href="/all"'));
  // Row identities lead to the board's account page, not straight to GitHub.
  assert.ok(page.includes('href="/u/alice"'));
  assert.ok(!page.includes('href="https://github.com/alice"'));
  // The enhance script has a machine-readable timestamp to upgrade.
  assert.ok(page.includes('<time datetime="2026-08-10T12:00:00.000Z" data-ago>'));
  assert.ok(
    page.includes('<link rel="alternate" type="application/json" href="/api/board?year=2026">'),
  );
  assertApiCatalogDiscovery(page);

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

  assert.ok(!page.includes(">next milestone</dt>"));
  assert.ok(!page.includes('id="climb"'));
  assert.ok(page.includes("2020 is final, so data is cached for 7 days."));
  assert.ok(!page.includes("Today's counts may lag GitHub activity."));
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
  assert.match(page, /<a\s+href="\/2024"/);
  assert.match(page, /<a\s+href="\/2025"/);
  assert.ok(page.includes('aria-label="Show 2026'));
  assert.doesNotMatch(page, /<a\s+href="\/2026"/);
  assert.ok(page.includes('href="/u/alice"'));
  assert.ok(page.includes('href="/u/bob"'));
  assert.ok(page.includes('<link rel="alternate" type="application/json" href="/api/all">'));
  assertApiCatalogDiscovery(page);
  assert.ok(!page.includes('href="https://github.com/alice"'));
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
  assert.match(page, />\s*400<\/strong>\s+contributions in\s+2025/);
  assert.match(page, />\s*320<\/strong\s*>\s+contributions/);
  assert.match(page, /next milestone at\s+<strong/);
  assert.match(page, />\s*500<\/strong>/);
  assert.match(page, /1st on the 2026 board\s*<span/);
  assert.match(page, /leads by\s+<strong/);
  assert.match(page, />\s*280<\/strong>/);
  assert.match(page, /<a\s+href="\/2024"/);
  // User pages have no arrow-key routing.
  assert.ok(!page.includes("data-prev-href"));
  assert.ok(!page.includes("data-next-href"));
  assert.ok(
    page.includes('<link rel="alternate" type="application/json" href="/api/users/alice">'),
  );
  assertApiCatalogDiscovery(page);
  assertScriptBudget(page, false);
});

test("user page shows the gap to the account directly above", () => {
  const data = makeAllTime();
  const page = userPageHtml({
    chrome,
    user: data.users[1],
    board: makeBoard(),
    allUsers: data.users,
    years: data.years,
    year: 2026,
    today: "2026-08-10",
    generatedAt: GENERATED,
  });

  assert.match(page, />\s*40<\/strong>\s+contributions/);
  assert.match(page, /next milestone at\s+<strong/);
  assert.match(page, />\s*100<\/strong>/);
  assert.match(page, /2nd on the 2026 board\s*<span/);
  assert.match(page, />\s*280<\/strong>\s+behind\s+<span class="text-ink">alice<\/span>/);
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
  assert.ok(!page.includes("next milestone"));
  assert.ok(!page.includes("behind alice"));
});

test("the cake day badge belongs to the day, and only to the live board", () => {
  const cakeDay = { chrome, board: makeBoard(), generatedAt: GENERATED, missing: [] };

  const onTheDay = yearPageHtml({ ...cakeDay, year: 2026, today: "2026-03-12" });
  assert.match(onTheDay, /alice<\/a\s*>[\s\S]{0,400}?\u{1F382}/u);
  // The cake and the figure are hidden from assistive tech, so one plain
  // sentence has to carry the whole thing.
  assert.ok(onTheDay.includes("cake day — 10 years on GitHub today"));
  // Only the account whose anniversary it is wears one.
  assert.equal(onTheDay.match(/\u{1F382}/gu)?.length, 1);

  assert.ok(!yearPageHtml({ ...cakeDay, year: 2026, today: "2026-03-13" }).includes("\u{1F382}"));
  // An archived board is a record of its year, not of the day it is read on.
  assert.ok(!yearPageHtml({ ...cakeDay, year: 2020, today: "2026-03-12" }).includes("\u{1F382}"));

  // A first anniversary counts one year, not "1 years".
  const firstYear = makeBoard();
  firstYear[0]!.createdAt = "2025-03-12T09:33:21Z";
  const turningOne = yearPageHtml({
    ...cakeDay,
    board: firstYear,
    year: 2026,
    today: "2026-03-12",
  });
  assert.ok(turningOne.includes("cake day — 1 year on GitHub today"));
});

test("the streak belongs to the live board, and only when it outlives a day", () => {
  const streak = { chrome, board: makeBoard(), generatedAt: GENERATED, missing: [] };

  // Alice contributes on 2 and 3 March, so on the 3rd her run is two days
  // long and earns the badge in her follows line.
  const onTheRun = yearPageHtml({ ...streak, year: 2026, today: "2026-03-03" });
  assert.match(onTheRun, />alice<\/a\s*>[\s\S]{0,400}?3 following<\/span[\s\S]{0,80}?2-day streak/);
  assert.equal(onTheRun.match(/-day streak/g)?.length, 1);

  // A single day is not a streak worth stating.
  assert.ok(!yearPageHtml({ ...streak, year: 2026, today: "2026-03-02" }).includes("-day streak"));

  // An archived board is a record of its year, not of the day it is read on.
  assert.ok(!yearPageHtml({ ...streak, year: 2020, today: "2026-03-03" }).includes("-day streak"));
});

test("the account page dates the account and ages it", () => {
  const data = makeAllTime();
  const page = (today: string) =>
    userPageHtml({
      chrome,
      user: data.users[0],
      board: makeBoard(),
      allUsers: data.users,
      years: data.years,
      year: 2026,
      today,
      generatedAt: GENERATED,
    });

  const ordinaryDay = page("2026-08-10");
  assert.match(ordinaryDay, />12 Mar 2016<\/strong>[\s\S]{0,120}?· 10 years ago<\/span/);
  assert.ok(!ordinaryDay.includes("ago today"));
  assert.match(page("2026-03-12"), /· 10 years ago today<\/span/);
  // The day before the anniversary is still the previous year.
  assert.match(page("2026-03-11"), /· 9 years ago<\/span/);

  // An account the archive alone knows about has no date to show.
  const archiveOnly = userPageHtml({
    chrome,
    user: data.users[1],
    board: makeBoard(),
    allUsers: data.users,
    years: data.years,
    year: 2026,
    today: "2026-08-10",
    generatedAt: GENERATED,
  });
  assert.ok(!archiveOnly.includes("joined github"));
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
