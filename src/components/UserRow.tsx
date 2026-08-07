import { Show, createMemo } from "solid-js";
import type { BoardUser } from "../../shared/types";
import { peakDay, userGrid } from "../lib/board";
import {
  formatDayShort,
  formatNumber,
  formatRank,
  type FirstDayOfWeek,
} from "../lib/format";
import Heatmap from "./Heatmap";

export interface UserRowProps {
  user: BoardUser;
  rank: number;
  year: number;
  today: string;
  firstDay: FirstDayOfWeek;
  highestTotal: number;
  highestDailyTotal: number;
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

  return (
    <article
      // Below 1120px the plot drops onto a second grid row; below 720px the
      // whole card tightens up. Rows rise in with a stagger keyed off --i.
      class="group grid animate-rise-row grid-cols-[2rem_52px_minmax(150px,1fr)_auto_8rem] items-center gap-5 rounded-2xl border bg-panel px-[1.3rem] py-4 transition-colors duration-200 [animation-delay:calc(var(--i,0)*45ms)] [grid-template-areas:'rank_avatar_id_plot_score'] hover:border-line hover:bg-panel-hover max-wide:grid-cols-[2rem_52px_minmax(0,1fr)_auto] max-wide:gap-y-4 max-wide:[grid-template-areas:'rank_avatar_id_score'_'plot_plot_plot_plot'] max-phone:grid-cols-[1.6rem_42px_minmax(0,1fr)_auto] max-phone:gap-x-[0.9rem] max-phone:gap-y-[0.9rem] max-phone:px-4 max-phone:py-[0.9rem]"
      classList={{ "border-accent/32": lead(), "border-line-soft": !lead() }}
      style={{ "--i": props.rank }}
    >
      <div
        class="text-[0.78rem] tracking-[0.06em] [grid-area:rank]"
        classList={{ "text-accent": lead(), "text-dimmer": !lead() }}
        aria-hidden="true"
      >
        {formatRank(props.rank)}
      </div>

      <a
        class="[grid-area:avatar]"
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
            class="font-display text-[1.08rem] font-semibold tracking-[-0.015em] text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[3px]"
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

      <div class="min-w-0 [grid-area:plot]">
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
    </article>
  );
}
