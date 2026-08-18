import type { AllTime, AllTimeUser, Board, ContributionWeek } from "../../shared/types.ts";
import {
  boardGoal,
  boardYearRanks,
  boardYearThresholds,
  cumulativeSeries,
  groupGrid,
  groupYearStrip,
  peakDay,
  peakYear,
  streakRun,
  userGoals,
  userGrid,
  userYearStrip,
} from "../../shared/board.ts";
import { cakeDayYears, joinDay, yearsOnGitHub } from "../../shared/cakeday.ts";
import { formatDayShort, formatDayYear, formatNumber, formatOrdinal } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { cumulativeChartHtml } from "./chart.ts";
import { MIN_PAGE_YEAR, SITE, hrefForYear, pageHtml, type SiteChrome } from "./layout.ts";
import { allTimeRowHtml, boardGoalLineHtml, goalRailHtml, userRowHtml } from "./rows.ts";
import { heatmapSvg, yearStripSvg } from "./svg.ts";

const SITE_DESCRIPTION =
  "GitHub contribution leaderboard and heatmaps for the ynga.tech friends.";

/** The big number, its caption and the goal line under it. */
function heroHtml(total: number, caption: string, extra: Html | null = null): Html {
  return html`<div>
    <p
      class="bg-[linear-gradient(96deg,var(--color-heat-4)_12%,var(--color-heat-3)_58%,var(--color-heat-2)_96%)] bg-clip-text font-display text-[clamp(3.6rem,12vw,7.5rem)] leading-[0.8] font-extrabold tracking-[-0.055em] tabular-nums text-transparent"
    >
      ${formatNumber(total)}
    </p>
    <h2
      class="mt-[0.9rem] max-w-[44ch] font-mono text-[0.8rem] leading-[1.6] font-normal text-dim"
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
          class="size-[11px] rounded-[3px] bg-heat-0 data-[level=1]:bg-heat-1 data-[level=2]:bg-heat-2 data-[level=3]:bg-heat-3 data-[level=4]:bg-heat-4"
          data-level="${level}"
        ></i>`,
    );
  const future = withFuture
    ? html`<span class="w-2" aria-hidden="true"></span
        ><i
          class="size-[11px] rounded-[3px] border border-future-line bg-transparent"
          data-state="future"
        ></i
        ><span>to come</span>`
    : null;
  return html`<div
    class="flex items-center gap-[0.32rem] tracking-[0.04em] text-dimmer"
  >
    <span>less</span>${swatches}<span>more</span>${future}
  </div>`;
}

const PLOT_PANEL =
  "overflow-x-auto rounded-2xl border border-line bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-[1.15rem] pt-4 pb-[0.9rem]";

const SECTION_RULE =
  "mt-[clamp(2.25rem,5vw,3.25rem)] mb-4 flex items-center gap-[0.85rem] text-[0.66rem] tracking-[0.2em] text-dimmer uppercase";

function sectionRuleHtml(label: string | number): Html {
  return html`<div class="${SECTION_RULE}">
    <span>${label}</span><span class="h-px flex-1 bg-line-soft" aria-hidden="true"></span>
  </div>`;
}

function missingNoteHtml(missing: string[]): Html | null {
  if (missing.length === 0) return null;
  return html`<p class="mt-[1.1rem] text-[0.7rem] leading-[1.6] text-dimmer">
    No GitHub data came back for ${missing.join(", ")}. The account may have been renamed or
    removed.
  </p>`;
}

