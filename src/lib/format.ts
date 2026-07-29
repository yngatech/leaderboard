const numberFmt = new Intl.NumberFormat("en-GB");

const longDayFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortDayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

export function formatNumber(value: number): string {
  return numberFmt.format(value);
}

/** Parses an ISO calendar date (no time component) as UTC. */
export function parseDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function formatDayLong(date: string): string {
  return longDayFmt.format(parseDay(date));
}

export function formatDayShort(date: string): string {
  return shortDayFmt.format(parseDay(date));
}

export function formatMonth(date: string): string {
  return monthFmt.format(parseDay(date));
}

/** Sunday = 0, matching the rows of a GitHub contribution calendar. */
export function weekdayIndex(date: string): number {
  return parseDay(date).getUTCDay();
}

export function formatAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
