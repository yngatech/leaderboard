import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import type { AllTimeUser, BoardUser, ContributionBreakdown } from "../../shared/types.ts";
import { dayWindow } from "../../worker/breakdown.ts";
import { dayPanelFragmentHtml, userPageHtml } from "../../worker/views/pages.ts";
import { chrome, ORIGIN, serveFixture } from "./fixture.ts";

const boardUser: BoardUser = {
  login: "example",
  name: "Example User",
  avatarUrl: "https://avatars.example/user",
  url: "https://github.com/example",
  followers: 0,
  following: 0,
  totalContributions: 4,
  weeks: [{
    days: [
      { date: "2026-03-02", count: 3, level: 4 },
      { date: "2026-03-03", count: 1, level: 1 },
    ],
  }],
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
  kinds: [{
    kind: "commits",
    total: 3,
    unlisted: 0,
    repositories: [{
      nameWithOwner: "example/app",
      url: "https://github.com/example/app",
      count: 3,
    }],
  }],
};
function buildPage(day?: string, overrides: Partial<Parameters<typeof userPageHtml>[0]> = {}) {
  return userPageHtml({
    chrome,
    user,
    board: [boardUser],
    allUsers: [user],
    years: [2026],
    year: 2026,
    today: "2026-08-10",
    generatedAt: breakdown.generatedAt,
    breakdown,
    ...(day ? { day, dayBreakdown: { ...breakdown, window: dayWindow(day) } } : {}),
    ...overrides,
  });
}
const first = "2026-03-02";
const second = "2026-03-03";
const closed = `${ORIGIN}/u/example#heatmap`;
const url = (day?: string) => `${ORIGIN}/u/example${day ? `?day=${day}#heatmap` : ""}`;
const cell = (page: Page, day = first) => page.locator(`a[data-day="${day}"]`);
const panel = (page: Page) => page.locator('[aria-label="example in 2026"] [data-day-slot] + #day-breakdown');
function buildPanel(day: string, overrides: Partial<Parameters<typeof dayPanelFragmentHtml>[0]> = {}) {
  return dayPanelFragmentHtml({
    login: "example",
    board: [boardUser],
    day,
    dayBreakdown: { ...breakdown, window: dayWindow(day) },
    year: 2026,
    today: "2026-08-10",
    ...overrides,
  });
}
const panelDay = (requested: string) => new URL(requested).pathname.split("/").pop()!;
/** Counts full-page fetches: an in-place swap should only ask for the panel. */
async function serveDays(context: BrowserContext, initial = buildPage()) {
  const pages: string[] = [];
  await serveFixture(context, initial);
  await context.route(`${ORIGIN}/u/example?day=*`, (route) => {
    pages.push(route.request().url());
    return route.fulfill({
      contentType: "text/html", body: buildPage(new URL(route.request().url()).searchParams.get("day")!),
    });
  });
  await context.route(`${ORIGIN}/u/example/day/*`, (route) => route.fulfill({
    contentType: "text/html", body: buildPanel(panelDay(route.request().url())),
  }));
  return pages;
}
const markDocument = (page: Page) =>
  page.evaluate(() => document.body.setAttribute("data-test-document", "original"));

test.describe("day links without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("navigate into the heatmap card and close", async ({ page, context }) => {
    await serveDays(context);
    await page.goto(url());
    await expect(cell(page)).toHaveAttribute("href", "/u/example?day=2026-03-02#heatmap");
    await cell(page).click();
    await expect(page).toHaveURL(url(first));
    await expect(panel(page)).toContainText("3 contributions on Mon 2 Mar");
    await expect(cell(page).locator("rect")).toHaveAttribute("data-selected", "true");
    // Lands with the heatmap still in view above the panel.
    await expect(cell(page)).toBeInViewport();
    await expect(panel(page)).toBeInViewport();
    await page.locator("[data-day-close]").click();
    await expect(page).toHaveURL(closed);
    await expect(page.locator("#day-breakdown")).toHaveCount(0);
  });
});

