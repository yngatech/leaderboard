import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedMentions,
  cakeDayNotification,
  discordUserReference,
  parseDiscordUserIds,
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

test("a mapped cake-day sentence moves to message content so it can ping", () => {
  const { users } = parseDiscordUserIds('{"example-user":"123456789012345678"}');
  const notification = cakeDayNotification(EVENT, users);

  assert.match(notification.content ?? "", /^<@123456789012345678> has been/);
  assert.equal(notification.embed.description, undefined);
  assert.equal(notification.mentionedUserId, "123456789012345678");
});

test("an unmapped cake-day sentence remains in the embed with its GitHub link", () => {
  const notification = cakeDayNotification(EVENT, new Map());

  assert.equal(notification.content, undefined);
  assert.match(notification.embed.description ?? "", /^\[example-user\]\(https:\/\/github.com\/example-user\) has been/);
  assert.equal(notification.mentionedUserId, undefined);
});

test("the Discord user map rejects malformed JSON objects", () => {
  assert.throws(() => parseDiscordUserIds("[]"), /JSON object/);
  assert.throws(() => parseDiscordUserIds("not JSON"), /JSON object/);
});

test("invalid Discord IDs are reported without discarding valid mappings", () => {
  const { users, invalidLogins } = parseDiscordUserIds(
    '{"valid-user":"123456789012345678","number-user":123456789012345678,"bad-user":"not-a-discord-id"}',
  );

  assert.deepEqual([...users], [["valid-user", "123456789012345678"]]);
  assert.deepEqual(invalidLogins, ["number-user", "bad-user"]);
});