/** The "Nothing here." card, shared by the 404 page and an unknown login. */
function nothingHereHtml(detail: string, thisYear: number): Html {
  return html`<section
    class="mt-[clamp(2.5rem,6vw,4rem)] rounded-2xl border border-line bg-panel p-[1.6rem]"
  >
    <p class="font-display text-[1.3rem] font-semibold tracking-[-0.02em] text-ink">
      Nothing here.
    </p>
    <p class="mt-2 max-w-[60ch] text-[0.78rem] leading-[1.6] text-dim">${detail}</p>
    <a
      class="mt-[1.1rem] inline-block cursor-pointer rounded-[9px] border border-accent/50 bg-transparent px-[1.1rem] py-[0.55rem] font-mono text-[0.75rem] tracking-[0.05em] text-accent no-underline transition-colors duration-200 hover:bg-accent/12"
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
    .map((user, index) =>
      userRowHtml({
        user,
        rank: index + 1,
        year,
        today,
        highestTotal: highestUserTotal,
        highestDailyTotal,
        goals: live ? userGoals(board, index) : null,
        cakeDay: live ? cakeDayYears(user.createdAt, today) : null,
      }),
    );

  /** Only the year in progress has a "so far" worth drawing. */
  const climb = live ? cumulativeSeries(board, year, today) : [];
  const chartHtml = climb.length > 0 ? cumulativeChartHtml({ series: climb, year, today }) : null;
  const hero = heroHtml(
    total,
    `contributions from ${board.length} accounts in ${year}`,
    goal ? boardGoalLineHtml(goal) : null,
  );

  const main = html`<section
      class="mt-[clamp(2.5rem,6vw,4rem)] animate-rise"
      aria-labelledby="pulse-heading"
    >
      ${hero}<div class="mt-[1.9rem] ${PLOT_PANEL}">${heatmapSvg(pulse, {
    cell: 17,
    gap: 3,
    months: true,
    unit: "contributions",
    peakDate: busiest?.date,
    label: `All ${board.length} accounts combined, day by day, in ${year}`,
  })}</div>
      <div
        class="mt-[0.9rem] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.72rem] text-dim"
      >
        ${busiestLine}${legendHtml(live)}
      </div>
    </section>
    ${sectionRuleHtml("the board")}
    <main class="flex flex-col gap-[0.6rem]">${rowsHtml}</main>
    ${missingNoteHtml(options.missing)}${chartHtml}`;

  return pageHtml({
    chrome,
    title: String(year),
    description: SITE_DESCRIPTION,
    nav: { kind: "year", year },
    alternate: `/api/board?year=${year}`,
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
      class="mt-[clamp(2.5rem,6vw,4rem)] animate-rise"
      aria-labelledby="pulse-heading"
    >
      ${hero}<div class="mt-[1.9rem] ${PLOT_PANEL}">${yearStripSvg(pulse, {
    cell: 70,
    gap: 6,
    labels: true,
    label: `All ${users.length} accounts combined, year by year, ${span}`,
    hrefFor: (year) => hrefForYear(year, chrome.thisYear),
  })}</div>
      <div
        class="mt-[0.9rem] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.72rem] text-dim"
      >
        ${bestLine}${legendHtml(false)}
      </div>
    </section>
    ${sectionRuleHtml("the board")}
    <main class="flex flex-col gap-[0.6rem]">${rowsHtml}</main>
    ${missingNoteHtml(options.missing)}`;

  return pageHtml({
    chrome,
    title: "all time",
    description: SITE_DESCRIPTION,
    nav: { kind: "all" },
    alternate: "/api/all",
    generatedAt: options.generatedAt,
    liveCopy: true,
    main,
  });
}

/* ---------------------------------------------------------------------------
   The account page's furniture.

   A profile is one of the board's rows grown to page scale: identity and
   career total on top, the plot in its recessed well, and a ledger welded
   along the bottom edge where every number that qualifies the plot above it
   lives. Because the ledger is part of the card rather than loose text beside
   it, no statistic can drift off on its own — and because it borrows the row
   goals band's tint, hairline and term type, the page still reads as board
   furniture rather than a dashboard.
--------------------------------------------------------------------------- */

/** The card shell. Border colour is chosen per chapter: gold marks a leader,
 *  exactly as it does on a rank-1 row. */
const CARD = "animate-rise overflow-hidden rounded-2xl border bg-panel";

/** Register one: who this is, and the number the whole card is about. */
const CARD_HEAD =
  "flex flex-wrap items-center gap-x-5 gap-y-4 px-[1.3rem] py-[1.25rem] max-phone:gap-x-4 max-phone:px-4 max-phone:py-4";

/** Register two: the plot, recessed into the card and still free to scroll.
 *  The hairline above it is added only where a head sits on top. */
const CARD_WELL =
  "overflow-x-auto bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-[1.3rem] pt-4 pb-[0.9rem] max-phone:px-4";

/** Register three: the ledger, a shade under the well like a row's goals band. */
const CARD_LEDGER =
  "border-t border-line-soft bg-[rgba(10,12,24,0.32)] px-[1.3rem] py-[1rem] max-phone:px-4 max-phone:py-[0.85rem]";