test("swaps days in place, acknowledges pending clicks, closes and follows history", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pages = await serveDays(context);
  await page.goto(url());
  await markDocument(page);
  const originalYear = await page.locator("#year-breakdown").innerHTML();
  await cell(page).click();
  await expect(page).toHaveURL(url(first));
  await expect(panel(page)).toContainText("3 contributions on Mon 2 Mar");
  await expect(cell(page).locator("rect")).toHaveAttribute("data-selected", "true");
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");

  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  await context.route(`${ORIGIN}/u/example/day/${second}`, async (route) => {
    await answered;
    await route.fulfill({ contentType: "text/html", body: buildPanel(second) });
  });
  await cell(page, second).click();
  await expect(cell(page, second).locator("rect")).toHaveAttribute("data-selected", "true");
  await expect(cell(page).locator("rect")).not.toHaveAttribute("data-selected", "true");
  await expect(panel(page)).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page).toHaveURL(url(second));
  await expect(panel(page)).toHaveAttribute("data-date", second);
  await expect(panel(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(panel(page).locator("h3 strong")).toHaveText("1");
  await expect(page.locator("#day-breakdown")).toHaveCount(1);
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");
  expect(await page.locator("#year-breakdown").innerHTML()).toBe(originalYear);

  await page.locator("[data-day-close]").click();
  await expect(page).toHaveURL(closed);
  await expect(page.locator("#day-breakdown")).toHaveCount(0);
  await expect(page.locator(".heat-cell[data-selected]")).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");
  await page.goBack();
  await expect(page).toHaveURL(url(second));
  await expect(panel(page)).toHaveAttribute("data-date", second);
  await page.goBack();
  await expect(page).toHaveURL(url(first));
  await expect(panel(page)).toHaveAttribute("data-date", first);
  await expect(cell(page).locator("rect")).toHaveAttribute("data-selected", "true");
  await page.goForward();
  await page.goForward();
  await expect(page).toHaveURL(closed);
  await expect(page.locator("#day-breakdown")).toHaveCount(0);
  await expect(page.locator(".heat-cell[data-selected]")).toHaveCount(0);
  // History moves stayed in this document too.
  await expect(page.locator("body")).toHaveAttribute("data-test-document", "original");
  expect(pages).toEqual([]);
  expect(errors).toEqual([]);
});

for (const scenario of ["fetch failure", "moved day", "moved year", "moved year without breakdowns"]) {
  test(`${scenario} falls back to full navigation`, async ({ page, context }) => {
    const failed = scenario === "moved year without breakdowns";
    const yearOptions = failed ? { breakdown: null } : {};
    const movedDay = scenario === "moved day";
    const movedUser = scenario === "fetch failure" ? boardUser : {
      ...boardUser,
      totalContributions: movedDay ? 6 : 5,
      ...(movedDay ? { weeks: [{ days: [
        { ...boardUser.weeks[0].days[0], count: 5 }, boardUser.weeks[0].days[1],
      ] }] } : {}),
    };
    await serveFixture(context, buildPage(undefined, yearOptions));
    await context.route(`${ORIGIN}/u/example?day=*`, (route) => route.fulfill({
      contentType: "text/html", body: buildPage(first, { ...yearOptions, board: [movedUser] }),
    }));
    await context.route(`${ORIGIN}/u/example/day/*`, (route) =>
      scenario === "fetch failure"
        ? route.fulfill({ status: 503, body: "unavailable" })
        : route.fulfill({ contentType: "text/html", body: buildPanel(first, { board: [movedUser] }) }),
    );
    await page.goto(url());
    await markDocument(page);
    await cell(page).click();
    await expect(page).toHaveURL(url(first));
    await expect(page.locator("body")).not.toHaveAttribute("data-test-document", "original");
    await expect(panel(page).locator("h3 strong")).toHaveText(movedDay ? "5" : "3");
    if (movedDay) await expect(cell(page)).toHaveAttribute("aria-label", /^5 contributions/);
    if (scenario === "moved year")
      await expect(page.locator("#year-breakdown h3 strong")).toHaveText("5");
  });
}

test("unavailable day detail stays in the heatmap card and can be closed", async ({ page, context }) => {
  await serveFixture(context, buildPage(first, { dayBreakdown: null }));
  await page.goto(url(first));
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).locator("[role=img]")).toHaveCount(0);
  await page.locator("[data-day-close]").click();
  await expect(page).toHaveURL(closed);
  await expect(page.locator("#day-breakdown")).toHaveCount(0);
});
