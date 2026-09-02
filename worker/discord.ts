import { joinDay } from "../shared/cakeday.ts";
import { formatDayYear } from "../shared/format.ts";
import type { CakeDayEvent } from "./notifications.ts";
import { SITE } from "./views/layout.ts";

const DISCORD_USER_ID = /^[1-9]\d{16,19}$/;

export interface DiscordEmbed {
  title: string;
  url: string;
  description?: string;
  color: number;
  thumbnail?: { url: string };
}

export interface DiscordNotification {
  embed: DiscordEmbed;
  content?: string;
  mentionedUserId?: string;
}

export interface AllowedMentions {
  parse: string[];
  users?: string[];
}

export interface DiscordUserReference {
  text: string;
  userId?: string;
}

export interface DiscordUserIds {
  users: ReadonlyMap<string, string>;
  invalidLogins: string[];
  duplicateLogins: string[];
}

/** Parses the encrypted mapping, retaining valid entries beside invalid ones. */
export function parseDiscordUserIds(value: string | undefined): DiscordUserIds {
  if (!value) return { users: new Map(), invalidLogins: [], duplicateLogins: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("DISCORD_USER_IDS must be a JSON object.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("DISCORD_USER_IDS must be a JSON object.");
  }

  const users = new Map<string, string>();
  const invalidLogins: string[] = [];
  const duplicateLogins: string[] = [];
  for (const [login, userId] of Object.entries(parsed)) {
    const normalizedLogin = login.toLowerCase();
    if (users.has(normalizedLogin)) {
      duplicateLogins.push(login);
      continue;
    }
    if (typeof userId !== "string" || !DISCORD_USER_ID.test(userId)) {
      invalidLogins.push(login);
      continue;
    }
    users.set(normalizedLogin, userId);
  }
  return { users, invalidLogins, duplicateLogins };
}

/** Uses a real mention when mapped, otherwise preserves the GitHub profile link. */
export function discordUserReference(
  login: string,
  githubUrl: string,
  userIds: ReadonlyMap<string, string>,
): DiscordUserReference {
  const userId = userIds.get(login.toLowerCase());
  return userId
    ? { text: `<@${userId}>`, userId }
    : { text: `[${login}](${githubUrl})` };
}

/** Keeps mentions disabled unless this particular notification names one user. */
export function allowedMentions(userId?: string): AllowedMentions {
  return userId ? { parse: [], users: [userId] } : { parse: [] };
}

/** Moves mapped cake-day copy into message content, where Discord can notify. */
export function cakeDayNotification(
  event: CakeDayEvent,
  userIds: ReadonlyMap<string, string>,
): DiscordNotification {
  const years = event.years === 1 ? "1 year" : `${event.years} years`;
  const user = discordUserReference(event.login, event.url, userIds);
  const description = `${user.text} has been on GitHub for **${years}** today, since ${formatDayYear(joinDay(event.createdAt))}.`;
  const embed: DiscordEmbed = {
    title: "🎂 Cake day",
    url: `${SITE}/u/${encodeURIComponent(event.login)}`,
    color: 0x58a6ff,
    thumbnail: { url: event.avatarUrl },
  };
  return {
    embed: user.userId ? embed : { ...embed, description },
    content: user.userId ? description : undefined,
    mentionedUserId: user.userId,
  };
}
