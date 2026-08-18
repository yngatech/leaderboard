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
    shape: yearShape(grid, TODAY),
    goals: { nextMilestone: 250 },
    generatedAt: "2026-03-05T09:30:00.000Z",
    site: "https://leaderboard.ynga.tech",
    ...overrides,
  };
}

/**
 * A card is consumed as an image: malformed, it silently fails to render at
 * all. Nesting is checked with a stack rather than by counting tags, which
 * certifies `<a></b>` as fine, and the browser test parses a real card for
 * the errors no regex catches.
 */
function assertWellFormed(markup: string): void {
  assert.ok(markup.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.doesNotMatch(markup, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/, "illegal in XML");

  const open: string[] = [];
  for (const [tag, closing, name, selfClosing] of markup.matchAll(
    /<(\/?)([a-zA-Z][\w-]*)(?:"[^"]*"|[^">])*?(\/?)>/g,
  )) {
    // Every attribute value must still be quoted. An escaped fragment shows up
    // as `stroke=&quot;…&quot;`, an unquoted value — while an entity *inside* a
    // quoted value is legitimate, which is where an escaped display name lands.
    for (const [, value] of tag.slice(1, -1).matchAll(/[\w:.-]+\s*=\s*("[^"]*"|[^\s>]+)/g)) {
      assert.ok(value.startsWith('"'), `unquoted attribute in <${name}>: ${value.slice(0, 24)}`);
    }
    if (closing) assert.equal(open.pop(), name, `closed <${name}> that was not open`);
    else if (!selfClosing) open.push(name);
  }
  assert.deepEqual(open, [], "every element is closed");
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

  assert.match(card, /4 active days/);
  assert.match(card, /3-day streak/);
  assert.ok(!card.includes("best day"));

  const quiet = cardSvg(
    makeCard({
      grid: userGrid([{ days: [{ date: "2026-01-02", count: 90, level: 4 }] }], 2026, TODAY),
      shape: yearShape(userGrid([{ days: [{ date: "2026-01-02", count: 90, level: 4 }] }], 2026, TODAY), TODAY),
    }),
  );
  assert.match(quiet, /1 active day\b/);
  assert.match(quiet, /best day 90 on 2 Jan/);
});

test("drops the scale past the top of the ladder", () => {
  const card = cardSvg(makeCard({ goals: { nextMilestone: null } }));

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

  assertWellFormed(card);
  assert.ok(!card.includes("<img src=x"));
  assert.match(card, /&lt;img src=x/);
});

test("survives a display name that would be illegal in XML", () => {
  const hostile = `Alice${String.fromCharCode(1)}${String.fromCharCode(31)}Example`;
  assertWellFormed(cardSvg(makeCard({ user: { login: "alice", name: hostile, avatar: null } })));
});

test("measures full-width names by the room they take, not their length", () => {
  const wide = "日本語のとても長い表示名前前前前前前前前前前前前前前前前前";
  const card = cardSvg(makeCard({ user: { login: "alice", name: wide, avatar: null } }));

  assertWellFormed(card);
  assert.match(card, /class="name"[^>]*>[^<]*…</);
});

test("keeps the card when the generated stamp is unusable", () => {
  const card = cardSvg(makeCard({ generatedAt: "not a date" }));

  assertWellFormed(card);
  assert.ok(!card.includes("as of"));
});

test("the well-formedness check rejects what it is there to catch", () => {
  const valid = cardSvg(makeCard());
  assertWellFormed(valid);

  assert.throws(() => assertWellFormed(valid.replace("</text>", "</tspan>")), /not open/);
  // The failure that shipped once already: an attribute fragment escaped.
  assert.throws(() => assertWellFormed(valid.replace('fill="none"', "fill=&quot;none&quot;")), /attribute/);
  assert.throws(() => assertWellFormed(valid.replace("</svg>", "")), /every element is closed/);

  // And a quote in a display name is not that, so it must still pass.
  assertWellFormed(cardSvg(makeCard({ user: { login: "alice", name: 'Al "Ace" Doe', avatar: null } })));
});