/** Same term type as the row goals band, so the two are one idiom. */
const LEDGER_TERM = "text-[0.6rem] tracking-[0.16em] text-dimmer uppercase";

/** The hairline between fields: vertical while they sit side by side, and
 *  horizontal once a phone stacks them. */
const LEDGER_RULE =
  "border-l border-line-soft pl-5 max-phone:border-t max-phone:border-l-0 max-phone:pt-[0.75rem] max-phone:pl-0";

const LEDGER_GRID = "grid gap-x-5 gap-y-[0.75rem] font-mono text-[0.74rem] leading-[1.55]";

/** One figure per ledger anchors it; the rest of the band stays sentence-sized. */
const LEDGER_FIGURE =
  "font-display text-[1.5rem] leading-none font-extrabold tracking-[-0.03em] tabular-nums text-ink max-phone:text-[1.35rem]";
const LEDGER_FIGURE_LEAD =
  "font-display text-[1.5rem] leading-none font-extrabold tracking-[-0.03em] tabular-nums text-accent max-phone:text-[1.35rem]";

/** A number that qualifies another number: milestone, margin, peak. */
const LEDGER_VALUE = "font-medium tabular-nums text-ink";

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
          <dd class="mt-[0.45rem] min-w-0 break-words text-dim">${field.body}</dd>
        </div>`,
    );
  return html`<div class="${CARD_LEDGER}">
    <dl class="${LEDGER_GRID} ${ledgerColumns(fields.length)}">${items}</dl>
  </div>`;
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
  /** The account's daily data from the year before, so a streak that crossed
   *  31 December keeps counting. Omitted or null when the year or feed is
   *  missing. */
  priorWeeks?: ContributionWeek[] | null;
}

/**
 * The card, and the line to paste to get it. The snippet wraps the image in a
 * link back here, because a card in a README is the only part of this board a
 * stranger ever sees.
 *
 * The preview is the live SVG rather than a mock-up of one: if the route is
 * broken, this section is where it shows, not in somebody's profile.
 */
function cardSectionHtml(login: string): Html {
  const path = `/u/${login}.svg`;
  // The preview is same-origin so a preview deployment shows its own card
  // rather than production's; the snippet has to be absolute, since it is read
  // somewhere that has never heard of this site.
  const snippet = `[![${login} on the ynga git board](${SITE}${path})](${SITE}/u/${login})`;

  return html`<section class="mt-[clamp(2rem,5vw,3rem)] ${CARD} border-line-soft [animation-delay:180ms]"
    aria-labelledby="card-heading"
  >
    <div class="px-[1.3rem] pt-[1.25rem] max-phone:px-4">
      <h2 class="${LEDGER_TERM}" id="card-heading">card for your readme</h2>
      <img
        class="mt-[0.9rem] block h-auto w-full max-w-[416px] rounded-[12px]"
        src="${path}"
        alt="The ${login} contribution card"
        width="416"
        height="252"
      />
    </div>
    <div class="${CARD_LEDGER} mt-[1.1rem] flex items-start gap-3 max-phone:flex-wrap">
      <code
        class="min-w-0 flex-1 overflow-x-auto font-mono text-[0.68rem] leading-[1.7] break-all whitespace-pre-wrap text-dim"
        id="card-snippet"
        >${snippet}</code
      >
      <button
        class="shrink-0 cursor-pointer rounded-[9px] border border-line px-[0.8rem] py-[0.4rem] font-mono text-[0.66rem] tracking-[0.08em] text-dim transition-colors duration-200 hover:border-accent/50 hover:text-accent"
        data-copy="card-snippet"
        hidden
      >
        copy
      </button>
    </div>
    <p class="px-[1.3rem] pb-[1.15rem] text-[0.68rem] leading-[1.6] text-dimmer max-phone:px-4">
      GitHub proxies and caches README images, so a card there can lag this page by a few hours.
    </p>
  </section>`;
}

export function userPageHtml(options: UserPageOptions): string {
  const { chrome, user, board, allUsers, years, year, today, priorWeeks } = options;

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

  /** The run still alive today, crossing the year boundary when it has to. */
  const streak = streakRun(
    [
      ...(priorWeeks ? [{ year: year - 1, weeks: priorWeeks }] : []),
      ...(boardUser ? [{ year, weeks: boardUser.weeks }] : []),
    ],
    today,
  ).days;

  const follows =
    user.followers !== null
      ? html`<p class="mt-[0.4rem] text-[0.7rem] text-dimmer">
          <span>${formatNumber(user.followers ?? 0)} followers</span
          ><span class="opacity-60">·</span
          ><span>${formatNumber(user.following ?? 0)} following</span
          >${streak > 1
            ? html`<span class="opacity-60">·</span
                ><span>${formatNumber(streak)}-day streak</span>`
            : null}
        </p>`
      : null;

  const sinceCaption = firstActive ? `contributions since ${firstActive}` : "contributions";

  /** Leading the board is worth exactly the marks a rank-1 row wears: a gold
   *  edge on the card and a gold total. The sentences stay quiet. */
  const leadsAllTime = allRank === 1;
  const leadsYear = boardRank === 1;

  /* ---- the career ledger: what the year strip above it adds up to ---- */
  const careerFields: LedgerField[] = [];
  if (best) {
    careerFields.push({
      term: "best year",
      body: html`<p>
        <strong class="${LEDGER_FIGURE}">${formatNumber(best.count)}</strong> contributions in
        ${best.year}
      </p>`,
    });
  }
  if (allRank) {
    careerFields.push({
      term: "standing",
      body: html`<p>${formatOrdinal(allRank)} on the all-time board</p>`,
    });
  }
  if (user.createdAt) {
    // On the day itself the anniversary is the more interesting half, so it
    // takes the same slot the age normally holds.
    const cakeDay = cakeDayYears(user.createdAt, today);
    const age = cakeDay ?? yearsOnGitHub(user.createdAt, today);
    const since =
      age > 0
        ? html` <span class="text-dimmer"
            >· ${formatNumber(age)} ${age === 1 ? "year" : "years"}${cakeDay
              ? " ago today"
              : " ago"}</span
          >`
        : null;
    careerFields.push({
      term: "joined github",
      body: html`<p>
        <strong class="${LEDGER_VALUE}">${formatDayYear(joinDay(user.createdAt))}</strong>${since}
      </p>`,
    });
  }

  const identityCard = html`<section
    class="mt-[clamp(2.5rem,6vw,4rem)] ${CARD} ${leadsAllTime
      ? "border-accent/32"
      : "border-line-soft"}"
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
          class="size-[72px] rounded-2xl border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200 hover:border-accent/40 hover:saturate-100 max-phone:size-[56px]"
          src="${user.avatarUrl}"
          alt=""
          width="72"
          height="72"
      /></a>
      <div class="min-w-0 flex-1">
        <h2
          class="font-display text-[clamp(1.6rem,4.5vw,2.2rem)] leading-[1.05] font-extrabold tracking-[-0.03em] break-words"
          id="user-heading"
        >
          <a
            class="text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[4px]"
            href="${user.url}"
            target="_blank"
            rel="noreferrer noopener"
            >${user.login}</a
          >
        </h2>
        <p class="mt-[0.35rem] text-[0.78rem] break-words text-dim">${user.name ?? "—"}</p>
        ${follows}
      </div>
      <div
        class="ml-auto flex shrink-0 flex-col items-end text-right max-phone:ml-0 max-phone:w-full max-phone:items-start max-phone:text-left"
      >
        <span
          class="font-display text-[clamp(2.2rem,7vw,3.2rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums${leadsAllTime
            ? " text-accent"
            : ""}"
          >${formatNumber(user.total)}</span
        ><span
          class="mt-[0.35rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase"
          >${sinceCaption}</span
        >
      </div>
    </div>
    <div class="border-t border-line-soft ${CARD_WELL}">${yearStripSvg(cells, {
    cell: 70,
    gap: 6,
    labels: true,
    podium: true,
    label: `${user.login}, year by year`,
    hrefFor: (y) => hrefForYear(y, chrome.thisYear),
  })}</div>
    ${ledgerHtml(careerFields)}
  </section>`;

  let liveSection: Html;
  if (boardUser && grid) {
    /* ---- the year ledger: the running total and what it is chasing ---- */
    const liveFields: LedgerField[] = [];

    let milestone: Html | null = null;
    if (goals?.nextMilestone) {
      // The rail turns "next milestone at 5,000" into a distance you can see,
      // using the same determinate device as the board's own target line.
      const toGo =
        goals.toMilestone === null
          ? null
          : html` <span class="opacity-60">·</span>
              <span class="tabular-nums">${formatNumber(goals.toMilestone)} to go</span>`;
      milestone = html`<div class="mt-[0.7rem] max-w-[24rem]">
        ${goalRailHtml(boardUser.totalContributions, goals.nextMilestone)}
        <p class="mt-[0.5rem] text-dimmer">
          next milestone at
          <strong class="${LEDGER_VALUE}">${formatNumber(goals.nextMilestone)}</strong>${toGo}
        </p>
      </div>`;
    }
    const running = html`<p>
        <strong class="${leadsYear ? LEDGER_FIGURE_LEAD : LEDGER_FIGURE}"
          >${formatNumber(boardUser.totalContributions)}</strong
        >
        contributions
      </p>
      ${milestone}`;
    liveFields.push({ term: `${year} so far`, body: running });

    let rankGap: Html | null = null;
    if (goals?.above) {
      rankGap =
        goals.above.behind > 0
          ? html`<strong class="${LEDGER_VALUE}">${formatNumber(goals.above.behind)}</strong>
              behind <span class="text-ink">${goals.above.login}</span>`
          : html`level with <span class="text-ink">${goals.above.login}</span>`;
    } else if (goals?.leadMargin !== null && goals?.leadMargin !== undefined) {
      rankGap = html`leads by
        <strong class="${LEDGER_VALUE}">${formatNumber(goals.leadMargin)}</strong>`;
    }
    if (boardRank) {
      liveFields.push({
        term: "standing",
        body: html`<p>
          ${formatOrdinal(boardRank)} on the ${year} board${rankGap
            ? html` <span class="text-dimmer">—</span> ${rankGap}`
            : null}
        </p>`,
      });
    }

    liveFields.push({
      term: "busiest day",
      body: peak
        ? html`<p>
            <strong class="${LEDGER_VALUE}">${formatNumber(peak.count)}</strong> contributions on
            ${formatDayShort(peak.date)}
          </p>`
        : html`<p class="text-dimmer">no activity yet</p>`,
    });

    liveSection = html`<section
      class="${CARD} [animation-delay:90ms] ${leadsYear
        ? "border-accent/32"
        : "border-line-soft"}"
      aria-label="${user.login} in ${year}"
    >
      <div class="${CARD_WELL}">${heatmapSvg(grid, {
      cell: 17,
      gap: 3,
      months: true,
      peakDate: peak?.date,
      label: `${user.login} made ${formatNumber(boardUser.totalContributions)} contributions in ${year}`,
    })}</div>
      ${ledgerHtml(liveFields)}
    </section>`;
  } else {
    liveSection = html`<section
      class="animate-rise rounded-2xl border border-line-soft bg-panel px-[1.3rem] py-[1.15rem] [animation-delay:90ms] max-phone:px-4"
      aria-label="${user.login} in ${year}"
    >
      <p class="text-[0.78rem] leading-[1.6] text-dim">
        No GitHub data came back for ${user.login} in ${year}.
      </p>
    </section>`;
  }

  const main = html`${identityCard}${sectionRuleHtml(year)}${liveSection}${cardSectionHtml(
    user.login,
  )}`;

  return pageHtml({
    chrome,
    title: user.login,
    description: `${user.login} on the ynga.tech GitHub contribution leaderboard.`,
    nav: { kind: "user" },
    alternate: `/api/users/${user.login}`,
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
  const main = html`<section
    class="mt-[clamp(2.5rem,6vw,4rem)] rounded-2xl border border-heat-3/45 bg-heat-3/8 p-[1.6rem]"
    role="alert"
  >
    <p class="font-display text-[1.3rem] font-semibold tracking-[-0.02em] text-ink">
      The board didn't load.
    </p>
    <p class="mt-2 max-w-[60ch] text-[0.78rem] leading-[1.6] text-dim">${message}</p>
    <a
      class="mt-[1.1rem] inline-block cursor-pointer rounded-[9px] border border-accent/50 bg-transparent px-[1.1rem] py-[0.55rem] font-mono text-[0.75rem] tracking-[0.05em] text-accent no-underline transition-colors duration-200 hover:bg-accent/12"
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
