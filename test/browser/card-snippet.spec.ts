import { readFile } from "node:fs/promises";
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { AllTime, Board } from "../../shared/types.ts";
import type { SiteChrome } from "../../worker/views/layout.ts";
import { userPageHtml } from "../../worker/views/pages.ts";

/**
 * The snippet an account copies into their profile README. The button is the
 * one control on the site that does nothing without a clipboard, so it ships
 * hidden and the markup underneath has to stand on its own.
 */

const ORIGIN = "https://board.test";
const SNIPPET =
  "[![alice on the ynga git board](https://leaderboard.ynga.tech/u/alice.svg)](https://leaderboard.ynga.tech/u/alice)";

const enhanceScript = await readFile(new URL("../../worker/enhance.js", import.meta.url), "utf8");

const chrome: SiteChrome = {
  thisYear: 2026,
  stylesUrl: "/assets/styles.css",
  enhanceUrl: "/assets/enhance.js",
  buildSha: "0123456789abcdef0123456789abcdef01234567",
};

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

async function serveFixture(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin !== ORIGIN) {
      await route.abort();
      return;
    }

    if (url.pathname === "/assets/enhance.js") {
      await route.fulfill({ contentType: "text/javascript", body: enhanceScript });
      return;
    }

    if (url.pathname === "/assets/styles.css") {
      await route.fulfill({ contentType: "text/css", body: "" });
      return;
    }

    // The card preview points at the live route; a 1x1 stands in for it here.
    if (url.pathname === "/u/alice.svg") {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="409" height="252"></svg>',
      });
      return;
    }

    if (request.resourceType() === "document") {
      await route.fulfill({ contentType: "text/html", body: pageHtml });
      return;
    }

    await route.abort();
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the snippet is readable and the button stays out of the way", async ({ page, context }) => {
    await serveFixture(context);

    await page.goto(ORIGIN);

    await expect(page.locator("#card-snippet")).toHaveText(SNIPPET);
    await expect(page.getByRole("img", { name: "The alice contribution card" })).toBeVisible();
    // Nothing offers an action the page cannot perform.
    await expect(page.getByRole("button", { name: "copy" })).toBeHidden();
  });
});

test("JavaScript adds a button that copies the snippet", async ({ page, context }) => {
  await serveFixture(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });

  await page.goto(ORIGIN);

  const button = page.getByRole("button", { name: "copy" });
  await expect(button).toBeVisible();

  // The confirmation lasts 1.6s and then puts the resting label back, which is
  // short enough that polling for it races the timer. Recording the changes as
  // they happen tests the same behaviour without depending on when the
  // assertion gets to look.
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
