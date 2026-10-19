import { expect, test } from "@playwright/test";
import type { AllTimeUser, BoardUser, ContributionBreakdown } from "../../shared/types.ts";
import { userPageHtml } from "../../worker/views/pages.ts";
import { chrome, ORIGIN, serveFixture } from "./fixture.ts";

const boardUser: BoardUser = {
  login: "example",
  name: "Example User",
  avatarUrl: "https://avatars.example/user",
  url: "https://github.com/example",
  followers: 0,
  following: 0,
  totalContributions: 4,
  weeks: [
    {
      days: [
        { date: "2026-03-02", count: 3, level: 4 },
        { date: "2026-03-03", count: 1, level: 1 },
      ],
    },
  ],
};
const user: AllTimeUser = { ...boardUser, total: 4, byYear: { "2026": 4 } };
const breakdown: ContributionBreakdown = {
  login: "example",
  accounts: ["example"],
  window: {
    kind: "year",
    year: 2026,
    from: "2026-01-01T00:00:00Z",
    to: "2026-08-10T12:00:00Z",
  },
  calendarTotal: 4,
  private: 1,
  other: 0,
  generatedAt: "2026-08-10T12:00:00Z",
  kinds: [
    {
      kind: "commits",
      total: 3,
      repositories: [
        {
          nameWithOwner: "example/app",
          url: "https://github.com/example/app",
          count: 3,
        },
      ],
      unlisted: 0,
    },
  ],
};
const options = {
  chrome,
  user,
  board: [boardUser],
  allUsers: [user],
  years: [2026],
  year: 2026,
  today: "2026-08-10",
  generatedAt: breakdown.generatedAt,
  breakdown,
};
const yearPage = userPageHtml(options);
const dayPage = userPageHtml({
  ...options,
  day: "2026-03-02",
  dayBreakdown: {
    ...breakdown,
    calendarTotal: 3,
    private: 0,
    window: {
      kind: "day",
      date: "2026-03-02",
      from: "2026-03-02T00:00:00Z",
      to: "2026-03-02T23:59:59Z",
    },
  },
});
const href = "/u/example?day=2026-03-02#day-breakdown";

test.describe("day links without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("heatmap links navigate to server rendered day detail", async ({ page, context }) => {
    await serveFixture(context, yearPage);
    await context.route(`${ORIGIN}/u/example?day=*`, (route) =>
      route.fulfill({ contentType: "text/html", body: dayPage }),
    );
    await page.goto(`${ORIGIN}/u/example`);
    const link = page.locator('a[data-day="2026-03-02"]');
    await expect(link).toHaveAttribute("href", href);
    await link.click();
    await expect(page).toHaveURL(`${ORIGIN}${href}`);
    await expect(page.locator("#day-breakdown")).toContainText("3 contributions on 2 Mar 2026");
    await expect(page.locator('a[data-day="2026-03-02"] rect')).toHaveAttribute(
      "data-selected",
      "true",
    );
  });
});

test("day click swaps server markup, preserves the document and supports back", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await serveFixture(context, yearPage);
  await context.route(`${ORIGIN}/u/example?day=*`, (route) =>
    route.fulfill({ contentType: "text/html", body: dayPage }),
  );
  await page.goto(`${ORIGIN}/u/example`);
  await page.evaluate(() => document.body.setAttribute("data-test-document", "original"));
  await page.locator('a[data-day="2026-03-02"]').click();
  await expect(page).toHaveURL(`${ORIGIN}${href}`);
  await expect(page.locator("#day-breakdown")).toContainText("3 contributions on 2 Mar 2026");
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");
  await expect(page.locator('a[data-day="2026-03-02"] rect')).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.locator("#year-breakdown")).toBeAttached();
  await page.goBack();
  await expect(page).toHaveURL(`${ORIGIN}/u/example`);
  await expect(page.locator("#day-breakdown")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("failed day fetch falls back to full navigation", async ({ page, context }) => {
  await serveFixture(context, yearPage);
  await context.route(`${ORIGIN}/u/example?day=*`, (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: dayPage })
      : route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.goto(`${ORIGIN}/u/example`);
  await page.locator('a[data-day="2026-03-02"]').click();
  await expect(page).toHaveURL(`${ORIGIN}${href}`);
  await expect(page.locator("#day-breakdown")).toBeVisible();
});
