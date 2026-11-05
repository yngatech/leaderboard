import { expect, test } from "@playwright/test";
import type { Board } from "../../shared/types.ts";
import { yearPageHtml } from "../../worker/views/pages.ts";
import { chrome, ORIGIN, serveFixture } from "./fixture.ts";

const generatedAt = new Date(Date.now() - 2 * 60_000).toISOString();

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


test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the server-rendered page remains useful", async ({ page, context }) => {
    await serveFixture(context, pageHtml);

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
  await serveFixture(context, pageHtml);

  await page.goto(ORIGIN);

  await expect(page.locator("time[data-ago]")).toHaveText(/minutes? ago/);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(`${ORIGIN}/all`);
});
