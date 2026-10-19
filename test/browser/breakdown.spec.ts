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
    await expect(page.locator("[data-day-slot] + #day-breakdown")).toContainText("3 contributions on Mon 2 Mar");
    await expect(page.locator('[aria-label="example in 2026"] #day-breakdown')).toHaveCount(1);
    await page.locator("[data-day-close]").click();
    await expect(page).toHaveURL(`${ORIGIN}/u/example`);
    await expect(page.locator("#day-breakdown")).toHaveCount(0);
    await page.locator('a[data-day="2026-03-02"]').click();
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
  const originalYear = await page.locator("#year-breakdown").innerHTML();
  await page.locator('a[data-day="2026-03-02"]').click();
  await expect(page).toHaveURL(`${ORIGIN}${href}`);
  await expect(page.locator("#day-breakdown")).toContainText("3 contributions on Mon 2 Mar");
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");
  await expect(page.locator('a[data-day="2026-03-02"] rect')).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.locator("[data-day-slot] + #day-breakdown")).toHaveCount(1);
  expect(await page.locator("#year-breakdown").innerHTML()).toBe(originalYear);
  await page.locator("[data-day-close]").click();
  await expect(page).toHaveURL(`${ORIGIN}/u/example`);
  await expect(page.locator("#day-breakdown")).toHaveCount(0);
  await expect(page.locator(".heat-cell[data-selected]")).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");
  expect(await page.locator("#year-breakdown").innerHTML()).toBe(originalYear);
  await page.locator('a[data-day="2026-03-02"]').click();
  await expect(page.locator("#day-breakdown")).toBeAttached();
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

test("a day from a board that has since moved loads the whole page", async ({ page, context }) => {
  // The board refreshed between page loads: the fetched page counts the day
  // higher, so its day detail would disagree with the heatmap already shown.
  const movedUser: BoardUser = {
    ...boardUser,
    totalContributions: 6,
    weeks: [{ days: [{ date: "2026-03-02", count: 5, level: 4 }, boardUser.weeks[0].days[1]] }],
  };
  const movedDayPage = userPageHtml({
    ...options,
    board: [movedUser],
    day: "2026-03-02",
    dayBreakdown: {
      ...breakdown,
      window: { kind: "day", date: "2026-03-02", from: "2026-03-02T00:00:00Z", to: "2026-03-02T23:59:59Z" },
    },
  });
  await serveFixture(context, yearPage);
  await context.route(`${ORIGIN}/u/example?day=*`, (route) =>
    route.fulfill({ contentType: "text/html", body: movedDayPage }),
  );
  await page.goto(`${ORIGIN}/u/example`);
  await page.evaluate(() => document.body.setAttribute("data-test-document", "original"));
  await page.locator('a[data-day="2026-03-02"]').click();
  await expect(page).toHaveURL(`${ORIGIN}${href}`);
  await expect(page.locator("#day-breakdown")).toContainText("5 contributions on Mon 2 Mar");
  await expect(page.locator('a[data-day="2026-03-02"]')).toHaveAttribute("aria-label", /^5 contributions/);
  await expect(page.locator("body")).not.toHaveAttribute("data-test-document", "original");
});

test("a changed year total navigates even when the selected day's count matches", async ({ page, context }) => {
  const movedYearPage = userPageHtml({
    ...options,
    board: [{ ...boardUser, totalContributions: 5 }],
    day: "2026-03-02",
    dayBreakdown: { ...breakdown, window: { kind: "day", date: "2026-03-02", from: "2026-03-02T00:00:00Z", to: "2026-03-02T23:59:59Z" } },
  });
  await serveFixture(context, yearPage);
  await context.route(`${ORIGIN}/u/example?day=*`, (route) =>
    route.fulfill({ contentType: "text/html", body: movedYearPage }),
  );
  await page.goto(`${ORIGIN}/u/example`);
  await page.evaluate(() => document.body.setAttribute("data-test-document", "original"));
  await page.locator('a[data-day="2026-03-02"]').click();
  await expect(page).toHaveURL(`${ORIGIN}${href}`);
  await expect(page.locator("body")).not.toHaveAttribute("data-test-document", "original");
  await expect(page.locator("#year-breakdown h3 strong")).toHaveText("5");
});

