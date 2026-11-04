import { insightsHtml } from "./insights.ts";
import type { PrInsights } from "../insights.ts";
import {
  AVATAR,
  BUTTON,
  BUTTON_QUIET,
  CARD,
  CARD_LEDGER,
  CARD_WELL,
  LEAD_EDGE,
  LEDGER_TERM,
  LEDGER_VALUE,
  NAME_LINK,
  SURFACE,
  sectionHeadingHtml,
} from "./ui.ts";
import type {
  AllTime,
  AllTimeUser,
  Board,
  BoardUser,
  ContributionBreakdown,
} from "../../shared/types.ts";
import { breakdownHtml, dayBreakdownHtml } from "./breakdown.ts";
import { reconcileBreakdown } from "../breakdown.ts";
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
  yearShape,
  type Grid,
  type PeakDay,
  type PeakYear,
  type UserGoals,
  type YearCell,
} from "../../shared/board.ts";
import { cakeDayYears, joinDay, yearsOnGitHub } from "../../shared/cakeday.ts";
import { ALL_TIME_PERSONAL_MILESTONES, nextMilestone } from "../../shared/milestones.ts";
import { formatDayShort, formatDayYear, formatNumber, formatOrdinal } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { cumulativeChartHtml } from "./chart.ts";
import { MIN_PAGE_YEAR, SITE, hrefForYear, pageHtml, type SiteChrome } from "./layout.ts";
import { allTimeRowHtml, boardGoalLineHtml, goalRailHtml, rowGapHtml, userRowHtml } from "./rows.ts";
import { dayTitle, heatmapSvg, yearStripSvg } from "./svg.ts";
import { recentAchievementsHtml, type RecentAchievementsOptions } from "./achievements.ts";

const SITE_DESCRIPTION =
  "GitHub contribution leaderboard and heatmaps for the ynga.tech friends.";

/** The big number, its caption and the goal line under it. */
function heroHtml(total: number, caption: string, extra: Html | null = null): Html {
  return html`<div>
    <p
      class="bg-[linear-gradient(96deg,var(--color-heat-4)_12%,var(--color-heat-3)_58%,var(--color-heat-2)_96%)] bg-clip-text type-hero text-transparent"
    >
      ${formatNumber(total)}
    </p>
    <h2
      class="mt-3.5 max-w-[44ch] font-mono text-body font-normal text-secondary"
      id="pulse-heading"
    >
      ${caption}
    </h2>
    ${extra}
  </div>`;
}

/** The five-step swatch legend, with the outlined "to come" cell on live years. */
function legendHtml(withFuture: boolean): Html {
  const swatches = [0, 1, 2, 3, 4]
    .map(
      (level) =>
        html`<i
          class="size-[11px] rounded-cell bg-heat-0 data-[level=1]:bg-heat-1 data-[level=2]:bg-heat-2 data-[level=3]:bg-heat-3 data-[level=4]:bg-heat-4"
          data-level="${level}"
        ></i>`,
    );
  const future = withFuture
    ? html`<span class="w-2" aria-hidden="true"></span
        ><i
          class="size-[11px] rounded-cell border border-future-line bg-transparent"
          data-state="future"
        ></i
        ><span>to come</span>`
    : null;
  return html`<div
    class="flex items-center gap-1.5 text-muted"
  >
    <span>less</span>${swatches}<span>more</span>${future}
  </div>`;
}

const PLOT_PANEL = `rounded-card border border-line-soft ${CARD_WELL}`;


function missingNoteHtml(missing: string[]): Html | null {
  if (missing.length === 0) return null;
  return html`<p class="mt-4.5 text-meta text-muted">
    No GitHub data came back for ${missing.join(", ")}. The account may have been renamed or
    removed.
  </p>`;
}

