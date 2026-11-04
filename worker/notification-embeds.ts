import { formatDayYear } from "../shared/format.ts";
import type { DiscordEmbed } from "./discord.ts";
import {
  ordinal,
  type BoardMilestoneEvent,
  type BoardRecordEvent,
  type DailyRecordNotification,
  type DailyWrapUpEvent,
  type MilestoneNotification,
  type PersonalBestEvent,
  type PersonalMilestoneEvent,
  type StandingNotification,
} from "./notifications.ts";
import { SITE } from "./views/layout.ts";

/** Every yearly notification the board check posts as a classic embed. */
export type YearlyNotification = StandingNotification | DailyRecordNotification | MilestoneNotification;

/**
 * Builds the embed for one yearly notification. This is the single entry point
 * the Durable Object and `scripts/discord-preview.ts` share, so keep its
 * signature stable when changing the builders behind it.
 */
export function notificationEmbed(year: number, notification: YearlyNotification): DiscordEmbed {
  switch (notification.type) {
    case "leader":
      return leaderEmbed(year, notification);
    case "overtake":
      return standingOvertakeEmbed(year, notification);
    case "personal-milestone":
      return personalMilestoneEmbed(year, notification.event);
    case "board-milestone":
      return boardMilestoneEmbed(year, notification.event);
    default:
      return dailyRecordEmbed(notification);
  }
}

function count(value: number): string {
  return value.toLocaleString("en-GB");
}

function personalBestEmbed(event: PersonalBestEvent): DiscordEmbed {
  const improvement =
    event.previousCount > 0
      ? `, beating their previous best of **${count(event.previousCount)}**`
      : "";
  return {
    title: "New daily contributions PB",
    url: `${SITE}/u/${encodeURIComponent(event.login)}?day=${event.date}`,
    description: `[${event.login}](${event.url}) recorded **${count(event.count)} contributions** on **${formatDayYear(event.date)}**${improvement}.`,
    color: 0x58a6ff,
    thumbnail: { url: event.avatarUrl },
  };
}

function boardRecordEmbed(event: BoardRecordEvent): DiscordEmbed {
  const previous =
    event.previousCount > 0
      ? `, beating the previous record of **${count(event.previousCount)}**`
      : "";
  return {
    title: "New peak daily contributions record",
    url: `${SITE}/u/${encodeURIComponent(event.peak.login)}?day=${event.peak.date}`,
    description: `[${event.peak.login}](${event.peak.url}) set a new board record with **${count(event.peak.count)} contributions** on **${formatDayYear(event.peak.date)}**${previous}.`,
    color: 0xf0b429,
    thumbnail: { url: event.peak.avatarUrl },
  };
}

function personalBestWrapUpEmbed(event: DailyWrapUpEvent): DiscordEmbed {
  return {
    title: "Daily contributions PB wrap-up",
    url: `${SITE}/u/${encodeURIComponent(event.login)}?day=${event.date}`,
    description: `[${event.login}](${event.url}) finished **${formatDayYear(event.date)}** on **${count(event.count)} contributions**, up from **${count(event.announcedCount)}** when the PB was announced.`,
    color: 0x58a6ff,
    thumbnail: { url: event.avatarUrl },
  };
}

function boardRecordWrapUpEmbed(event: DailyWrapUpEvent): DiscordEmbed {
  return {
    title: "Peak daily contributions record wrap-up",
    url: `${SITE}/u/${encodeURIComponent(event.login)}?day=${event.date}`,
    description: `[${event.login}](${event.url}) finished **${formatDayYear(event.date)}** on **${count(event.count)} contributions**, a board record up from **${count(event.announcedCount)}** when it was last announced.`,
    color: 0xf0b429,
    thumbnail: { url: event.avatarUrl },
  };
}

function dailyRecordEmbed(notification: DailyRecordNotification): DiscordEmbed {
  switch (notification.type) {
    case "personal-best-wrap-up":
      return personalBestWrapUpEmbed(notification.event);
    case "board-record-wrap-up":
      return boardRecordWrapUpEmbed(notification.event);
    case "personal-best":
      return personalBestEmbed(notification.event);
    case "board-record":
      return boardRecordEmbed(notification.event);
  }
}

function personalMilestoneEmbed(year: number, event: PersonalMilestoneEvent): DiscordEmbed {
  return {
    title: "Contribution milestone",
    url: `${SITE}/u/${encodeURIComponent(event.login)}`,
    description: `[${event.login}](${event.url}) has passed **${count(event.threshold)} contributions** in ${year}.`,
    color: 0x58a6ff,
    thumbnail: { url: event.avatarUrl },
  };
}

function boardMilestoneEmbed(year: number, event: BoardMilestoneEvent): DiscordEmbed {
  return {
    title: "Board contribution milestone",
    url: `${SITE}/${year}`,
    description: `The board has passed **${count(event.threshold)} contributions** in ${year}.`,
    color: 0xf0b429,
  };
}

function leaderEmbed(year: number, notification: Extract<StandingNotification, { type: "leader" }>): DiscordEmbed {
  const { leader } = notification.event;
  return {
    title: "New git board leader",
    url: `${SITE}/${year}`,
    description: `[${leader.login}](${leader.url}) has taken the lead for **${year}** with **${count(leader.totalContributions)} contributions**.`,
    color: 0xf0b429,
    thumbnail: { url: leader.avatarUrl },
  };
}

function standingOvertakeEmbed(
  year: number,
  notification: Extract<StandingNotification, { type: "overtake" }>,
): DiscordEmbed {
  const { position, mover, displaced } = notification.event;
  return {
    title: "Position change",
    url: `${SITE}/${year}`,
    description: `[${mover.login}](${mover.url}) has overtaken [${displaced.login}](${displaced.url}) for **${ordinal(position)} place** in ${year} with **${count(mover.totalContributions)} contributions**.`,
    color: 0x58a6ff,
    thumbnail: { url: mover.avatarUrl },
  };
}
