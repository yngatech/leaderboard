import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedMentions,
  discordUserReference,
  parseDiscordUserIds,
} from "../worker/discord.ts";

test("cake-day users can be mapped from GitHub logins case-insensitively", () => {
  const users = parseDiscordUserIds('{"Example-User":"123456789012345678"}');

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
      parseDiscordUserIds(undefined),
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

test("the Discord user map rejects malformed JSON and unsafe IDs", () => {
  assert.throws(() => parseDiscordUserIds("[]"), /JSON object/);
  assert.throws(
    () => parseDiscordUserIds('{"example-user":123456789012345678}'),
    /invalid ID for example-user/,
  );
  assert.throws(
    () => parseDiscordUserIds('{"example-user":"not-a-discord-id"}'),
    /invalid ID for example-user/,
  );
});