/** The "Nothing here." card, shared by the 404 page and an unknown login. */
function nothingHereHtml(detail: string, thisYear: number): Html {
  return html`<section
    class="mt-page ${SURFACE} p-card"
  >
    <p class="type-subhead text-ink">
      Nothing here.
    </p>
    <p class="mt-2 max-w-[60ch] text-body text-secondary">${detail}</p>
    <a
      class="mt-4.5 ${BUTTON}"
      href="/"
      >Show ${thisYear}</a
    >
  </section>`;
}

export interface YearPageOptions {
  chrome: SiteChrome;
  board: Board;
  year: number;
  today: string;
  generatedAt: string | null;
  missing: string[];
  achievements?: RecentAchievementsOptions;
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
    ? html`<p>
        Busiest day:
        <strong class="font-medium text-ink">${formatNumber(busiest.count)}</strong>
        contributions on ${formatDayShort(busiest.date)}
      </p>`
    : null;

  const rowsHtml = board
    .flatMap((user, index) => [
      live && index > 0 ? rowGapHtml(board[index - 1], user) : null,
      userRowHtml({
        user,
        rank: index + 1,
        year,
        today,
        highestTotal: highestUserTotal,
        highestDailyTotal,
        cakeDay: live ? cakeDayYears(user.createdAt, today) : null,
        currentStreak: live ? yearShape(userGrid(user.weeks, year, today), today).currentStreak : null,
      }),
    ]);

  /** Only the year in progress has a "so far" worth drawing. */
  const climb = live ? cumulativeSeries(board, year, today) : [];
  const chartHtml = climb.length > 0 ? cumulativeChartHtml({ series: climb, year, today }) : null;
  const hero = heroHtml(
    total,
    `contributions from ${board.length} accounts in ${year}`,
    goal ? boardGoalLineHtml(goal) : null,
  );

  const main = html`<section
      class="mt-page animate-rise"
      aria-labelledby="pulse-heading"
    >
      ${hero}<div class="mt-7.5 ${PLOT_PANEL}">${heatmapSvg(pulse, {
    cell: 17,
    gap: 3,
    months: true,
    unit: "contributions",
    peakDate: busiest?.date,
    label: `All ${board.length} accounts combined, day by day, in ${year}`,
  })}</div>
      <div
        class="mt-3.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-meta text-secondary"
      >
        ${busiestLine}${legendHtml(live)}
      </div>
    </section>
    ${sectionHeadingHtml("the board")}
    <main class="flex flex-col gap-2.5">${rowsHtml}</main>
    ${missingNoteHtml(options.missing)}${chartHtml}
    ${options.achievements ? recentAchievementsHtml(options.achievements) : null}`;

