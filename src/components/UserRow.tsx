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
}

export default function UserRow(props: UserRowProps) {
  const grid = createMemo(() => userGrid(props.user.weeks, props.year, props.today));
  const peak = createMemo(() => peakDay(grid()));

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
          {/* An all-zero year crowns nobody. */}
          <Show when={props.rank === 1 && props.user.totalContributions > 0}>
            <span class="row__crown" aria-hidden="true">
              👑
            </span>
          </Show>
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
          label={`${props.user.login} made ${formatNumber(props.user.totalContributions)} contributions in ${props.year}`}
        />
      </div>

      <div class="row__score">
        <span class="row__total">{formatNumber(props.user.totalContributions)}</span>
        <span class="row__total-label">contributions</span>
        <Show when={peak()} fallback={<span class="row__peak">no activity</span>}>
          {(best) => (
            <span class="row__peak">
              peak {formatNumber(best().count)} on {formatDayShort(best().date)}
            </span>
          )}
        </Show>
      </div>
    </article>
  );
}
