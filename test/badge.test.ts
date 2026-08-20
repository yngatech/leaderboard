import assert from "node:assert/strict";
import test from "node:test";
import type { BadgeInput } from "../worker/views/badge.ts";
import { badgeSvg } from "../worker/views/badge.ts";

type YearInput = Extract<BadgeInput, { kind: "year" }>;
type AllInput = Extract<BadgeInput, { kind: "all" }>;

function yearBadge(overrides: Partial<YearInput> = {}): BadgeInput {
  return { kind: "year", year: 2026, total: 1204, ...overrides };
}

function allBadge(overrides: Partial<AllInput> = {}): BadgeInput {
  return { kind: "all", firstYear: 2019, allTime: 12480, ...overrides };
}

/** A badge fails the way a card does: silently, as a broken image. */
function assertWellFormed(markup: string): void {
  assert.ok(markup.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.doesNotMatch(markup, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/, "illegal in XML");

  const open: string[] = [];
  for (const [tag, closing, name, selfClosing] of markup.matchAll(
    /<(\/?)([a-zA-Z][\w-]*)(?:"[^"]*"|[^">])*?(\/?)>/g,
  )) {
    for (const [, value] of tag.slice(1, -1).matchAll(/[\w:.-]+\s*=\s*("[^"]*"|[^\s>]+)/g)) {
      assert.ok(value.startsWith('"'), `unquoted attribute in <${name}>: ${value.slice(0, 24)}`);
    }
    if (closing) assert.equal(open.pop(), name, `closed <${name}> that was not open`);
    else if (!selfClosing) open.push(name);
  }
  assert.deepEqual(open, [], "every element is closed");
}

/** The width the badge claims, which is what a README lays out against. */
function declaredWidth(markup: string): number {
  return Number(/\swidth="(\d+)"/.exec(markup)?.[1]);
}

test("the year badge counts the year and the all-time badge counts the span", () => {
  const year = badgeSvg(yearBadge());
  const all = badgeSvg(allBadge());

  assertWellFormed(year);
  assertWellFormed(all);

  assert.match(year, />contributions in 2026</);
  assert.match(year, />1,204</);
  assert.match(year, /<title>1,204 GitHub contributions in 2026\.<\/title>/);

  assert.match(all, />contributions since 2019</);
  assert.match(all, />12,480</);
  assert.match(all, /<title>12,480 GitHub contributions since 2019\.<\/title>/);

  // Neither badge reads the other's number.
  assert.ok(!year.includes("12,480"));
  assert.ok(!all.includes("1,204"));
});

test("says so rather than drawing a zero for an account GitHub has no data for", () => {
  for (const badge of [badgeSvg(yearBadge({ total: null })), badgeSvg(allBadge({ allTime: null }))]) {
    assertWellFormed(badge);
    assert.match(badge, />no data</);
    assert.ok(!badge.includes(">0<"));
    // The flat fill, not the accent: a missing number should not read as a score.
    assert.match(badge, /fill="#262c4c"/);
    assert.ok(!badge.includes("#ffc24d"));
  }
});

test("each kind carries only its own feed's number", () => {
  // Structural, not incidental: a year badge has no field to hold an all-time
  // total in, so the route cannot make one of them wait on the other's feed.
  assert.deepEqual(Object.keys(yearBadge()).sort(), ["kind", "total", "year"]);
  assert.deepEqual(Object.keys(allBadge()).sort(), ["allTime", "firstYear", "kind"]);
});

test("the pill grows with the number it has to hold", () => {
  const small = declaredWidth(badgeSvg(yearBadge({ total: 7 })));
  const large = declaredWidth(badgeSvg(yearBadge({ total: 148230 })));

  assert.ok(large > small, `${large} is not wider than ${small}`);
  // "148,230" against "7": seven cells at an 11px 0.6em advance.
  assert.equal(large - small, Math.round(7 * 11 * 0.6) - Math.round(1 * 11 * 0.6));
});

test("holds the shields line height whatever it is asked to draw", () => {
  for (const input of [yearBadge(), allBadge(), yearBadge({ total: null })]) {
    assert.match(badgeSvg(input), /\sheight="20"/);
  }
});

test("carries no typeface, so a badge stays small", () => {
  const badge = badgeSvg(yearBadge());

  assert.ok(!badge.includes("@font-face"));
  assert.ok(!badge.includes("data:"));
  // Kilobytes against the card's hundred: the fonts are the whole difference.
  assert.ok(badge.length < 2_048, `${badge.length} bytes`);
});

test("names nobody: a badge sits in its owner's own readme", () => {
  const badge = badgeSvg(yearBadge());

  // Nothing GitHub holds reaches a badge, which is why it needs no escaping.
  assert.doesNotMatch(badge, /@[A-Za-z0-9]/);
  assert.ok(!badge.includes("leaderboard.ynga.tech"));
});