  return pageHtml({
    chrome,
    title: String(year),
    description: SITE_DESCRIPTION,
    nav: { kind: "year", year },
    alternate: `/api/board?year=${year}`,
    generatedAt: options.generatedAt,
    liveCopy: live,
    provisionalToday: live,
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
    ? html`<p>
        Biggest year: <strong class="font-medium text-ink">${formatNumber(best.count)}</strong>
        contributions in ${best.year}
      </p>`
    : null;

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
    );
  const hero = heroHtml(total, `contributions from ${users.length} accounts, ${span}`);

  const main = html`<section
      class="mt-page animate-rise"
      aria-labelledby="pulse-heading"
    >
      ${hero}<div class="mt-7.5 ${PLOT_PANEL}">${yearStripSvg(pulse, {
    cell: 70,
    gap: 6,
    labels: true,
    label: `All ${users.length} accounts combined, year by year, ${span}`,
    hrefFor: (year) => hrefForYear(year, chrome.thisYear),
  })}</div>
      <div
        class="mt-3.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-meta text-secondary"
      >
        ${bestLine}${legendHtml(false)}
      </div>
    </section>
    ${sectionHeadingHtml("the board")}
    <main class="flex flex-col gap-2.5">${rowsHtml}</main>
    ${missingNoteHtml(options.missing)}`;

  return pageHtml({
    chrome,
    title: "all time",
    description: SITE_DESCRIPTION,
    nav: { kind: "all" },
    alternate: "/api/all",
    generatedAt: options.generatedAt,
    liveCopy: true,
    provisionalToday: true,
    main,
  });
}

/* ---------------------------------------------------------------------------
   The account page's furniture.

   A profile is one of the board's rows grown to page scale: identity and
   career total on top, the plot in its recessed well, and a ledger welded
   along the bottom edge where every number that qualifies the plot above it
   lives. Because the ledger is part of the card rather than loose text beside
   it, no statistic can drift off on its own — and because it keeps the
   board's tint, hairline and term type, the page still reads as board
   furniture rather than a dashboard.
--------------------------------------------------------------------------- */

/** Register one: who this is, and the number the whole card is about. */
const CARD_HEAD = "flex flex-wrap items-center gap-x-5 gap-y-4 p-card max-phone:gap-x-4";


/** The hairline between fields: vertical while they sit side by side, and
 *  horizontal once a phone stacks them. */
const LEDGER_RULE =
  "border-l border-line-soft pl-5 max-phone:border-t max-phone:border-l-0 max-phone:pt-3 max-phone:pl-0";

const LEDGER_GRID = "grid gap-x-5 gap-y-3 font-mono text-body";

/** One figure per ledger anchors it; the rest of the band stays sentence-sized. */
const LEDGER_FIGURE = "type-figure text-ink";
const LEDGER_FIGURE_LEAD = "type-figure text-accent";

/** Wide first column, because only that field carries a rail. */
function ledgerColumns(count: number): string {
  if (count >= 3) {
    return "grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)] max-phone:grid-cols-1";
  }
  if (count === 2) return "grid-cols-2 max-phone:grid-cols-1";
  return "grid-cols-1";
}

interface LedgerField {
  /** Static micro-label; never interpolated from GitHub data. */
  term: string;
  body: Html;
}

/** The band itself. No fields means no band, rather than an empty strip. */
function ledgerHtml(fields: LedgerField[]): Html | null {
  if (fields.length === 0) return null;
  const items = fields
    .map(
      (field, index) =>
        html`<div class="min-w-0${index > 0 ? ` ${LEDGER_RULE}` : ""}">
          <dt class="${LEDGER_TERM}">${field.term}</dt>
          <dd class="mt-2 min-w-0 break-words text-secondary">${field.body}</dd>
        </div>`,
    );
  return html`<div class="${CARD_LEDGER}">
    <dl class="${LEDGER_GRID} ${ledgerColumns(fields.length)}">${items}</dl>
  </div>`;
}

export interface UserPageOptions {
  achievements?: RecentAchievementsOptions;
  insights?: PrInsights | null;
  breakdown?: ContributionBreakdown | null;
  dayBreakdown?: ContributionBreakdown | null;
  day?: string;
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

/** A snippet to paste, and the button that appears once there is a clipboard. */
function snippetRowHtml(id: string, snippet: string): Html {
  return html`<div class="${SURFACE} flex min-w-0 items-start gap-3 p-card max-phone:flex-wrap">
    <code
      class="min-w-0 flex-1 overflow-x-auto font-mono text-meta break-all whitespace-pre-wrap text-secondary"
      id="${id}"
      >${snippet}</code
    >
    <button
      class="${BUTTON_QUIET} shrink-0"
      data-copy="${id}"
      hidden
    >
      copy
    </button>
  </div>`;
}

/**
 * The card, the badges, and the lines to paste to get them. Each snippet wraps
 * its image in a link back here, because what somebody puts in a README is the
 * only part of this board a stranger ever sees.
 *
 * Every preview is the live SVG rather than a mock-up of one: if a route is
 * broken, this section is where it shows, not in somebody's profile. The alt
 * text is deliberately year-free — a snippet is pasted once and never revisited,
 * so anything that names a year is wrong by January.
 */
function cardSectionHtml(login: string): Html {
  const cardPath = `/u/${login}.svg`;
  const yearPath = `/u/${login}/year.svg`;
  const allPath = `/u/${login}/all.svg`;
  const streakPath = `/u/${login}/streak.svg`;
  // A preview is same-origin so a preview deployment shows its own images
  // rather than production's; a snippet has to be absolute, since it is read
  // somewhere that has never heard of this site.
  const cardSnippet = `[![${login} on the ynga git board](${SITE}${cardPath})](${SITE}/u/${login})`;
  const badgeSnippet = [
    `[![contributions this year](${SITE}${yearPath})](${SITE}/u/${login})`,
    `[![contributions all time](${SITE}${allPath})](${SITE}/u/${login})`,
    `[![current streak](${SITE}${streakPath})](${SITE}/u/${login})`,
  ].join(" ");

  return html`<section class="animate-rise [animation-delay:180ms]"
    aria-labelledby="card-heading"
  >
    ${sectionHeadingHtml("for your readme", { headingId: "card-heading" })}
    <div class="grid grid-cols-2 items-center gap-6 max-phone:grid-cols-1">
      <img
        class="block h-auto w-full max-w-[416px] rounded-[12px]"
        src="${cardPath}"
        alt="The ${login} contribution card"
        width="416"
        height="252"
      />
      ${snippetRowHtml("card-snippet", cardSnippet)}
    </div>
    <div class="mt-6 grid grid-cols-2 items-center gap-6 border-t border-line-soft pt-6 max-phone:grid-cols-1">
      <div class="flex flex-wrap items-center gap-2">
        <img class="block h-5 w-auto" src="${yearPath}" alt="Contributions this year" height="20" />
        <img class="block h-5 w-auto" src="${allPath}" alt="Contributions all time" height="20" />
        <img class="block h-5 w-auto" src="${streakPath}" alt="Current streak" height="20" />
      </div>
      ${snippetRowHtml("badge-snippet", badgeSnippet)}
    </div>
    <p class="mt-4 text-meta text-muted">
      GitHub proxies and caches README images, so a card or badge there can lag this page by a few
      hours.
    </p>
  </section>`;
}

function followingHtml(user: AllTimeUser): Html | null {
  if (user.followers === null) return null;
  return html`<p class="mt-1.5 wrap-sep text-meta text-muted">
    <span>${formatNumber(user.followers ?? 0)} followers</span
    ><span>${formatNumber(user.following ?? 0)} following</span>
  </p>`;
}

function careerLedgerFields(
  user: AllTimeUser,
  best: PeakYear | null,
  allRank: number | null,
  today: string,
): LedgerField[] {
  const fields: LedgerField[] = [];
  if (best) {
    fields.push({
      term: "best year",
      body: html`<p>
        <strong class="${LEDGER_FIGURE}">${formatNumber(best.count)}</strong> contributions in
        ${best.year}
      </p>`,
    });
  }
  if (allRank) {
    fields.push({
      term: "standing",
      body: html`<p>${formatOrdinal(allRank)} on the all-time board</p>`,
    });
  }
  if (!user.createdAt) return fields;

  // On the day itself the anniversary is the more interesting half, so it
  // takes the same slot the age normally holds.
  const cakeDay = cakeDayYears(user.createdAt, today);
  const age = cakeDay ?? yearsOnGitHub(user.createdAt, today);
  const since =
    age > 0
      ? html` <span class="text-muted"
          >· ${formatNumber(age)} ${age === 1 ? "year" : "years"}${cakeDay
            ? " ago today"
            : " ago"}</span
        >`
      : null;
  fields.push({
    term: "joined github",
    body: html`<p>
      <strong class="${LEDGER_VALUE}">${formatDayYear(joinDay(user.createdAt))}</strong>${since}
    </p>`,
  });
  return fields;
}

interface IdentityCardOptions {
  chrome: SiteChrome;
  user: AllTimeUser;
  cells: YearCell[];
  careerFields: LedgerField[];
  leadsAllTime: boolean;
  sinceCaption: string;
}

function identityCardHtml(options: IdentityCardOptions): Html {
  const { chrome, user, cells, careerFields, leadsAllTime, sinceCaption } = options;
  return html`<section
    class="mt-page ${CARD} ${leadsAllTime ? LEAD_EDGE : "border-line-soft"}"
    aria-labelledby="user-heading"
  >
    <div class="${CARD_HEAD}">
      <a
        class="shrink-0"
        href="${user.url}"
        target="_blank"
        rel="noreferrer noopener"
        tabindex="-1"
        ><img
          class="${AVATAR} size-[72px] hover:border-accent/40 hover:saturate-100 max-phone:size-[56px]"
          src="${user.avatarUrl}"
          alt=""
          width="72"
          height="72"
      /></a>
      <div class="min-w-0 flex-1">
        <h2
          class="type-title break-words"
          id="user-heading"
        >
          <a
            class="${NAME_LINK}"
            href="${user.url}"
            target="_blank"
            rel="noreferrer noopener"
            >${user.login}</a
          >
        </h2>
        <p class="mt-1.5 text-body break-words text-secondary">${user.name ?? "—"}</p>
        ${followingHtml(user)}
      </div>
      <div
        class="ml-auto flex shrink-0 flex-col items-end text-right max-phone:ml-0 max-phone:w-full max-phone:items-start max-phone:text-left"
      >
        <span
          class="type-headline${leadsAllTime
            ? " text-accent"
            : ""}"
          >${formatNumber(user.total)}</span
        ><span
          class="mt-1.5 text-meta text-muted"
          >${sinceCaption}</span
        >
        ${allTimeMilestoneHtml(user.total)}
      </div>
    </div>
    <div class="border-t border-line-soft ${CARD_WELL}">${yearStripSvg(cells, {
    cell: 70,
    gap: 6,
    labels: true,
    podium: true,
    label: `${user.login}, year by year`,
    hrefFor: (year) => hrefForYear(year, chrome.thisYear),
  })}</div>
    ${ledgerHtml(careerFields)}
  </section>`;
}

function allTimeMilestoneHtml(total: number): Html | null {
  const target = nextMilestone(total, ALL_TIME_PERSONAL_MILESTONES);
  if (target === null) return null;
  return html`<div
    class="mt-3 w-[14rem] max-w-full text-left"
    role="group"
    aria-label="All-time contribution goal"
  >
    <p class="text-meta text-muted">
      <strong class="font-medium text-ink tabular-nums">${formatNumber(target - total)}</strong>
      to <strong class="font-medium text-ink tabular-nums">${formatNumber(target)}</strong> all time
    </p>
    <div class="mt-2">${goalRailHtml(total, target)}</div>
  </div>`;
}

function milestoneHtml(boardUser: BoardUser, goals: UserGoals | null): Html | null {
  if (!goals?.nextMilestone) return null;
  // The rail turns "next milestone at 5,000" into a distance you can see,
  // using the same determinate device as the board's own target line.
  const toGo =
    goals.toMilestone === null
      ? null
      : html` <span class="opacity-60">·</span>
          <span class="tabular-nums">${formatNumber(goals.toMilestone)} to go</span>`;
  return html`<div class="mt-3 max-w-[24rem]">
    ${goalRailHtml(boardUser.totalContributions, goals.nextMilestone)}
    <p class="mt-2 text-muted">
      next milestone at
      <strong class="${LEDGER_VALUE}">${formatNumber(goals.nextMilestone)}</strong>${toGo}
    </p>
  </div>`;
}

function rankGapHtml(goals: UserGoals | null): Html | null {
  if (goals?.above) {
    return goals.above.behind > 0
      ? html`<strong class="${LEDGER_VALUE}">${formatNumber(goals.above.behind)}</strong>
          behind <span class="text-ink">${goals.above.login}</span>`
      : html`level with <span class="text-ink">${goals.above.login}</span>`;
  }
  if (goals?.leadMargin === null || goals?.leadMargin === undefined) return null;
  return html`leads by
    <strong class="${LEDGER_VALUE}">${formatNumber(goals.leadMargin)}</strong>`;
}

interface LiveYearSectionOptions {
  dayPanel?: Html | null;
  selectedDate?: string;
  user: AllTimeUser;
  boardUser: BoardUser | null;
  grid: Grid | null;
  peak: PeakDay | null;
  goals: UserGoals | null;
  boardRank: number | null;
  year: number;
  leadsYear: boolean;
}

function liveYearSectionHtml(options: LiveYearSectionOptions): Html {
  const { user, boardUser, grid, peak, goals, boardRank, year, leadsYear } = options;
  if (!boardUser || !grid) {
    return html`<section
      class="animate-rise ${SURFACE} p-card [animation-delay:90ms]"
      aria-label="${user.login} in ${year}"
    >
      <p class="text-body text-secondary">
        No GitHub data came back for ${user.login} in ${year}.
      </p>
      ${options.dayPanel}
    </section>`;
  }

  const fields: LedgerField[] = [];
  const running = html`<p>
      <strong class="${leadsYear ? LEDGER_FIGURE_LEAD : LEDGER_FIGURE}"
        >${formatNumber(boardUser.totalContributions)}</strong
      >
      contributions
    </p>
    ${milestoneHtml(boardUser, goals)}`;
  fields.push({ term: `${year} so far`, body: running });

  if (boardRank) {
    const rankGap = rankGapHtml(goals);
    fields.push({
      term: "standing",
      body: html`<p>
        ${formatOrdinal(boardRank)} on the ${year} board${rankGap
          ? html` <span class="text-muted">—</span> ${rankGap}`
          : null}
      </p>`,
    });
  }
  fields.push({
    term: "busiest day",
    body: peak
      ? html`<p>
          <strong class="${LEDGER_VALUE}">${formatNumber(peak.count)}</strong> contributions on
          ${formatDayShort(peak.date)}
        </p>`
      : html`<p class="text-muted">no activity yet</p>`,
  });

  return html`<section
    class="${CARD} [animation-delay:90ms] ${leadsYear ? LEAD_EDGE : "border-line-soft"}"
    aria-label="${user.login} in ${year}"
  >
    <div class="${CARD_WELL}" data-day-slot>
      ${heatmapSvg(grid, {
        dayHref: (date) => `/u/${user.login}?day=${date}#year`,
        selectedDate: options.selectedDate,
        cell: 17,
        gap: 3,
        months: true,
        peakDate: peak?.date,
        label: heatmapLabel(user.login, boardUser.totalContributions, year),
      })}
    </div>
    ${options.dayPanel}
    ${ledgerHtml(fields)}
  </section>`;
}

function heatmapLabel(login: string, total: number, year: number): string {
  return `${login} made ${formatNumber(total)} contributions in ${year}`;
}

/** The day panel, measured against the heatmap cell and year total it sits
 *  beside, and tagged with both so a panel fetched on its own can tell
 *  whether it still agrees with the page it lands on. */
function dayPanelHtml(
  login: string,
  boardUser: BoardUser | null,
  grid: Grid | null,
  day: string,
  breakdown: ContributionBreakdown | null,
  year: number,
): Html {
  // The rendered grid, not the raw weeks: a date GitHub left out of the
  // calendar is still drawn, as a zero.
  const shown = grid?.flat().find((cell) => cell.date === day && cell.state === "day");
  const reconciled = breakdown && shown ? reconcileBreakdown(breakdown, shown.count) : breakdown;
  return dayBreakdownHtml(
    day,
    reconciled,
    login,
    year,
    shown && boardUser
      ? {
          cell: dayTitle(shown.count, day, "contributions"),
          year: heatmapLabel(login, boardUser.totalContributions, year),
        }
      : undefined,
  );
}

export interface DayPanelOptions {
  login: string;
  board: Board;
  day: string;
  dayBreakdown: ContributionBreakdown | null;
  /** The year in progress. */
  year: number;
  today: string;
}

/** Just the day panel of `/u/{login}?day=…`, for swapping in place: it needs
 *  the day and the board, not the year breakdown or all-time feed. */
export function dayPanelFragmentHtml(options: DayPanelOptions): string {
  const { login, board, day, year, today } = options;
  const boardUser = board.find((other) => other.login.toLowerCase() === login.toLowerCase()) ?? null;
  const grid = boardUser ? userGrid(boardUser.weeks, year, today) : null;
  return String(dayPanelHtml(login, boardUser, grid, day, options.dayBreakdown, year));
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
  const goals = boardIndex >= 0 ? userGoals(board, boardIndex) : null;

  const firstActive = years.find((y) => (user.byYear[String(y)] ?? 0) > 0) ?? null;
  /** Competition ranking across every account's all-time total. */
  const allRank =
    user.total > 0 ? allUsers.filter((other) => other.total > user.total).length + 1 : null;

  const sinceCaption = firstActive ? `contributions since ${firstActive}` : "contributions";

  /** Leading the board is worth exactly the marks a rank-1 row wears: a gold
   *  edge on the card and a gold total. The sentences stay quiet. */
  const leadsAllTime = allRank === 1;
  const leadsYear = boardRank === 1;

  /* ---- the career ledger: what the year strip above it adds up to ---- */
  const identityCard = identityCardHtml({
    chrome,
    user,
    cells,
    careerFields: careerLedgerFields(user, best, allRank, today),
    leadsAllTime,
    sinceCaption,
  });
  /* The breakdown answers to the totals this page already shows: the board's
     year and, for a day in it, that day's heatmap cell. */
  const yearBreakdown =
    options.breakdown && boardUser
      ? reconcileBreakdown(options.breakdown, boardUser.totalContributions)
      : (options.breakdown ?? null);

  /* ---- the year ledger: the running total and what it is chasing ---- */
  const liveSection = liveYearSectionHtml({
    user,
    boardUser,
    grid,
    peak,
    goals,
    boardRank,
    year,
    leadsYear,
    selectedDate: options.day,
    dayPanel: options.day
      ? dayPanelHtml(user.login, boardUser, grid, options.day, options.dayBreakdown ?? null, year)
      : null,
  });

  // Day links land on the year's heading, so the heatmap stays in view under it.
  const main = html`${identityCard}${sectionHeadingHtml(year, { id: "year" })}${liveSection}
    ${options.achievements ? recentAchievementsHtml(options.achievements) : null}
    ${sectionHeadingHtml("where contributions came from")}
    ${yearBreakdown ? breakdownHtml(yearBreakdown) : html`<p class="text-body text-muted">Breakdown unavailable right now.</p>`}
    ${options.insights ? insightsHtml(options.insights) : null}
    ${cardSectionHtml(user.login)}`;

  return pageHtml({
    chrome,
    title: user.login,
    description: `${user.login} on the ynga.tech GitHub contribution leaderboard.`,
    nav: { kind: "user" },
    alternate: `/api/users/${user.login}`,
    generatedAt: options.generatedAt,
    liveCopy: true,
    provisionalToday: true,
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
  const main = html`<section
    class="mt-page rounded-card border border-heat-3/45 bg-heat-3/8 p-card"
    role="alert"
  >
    <p class="type-subhead text-ink">
      The board didn't load.
    </p>
    <p class="mt-2 max-w-[60ch] text-body text-secondary">${message}</p>
    <a
      class="mt-4.5 ${BUTTON}"
      href=""
      >Try again</a
    >
  </section>`;
  return pageHtml({
    chrome,
    title: "error",
    description: SITE_DESCRIPTION,
    nav: null,
    liveCopy: true,
    main,
  });
}
