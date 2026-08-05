import { Show, createMemo } from "solid-js";
import type { BoardUser } from "../../shared/types";
import { peakDay, userGrid } from "../lib/board";
import { formatDayShort, formatNumber } from "../lib/format";
import Heatmap from "./Heatmap";

export interface UserRowProps {
  user: BoardUser;
  rank: number;
  year: number;
  today: string;
  highestTotal: number;
  highestDailyTotal: number;
}

export default function UserRow(props: UserRowProps) {
  const grid = createMemo(() => userGrid(props.user.weeks, props.year, props.today));
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

  return (
    <article class="row" classList={{ "row--lead": props.rank === 1 }} style={{ "--i": props.rank }}>
      <div class="row__rank" aria-hidden="true">
        {String(props.rank).padStart(2, "0")}
      </div>

      <a class="row__avatar" href={props.user.url} target="_blank" rel="noreferrer noopener" tabindex="-1">
        <img src={props.user.avatarUrl} alt="" width="52" height="52" loading="lazy" />
      </a>

      <div class="row__id">
        <div class="row__title">
          <a class="row__login" href={props.user.url} target="_blank" rel="noreferrer noopener">
            {props.user.login}
          </a>
        </div>
        <p class="row__name">{props.user.name ?? "—"}</p>
        <p class="row__meta">
          <span>{formatNumber(props.user.followers)} followers</span>
          <span class="row__dot">·</span>
          <span>{formatNumber(props.user.following)} following</span>
        </p>
      </div>

      <div class="row__plot">
        <Heatmap
          weeks={grid()}
          cell={8}
          gap={2}
          // Stars the busiest day. An all-zero year has no peak, so no star.
          peakDate={peak()?.date}
          label={`${props.user.login} made ${formatNumber(props.user.totalContributions)} contributions in ${props.year}`}
        />
      </div>

      <div class="row__score">
        <span class="row__total" classList={{ "row__total--best": leadsTotal() }}>
          {formatNumber(props.user.totalContributions)}
          <Show when={leadsTotal()}>
            <span class="row__award-note"> — highest total on the board</span>
          </Show>
        </span>
        <span class="row__total-label">contributions</span>
        <Show when={peak()} fallback={<span class="row__peak">no activity</span>}>
          {(best) => (
            <span class="row__peak" classList={{ "row__peak--best": leadsPeak() }}>
              peak {formatNumber(best().count)} on {formatDayShort(best().date)}
              <Show when={leadsPeak()}>
                <span class="row__award-note"> — highest single day on the board</span>
              </Show>
            </span>
          )}
        </Show>
      </div>
    </article>
  );
}
