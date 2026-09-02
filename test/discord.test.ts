import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedMentions,
  cakeDayNotification,
  discordUserReference,
  discordWebhookPayload,
  discordWebhookUrl,
  parseDiscordUserIds,
  type DiscordNotification,
} from "../worker/discord.ts";
import type { CakeDayEvent } from "../worker/notifications.ts";

const EVENT: CakeDayEvent = {
  login: "example-user",
  url: "https://github.com/example-user",
  avatarUrl: "https://avatars.example/example-user",
  createdAt: "2016-09-02T09:33:21Z",
  years: 10,
};

test("cake-day users can be mapped from GitHub logins case-insensitively", () => {
  const { users } = parseDiscordUserIds('{"Example-User":"123456789012345678"}');

  assert.deepEqual(
    discordUserReference("example-user", "https://github.com/example-user", users),
    { text: "<@123456789012345678>", userId: "123456789012345678" },
  );
});

test("an unmapped cake-day user keeps their GitHub profile link", () => {
  assert.deepEqual(
    discordUserReference(
      "example-user",
      "https://github.com/example-user",
      parseDiscordUserIds(undefined).users,
    ),
    { text: "[example-user](https://github.com/example-user)" },
  );
});

test("only an explicitly named Discord user is allowed to be pinged", () => {
  assert.deepEqual(allowedMentions(), { parse: [] });
  assert.deepEqual(allowedMentions("123456789012345678"), {
    parse: [],
    users: ["123456789012345678"],
  });
});

function componentText(notification: DiscordNotification): string {
  if (notification.kind !== "components") throw new Error("expected Components V2");
  return notification.components[0]?.components[0]?.components[0]?.content ?? "";
}

test("a mapped cake-day sentence is a pingable text component inside the card", () => {
  const { users } = parseDiscordUserIds('{"example-user":"123456789012345678"}');
  const notification = cakeDayNotification(EVENT, users);

  assert.match(
    componentText(notification),
    /^## \[🎂 Happy cake day!\]\(https:\/\/leaderboard\.ynga\.tech\/u\/example-user\)\n<@123456789012345678> has been/,
  );
  assert.equal(
    notification.kind === "components" ? notification.mentionedUserId : undefined,
    "123456789012345678",
  );
});

test("an unmapped cake-day card keeps its GitHub profile link", () => {
  const notification = cakeDayNotification(EVENT, new Map());

  assert.match(
    componentText(notification),
    /\n\[example-user\]\(https:\/\/github.com\/example-user\) has been/,
  );
  assert.equal(
    notification.kind === "components" ? notification.mentionedUserId : undefined,
    undefined,
  );
});

test("Components V2 payloads cannot include classic message content or embeds", () => {
  const notification = cakeDayNotification(EVENT, new Map());
  const payload = discordWebhookPayload(notification);

  assert.equal("flags" in payload ? payload.flags : undefined, 32768);
  assert.ok("components" in payload);
  assert.ok(!("content" in payload));
  assert.ok(!("embeds" in payload));
  assert.equal(
    discordWebhookUrl("https://discord.example/webhook?wait=true", notification).search,
    "?wait=true&with_components=true",
  );
});

test("classic notifications remain embed-only with mentions disabled", () => {
  const payload = discordWebhookPayload({
    kind: "embed",
    embed: {
      title: "Board update",
      url: "https://leaderboard.ynga.tech",
      description: "A board update.",
      color: 0x58a6ff,
    },
  });

  assert.deepEqual(payload, {
    username: "git board",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "Board update",
      url: "https://leaderboard.ynga.tech",
      description: "A board update.",
      color: 0x58a6ff,
    }],
  });
  assert.equal(
    discordWebhookUrl("https://discord.example/webhook?wait=true", {
      kind: "embed",
      embed: {
        title: "Board update",
        url: "https://leaderboard.ynga.tech",
        color: 0x58a6ff,
      },
    }).search,
    "?wait=true",
  );
});

test("the Discord user map rejects malformed JSON objects", () => {
  assert.throws(() => parseDiscordUserIds("[]"), /JSON object/);
  assert.throws(() => parseDiscordUserIds("not JSON"), /JSON object/);
});

test("invalid Discord IDs are reported without discarding valid mappings", () => {
  const { users, invalidLogins, duplicateLogins } = parseDiscordUserIds(
    '{"valid-user":"123456789012345678","number-user":123456789012345678,"bad-user":"not-a-discord-id"}',
  );

  assert.deepEqual([...users], [["valid-user", "123456789012345678"]]);
  assert.deepEqual(invalidLogins, ["number-user", "bad-user"]);
  assert.deepEqual(duplicateLogins, []);
});

test("case-variant duplicate GitHub logins are reported and the first mapping wins", () => {
  const { users, invalidLogins, duplicateLogins } = parseDiscordUserIds(
    '{"Example-User":"123456789012345678","example-user":"987654321098765432"}',
  );

  assert.deepEqual([...users], [["example-user", "123456789012345678"]]);
  assert.deepEqual(invalidLogins, []);
  assert.deepEqual(duplicateLogins, ["example-user"]);
});
