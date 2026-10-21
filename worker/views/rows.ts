import type { AllTimeUser, BoardUser } from "../../shared/types.ts";
import type { BoardGoal, Thresholds, YearRanks } from "../../shared/board.ts";
import { peakDay, peakYear, userGrid, userYearStrip } from "../../shared/board.ts";
import { formatDayShort, formatNumber, formatRank } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { heatmapSvg, yearStripSvg } from "./svg.ts";

/* ---------------------------------------------------------------------------
   The board's row cards and goal furniture. Class lists are verbatim string
   literals throughout so
   the Tailwind scanner sees every utility.
--------------------------------------------------------------------------- */

/**
 * One determinate rule, drawn at two scales so a board goal and a personal one
 * read as the same kind of fact.
 *
 * The ramp is sized to the whole track rather than to the filled part, so the
 * colour itself carries the distance covered: an early total sits in the cold
 * violet and a nearly finished one arrives at ember. Gold is left out on
 * purpose — on this board it means leader, not progress.
 */
export function goalRailHtml(value: number, target: number, compact = false): Html {
  const fraction = target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
  const scale = compact ? "h-[2px] w-16 max-phone:w-12" : "h-[3px] w-full";
  // Stretch the ramp back out over the full track: the fill is `fraction` of
  // the track, so the gradient is 1/fraction of the fill.
  const size = fraction > 0 ? (100 / fraction).toFixed(2) : "100";
  // The numbers either side of the rail already say all of this.
  return html`<span
    class="block overflow-hidden rounded-full bg-heat-0 ${scale}"
    aria-hidden="true"
    ><span
      class="block h-full rounded-full bg-[linear-gradient(90deg,var(--color-heat-1)_0%,var(--color-heat-2)_62%,var(--color-heat-3)_100%)] bg-left bg-no-repeat transition-[width] duration-500"
      style="width:${(fraction * 100).toFixed(2)}%;background-size:${size}% 100%"
    ></span
  ></span>`;
}

/**
 * The next round number the board is walking towards, under the year's running
 * total. Deliberately quiet and deliberately short: the giant figure above is
 * the headline, and this only says how much of the walk is left. Past the top
 * of the ladder there is nothing to aim at, so nothing is drawn.
 */
export function boardGoalLineHtml(goal: BoardGoal): Html | null {
  if (goal.nextMilestone === null) return null;
  return html`<div class="mt-[1.15rem] max-w-[30rem]">
    <div
      class="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 font-mono text-[0.74rem]"
    >
      <p class="text-dim">
        <span class="text-[0.6rem] tracking-[0.18em] text-dimmer uppercase"
          >next board target</span
        >
        <span class="tabular-nums text-ink">${formatNumber(goal.total)}</span> of
        <span class="tabular-nums">${formatNumber(goal.nextMilestone)}</span>
      </p>
      <p class="tabular-nums text-dimmer">${formatNumber(goal.remaining ?? 0)} to go</p>
    </div>
    <div class="mt-[0.6rem]">${goalRailHtml(goal.total, goal.nextMilestone)}</div>
  </div>`;
}

/**
 * The margin between two neighbouring rows, centred on a hairline in the gap
 * between them: it belongs to the pair rather than to either row. Live years
 * only, like the rest of the board's forward-looking furniture. Neighbours on
 * the same total get no line: the matching totals already say so.
 */
export function rowGapHtml(above: BoardUser, below: BoardUser): Html | null {
  const margin = above.totalContributions - below.totalContributions;
  if (margin === 0) return null;
  const label = `${formatNumber(margin)} ahead`;
  const spoken = `${above.login} leads ${below.login} by ${formatNumber(margin)}`;
  return html`<div
    class="-my-[0.1rem] flex items-center gap-3 px-[1.3rem] font-mono text-[0.66rem] text-dimmer max-phone:px-4"
  >
    <span class="h-px flex-1 bg-line-soft" aria-hidden="true"></span
    ><span class="tabular-nums" aria-hidden="true">${label}</span
    ><span class="sr-only">${spoken}</span
    ><span class="h-px flex-1 bg-line-soft" aria-hidden="true"></span>
  </div>`;
}

export interface UserRowOptions {
  user: BoardUser;
  rank: number;
  year: number;
  today: string;
  highestTotal: number;
  highestDailyTotal: number;
  /** Years on GitHub when today is the anniversary; live years only, like the goals. */
  cakeDay?: number | null;
  /** Consecutive contributing days still alive; live years only. A finished
   *  year passes nothing, because a board that cached for a month has no
   *  business asserting what today is. */
  currentStreak?: number | null;
}

