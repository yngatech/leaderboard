import type { AllTime, AllTimeUser, Board } from "../../shared/types.ts";
import {
  boardGoal,
  boardYearRanks,
  boardYearThresholds,
  cumulativeSeries,
  groupGrid,
  groupYearStrip,
  peakDay,
  peakYear,
  userGoals,
  userGrid,
  userYearStrip,
} from "../../shared/board.ts";
import { formatDayShort, formatNumber, formatOrdinal } from "../../shared/format.ts";
import { attr, escapeHtml } from "../html.ts";
import { cumulativeChartHtml } from "./chart.ts";
import { MIN_PAGE_YEAR, hrefForYear, pageHtml, type SiteChrome } from "./layout.ts";
import { allTimeRowHtml, boardGoalLineHtml, userRowHtml } from "./rows.ts";
import { heatmapSvg, yearStripSvg } from "./svg.ts";

const SITE_DESCRIPTION =
  "GitHub contribution leaderboard and heatmaps for the ynga.tech friends.";

/** The big number, its caption and the goal line under it. */
function heroHtml(total: number, caption: string, extra = ""): string {
  return `<div><p class="bg-[linear-gradient(96deg,var(--color-heat-4)_12%,var(--color-heat-3)_58%,var(--color-heat-2)_96%)] bg-clip-text font-display text-[clamp(3.6rem,12vw,7.5rem)] leading-[0.8] font-extrabold tracking-[-0.055em] tabular-nums text-transparent">${formatNumber(total)}</p><h2 class="mt-[0.9rem] max-w-[44ch] font-mono text-[0.8rem] leading-[1.6] font-normal text-dim" id="pulse-heading">${escapeHtml(caption)}</h2>${extra}</div>`;
}

/** The five-step swatch legend, with the outlined "to come" cell on live years. */
function legendHtml(withFuture: boolean): string {
  const swatches = [0, 1, 2, 3, 4]
    .map(
      (level) =>
        `<i class="size-[11px] rounded-[3px] bg-heat-0 data-[level=1]:bg-heat-1 data-[level=2]:bg-heat-2 data-[level=3]:bg-heat-3 data-[level=4]:bg-heat-4" data-level="${level}"></i>`,
    )
    .join("");
  const future = withFuture
    ? `<span class="w-2" aria-hidden="true"></span><i class="size-[11px] rounded-[3px] border border-future-line bg-transparent" data-state="future"></i><span>to come</span>`
    : "";
  return `<div class="flex items-center gap-[0.32rem] tracking-[0.04em] text-dimmer"><span>less</span>${swatches}<span>more</span>${future}</div>`;
}

const PLOT_PANEL =
  "overflow-x-auto rounded-2xl border border-line bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-[1.15rem] pt-4 pb-[0.9rem]";

const SECTION_RULE =
  "mt-[clamp(2.25rem,5vw,3.25rem)] mb-4 flex items-center gap-[0.85rem] text-[0.66rem] tracking-[0.2em] text-dimmer uppercase";

function missingNoteHtml(missing: string[]): string {
  if (missing.length === 0) return "";
  return `<p class="mt-[1.1rem] text-[0.7rem] leading-[1.6] text-dimmer">No GitHub data came back for ${escapeHtml(missing.join(", "))}. The account may have been renamed or removed.</p>`;
}

/** The "Nothing here." card, shared by the 404 page and an unknown login. */
function nothingHereHtml(detail: string, thisYear: number): string {
  return `<section class="mt-[clamp(2.5rem,6vw,4rem)] rounded-2xl border border-line bg-panel p-[1.6rem]"><p class="font-display text-[1.3rem] font-semibold tracking-[-0.02em] text-ink">Nothing here.</p><p class="mt-2 max-w-[60ch] text-[0.78rem] leading-[1.6] text-dim">${escapeHtml(detail)}</p><a class="mt-[1.1rem] inline-block cursor-pointer rounded-[9px] border border-accent/50 bg-transparent px-[1.1rem] py-[0.55rem] font-mono text-[0.75rem] tracking-[0.05em] text-accent no-underline transition-colors duration-200 hover:bg-accent/12" href="/">Show ${thisYear}</a></section>`;
}

