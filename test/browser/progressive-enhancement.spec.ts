import { readFile } from "node:fs/promises";
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Board } from "../../shared/types.ts";
import type { SiteChrome } from "../../worker/views/layout.ts";
import { yearPageHtml } from "../../worker/views/pages.ts";

const ORIGIN = "https://board.test";
const generatedAt = new Date(Date.now() - 2 * 60_000).toISOString();
const enhanceScript = await readFile(
  new URL("../../worker/enhance.js", import.meta.url),
  "utf8",
);

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
    name: "Bob Example",
    avatarUrl: "https://avatars.example/bob",
    url: "https://github.com/bob",
    followers: 5,
    following: 8,
    totalContributions: 40,
    weeks: [{ days: [{ date: "2026-01-05", count: 40, level: 2 }] }],
  },
];

const pageHtml = yearPageHtml({
  chrome,
  board,
  year: 2026,
  today: "2026-08-10",
  generatedAt,
  missing: [],
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

    if (request.resourceType() === "document") {
      await route.fulfill({ contentType: "text/html", body: pageHtml });
      return;
    }

    await route.abort();
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the server-rendered page remains useful", async ({ page, context }) => {
    await serveFixture(context);

    await page.goto(ORIGIN);

    await expect(page).toHaveTitle("git board — 2026");
    await expect(page.getByRole("heading", { name: "git board" })).toBeVisible();
    await expect(page.getByText("contributions from 2 accounts in 2026")).toBeVisible();
    await expect(page.getByRole("link", { name: "alice", exact: true })).toBeVisible();
    await expect(page.locator("time[data-ago]")).toContainText("UTC");

    await page.getByRole("link", { name: "Show 2025" }).click();
    await expect(page).toHaveURL(`${ORIGIN}/2025`);
  });
});

test("JavaScript upgrades the timestamp and adds keyboard navigation", async ({ page, context }) => {
  await serveFixture(context);

  await page.goto(ORIGIN);

  await expect(page.locator("time[data-ago]")).toHaveText(/minutes? ago/);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(`${ORIGIN}/all`);
});
