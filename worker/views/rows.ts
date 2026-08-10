import type { AllTimeUser, BoardUser } from "../../shared/types.ts";
import type { BoardGoal, Thresholds, UserGoals, YearRanks } from "../../shared/board.ts";
import { peakDay, peakYear, userGrid, userYearStrip } from "../../shared/board.ts";
import { formatDayShort, formatNumber, formatOrdinal, formatRank } from "../../shared/format.ts";
import { attr, escapeHtml } from "../html.ts";
import { heatmapSvg, yearStripSvg } from "./svg.ts";

/* ---------------------------------------------------------------------------
   The board's row cards and goal furniture, once components, now plain
   template functions. Class lists are verbatim string literals throughout so
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
export function goalRailHtml(value: number, target: number, compact = false): string {
  const fraction = target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
  const scale = compact ? "h-[2px] w-16 max-phone:w-12" : "h-[3px] w-full";
  // Stretch the ramp back out over the full track: the fill is `fraction` of
  // the track, so the gradient is 1/fraction of the fill.
  const size = fraction > 0 ? (100 / fraction).toFixed(2) : "100";
  // The numbers either side of the rail already say all of this.
  return `<span class="block overflow-hidden rounded-full bg-heat-0 ${scale}" aria-hidden="true"><span class="block h-full rounded-full bg-[linear-gradient(90deg,var(--color-heat-1)_0%,var(--color-heat-2)_62%,var(--color-heat-3)_100%)] bg-left bg-no-repeat transition-[width] duration-500" style="width:${(fraction * 100).toFixed(2)}%;background-size:${size}% 100%"></span></span>`;
}

/**
 * The next round number the board is walking towards, under the year's running
 * total. Deliberately quiet and deliberately short: the giant figure above is
 * the headline, and this only says how much of the walk is left. Past the top
 * of the ladder there is nothing to aim at, so nothing is drawn.
 */
export function boardGoalLineHtml(goal: BoardGoal): string {
  if (goal.nextMilestone === null) return "";
  return `<div class="mt-[1.15rem] max-w-[30rem]"><div class="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 font-mono text-[0.74rem]"><p class="text-dim"><span class="text-[0.6rem] tracking-[0.18em] text-dimmer uppercase">next board target</span> <span class="tabular-nums text-ink">${formatNumber(goal.total)}</span> of <span class="tabular-nums">${formatNumber(goal.nextMilestone)}</span></p><p class="tabular-nums text-dimmer">${formatNumber(goal.remaining ?? 0)} to go</p></div><div class="mt-[0.6rem]">${goalRailHtml(goal.total, goal.nextMilestone)}</div></div>`;
}

/**
 * Whether a set of goals has anything to unfold. An account past the top of
 * the milestone ladder, alone on the board, has nothing forward-looking to
 * say — better no affordance at all than an empty band.
 */
export function hasGoals(goals: UserGoals): boolean {
  return goals.nextMilestone !== null || goals.above !== null || goals.leadMargin !== null;
}

/** Shared by both facts, so the two labels can never drift apart. */
const TERM = "text-[0.6rem] tracking-[0.16em] text-dimmer uppercase";

/**
 * The sub-strip under a row: what this account is walking towards, and how far
 * it is from the account above. It sits a shade darker than the card so it
 * reads as part of the row rather than a second card inside it.
 */
export function userGoalsBandHtml(goals: UserGoals): string {
  const parts: string[] = [];

  if (goals.nextMilestone !== null) {
    /** The total itself, recovered from the gap — no extra prop to keep in step. */
    const reached = goals.nextMilestone - (goals.toMilestone ?? 0);
    parts.push(
      `<div class="flex items-center gap-[0.6rem]"><dt class="${TERM}">next milestone</dt><dd class="flex items-center gap-[0.6rem] text-dim"><span><strong class="font-medium tabular-nums text-ink">${formatNumber(goals.toMilestone ?? 0)}</strong> to <span class="tabular-nums">${formatNumber(goals.nextMilestone)}</span></span>${goalRailHtml(reached, goals.nextMilestone, true)}</dd></div>`,
    );
  }

  if (goals.above) {
    const above = goals.above;
    // A 39-character login is legal, so let it break rather than push the
    // card past the viewport on a narrow phone.
    const gap =
      above.behind > 0
        ? `<strong class="font-medium tabular-nums text-ink">${formatNumber(above.behind)}</strong> behind <span class="text-ink">${escapeHtml(above.login)}</span>`
        : `level with <span class="text-ink">${escapeHtml(above.login)}</span>`;
    parts.push(
      `<div class="flex min-w-0 items-center gap-[0.6rem]"><dt class="${TERM}">rank gap</dt><dd class="min-w-0 break-words text-dim">${gap} <span class="text-dimmer">(${formatOrdinal(above.rank)})</span></dd></div>`,
    );
  } else if (goals.leadMargin !== null) {
    // The leader has nobody above, so the same slot measures downwards.
    parts.push(
      `<div class="flex items-center gap-[0.6rem]"><dt class="${TERM}">rank gap</dt><dd class="text-dim">leads by <strong class="font-medium tabular-nums text-ink">${formatNumber(goals.leadMargin)}</strong></dd></div>`,
    );
  }

  return `<div class="border-t border-line-soft bg-[rgba(10,12,24,0.32)] px-[1.3rem] py-[0.72rem] max-phone:px-4 max-phone:py-[0.65rem]"><dl class="flex flex-wrap items-center gap-x-6 gap-y-[0.55rem] font-mono text-[0.72rem] leading-tight max-phone:gap-x-[1.1rem]">${parts.join("")}</dl></div>`;
}