export interface YearPageOptions {
  chrome: SiteChrome;
  board: Board;
  year: number;
  today: string;
  generatedAt: string | null;
  missing: string[];
}

export function yearPageHtml(options: YearPageOptions): string {
  const { chrome, board, year, today } = options;
  const live = year === chrome.thisYear;

  const total = board.reduce((sum, user) => sum + user.totalContributions, 0);
  const highestUserTotal = board.reduce(
    (highest, user) => Math.max(highest, user.totalContributions),
    0,
  );
  const highestDailyTotal = board.reduce(
    (highest, user) =>
      user.weeks.reduce(
        (userHighest, week) =>
          week.days.reduce((weekHighest, day) => Math.max(weekHighest, day.count), userHighest),
        highest,
      ),
    0,
  );
  const pulse = groupGrid(board, year, today);
  const busiest = peakDay(pulse);

  /**
   * Goals are forward-looking, so they belong to the year that can still
   * change. A finished year gets none, and every row it renders is the row it
   * has always been.
   */
  const goal = live ? boardGoal(board) : null;

  const busiestLine = busiest
    ? `<p>Busiest day: <strong class="font-medium text-ink">${formatNumber(busiest.count)}</strong> contributions on ${escapeHtml(formatDayShort(busiest.date))}</p>`
    : "";

  const rowsHtml = board
    .map((user, index) =>
      userRowHtml({
        user,
        rank: index + 1,
        year,
        today,
        highestTotal: highestUserTotal,
        highestDailyTotal,
        goals: live ? userGoals(board, index) : null,
      }),
    )
    .join("");

  /** Only the year in progress has a "so far" worth drawing. */
  const climb = live ? cumulativeSeries(board, year, today) : [];
  const chartHtml = climb.length > 0 ? cumulativeChartHtml({ series: climb, year, today }) : "";

  const main = `<section class="mt-[clamp(2.5rem,6vw,4rem)] animate-rise" aria-labelledby="pulse-heading">${heroHtml(
    total,
    `contributions from ${board.length} accounts in ${year}`,
    goal ? boardGoalLineHtml(goal) : "",
  )}<div class="mt-[1.9rem] ${PLOT_PANEL}">${heatmapSvg(pulse, {
    cell: 17,
    gap: 3,
    months: true,
    unit: "contributions",
    peakDate: busiest?.date,
    label: `All ${board.length} accounts combined, day by day, in ${year}`,
  })}</div><div class="mt-[0.9rem] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.72rem] text-dim">${busiestLine}${legendHtml(live)}</div></section><div class="${SECTION_RULE}"><span>the board</span><span class="h-px flex-1 bg-line-soft" aria-hidden="true"></span></div><main class="flex flex-col gap-[0.6rem]">${rowsHtml}</main>${missingNoteHtml(options.missing)}${chartHtml}`;

  return pageHtml({
    chrome,
    title: String(year),
    description: SITE_DESCRIPTION,
    nav: { kind: "year", year },
    generatedAt: options.generatedAt,
    liveCopy: live,
    main,
  });
}

export interface AllPageOptions {
  chrome: SiteChrome;
  data: AllTime;
  generatedAt: string | null;
  missing: string[];
}

