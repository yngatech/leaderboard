import { Show, createMemo } from "solid-js";
import type { AllTimeUser } from "../../shared/types";
import type { Thresholds, YearRanks } from "../../shared/board";
import { peakYear, userYearStrip } from "../../shared/board";
import { formatNumber, formatRank } from "../../shared/format";
import YearStrip from "./YearStrip";

export interface AllTimeRowProps {
  user: AllTimeUser;
  rank: number;
  years: number[];
  thresholds: Thresholds;
  ranks: YearRanks;
  highestTotal: number;
  highestYearTotal: number;
}

export default function AllTimeRow(props: AllTimeRowProps) {
  const cells = createMemo(() =>
    userYearStrip(props.user, props.years, props.thresholds, props.ranks),
  );
  const best = createMemo(() => peakYear(cells()));

  // Gold marks the all-time biggest total. No contributions marks nobody; exact ties all win,
  // so this compares values instead of trusting rank 1.
  const leadsTotal = createMemo(() => props.user.total > 0 && props.user.total === props.highestTotal);

  // Separate award: the biggest single year anyone on the board has posted.
  const leadsYear = createMemo(() => {
    const peak = best();
    return !!peak && props.highestYearTotal > 0 && peak.count === props.highestYearTotal;
  });

  const lead = () => props.rank === 1;

  return (
    <article
      // Below 1120px the strip drops onto a second grid row; below 720px the
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
        <Show when={props.user.followers !== null}>
          <p class="mt-[0.4rem] flex flex-wrap gap-[0.3rem] text-[0.68rem] text-dimmer">
            <span>{formatNumber(props.user.followers ?? 0)} followers</span>
            <span class="opacity-60">·</span>
            <span>{formatNumber(props.user.following ?? 0)} following</span>
          </p>
        </Show>
      </div>

      <div class="min-w-0 [grid-area:plot]">
        <YearStrip
          cells={cells()}
          cell={34}
          gap={5}
          podium
          label={`${props.user.login} made ${formatNumber(props.user.total)} contributions from ${props.years[0]} to ${props.years[props.years.length - 1]}`}
        />
      </div>

      <div class="flex flex-col items-end text-right [grid-area:score]">
        <span
          class="font-display text-2xl leading-none font-extrabold tracking-[-0.03em] tabular-nums max-phone:text-[1.2rem]"
          classList={{ "text-accent": leadsTotal() }}
        >
          {formatNumber(props.user.total)}
          <Show when={leadsTotal()}>
            <span class="sr-only"> — highest total on the board</span>
          </Show>
        </span>
        <span class="mt-[0.3rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase">
          contributions
        </span>
        <Show
          when={best()}
          fallback={<span class="mt-[0.4rem] text-[0.68rem] text-dim">no activity</span>}
        >
          {(peak) => (
            <span
              class="mt-[0.4rem] text-[0.68rem]"
              classList={{ "text-accent": leadsYear(), "text-dim": !leadsYear() }}
            >
              best {formatNumber(peak().count)} in {peak().year}
              <Show when={leadsYear()}>
                <span class="sr-only"> — highest single year on the board</span>
              </Show>
            </span>
          )}
        </Show>
      </div>
    </article>
  );
}
