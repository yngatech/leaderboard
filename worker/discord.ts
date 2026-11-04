import { joinDay } from "../shared/cakeday.ts";
import { formatDayYear, formatNumber } from "../shared/format.ts";
import type { CakeDayEvent, PersonalMilestoneEvent } from "./notifications.ts";
import { SITE } from "./views/layout.ts";

const DISCORD_USER_ID = /^[1-9]\d{16,19}$/;
const MAX_DISCORD_SNOWFLAKE = (1n << 64n) - 1n;
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
  mentionedUserIds: string[];
}

export type DiscordNotification = DiscordEmbedNotification | DiscordComponentsNotification;

export function allTimeMilestoneNotification(event: PersonalMilestoneEvent): DiscordEmbedNotification {
  return {
    kind: "embed",
    embed: {
      title: "All-time contribution milestone",
      url: `${SITE}/u/${encodeURIComponent(event.login)}`,
      description: `[${event.login}](${event.url}) has reached **${formatNumber(event.threshold)} contributions** all time.`,
      color: 0x58a6ff,
      thumbnail: { url: event.avatarUrl },
    },
  };
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
    if (
      typeof userId !== "string" ||
      !DISCORD_USER_ID.test(userId) ||
      BigInt(userId) > MAX_DISCORD_SNOWFLAKE
    ) {
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

/** Allows only the users explicitly named by this notification. */
export function allowedMentions(userIds: readonly string[] = []): AllowedMentions {
  return userIds.length ? { parse: [], users: [...new Set(userIds)] } : { parse: [] };
}

/** Builds the mutually exclusive classic-embed or Components V2 webhook body. */
export function discordWebhookPayload(notification: DiscordNotification) {
  const common = {
    username: "git board",
    allowed_mentions: allowedMentions(
      notification.kind === "components" ? notification.mentionedUserIds : undefined,
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

/** Maps the profile links emitted by notification builders at the Discord boundary. */
export function mentionDiscordUsers(
  notification: DiscordNotification,
  userIds: ReadonlyMap<string, string>,
): DiscordNotification {
  if (notification.kind !== "embed") return notification;
  const { embed } = notification;
  if (!embed.description || !embed.thumbnail) return notification;
  const mentionedUserIds: string[] = [];
  const description = embed.description.replace(
    /\[([a-z\d-]+)\]\((https:\/\/github\.com\/\1)\)/gi,
    (link, login: string, url: string) => {
      const user = discordUserReference(login, url, userIds);
      if (!user.userId) return link;
      mentionedUserIds.push(user.userId);
      return user.text;
    },
  );
  return mentionedUserIds.length
    ? discordCard({ ...embed, description, thumbnail: embed.thumbnail }, mentionedUserIds)
    : notification;
}

export function cakeDayNotification(
  event: CakeDayEvent,
  userIds: ReadonlyMap<string, string>,
): DiscordNotification {
  const years = event.years === 1 ? "1 year" : `${event.years} years`;
  const user = discordUserReference(event.login, event.url, userIds);
  const description = `${user.text} has been on GitHub for **${years}** today, since ${formatDayYear(joinDay(event.createdAt))}.`;
  return discordCard({
    title: "🎂 Happy cake day!",
    url: `${SITE}/u/${encodeURIComponent(event.login)}`,
    description,
    color: 0x58a6ff,
    thumbnail: { url: event.avatarUrl },
  }, user.userId ? [user.userId] : []);
}

/** Mentions must be in text components to ping from inside a rich card. */
function discordCard(embed: Required<DiscordEmbed>, mentionedUserIds: string[]): DiscordComponentsNotification {
  return {
    kind: "components",
    components: [{
      type: 17,
      accent_color: embed.color,
      components: [{
        type: 9,
        components: [{
          type: 10,
          content: `## [${embed.title}](${embed.url})\n${embed.description}`,
        }],
        accessory: {
          type: 11,
          media: { url: embed.thumbnail.url },
          description: "GitHub avatar",
        },
      }],
    }],
    mentionedUserIds,
  };
}
