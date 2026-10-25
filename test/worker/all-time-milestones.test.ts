import assert from "node:assert/strict";
import test from "node:test";
import { PEOPLE } from "../../worker/github.ts";
import type { DiscordEmbed } from "../../worker/discord.ts";
import { setup } from "./fixture.ts";

const login = PEOPLE[0].accounts[0];
function lifetimePosts(posts: unknown[]): DiscordEmbed[] {
  return posts.flatMap((post) => (post as { embeds?: DiscordEmbed[] }).embeds ?? [])
    .filter((embed) => embed.title === "All-time contribution milestone");
}

test("the alarm announces 20k once and retains it through eviction and total corrections", async (t) => {
  const app = await setup(t, { history: 19_000 });
  app.setCount(488);
  const first = await app.refreshed();
  assert.equal(first.values["all-time-milestones"]?.personalMilestones[login], 17_500);
  assert.equal(app.posts.length, 0);

  app.setCount(999);
  await app.refreshed();
  assert.equal(lifetimePosts(app.posts).length, 0);
  app.setCount(1_001);
  await app.refreshed();
  await app.refreshed();
  const posts = lifetimePosts(app.posts);
  assert.equal(posts.length, 1);
  assert.match(posts[0].description!, /20,000 contributions/);
  assert.equal(posts[0].url, `https://leaderboard.ynga.tech/u/${login}`);

  await app.mf.unsafeEvictDurableObject("alarm-test", "TestLeaderState", { name: "leaderboard" });
  for (const count of [1_001, 200, 1_001]) {
    app.setCount(count);
    const current = await app.refreshed();
    assert.equal(current.values["all-time-milestones"]?.personalMilestones[login], 20_000);
  }
  assert.equal(lifetimePosts(app.posts).length, 1);
});

test("failed yearly notifications do not prevent a lifetime crossing", async (t) => {
  const app = await setup(t, { history: 19_000 });
  app.setCount(999);
  await app.refreshed();
  app.setMode("yearly-discord-error");
  app.setCount(1_000);
  const failed = await app.refreshed();
  assert.equal(failed.values["all-time-milestones"]?.personalMilestones[login], 20_000);
  assert.equal(failed.values.milestones?.personalMilestones[login], 750);
  assert.equal(lifetimePosts(app.posts).length, 1);

  app.setMode("ok");
  await app.refreshed();
  assert.equal(lifetimePosts(app.posts).length, 1);
});

test("a failed lifetime webhook retries while yearly milestones continue", async (t) => {
  const app = await setup(t, { history: 19_000 });
  app.setCount(999);
  await app.refreshed();
  app.setMode("lifetime-discord-error");
  app.setCount(1_000);
  const failed = await app.refreshed();
  assert.equal(failed.values.milestones?.personalMilestones[login], 1_000);
  assert.equal(failed.values["all-time-milestones"]?.personalMilestones[login], 17_500);
  assert.equal(lifetimePosts(app.posts).length, 0);

  app.setMode("ok");
  await app.refreshed();
  await app.refreshed();
  assert.equal(lifetimePosts(app.posts).length, 1);
});

test("a partial cached archive is retried before lifetime totals are seeded", async (t) => {
  const app = await setup(t, { history: 19_000 });
  app.setCount(488);
  app.setMode("archive-partial");
  const partial = await app.refreshed();
  assert.equal(partial.values["all-time-milestones"], undefined);
  assert.equal(partial.values["board-snapshot"]?.board[0].totalContributions, 488);

  app.setMode("ok");
  const seeded = await app.refreshed();
  assert.equal(seeded.values["all-time-milestones"]?.personalMilestones[login], 17_500);
  assert.equal(lifetimePosts(app.posts).length, 0);
  app.setCount(1_000);
  await app.refreshed();
  assert.equal(lifetimePosts(app.posts).length, 1);
});

test("stale history defers a lifetime crossing until a complete archive returns", async (t) => {
  const app = await setup(t, { history: 19_000 });
  app.setCount(999);
  await app.refreshed();
  await app.state("stale-archive");
  app.setCount(1_000);
  const stale = await app.refreshed();
  assert.equal(stale.values.milestones?.personalMilestones[login], 1_000);
  assert.equal(stale.values["all-time-milestones"]?.personalMilestones[login], 17_500);
  assert.equal(lifetimePosts(app.posts).length, 0);

  await app.mf.purgeCache();
  app.setMode("archive-error");
  const unavailable = await app.refreshed();
  assert.equal(unavailable.values["all-time-milestones"]?.personalMilestones[login], 17_500);
  app.setMode("ok");
  await app.refreshed();
  assert.equal(lifetimePosts(app.posts).length, 1);
});