export interface UserRowOptions {
  user: BoardUser;
  rank: number;
  year: number;
  today: string;
  highestTotal: number;
  highestDailyTotal: number;
  /**
   * Forward-looking goals, which only the year in progress has. A finished
   * year passes nothing and the row renders exactly as it always did: no
   * chevron, no disclosure, no band.
   */
  goals?: UserGoals | null;
}

/** The identity, plot and score cells shared by open and plain rows. */
function userRowBody(options: UserRowOptions, withChevron: boolean): string {
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

  const lead = rank === 1;

  // The affordance lives in the rank column's spare height, so it costs the
  // row nothing. Never gold: it is not a leader mark.
  const chevron = withChevron
    ? `<svg class="block h-auto w-[9px] text-dimmer transition-[color,rotate] duration-200 group-hover:text-dim group-open:rotate-180" viewBox="0 0 10 6" fill="none"><path d="M1 1.25 5 4.75 9 1.25" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`
    : "";

  const score = peak
    ? `<span class="mt-[0.4rem] text-[0.68rem] ${leadsPeak ? "text-accent" : "text-dim"}">peak ${formatNumber(peak.count)} on ${formatDayShort(peak.date)}${leadsPeak ? '<span class="sr-only"> — highest single day on the board</span>' : ""}</span>`
    : `<span class="mt-[0.4rem] text-[0.68rem] text-dim">no activity</span>`;

  return `<div class="flex flex-col items-start gap-[0.3rem] text-[0.78rem] tracking-[0.06em] [grid-area:rank] ${lead ? "text-accent" : "text-dimmer"}" aria-hidden="true"><span>${formatRank(rank)}</span>${chevron}</div><a class="relative [grid-area:avatar]" href="${attr(profileHref)}" tabindex="-1"><img class="size-[52px] rounded-[13px] border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200 group-hover:border-accent/40 group-hover:saturate-100 max-phone:size-[42px] max-phone:rounded-[11px]" src="${attr(user.avatarUrl)}" alt="" width="52" height="52" loading="lazy"></a><div class="min-w-0 [grid-area:id]"><div class="flex min-w-0 items-center gap-[0.35rem]"><a class="relative font-display text-[1.08rem] font-semibold tracking-[-0.015em] text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[3px]" href="${attr(profileHref)}">${escapeHtml(user.login)}</a></div><p class="mt-[0.15rem] text-[0.74rem] text-dim">${escapeHtml(user.name ?? "—")}</p><p class="mt-[0.4rem] flex flex-wrap gap-[0.3rem] text-[0.68rem] text-dimmer"><span>${formatNumber(user.followers)} followers</span><span class="opacity-60">·</span><span>${formatNumber(user.following)} following</span></p></div><div class="min-w-0 phone:relative [grid-area:plot]">${heatmapSvg(grid, {
    cell: 8,
    gap: 2,
    // Stars the busiest day. An all-zero year has no peak, so no star.
    peakDate: peak?.date,
    label: `${user.login} made ${formatNumber(user.totalContributions)} contributions in ${year}`,
  })}</div><div class="flex flex-col items-end text-right [grid-area:score]"><span class="font-display text-2xl leading-none font-extrabold tracking-[-0.03em] tabular-nums max-phone:text-[1.2rem] ${leadsTotal ? "text-accent" : ""}">${formatNumber(user.totalContributions)}${leadsTotal ? '<span class="sr-only"> — highest total on the board</span>' : ""}</span><span class="mt-[0.3rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase">contributions</span>${score}</div>`;
}

