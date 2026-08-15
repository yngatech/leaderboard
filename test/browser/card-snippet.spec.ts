import { expect, test } from "@playwright/test";
import type { AllTime, Board } from "../../shared/types.ts";
import { userPageHtml } from "../../worker/views/pages.ts";
import { chrome, ORIGIN, serveFixture } from "./fixture.ts";

/**
 * The button is the one control on the site that does nothing without a
 * clipboard, so it ships hidden and the snippet stands on its own.
 */

const SNIPPET =
  "[![alice on the ynga git board](https://leaderboard.ynga.tech/u/alice.svg)](https://leaderboard.ynga.tech/u/alice)";

const board: Board = [
  {
    login: "alice",
    name: "Alice Example",
    avatarUrl: "https://avatars.example/alice",
    url: "https://github.com/alice",
    followers: 12,
    following: 3,
    totalContributions: 320,
    weeks: [{ days: [{ date: "2026-03-02", count: 200, level: 4 }] }],
  },
];

const allUsers: AllTime["users"] = [
  {
    login: "alice",
    name: "Alice Example",
    avatarUrl: "https://avatars.example/alice",
    url: "https://github.com/alice",
    followers: 12,
    following: 3,
    byYear: { "2025": 900, "2026": 320 },
    total: 1220,
  },
];

const pageHtml = userPageHtml({
  chrome,
  user: allUsers[0],
  board,
  allUsers,
  years: [2025, 2026],
  year: 2026,
  today: "2026-08-10",
  generatedAt: new Date().toISOString(),
});

// The preview points at the live route; a stub stands in for it here.
const CARD_STUB = {
  path: "/u/alice.svg",
  contentType: "image/svg+xml",
  body: '<svg xmlns="http://www.w3.org/2000/svg" width="409" height="252"></svg>',
};

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the snippet is readable and the button stays out of the way", async ({ page, context }) => {
    await serveFixture(context, pageHtml, [CARD_STUB]);

    await page.goto(ORIGIN);

    await expect(page.locator("#card-snippet")).toHaveText(SNIPPET);
    await expect(page.getByRole("img", { name: "The alice contribution card" })).toBeVisible();
    // Nothing offers an action the page cannot perform.
    await expect(page.getByRole("button", { name: "copy" })).toBeHidden();
  });
});

test("JavaScript adds a button that copies the snippet", async ({ page, context }) => {
  await serveFixture(context, pageHtml, [CARD_STUB]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });

  await page.goto(ORIGIN);

  const button = page.getByRole("button", { name: "copy" });
  await expect(button).toBeVisible();

  // The confirmation lasts 1.6s before the resting label returns, which is
  // short enough that polling for it races the timer.
  await page.evaluate(() => {
    const target = document.querySelector("button[data-copy]");
    const seen: string[] = [];
    (window as unknown as { labels: string[] }).labels = seen;
    new MutationObserver(() => seen.push(target?.textContent?.trim() ?? "")).observe(target!, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  await button.click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { labels: string[] }).labels))
    .toEqual(["copied", "copy"]);

  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SNIPPET);
});
