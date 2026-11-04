import assert from "node:assert/strict";
import test from "node:test";
import type { DiscordEmbed } from "../../worker/discord.ts";
import { PEOPLE } from "../../worker/github.ts";
import { setup } from "./fixture.ts";

test("per-person embed titles link the person's profile; standings and board milestones link the board", async (t) => {
  const login = PEOPLE[0].accounts[0];
  const year = new Date().getUTCFullYear();
  const app = await setup(t);
  app.setCount(1);
  await app.refreshed();
  // The fixture books the leading account's whole year on 1 January.
  app.setCount(1_000);
  await app.refreshed();

  const links = new Map<string, Set<string>>();
  for (const post of app.posts) {
    for (const embed of (post as { embeds?: DiscordEmbed[] }).embeds ?? []) {
      links.set(embed.title, (links.get(embed.title) ?? new Set()).add(embed.url));
    }
  }
  const profile = `https://leaderboard.ynga.tech/u/${login}`;
  const board = `https://leaderboard.ynga.tech/${year}`;
  assert.deepEqual(Object.fromEntries([...links].map(([title, urls]) => [title, [...urls]])), {
    "New daily contributions PB": [`${profile}?day=${year}-01-01`],
    "New peak daily contributions record": [`${profile}?day=${year}-01-01`],
    "Contribution milestone": [profile],
    "All-time contribution milestone": [profile],
    "New git board leader": [board],
    "Position change": [board],
    "Board contribution milestone": [board],
  });
});
