import { joinDay } from "../shared/cakeday.ts";
import { formatDayYear } from "../shared/format.ts";
import type { CakeDayEvent } from "./notifications.ts";
import { SITE } from "./views/layout.ts";

const DISCORD_USER_ID = /^[1-9]\d{16,19}$/;
const COMPONENTS_V2_FLAG = 1 << 15;

export interface DiscordEmbed {
  title: string;
  url: string;
  description?: string;
  color: number;
  thumbnail?: { url: string };
}

export interface DiscordEmbedNotification {
  kind: "embed";
  embed: DiscordEmbed;
}

export interface DiscordTextDisplay {
  type: 10;
  content: string;
}

export interface DiscordThumbnail {
  type: 11;
  media: { url: string };
  description: string;
}

export interface DiscordSection {
  type: 9;
  components: DiscordTextDisplay[];
  accessory: DiscordThumbnail;
}

export interface DiscordContainer {
  type: 17;
  accent_color: number;
  components: DiscordSection[];
}

export interface DiscordComponentsNotification {
  kind: "components";
  components: DiscordContainer[];
  mentionedUserId?: string;
}

export type DiscordNotification = DiscordEmbedNotification | DiscordComponentsNotification;

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

/** Builds the mutually exclusive classic-embed or Components V2 webhook body. */
export function discordWebhookPayload(notification: DiscordNotification) {
  const common = {
    username: "git board",
    allowed_mentions: allowedMentions(
      notification.kind === "components" ? notification.mentionedUserId : undefined,
    ),
  };
  return notification.kind === "components"
    ? {
        ...common,
        flags: COMPONENTS_V2_FLAG,
        components: notification.components,
      }
    : {
        ...common,
        embeds: [notification.embed],
      };
}

/** Enables non-interactive Components V2 on ordinary incoming webhooks. */
export function discordWebhookUrl(
  value: string,
  notification: DiscordNotification,
): URL {
  const url = new URL(value);
  if (notification.kind === "components") url.searchParams.set("with_components", "true");
  return url;
}

/** Keeps a pingable mention inside the same rich card as the cake-day copy. */
export function cakeDayNotification(
  event: CakeDayEvent,
  userIds: ReadonlyMap<string, string>,
): DiscordNotification {
  const years = event.years === 1 ? "1 year" : `${event.years} years`;
  const user = discordUserReference(event.login, event.url, userIds);
  const description = `${user.text} has been on GitHub for **${years}** today, since ${formatDayYear(joinDay(event.createdAt))}.`;
  return {
    kind: "components",
    components: [{
      type: 17,
      accent_color: 0x58a6ff,
      components: [{
        type: 9,
        components: [{
          type: 10,
          content: `## [🎂 Happy cake day!](${SITE}/u/${encodeURIComponent(event.login)})\n${description}`,
        }],
        accessory: {
          type: 11,
          media: { url: event.avatarUrl },
          description: "GitHub avatar",
        },
      }],
    }],
    mentionedUserId: user.userId,
  };
}