test("another day replaces the existing panel inside the heatmap card", async ({ page, context }) => {
  const nextDayPage = userPageHtml({
    ...options,
    day: "2026-03-03",
    dayBreakdown: { ...breakdown, window: { kind: "day", date: "2026-03-03", from: "2026-03-03T00:00:00Z", to: "2026-03-03T23:59:59Z" } },
  });
  await serveFixture(context, dayPage);
  await context.route(`${ORIGIN}/u/example?day=*`, (route) =>
    route.fulfill({ contentType: "text/html", body: nextDayPage }),
  );
  await page.goto(`${ORIGIN}${href}`);
  await page.evaluate(() => document.body.setAttribute("data-test-document", "original"));
  await page.locator('a[data-day="2026-03-03"]').click();
  await expect(page).toHaveURL(`${ORIGIN}/u/example?day=2026-03-03#day-breakdown`);
  await expect(page.locator("#day-breakdown")).toHaveCount(1);
  await expect(page.locator("[data-day-slot] + #day-breakdown h3 strong")).toHaveText("1");
  await expect(page.locator('a[data-day="2026-03-02"] rect')).not.toHaveAttribute("data-selected");
  await expect(page.locator('a[data-day="2026-03-03"] rect')).toHaveAttribute("data-selected", "true");
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");
});

test("unavailable day detail stays in the heatmap card and can be closed", async ({ page, context }) => {
  await serveFixture(context, userPageHtml({ ...options, day: "2026-03-02", dayBreakdown: null }));
  await page.goto(`${ORIGIN}${href}`);
  await expect(page.locator("[data-day-slot] + #day-breakdown")).toHaveCount(1);
  await expect(page.locator("#day-breakdown [role=img]")).toHaveCount(0);
  await page.locator("[data-day-close]").click();
  await expect(page).toHaveURL(`${ORIGIN}/u/example`);
  await expect(page.locator("#day-breakdown")).toHaveCount(0);
});

test("a changed year total navigates even when both year breakdowns failed", async ({ page, context }) => {
  const dayWindowFixture = { kind: "day", date: "2026-03-02", from: "2026-03-02T00:00:00Z", to: "2026-03-02T23:59:59Z" } as const;
  const openPage = userPageHtml({ ...options, breakdown: null });
  const movedPage = userPageHtml({
    ...options,
    breakdown: null,
    board: [{ ...boardUser, totalContributions: 5 }],
    day: "2026-03-02",
    dayBreakdown: { ...breakdown, window: dayWindowFixture },
  });
  await serveFixture(context, openPage);
  await context.route(`${ORIGIN}/u/example?day=*`, (route) =>
    route.fulfill({ contentType: "text/html", body: movedPage }),
  );
  await page.goto(`${ORIGIN}/u/example`);
  await page.evaluate(() => document.body.setAttribute("data-test-document", "original"));
  await page.locator('a[data-day="2026-03-02"]').click();
  await expect(page).toHaveURL(`${ORIGIN}${href}`);
  await expect(page.locator("body")).not.toHaveAttribute("data-test-document", "original");
});

test("back then forward after closing a day shows what the URL names", async ({ page, context }) => {
  await serveFixture(context, yearPage);
  await context.route(`${ORIGIN}/u/example?day=*`, (route) =>
    route.fulfill({ contentType: "text/html", body: dayPage }),
  );
  await page.goto(`${ORIGIN}/u/example`);
  await page.locator('a[data-day="2026-03-02"]').click();
  await expect(page.locator("#day-breakdown")).toHaveCount(1);
  await page.locator("[data-day-close]").click();
  await expect(page).toHaveURL(`${ORIGIN}/u/example`);
  await page.goBack();
  await expect(page).toHaveURL(`${ORIGIN}${href}`);
  await expect(page.locator("#day-breakdown")).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(`${ORIGIN}/u/example`);
  await expect(page.locator("#day-breakdown")).toHaveCount(0);
  await expect(page.locator(".heat-cell[data-selected]")).toHaveCount(0);
});

test("a day click is acknowledged before GitHub answers", async ({ page, context }) => {
  const nextDayPage = userPageHtml({
    ...options,
    day: "2026-03-03",
    dayBreakdown: { ...breakdown, window: { kind: "day", date: "2026-03-03", from: "2026-03-03T00:00:00Z", to: "2026-03-03T23:59:59Z" } },
  });
  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  await serveFixture(context, dayPage);
  await context.route(`${ORIGIN}/u/example?day=2026-03-03*`, async (route) => {
    await answered;
    await route.fulfill({ contentType: "text/html", body: nextDayPage });
  });
  await page.goto(`${ORIGIN}${href}`);
  await page.locator('a[data-day="2026-03-03"]').click();
  await expect(page.locator('a[data-day="2026-03-03"] rect')).toHaveAttribute("data-selected", "true");
  await expect(page.locator('a[data-day="2026-03-02"] rect')).not.toHaveAttribute("data-selected", "true");
  await expect(page.locator("#day-breakdown")).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => document.body.setAttribute("data-test-document", "original"));
  release();
  await expect(page.locator("#day-breakdown")).toHaveAttribute("data-date", "2026-03-03");
  await expect(page.locator("#day-breakdown")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");
});