export function allPageHtml(options: AllPageOptions): string {
  const { chrome, data } = options;
  const users = data.users;
  const years = data.years;

  const ranked = [...users].sort((a, b) => b.total - a.total || a.login.localeCompare(b.login));
  const thresholds = boardYearThresholds(users);
  const ranks = boardYearRanks(users, years);
  const total = users.reduce((sum, user) => sum + user.total, 0);
  const highestTotal = users.reduce((highest, user) => Math.max(highest, user.total), 0);
  const highestYearTotal = users.reduce(
    (highest, user) =>
      Object.values(user.byYear).reduce((userHighest, count) => Math.max(userHighest, count), highest),
    0,
  );
  const pulse = groupYearStrip(users, years);
  const best = peakYear(pulse);
  const span = years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : "";

  const bestLine = best
    ? `<p>Biggest year: <strong class="font-medium text-ink">${formatNumber(best.count)}</strong> contributions in ${best.year}</p>`
    : "";

  const rowsHtml = ranked
    .map((user, index) =>
      allTimeRowHtml({
        user,
        rank: index + 1,
        years,
        thresholds,
        ranks,
        highestTotal,
        highestYearTotal,
      }),
    )
    .join("");

  const main = `<section class="mt-[clamp(2.5rem,6vw,4rem)] animate-rise" aria-labelledby="pulse-heading">${heroHtml(
    total,
    `contributions from ${users.length} accounts, ${span}`,
  )}<div class="mt-[1.9rem] ${PLOT_PANEL}">${yearStripSvg(pulse, {
    cell: 70,
    gap: 6,
    labels: true,
    label: `All ${users.length} accounts combined, year by year, ${span}`,
    hrefFor: (year) => hrefForYear(year, chrome.thisYear),
  })}</div><div class="mt-[0.9rem] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.72rem] text-dim">${bestLine}${legendHtml(false)}</div></section><div class="${SECTION_RULE}"><span>the board</span><span class="h-px flex-1 bg-line-soft" aria-hidden="true"></span></div><main class="flex flex-col gap-[0.6rem]">${rowsHtml}</main>${missingNoteHtml(options.missing)}`;

  return pageHtml({
    chrome,
    title: "all time",
    description: SITE_DESCRIPTION,
    nav: { kind: "all" },
    generatedAt: options.generatedAt,
    liveCopy: true,
    main,
  });
}

export interface UserPageOptions {
  chrome: SiteChrome;
  /** The account's all-time record; the page's source of truth. */
  user: AllTimeUser;
  board: Board;
  allUsers: AllTimeUser[];
  years: number[];
  /** The year in progress. */
  year: number;
  today: string;
  generatedAt: string | null;
}

export function userPageHtml(options: UserPageOptions): string {
  const { chrome, user, board, allUsers, years, year, today } = options;

  const boardIndex = board.findIndex((other) => other.login === user.login);
  const boardUser = boardIndex >= 0 ? board[boardIndex] : null;
  const boardRank = boardIndex >= 0 ? boardIndex + 1 : null;

  const thresholds = boardYearThresholds(allUsers);
  const ranks = boardYearRanks(allUsers, years);
  const cells = userYearStrip(user, years, thresholds, ranks);
  const best = peakYear(cells);

  const grid = boardUser ? userGrid(boardUser.weeks, year, today) : null;
  const peak = grid ? peakDay(grid) : null;

  const firstActive = years.find((y) => (user.byYear[String(y)] ?? 0) > 0) ?? null;
  /** Competition ranking across every account's all-time total. */
  const allRank =
    user.total > 0 ? allUsers.filter((other) => other.total > user.total).length + 1 : null;

  const follows =
    user.followers !== null
      ? `<p class="mt-[0.4rem] flex flex-wrap gap-[0.3rem] text-[0.7rem] text-dimmer"><span>${formatNumber(user.followers ?? 0)} followers</span><span class="opacity-60">·</span><span>${formatNumber(user.following ?? 0)} following</span></p>`
      : "";

  const sinceCaption = firstActive ? `contributions since ${firstActive}` : "contributions";
  const rankLine = allRank
    ? `<span class="mt-[0.4rem] text-[0.68rem] text-dim">${formatOrdinal(allRank)} on the all-time board</span>`
    : "";

  const bestLine = best
    ? `<p class="mt-[0.9rem] text-[0.72rem] text-dim">Best year: <strong class="font-medium text-ink">${formatNumber(best.count)}</strong> contributions in ${best.year}</p>`
    : "";

  let liveSection: string;
  if (boardUser && grid) {
    const peakLine = peak
      ? `<p>Busiest day: <strong class="font-medium text-ink">${formatNumber(peak.count)}</strong> contributions on ${escapeHtml(formatDayShort(peak.date))}</p>`
      : "";
    const rankNote = boardRank ? ` · ${formatOrdinal(boardRank)} on the ${year} board` : "";
    liveSection = `<section aria-label="${attr(`${user.login} in ${year}`)}"><div class="${PLOT_PANEL}">${heatmapSvg(grid, {
      cell: 17,
      gap: 3,
      months: true,
      peakDate: peak?.date,
      label: `${user.login} made ${formatNumber(boardUser.totalContributions)} contributions in ${year}`,
    })}</div><div class="mt-[0.9rem] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.72rem] text-dim"><p><strong class="font-medium text-ink">${formatNumber(boardUser.totalContributions)}</strong> contributions${rankNote}</p>${peakLine}</div></section>`;
  } else {
    liveSection = `<p class="text-[0.78rem] leading-[1.6] text-dim">No GitHub data came back for ${escapeHtml(user.login)} in ${year}.</p>`;
  }

  const main = `<section class="mt-[clamp(2.5rem,6vw,4rem)] animate-rise" aria-labelledby="user-heading"><div class="flex flex-wrap items-center gap-5"><a href="${attr(user.url)}" target="_blank" rel="noreferrer noopener" tabindex="-1"><img class="size-[72px] rounded-2xl border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200 hover:border-accent/40 hover:saturate-100 max-phone:size-[56px]" src="${attr(user.avatarUrl)}" alt="" width="72" height="72"></a><div class="min-w-0"><a class="font-display text-[clamp(1.6rem,4.5vw,2.2rem)] leading-none font-extrabold tracking-[-0.03em] text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[4px]" href="${attr(user.url)}" target="_blank" rel="noreferrer noopener" id="user-heading">${escapeHtml(user.login)}</a><p class="mt-[0.35rem] text-[0.78rem] text-dim">${escapeHtml(user.name ?? "—")}</p>${follows}</div><div class="ml-auto flex flex-col items-end text-right max-phone:ml-0 max-phone:w-full max-phone:items-start max-phone:text-left"><span class="font-display text-[clamp(2.2rem,7vw,3.2rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">${formatNumber(user.total)}</span><span class="mt-[0.35rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase">${sinceCaption}</span>${rankLine}</div></div><div class="mt-[1.9rem] ${PLOT_PANEL}">${yearStripSvg(cells, {
    cell: 70,
    gap: 6,
    labels: true,
    podium: true,
    label: `${user.login}, year by year`,
    hrefFor: (y) => hrefForYear(y, chrome.thisYear),
  })}</div>${bestLine}</section><div class="${SECTION_RULE}"><span>${year}</span><span class="h-px flex-1 bg-line-soft" aria-hidden="true"></span></div>${liveSection}`;

  return pageHtml({
    chrome,
    title: user.login,
    description: `${user.login} on the ynga.tech GitHub contribution leaderboard.`,
    nav: { kind: "user" },
    generatedAt: options.generatedAt,
    liveCopy: true,
    main,
  });
}

