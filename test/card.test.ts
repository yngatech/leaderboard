import assert from "node:assert/strict";
import test from "node:test";
import { userGrid, yearShape } from "../shared/board.ts";
import type { CardInput } from "../worker/views/card.ts";
import { absentCardSvg, cardSvg } from "../worker/views/card.ts";

const TODAY = "2026-03-05";

function makeCard(overrides: Partial<CardInput> = {}): CardInput {
  const grid = userGrid(
    [
      {
        days: [
          { date: "2026-01-02", count: 4, level: 1 },
          { date: "2026-03-03", count: 90, level: 4 },
          { date: "2026-03-04", count: 6, level: 2 },
          { date: "2026-03-05", count: 8, level: 2 },
        ],
      },
    ],
    2026,
    TODAY,
  );

  return {
    user: { login: "alice", name: "Alice Example", avatar: null },
    year: 2026,
    total: 108,
    allTime: 4820,
    firstYear: 2019,
    grid,
    shape: yearShape(grid),
    goals: { nextMilestone: 250, toMilestone: 142 },
    generatedAt: "2026-03-05T09:30:00.000Z",
    site: "https://leaderboard.ynga.tech",
    ...overrides,
  };
}

/**
 * A card is consumed as an image: malformed, it silently fails to render at
 * all. The shape that bites is an interpolated attribute fragment coming back
 * escaped, with the quotes it needed turned into &quot; inside the tag.
 */
function assertWellFormed(document: string): void {
  assert.ok(document.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(!document.includes("&quot;"), "an attribute was escaped into the markup");
  const opened = document.match(/<(?!\/|\?|!)[a-z]/g)?.length ?? 0;
  const closed = (document.match(/<\//g)?.length ?? 0) + (document.match(/\/>/g)?.length ?? 0);
  assert.equal(opened, closed, "every element is closed");
}

test("draws the year, the career total and the milestone as a scale", () => {
  const card = cardSvg(makeCard());

  assertWellFormed(card);
  assert.match(card, /IN 2026/);
  assert.match(card, /108/);
  assert.match(card, /CONTRIBUTIONS SINCE 2019/);
  assert.match(card, /4,820/);
  assert.match(card, /class="scale"[^>]*>0</);
  assert.match(card, /class="scale"[^>]*>250</);
  assert.match(card, /<title>Alice Example: 108 GitHub contributions in 2026, 4,820 since 2019\.</);
});

test("never mentions another account", () => {
  const card = cardSvg(makeCard());

  for (const comparative of ["behind", "ahead", "level with"]) {
    assert.ok(!card.includes(comparative), `card mentions "${comparative}"`);
  }
  // As a pattern: a bare "#1" also matches every hex colour on the card.
  assert.doesNotMatch(card, /#\d+ of \d+/);
});

test("reads the year's own shape into the facts column", () => {
  const card = cardSvg(makeCard());

  // The last three run up to today, so the streak takes the best day's line.
  assert.match(card, /4 active days/);
  assert.match(card, /3-day streak/);
  assert.ok(!card.includes("best day"));

  const quiet = cardSvg(
    makeCard({
      grid: userGrid([{ days: [{ date: "2026-01-02", count: 90, level: 4 }] }], 2026, TODAY),
      shape: yearShape(userGrid([{ days: [{ date: "2026-01-02", count: 90, level: 4 }] }], 2026, TODAY)),
    }),
  );
  assert.match(quiet, /1 active day\b/);
  assert.match(quiet, /best day 90 on 2 Jan/);
});

test("drops the scale past the top of the ladder", () => {
  const card = cardSvg(makeCard({ goals: { nextMilestone: null, toMilestone: null } }));

  assertWellFormed(card);
  assert.doesNotMatch(card, /class="scale"/);
  // The bar stays, filled: past the ladder is not a target half met.
  assert.match(card, /fill="url\(#ramp\)"/);
});

test("lays out one cell a day and one initial a month", () => {
  const card = cardSvg(makeCard());

  const days = makeCard().grid.flat().filter((cell) => cell.state !== "outside").length;
  assert.equal(card.match(/rx="1.5"/g)?.length, days);

  const months = card.match(/class="month"/g)?.length;
  assert.equal(months, 12);
});

test("lays out without an avatar rather than reaching for one", () => {
  const withoutAvatar = cardSvg(makeCard());
  assert.ok(!withoutAvatar.includes("<image"));

  const withAvatar = cardSvg(makeCard({ user: { login: "alice", name: null, avatar: "data:image/png;base64,AAAA" } }));
  assert.match(withAvatar, /<image[^>]+href="data:image\/png;base64,AAAA"/);
  assert.match(withAvatar, /@alice/);
});

test("inlines the typefaces only when it is given them", () => {
  assert.ok(!cardSvg(makeCard()).includes("@font-face"));

  // The shape Vite's `?inline` hands over: a whole data URI, used verbatim.
  const dressed = cardSvg(
    makeCard({
      fonts: {
        display: "data:font/woff2;base64,RElTUExBWQ==",
        mono: "data:font/woff2;base64,TU9OTw==",
      },
    }),
  );
  assert.match(dressed, /@font-face\{font-family:'DM Mono'.+url\(data:font\/woff2;base64,TU9OTw==\)/);
  assert.match(
    dressed,
    /@font-face\{font-family:'Bricolage Grotesque'.+url\(data:font\/woff2;base64,RElTUExBWQ==\)/,
  );
});

test("states an absent account rather than drawing it a zero", () => {
  const card = absentCardSvg({
    user: { login: "alice", name: null, avatar: null },
    site: "https://leaderboard.ynga.tech",
  });

  assertWellFormed(card);
  assert.match(card, /No GitHub data for this account\./);
  assert.match(card, /leaderboard\.ynga\.tech\/u\/alice/);
  assert.ok(!card.includes("CONTRIBUTIONS"));
  assert.ok(!card.includes('rx="1.5"'));
});

test("escapes a display name that arrives as markup", () => {
  const card = cardSvg(
    makeCard({ user: { login: "bob", name: '<img src=x onerror="alert(1)">', avatar: null } }),
  );

  assert.ok(!card.includes("<img src=x"));
  assert.match(card, /&lt;img src=x/);
});
