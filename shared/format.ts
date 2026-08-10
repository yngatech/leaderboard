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

export type FirstDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function formatNumber(value: number): string {
  return numberFmt.format(value);
}

/**
 * A place on the board, marked as one. The hash is what makes a rank read as a
 * rank rather than as a second quantity, which matters most where a rank sits
 * next to a total; the board wears it too so there is one idiom, not two.
 */
export function formatRank(place: number): string {
  return `#${place}`;
}

/** 1st, 2nd, 3rd, 4th… 11th–13th take "th" whatever their last digit says. */
export function formatOrdinal(value: number): string {
  const teen = value % 100;
  const suffix =
    teen >= 11 && teen <= 13 ? "th" : (["th", "st", "nd", "rd"][value % 10] ?? "th");
  return `${value}${suffix}`;
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

/** Zero-based row within a week whose first day uses Intl's Monday=1…Sunday=7. */
export function weekdayIndex(date: string, firstDay: FirstDayOfWeek = 1): number {
  const isoWeekday = parseDay(date).getUTCDay() || 7;
  return (isoWeekday - firstDay + 7) % 7;
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
