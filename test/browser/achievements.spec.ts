import { expect, test } from "@playwright/test";
import { achievementsPageHtml, recentAchievementsHtml } from "../../worker/views/achievements.ts";
import { html } from "../../worker/html.ts";
import { pageHtml } from "../../worker/views/layout.ts";
import { achievementEvents, achievementToday, achievementYear } from "../fixtures/achievements.ts";
import { chrome, ORIGIN, serveFixture } from "./fixture.ts";

const logins = ["example-contributor", "sample-builder", "sample-maintainer"];
function history(year = achievementYear, login?: string): string {
  return achievementsPageHtml({
    chrome, year, login, today: achievementToday, events: year === 2026 ? achievementEvents : [],
    generatedAt: "2026-10-25T14:00:00Z", logins,
  });
}

test.use({ javaScriptEnabled: false });

test("year and account filters submit and show the selected person's calculated history", async ({ page, context }) => {
  await serveFixture(context, history());
  await context.route(`${ORIGIN}/achievements?*`, async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ contentType: "text/html", body: history(
      +(url.searchParams.get("year") ?? 2026), url.searchParams.get("person") || undefined,
    ) });
  });
  await page.goto(`${ORIGIN}/achievements`);
  await page.getByRole("combobox", { name: "Account", exact: true }).selectOption("example-contributor");
  await page.getByRole("button", { name: "Show achievements" }).click();
  await expect(page).toHaveURL(`${ORIGIN}/achievements?year=2026&person=example-contributor`);
  const feed = page.getByRole("region", { name: "2026 achievements for example-contributor" });
  await expect(feed.locator('[data-achievement="lifetime-milestone/example-contributor/20000"]'))
    .toContainText("20,000 all-time contributions");
  await expect(feed.getByRole("link", { name: "sample-builder", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Year", exact: true }).selectOption("2025");
  await page.getByRole("button", { name: "Show achievements" }).click();
  await expect(page.getByRole("link", { name: "Explore the contribution board" })).toHaveAttribute("href", "/2025");
});

test("older entries are accessible without scripting", async ({ page, context }) => {
  const event = achievementEvents.find((item) => item.kind === "yearly-milestone")!;
  await serveFixture(context, achievementsPageHtml({
    chrome, year: 2026, today: achievementToday, logins, generatedAt: null,
    events: Array.from({ length: 21 }, (_, index) => ({ ...event, id: `example/${index}` })),
  }));
  await page.goto(`${ORIGIN}/achievements`);
  await expect(page.locator('[data-achievement="example/20"]')).toBeHidden();
  await page.getByText("Show 1 earlier achievement", { exact: true }).click();
  await expect(page.locator('[data-achievement="example/20"]')).toBeVisible();
});

test("compact profile entries retain shared records and link to the person's history", async ({ page, context }) => {
  const compact = recentAchievementsHtml({
    events: achievementEvents, year: 2026, today: achievementToday, login: "example-contributor",
  });
  await serveFixture(context, pageHtml({
    chrome, title: "example", description: "Synthetic achievements", nav: null,
    main: html`<main>${compact}</main>`,
  }));
  await page.goto(ORIGIN);
  await expect(page.locator('[data-achievement="board-record/2026/2026-10-23"]')).toBeVisible();
  await expect(page.locator('[data-achievement="personal-best/2026/example-contributor/2026-10-23"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View achievements" }))
    .toHaveAttribute("href", "/achievements?year=2026&person=example-contributor");
});
