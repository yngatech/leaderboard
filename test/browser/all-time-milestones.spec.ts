import { expect, test } from "@playwright/test";
import type { AllTimeUser, Board } from "../../shared/types.ts";
import { userPageHtml } from "../../worker/views/pages.ts";
import { chrome, ORIGIN, serveFixture } from "./fixture.ts";

function profile(total: number, withLiveYear = true): string {
  const current = Math.min(total, 1_000);
  const user: AllTimeUser = {
    login: "example-contributor",
    name: "Example contributor",
    avatarUrl: "https://avatars.example/contributor",
    url: "https://github.com/example-contributor",
    followers: 0,
    following: 0,
    byYear: { 2025: total - current, 2026: current },
    total,
  };
  const board: Board = withLiveYear ? [{
    ...user,
    createdAt: user.createdAt ?? undefined,
    followers: 0,
    following: 0,
    totalContributions: current,
    weeks: [{ days: [{ date: "2026-10-01", count: current, level: 1 }] }],
  }] : [];
  return userPageHtml({
    chrome, user, board, allUsers: [user], years: [2025, 2026], year: 2026,
    today: "2026-10-25", generatedAt: "2026-10-25T09:00:00Z",
  });
}

test.use({ javaScriptEnabled: false });

for (const [total, remaining, target] of [
  [0, "100", "100"],
  [19_488, "512", "20,000"],
  [20_000, "2,500", "22,500"],
  [99_999, "1", "100,000"],
] as const) {
  test(`the lifetime goal uses the career total of ${total}`, async ({ page, context }) => {
    await serveFixture(context, profile(total));
    await page.goto(ORIGIN);
    const goal = page.getByRole("group", { name: "All-time contribution goal" });
    await expect(goal).toBeVisible();
    await expect(goal.locator("strong")).toHaveText([remaining, target]);
  });
}

test("a lifetime goal remains available when the live year is missing", async ({ page, context }) => {
  await serveFixture(context, profile(19_488, false));
  await page.goto(ORIGIN);
  await expect(page.getByRole("group", { name: "All-time contribution goal" }).locator("strong"))
    .toHaveText(["512", "20,000"]);
});

for (const total of [100_000, 120_000]) {
  test(`the lifetime goal is omitted after the final rung at ${total}`, async ({ page, context }) => {
    await serveFixture(context, profile(total));
    await page.goto(ORIGIN);
    await expect(page.getByRole("group", { name: "All-time contribution goal" })).toHaveCount(0);
  });
}
