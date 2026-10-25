import assert from "node:assert/strict";
import test from "node:test";
import { PEOPLE } from "../../worker/github.ts";
import type { DiscordEmbedNotification } from "../../worker/discord.ts";
import { setup } from "./fixture.ts";

const login = PEOPLE[0].accounts[0];

function personalMilestonePosts(posts: unknown[]) {
  return posts.flatMap((post) => {
    const payload = post as { embeds?: DiscordEmbedNotification["embed"][] };
    return payload.embeds?.filter((embed) => embed.title === "Contribution milestone") ?? [];
  });
}

test("the alarm silently migrates passed yearly rungs, then announces 13k and 14k once", async (t) => {
  const app = await setup(t);
  app.setCount(12_000);
  const first = await app.refreshed();
  const legacy = structuredClone(first.values.milestones!);
  delete legacy.personalMilestonesVersion;
  legacy.personalMilestones[login] = 10_000;
  await app.seedMilestones(legacy);

  const migrated = await app.refreshed();
  assert.equal(migrated.values.milestones?.personalMilestonesVersion, 2);
  assert.equal(migrated.values.milestones?.personalMilestones[login], 12_000);
  assert.equal(app.posts.length, 0);

  for (const total of [13_000, 13_000, 14_000, 14_000]) {
    app.setCount(total);
    await app.refreshed();
  }
  const posts = personalMilestonePosts(app.posts);
  assert.equal(posts.length, 2);
  assert.match(posts[0].description!, /13,000 contributions/);
  assert.match(posts[1].description!, /14,000 contributions/);

  await app.mf.unsafeEvictDurableObject("alarm-test", "TestLeaderState", { name: "leaderboard" });
  const restored = await app.refreshed();
  assert.equal(restored.values.milestones?.personalMilestones[login], 14_000);
  assert.equal(personalMilestonePosts(app.posts).length, 2);
});

test("an old yearly milestone survives a failed webhook before migration completes", async (t) => {
  const app = await setup(t);
  app.setCount(12_000);
  const first = await app.refreshed();
  const legacy = structuredClone(first.values.milestones!);
  delete legacy.personalMilestonesVersion;
  legacy.personalMilestones[login] = 7_500;
  await app.seedMilestones(legacy);

  app.setMode("discord-error");
  const failed = await app.refreshed();
  assert.equal(failed.values.milestones?.personalMilestonesVersion, undefined);
  assert.equal(failed.values.milestones?.personalMilestones[login], 7_500);
  assert.equal(app.posts.length, 0);

  app.setMode("ok");
  const migrated = await app.refreshed();
  await app.refreshed();
  assert.equal(migrated.values.milestones?.personalMilestonesVersion, 2);
  assert.equal(migrated.values.milestones?.personalMilestones[login], 12_000);
  const posts = personalMilestonePosts(app.posts);
  assert.equal(posts.length, 1);
  assert.match(posts[0].description!, /10,000 contributions/);
});
