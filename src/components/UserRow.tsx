import { Show, createMemo, createSignal, createUniqueId } from "solid-js";
import type { BoardUser } from "../../shared/types";
import { peakDay, userGrid, type UserGoals } from "../../shared/board";
import {
  formatDayShort,
  formatNumber,
  formatRank,
  type FirstDayOfWeek,
} from "../../shared/format";
import Heatmap from "./Heatmap";
import UserGoalsBand, { hasGoals } from "./UserGoalsBand";

export interface UserRowProps {
  user: BoardUser;
  rank: number;
  year: number;
  today: string;
  firstDay: FirstDayOfWeek;
  highestTotal: number;
  highestDailyTotal: number;
  /**
   * Forward-looking goals, which only the year in progress has. A finished
   * year passes nothing and the row renders exactly as it always did: no
   * chevron, no button, no band.
   */
  goals?: UserGoals | null;
}

export default function UserRow(props: UserRowProps) {
  const grid = createMemo(() =>
    userGrid(props.user.weeks, props.year, props.today, props.firstDay),
  );
  const peak = createMemo(() => peakDay(grid()));

  // Gold marks the year's biggest total. An all-zero year marks nobody; exact ties all win,
  // so this compares values instead of trusting rank 1.
  const leadsTotal = createMemo(
    () =>
      props.user.totalContributions > 0 &&
      props.user.totalContributions === props.highestTotal,
  );

  // Separate award: the single busiest day across the board.
  const leadsPeak = createMemo(() => {
    const best = peak();
    return !!best && props.highestDailyTotal > 0 && best.count === props.highestDailyTotal;
  });

  const lead = () => props.rank === 1;

  /** Null whenever there is nothing to unfold, which is what gates the whole
   *  disclosure: the button, the chevron and the band all key off it. */
  const goals = createMemo(() => {
    const current = props.goals;
    return current && hasGoals(current) ? current : null;
  });

  const [open, setOpen] = createSignal(false);
  const bandId = createUniqueId();

  return (
    <article
      // The card itself: border, background and the staggered entrance. The
      // strip inside keeps the grid, so an unfolded band can sit under it
      // without an empty track holding a gap open when it is closed.
      class="group animate-rise-row rounded-2xl border bg-panel transition-colors duration-200 [animation-delay:calc(var(--i,0)*45ms)] hover:border-line hover:bg-panel-hover"
      classList={{ "border-accent/32": lead(), "border-line-soft": !lead() }}
      // One source of truth for the unfold: the chevron and the band both read it.
      data-open={goals() ? (open() ? "true" : "false") : undefined}
      style={{ "--i": props.rank }}
    >
      <div
        // Below 1120px the plot drops onto a second grid row; below 720px the
        // whole card tightens up.
        class="relative grid grid-cols-[2rem_52px_minmax(150px,1fr)_auto_8rem] items-center gap-5 px-[1.3rem] py-4 [grid-template-areas:'rank_avatar_id_plot_score'] max-wide:grid-cols-[2rem_52px_minmax(0,1fr)_auto] max-wide:gap-y-4 max-wide:[grid-template-areas:'rank_avatar_id_score'_'plot_plot_plot_plot'] max-phone:grid-cols-[1.6rem_42px_minmax(0,1fr)_auto] max-phone:gap-x-[0.9rem] max-phone:gap-y-[0.9rem] max-phone:px-4 max-phone:py-[0.9rem]"
      >
        {/* The whole strip is the toggle, so the target is as big as the row.
            It is laid over the strip rather than wrapped round it, which keeps
            the grid exactly as it was; anything that has its own job — the two
            links, the plot and its per-day tooltips — is given `relative`
            below, so it paints over this button and keeps its own pointer. */}
        <Show when={goals()}>
          <button
            class="absolute inset-0 cursor-pointer focus-visible:rounded-2xl"
            type="button"
            aria-expanded={open()}
            aria-controls={bandId}
            aria-label={`Goals for ${props.user.login}`}
            onClick={() => setOpen((was) => !was)}
          />
        </Show>

        <div
          class="flex flex-col items-start gap-[0.3rem] text-[0.78rem] tracking-[0.06em] [grid-area:rank]"
          classList={{ "text-accent": lead(), "text-dimmer": !lead() }}
          aria-hidden="true"
        >
          <span>{formatRank(props.rank)}</span>
          {/* The affordance lives in the rank column's spare height, so it
              costs the row nothing. Never gold: it is not a leader mark. */}
          <Show when={goals()}>
            <svg
              // `rotate-180` sets the rotate property, not transform, so the
              // transition has to name it.
              class="block h-auto w-[9px] text-dimmer transition-[color,rotate] duration-200 group-hover:text-dim group-data-[open=true]:rotate-180"
              viewBox="0 0 10 6"
              fill="none"
            >
              <path
                d="M1 1.25 5 4.75 9 1.25"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </Show>
        </div>

        <a
          class="relative [grid-area:avatar]"
          href={props.user.url}
          target="_blank"
          rel="noreferrer noopener"
          tabindex="-1"
        >
          <img
            class="size-[52px] rounded-[13px] border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200 group-hover:border-accent/40 group-hover:saturate-100 max-phone:size-[42px] max-phone:rounded-[11px]"
            src={props.user.avatarUrl}
            alt=""
            width="52"
            height="52"
            loading="lazy"
          />
        </a>

        <div class="min-w-0 [grid-area:id]">
          <div class="flex min-w-0 items-center gap-[0.35rem]">
            <a
              class="relative font-display text-[1.08rem] font-semibold tracking-[-0.015em] text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[3px]"
              href={props.user.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {props.user.login}
            </a>
          </div>
          <p class="mt-[0.15rem] text-[0.74rem] text-dim">{props.user.name ?? "—"}</p>
          <p class="mt-[0.4rem] flex flex-wrap gap-[0.3rem] text-[0.68rem] text-dimmer">
            <span>{formatNumber(props.user.followers)} followers</span>
            <span class="opacity-60">·</span>
            <span>{formatNumber(props.user.following)} following</span>
          </p>
        </div>

        {/* Raised above the toggle only where a pointer exists, so day
            tooltips survive on desktop while a phone can tap the whole card. */}
        <div class="min-w-0 phone:relative [grid-area:plot]">
          <Heatmap
            weeks={grid()}
            cell={8}
            gap={2}
            firstDay={props.firstDay}
            // Stars the busiest day. An all-zero year has no peak, so no star.
            peakDate={peak()?.date}
            label={`${props.user.login} made ${formatNumber(props.user.totalContributions)} contributions in ${props.year}`}
          />
        </div>

        <div class="flex flex-col items-end text-right [grid-area:score]">
          <span
            class="font-display text-2xl leading-none font-extrabold tracking-[-0.03em] tabular-nums max-phone:text-[1.2rem]"
            classList={{ "text-accent": leadsTotal() }}
          >
            {formatNumber(props.user.totalContributions)}
            <Show when={leadsTotal()}>
              <span class="sr-only"> — highest total on the board</span>
            </Show>
          </span>
          <span class="mt-[0.3rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase">
            contributions
          </span>
          <Show
            when={peak()}
            fallback={<span class="mt-[0.4rem] text-[0.68rem] text-dim">no activity</span>}
          >
            {(best) => (
              <span
                class="mt-[0.4rem] text-[0.68rem]"
                classList={{ "text-accent": leadsPeak(), "text-dim": !leadsPeak() }}
              >
                peak {formatNumber(best().count)} on {formatDayShort(best().date)}
                <Show when={leadsPeak()}>
                  <span class="sr-only"> — highest single day on the board</span>
                </Show>
              </span>
            )}
          </Show>
        </div>
      </div>

      {/* The unfold is a grid row growing from 0fr to 1fr, so the band opens to
          whatever height its own text needs and adds nothing while closed.
          The document's reduced-motion switch already flattens the timing. */}
      <Show when={goals()}>
        {(current) => (
          <div
            class="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 group-data-[open=true]:grid-rows-[1fr]"
            id={bandId}
            // Nothing in here is focusable, but a zero-height region is still
            // read out, so hide it until it is actually open.
            aria-hidden={!open()}
          >
            <div class="overflow-hidden rounded-b-[15px] opacity-0 transition-opacity duration-200 group-data-[open=true]:opacity-100">
              <UserGoalsBand goals={current()} />
            </div>
          </div>
        )}
      </Show>
    </article>
  );
}
