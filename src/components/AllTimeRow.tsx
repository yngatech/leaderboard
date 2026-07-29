import { Show, createMemo } from "solid-js";
import type { AllTimeUser } from "../../shared/types";
import type { Thresholds, YearRanks } from "../lib/board";
import { peakYear, userYearStrip } from "../lib/board";
import { formatNumber } from "../lib/format";
import YearStrip from "./YearStrip";

export interface AllTimeRowProps {
  user: AllTimeUser;
  rank: number;
  years: number[];
  thresholds: Thresholds;
  ranks: YearRanks;
}

export default function AllTimeRow(props: AllTimeRowProps) {
  const cells = createMemo(() =>
    userYearStrip(props.user, props.years, props.thresholds, props.ranks),
  );
  const best = createMemo(() => peakYear(cells()));

  return (
    <article class="row" classList={{ "row--lead": props.rank === 1 }} style={{ "--i": props.rank }}>
      <div class="row__rank" aria-hidden="true">
        {String(props.rank).padStart(2, "0")}
      </div>

      <a class="row__avatar" href={props.user.url} target="_blank" rel="noreferrer noopener" tabindex="-1">
        <img src={props.user.avatarUrl} alt="" width="52" height="52" loading="lazy" />
      </a>

      <div class="row__id">
        <a class="row__login" href={props.user.url} target="_blank" rel="noreferrer noopener">
          {props.user.login}
        </a>
        <p class="row__name">{props.user.name ?? "—"}</p>
        <Show when={props.user.followers !== null}>
          <p class="row__meta">
            <span>{formatNumber(props.user.followers ?? 0)} followers</span>
            <span class="row__dot">·</span>
            <span>{formatNumber(props.user.following ?? 0)} following</span>
          </p>
        </Show>
      </div>

      <div class="row__plot row__plot--years">
        <YearStrip
          cells={cells()}
          cell={34}
          gap={5}
          podium
          label={`${props.user.login} made ${formatNumber(props.user.total)} contributions from ${props.years[0]} to ${props.years[props.years.length - 1]}`}
        />
      </div>

      <div class="row__score">
        <span class="row__total">{formatNumber(props.user.total)}</span>
        <span class="row__total-label">contributions</span>
        <Show when={best()} fallback={<span class="row__peak">no activity</span>}>
          {(peak) => (
            <span class="row__peak">
              best {formatNumber(peak().count)} in {peak().year}
            </span>
          )}
        </Show>
      </div>
    </article>
  );
}