/** The grid layout the row's cells sit in; shared by both row variants. */
const ROW_GRID =
  "grid grid-cols-[2rem_52px_minmax(150px,1fr)_auto_8rem] items-center gap-5 px-[1.3rem] py-4 [grid-template-areas:'rank_avatar_id_plot_score'] max-wide:grid-cols-[2rem_52px_minmax(0,1fr)_auto] max-wide:gap-y-4 max-wide:[grid-template-areas:'rank_avatar_id_score'_'plot_plot_plot_plot'] max-phone:grid-cols-[1.6rem_42px_minmax(0,1fr)_auto] max-phone:gap-x-[0.9rem] max-phone:gap-y-[0.9rem] max-phone:px-4 max-phone:py-[0.9rem]";

/** The card shell: border, background and the staggered entrance. */
const ROW_CARD =
  "group animate-rise-row rounded-2xl border bg-panel transition-colors duration-200 [animation-delay:calc(var(--i,0)*45ms)] hover:border-line hover:bg-panel-hover";

export function userRowHtml(options: UserRowOptions): string {
  const lead = options.rank === 1;
  const border = lead ? "border-accent/32" : "border-line-soft";

  /** Null whenever there is nothing to unfold, which is what gates the whole
   *  disclosure: the summary, the chevron and the band all key off it. */
  const goals = options.goals && hasGoals(options.goals) ? options.goals : null;

  if (!goals) {
    return `<article class="${ROW_CARD} ${border}" style="--i:${options.rank}"><div class="relative ${ROW_GRID}">${userRowBody(options, false)}</div></article>`;
  }

  // The whole row is the toggle: it is the <summary>, so the target is as big
  // as the card and needs no script. Links and the plot carry `relative` (or
  // `phone:relative`) so they paint above it and keep their own pointer.
  return `<details class="${ROW_CARD} ${border}" style="--i:${options.rank}"><summary class="relative list-none cursor-pointer [&::-webkit-details-marker]:hidden focus-visible:rounded-2xl ${ROW_GRID}">${userRowBody(options, true)}</summary><div class="overflow-hidden rounded-b-[15px]">${userGoalsBandHtml(goals)}</div></details>`;
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

export function allTimeRowHtml(options: AllTimeRowOptions): string {
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
      ? `<p class="mt-[0.4rem] flex flex-wrap gap-[0.3rem] text-[0.68rem] text-dimmer"><span>${formatNumber(user.followers ?? 0)} followers</span><span class="opacity-60">·</span><span>${formatNumber(user.following ?? 0)} following</span></p>`
      : "";

  const score = best
    ? `<span class="mt-[0.4rem] text-[0.68rem] ${leadsYear ? "text-accent" : "text-dim"}">best ${formatNumber(best.count)} in ${best.year}${leadsYear ? '<span class="sr-only"> — highest single year on the board</span>' : ""}</span>`
    : `<span class="mt-[0.4rem] text-[0.68rem] text-dim">no activity</span>`;

  return `<article class="${ROW_CARD} ${lead ? "border-accent/32" : "border-line-soft"} ${ROW_GRID}" style="--i:${rank}"><div class="text-[0.78rem] tracking-[0.06em] [grid-area:rank] ${lead ? "text-accent" : "text-dimmer"}" aria-hidden="true">${formatRank(rank)}</div><a class="[grid-area:avatar]" href="${attr(profileHref)}" tabindex="-1"><img class="size-[52px] rounded-[13px] border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200 group-hover:border-accent/40 group-hover:saturate-100 max-phone:size-[42px] max-phone:rounded-[11px]" src="${attr(user.avatarUrl)}" alt="" width="52" height="52" loading="lazy"></a><div class="min-w-0 [grid-area:id]"><div class="flex min-w-0 items-center gap-[0.35rem]"><a class="font-display text-[1.08rem] font-semibold tracking-[-0.015em] text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[3px]" href="${attr(profileHref)}">${escapeHtml(user.login)}</a></div><p class="mt-[0.15rem] text-[0.74rem] text-dim">${escapeHtml(user.name ?? "—")}</p>${follows}</div><div class="min-w-0 [grid-area:plot]">${yearStripSvg(cells, {
    cell: 34,
    gap: 5,
    podium: true,
    label: `${user.login} made ${formatNumber(user.total)} contributions from ${years[0]} to ${years[years.length - 1]}`,
  })}</div><div class="flex flex-col items-end text-right [grid-area:score]"><span class="font-display text-2xl leading-none font-extrabold tracking-[-0.03em] tabular-nums max-phone:text-[1.2rem] ${leadsTotal ? "text-accent" : ""}">${formatNumber(user.total)}${leadsTotal ? '<span class="sr-only"> — highest total on the board</span>' : ""}</span><span class="mt-[0.3rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase">contributions</span>${score}</div></article>`;
}
