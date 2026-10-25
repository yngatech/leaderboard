import assert from "node:assert/strict";
import test from "node:test";
import type { discordWebhookPayload } from "../../worker/discord.ts";
import { PEOPLE } from "../../worker/github.ts";
import { setup } from "./fixture.ts";

test("the alarm maps all user notifications at delivery and leaves board milestones quiet", async (t) => {
  const login = PEOPLE[0].accounts[0];
  const userId = "123456789012345678";
  const app = await setup(t, { history: 19_000, discordUserIds: JSON.stringify({ [login]: userId }) });
  app.setCount(1);
  await app.refreshed();
  app.setCount(1_000);
  await app.refreshed();
  app.setCount(1_200);
  await app.refreshed();
  const posts = app.posts as ReturnType<typeof discordWebhookPayload>[];
  assert.ok(posts.some((post) => "components" in post));
  for (const post of posts) {
    if ("components" in post) {
      assert.equal(post.flags, 32768);
      assert.deepEqual(post.allowed_mentions, { parse: [], users: [userId] });
      assert.ok(post.components[0].components[0].components[0].content.includes(`<@${userId}>`));
    } else {
      assert.ok(!post.embeds[0].description?.includes(`https://github.com/${login}`));
      assert.deepEqual(post.allowed_mentions, { parse: [] });
    }
  }
});
