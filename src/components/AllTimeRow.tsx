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
        <span class="row__total" classList={{ "row__total--best": leadsTotal() }}>
          {formatNumber(props.user.total)}
          <Show when={leadsTotal()}>
            <span class="row__award-note"> — highest total on the board</span>
          </Show>
        </span>
        <span class="row__total-label">contributions</span>
        <Show when={best()} fallback={<span class="row__peak">no activity</span>}>
          {(peak) => (
            <span class="row__peak" classList={{ "row__peak--best": leadsYear() }}>
              best {formatNumber(peak().count)} in {peak().year}
              <Show when={leadsYear()}>
                <span class="row__award-note"> — highest single year on the board</span>
              </Show>
            </span>
          )}
        </Show>
      </div>
    </article>
  );
}
