import type { AllTimeUser, Board } from "../../shared/types.ts";
import { achievementsForYear } from "../../shared/achievements.ts";

export const achievementYear = 2026;
export const achievementToday = "2026-10-25";
const definitions = [
  { login: "example-contributor", createdAt: "2013-04-02T12:00:00Z", prior: 19_400, counts: [100, 200, 100, 400, 50, 80] },
  { login: "sample-builder", createdAt: "2019-10-24T12:00:00Z", prior: 5_000, counts: [150, 10, 300, 20, 350, 150] },
  { login: "sample-maintainer", createdAt: "2020-10-25T12:00:00Z", prior: 1_000, counts: [30, 0, 0, 0, 40, 75] },
];

export const achievementBoard: Board = definitions.map((entry) => ({
  login: entry.login, createdAt: entry.createdAt, name: null,
  url: `https://github.com/${entry.login}`, avatarUrl: "/avatar.svg",
  followers: 0, following: 0,
  totalContributions: entry.counts.reduce((sum, count) => sum + count, 0),
  weeks: [{ days: entry.counts.map((count, index) => ({
    date: `2026-10-${20 + index}`, count, level: count > 100 ? 4 as const : 2 as const,
  })) }],
})).sort((a, b) => b.totalContributions - a.totalContributions);

export const achievementUsers: AllTimeUser[] = achievementBoard.map((user) => ({
  login: user.login, name: user.name, createdAt: user.createdAt,
  avatarUrl: user.avatarUrl, url: user.url, followers: 0, following: 0,
  byYear: { 2025: definitions.find((entry) => entry.login === user.login)!.prior, 2026: user.totalContributions },
  total: definitions.find((entry) => entry.login === user.login)!.prior + user.totalContributions,
}));

export const achievementEvents = achievementsForYear({
  board: achievementBoard, year: achievementYear, today: achievementToday, history: achievementUsers,
});