/** The identity, plot and score cells of one row. */
function userRowBody(options: UserRowOptions): Html {
  const { user, rank, year, today } = options;
  const profileHref = `/u/${encodeURIComponent(user.login)}`;
  const grid = userGrid(user.weeks, year, today);
  const peak = peakDay(grid);

  // Gold marks the year's biggest total. An all-zero year marks nobody; exact
  // ties all win, so this compares values instead of trusting rank 1.
  const leadsTotal =
    user.totalContributions > 0 && user.totalContributions === options.highestTotal;

  // Separate award: the single busiest day across the board.
  const leadsPeak =
    !!peak && options.highestDailyTotal > 0 && peak.count === options.highestDailyTotal;

  const cakeYears = options.cakeDay
    ? `${formatNumber(options.cakeDay)} ${options.cakeDay === 1 ? "year" : "years"}`
    : null;

  /** Both halves are hidden and respoken as one sentence: a flex gap is not
   *  spacing a screen reader can hear. */
  const cakeDay = cakeYears
    ? html`<span
        class="flex shrink-0 items-center gap-[0.4rem] rounded-full border border-heat-2/70 bg-heat-2/32 px-[0.6rem] py-[0.25rem] text-[0.7rem] text-ink"
        ><span class="text-[0.85rem] leading-none" aria-hidden="true">🎂</span
        ><span class="tabular-nums" aria-hidden="true">${cakeYears}</span
        ><span class="sr-only">cake day — ${cakeYears} on GitHub today</span
        ></span
      >`
    : null;

  const score = peak
    ? html`<span
        class="mt-[0.4rem] text-[0.68rem] ${leadsPeak ? "text-accent" : "text-dim"}"
        >peak ${formatNumber(peak.count)} on ${formatDayShort(peak.date)}${leadsPeak
          ? html`<span class="sr-only"> — highest single day on the board</span>`
          : null}</span
      >`
    : html`<span class="mt-[0.4rem] text-[0.68rem] text-dim">no activity</span>`;

  return html`${rankHtml(rank)}
    <a class="[grid-area:avatar]" href="${profileHref}" tabindex="-1"
      ><img
        class="size-[52px] rounded-[13px] border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200 group-hover:border-accent/40 group-hover:saturate-100 max-phone:size-[42px] max-phone:rounded-[11px]"
        src="${user.avatarUrl}"
        alt=""
        width="52"
        height="52"
        loading="lazy"
    /></a>
    <div class="min-w-0 [grid-area:id]">
      <div class="flex min-w-0 items-center gap-[0.7rem]">
        <a
          class="font-display text-[1.08rem] font-semibold tracking-[-0.015em] text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[3px]"
          href="${profileHref}"
          >${user.login}</a
        >${cakeDay}
      </div>
      <p class="mt-[0.15rem] text-[0.74rem] text-dim">${user.name ?? "—"}</p>
<p class="mt-[0.4rem] wrap-sep text-[0.68rem] text-dimmer">
        <span>${formatNumber(user.followers)} followers</span
        ><span>${formatNumber(user.following)} following</span
        >${options.currentStreak && options.currentStreak > 1
          ? html`<span>${formatNumber(options.currentStreak)}-day streak</span>`
          : null}
      </p>
    </div>
    <div class="min-w-0 [grid-area:plot]">${heatmapSvg(grid, {
    // Each day opens that day's breakdown on the account page.
    dayHref: (date) => `${profileHref}?day=${date}#year`,
    cell: 8,
    gap: 2,
    // Stars the busiest day. An all-zero year has no peak, so no star.
    peakDate: peak?.date,
    label: `${user.login} made ${formatNumber(user.totalContributions)} contributions in ${year}`,
  })}</div>
    <div class="flex flex-col items-end text-right [grid-area:score]">
      <span
        class="font-display text-2xl leading-none font-extrabold tracking-[-0.03em] tabular-nums max-phone:text-[1.2rem] ${leadsTotal
          ? "text-accent"
          : ""}"
        >${formatNumber(user.totalContributions)}${leadsTotal
          ? html`<span class="sr-only"> — highest total on the board</span>`
          : null}</span
      ><span class="mt-[0.3rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase"
        >contributions</span
      >${score}
    </div>`;
}

/** The rank in the display face: gold for the leader, bright for the podium. */
function rankHtml(rank: number): Html {
  const tone = rank === 1 ? "text-accent" : rank <= 3 ? "text-ink" : "text-dimmer";
  return html`<div
    class="font-display text-[1.15rem] font-extrabold tracking-[-0.03em] tabular-nums [grid-area:rank] max-phone:text-[0.95rem] ${tone}"
    aria-hidden="true"
  >
    ${formatRank(rank)}
  </div>`;
}

/** The grid layout the row's cells sit in; shared by the year and all-time rows. */
const ROW_GRID =
  "grid grid-cols-[2.5rem_52px_minmax(150px,1fr)_auto_8rem] items-center gap-5 px-[1.3rem] py-4 [grid-template-areas:'rank_avatar_id_plot_score'] max-wide:grid-cols-[2.5rem_52px_minmax(0,1fr)_auto] max-wide:gap-y-4 max-wide:[grid-template-areas:'rank_avatar_id_score'_'plot_plot_plot_plot'] max-phone:grid-cols-[2rem_42px_minmax(0,1fr)_auto] max-phone:gap-x-[0.9rem] max-phone:gap-y-[0.9rem] max-phone:px-4 max-phone:py-[0.9rem]";

/** The card shell: border, background and the staggered entrance. */
const ROW_CARD =
  "group animate-rise-row rounded-2xl border bg-panel transition-colors duration-200 [animation-delay:calc(var(--i,0)*45ms)] hover:border-line hover:bg-panel-hover";

export function userRowHtml(options: UserRowOptions): Html {
  const border = options.rank === 1 ? "border-accent/32" : "border-line-soft";
  return html`<article class="${ROW_CARD} ${border} ${ROW_GRID}" style="--i:${options.rank}">
    ${userRowBody(options)}
  </article>`;
}

export interface AllTimeRowOptions {
  user: AllTimeUser;
  rank: number;
  years: number[];
  thresholds: Thresholds;
  ranks: YearRanks;
  highestTotal: number;
  highestYearTotal: number;
}

export function allTimeRowHtml(options: AllTimeRowOptions): Html {
  const { user, rank, years } = options;
  const profileHref = `/u/${encodeURIComponent(user.login)}`;
  const cells = userYearStrip(user, years, options.thresholds, options.ranks);
  const best = peakYear(cells);

  // Gold marks the all-time biggest total. No contributions marks nobody;
  // exact ties all win, so this compares values instead of trusting rank 1.
  const leadsTotal = user.total > 0 && user.total === options.highestTotal;

  // Separate award: the biggest single year anyone on the board has posted.
  const leadsYear = !!best && options.highestYearTotal > 0 && best.count === options.highestYearTotal;

  const lead = rank === 1;

  const follows =
    user.followers !== null
      ? html`<p class="mt-[0.4rem] wrap-sep text-[0.68rem] text-dimmer">
          <span>${formatNumber(user.followers ?? 0)} followers</span
          ><span>${formatNumber(user.following ?? 0)} following</span>
        </p>`
      : null;

  const score = best
    ? html`<span
        class="mt-[0.4rem] text-[0.68rem] ${leadsYear ? "text-accent" : "text-dim"}"
        >best ${formatNumber(best.count)} in ${best.year}${leadsYear
          ? html`<span class="sr-only"> — highest single year on the board</span>`
          : null}</span
      >`
    : html`<span class="mt-[0.4rem] text-[0.68rem] text-dim">no activity</span>`;

  return html`<article
    class="${ROW_CARD} ${lead ? "border-accent/32" : "border-line-soft"} ${ROW_GRID}"
    style="--i:${rank}"
  >
    ${rankHtml(rank)}
    <a class="[grid-area:avatar]" href="${profileHref}" tabindex="-1"
      ><img
        class="size-[52px] rounded-[13px] border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200 group-hover:border-accent/40 group-hover:saturate-100 max-phone:size-[42px] max-phone:rounded-[11px]"
        src="${user.avatarUrl}"
        alt=""
        width="52"
        height="52"
        loading="lazy"
    /></a>
    <div class="min-w-0 [grid-area:id]">
      <div class="flex min-w-0 items-center gap-[0.35rem]">
        <a
          class="font-display text-[1.08rem] font-semibold tracking-[-0.015em] text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[3px]"
          href="${profileHref}"
          >${user.login}</a
        >
      </div>
      <p class="mt-[0.15rem] text-[0.74rem] text-dim">${user.name ?? "—"}</p>
      ${follows}
    </div>
    <div class="min-w-0 [grid-area:plot]">${yearStripSvg(cells, {
    cell: 34,
    gap: 5,
    podium: true,
    label: `${user.login} made ${formatNumber(user.total)} contributions from ${years[0]} to ${years[years.length - 1]}`,
  })}</div>
    <div class="flex flex-col items-end text-right [grid-area:score]">
      <span
        class="font-display text-2xl leading-none font-extrabold tracking-[-0.03em] tabular-nums max-phone:text-[1.2rem] ${leadsTotal
          ? "text-accent"
          : ""}"
        >${formatNumber(user.total)}${leadsTotal
          ? html`<span class="sr-only"> — highest total on the board</span>`
          : null}</span
      ><span class="mt-[0.3rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase"
        >contributions</span
      >${score}
    </div>
  </article>`;
}