export function notFoundPageHtml(chrome: SiteChrome): string {
  return pageHtml({
    chrome,
    title: "not found",
    description: SITE_DESCRIPTION,
    nav: null,
    liveCopy: true,
    main: nothingHereHtml(
      `Boards run from ${MIN_PAGE_YEAR} to ${chrome.thisYear}, plus all time.`,
      chrome.thisYear,
    ),
  });
}

/** An unknown login is a 404 with a name in it. */
export function unknownUserPageHtml(chrome: SiteChrome, login: string): string {
  return pageHtml({
    chrome,
    title: "not found",
    description: SITE_DESCRIPTION,
    nav: null,
    liveCopy: true,
    main: nothingHereHtml(`No account called ${login} on this board.`, chrome.thisYear),
  });
}

export function errorPageHtml(chrome: SiteChrome, message: string): string {
  const main = `<section class="mt-[clamp(2.5rem,6vw,4rem)] rounded-2xl border border-heat-3/45 bg-heat-3/8 p-[1.6rem]" role="alert"><p class="font-display text-[1.3rem] font-semibold tracking-[-0.02em] text-ink">The board didn't load.</p><p class="mt-2 max-w-[60ch] text-[0.78rem] leading-[1.6] text-dim">${escapeHtml(message)}</p><a class="mt-[1.1rem] inline-block cursor-pointer rounded-[9px] border border-accent/50 bg-transparent px-[1.1rem] py-[0.55rem] font-mono text-[0.75rem] tracking-[0.05em] text-accent no-underline transition-colors duration-200 hover:bg-accent/12" href="">Try again</a></section>`;
  return pageHtml({
    chrome,
    title: "error",
    description: SITE_DESCRIPTION,
    nav: null,
    liveCopy: true,
    main,
  });
}
