import { Show, createMemo } from "solid-js";
import type { AllTimeUser, BoardUser } from "../../shared/types";
import {
  boardYearRanks,
  boardYearThresholds,
  peakDay,
  peakYear,
  userGrid,
  userYearStrip,
} from "../lib/board";
import { formatDayShort, formatNumber, formatOrdinal, type FirstDayOfWeek } from "../lib/format";
import Heatmap from "./Heatmap";
import YearStrip from "./YearStrip";

export interface UserPageProps {
  /** The account's all-time record; the page's source of truth. */
  user: AllTimeUser;
  /** The account's entry on the live-year board, if GitHub reported one. */
  boardUser: BoardUser | null;
  /** 1-based position on the live-year board. */
  boardRank: number | null;
  boardSize: number;
  allUsers: AllTimeUser[];
  years: number[];
  /** The year in progress. */
  year: number;
  today: string;
  firstDay: FirstDayOfWeek;
  onYearClick: (year: number) => void;
}

export default function UserPage(props: UserPageProps) {
  const thresholds = createMemo(() => boardYearThresholds(props.allUsers));
  const ranks = createMemo(() => boardYearRanks(props.allUsers, props.years));
  const cells = createMemo(() => userYearStrip(props.user, props.years, thresholds(), ranks()));
  const best = createMemo(() => peakYear(cells()));

  const grid = createMemo(() => {
    const boardUser = props.boardUser;
    return boardUser ? userGrid(boardUser.weeks, props.year, props.today, props.firstDay) : null;
  });
  const peak = createMemo(() => {
    const current = grid();
    return current ? peakDay(current) : null;
  });

  const firstActive = createMemo(
    () => props.years.find((year) => (props.user.byYear[String(year)] ?? 0) > 0) ?? null,
  );
  /** Competition ranking across every account's all-time total. */
  const allRank = createMemo(() =>
    props.user.total > 0
      ? props.allUsers.filter((other) => other.total > props.user.total).length + 1
      : null,
  );

  return (
    <>
      <section class="mt-[clamp(2.5rem,6vw,4rem)] animate-rise" aria-labelledby="user-heading">
        <div class="flex flex-wrap items-center gap-5">
          <a href={props.user.url} target="_blank" rel="noreferrer noopener" tabindex="-1">
            <img
              class="size-[72px] rounded-2xl border border-line bg-heat-0 saturate-[0.85] transition-[filter,border-color] duration-200 hover:border-accent/40 hover:saturate-100 max-phone:size-[56px]"
              src={props.user.avatarUrl}
              alt=""
              width="72"
              height="72"
            />
          </a>

          <div class="min-w-0">
            <a
              class="font-display text-[clamp(1.6rem,4.5vw,2.2rem)] leading-none font-extrabold tracking-[-0.03em] text-ink no-underline hover:text-accent hover:underline hover:underline-offset-[4px]"
              href={props.user.url}
              target="_blank"
              rel="noreferrer noopener"
              id="user-heading"
            >
              {props.user.login}
            </a>
            <p class="mt-[0.35rem] text-[0.78rem] text-dim">{props.user.name ?? "—"}</p>
            <Show when={props.user.followers !== null}>
              <p class="mt-[0.4rem] flex flex-wrap gap-[0.3rem] text-[0.7rem] text-dimmer">
                <span>{formatNumber(props.user.followers ?? 0)} followers</span>
                <span class="opacity-60">·</span>
                <span>{formatNumber(props.user.following ?? 0)} following</span>
              </p>
            </Show>
          </div>

          <div class="ml-auto flex flex-col items-end text-right max-phone:ml-0 max-phone:w-full max-phone:items-start max-phone:text-left">
            <span class="font-display text-[clamp(2.2rem,7vw,3.2rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
              {formatNumber(props.user.total)}
            </span>
            <span class="mt-[0.35rem] text-[0.62rem] tracking-[0.12em] text-dimmer uppercase">
              <Show when={firstActive()} fallback={<>contributions</>}>
                {(year) => <>contributions since {year()}</>}
              </Show>
            </span>
            <Show when={allRank()}>
              {(rank) => (
                <span class="mt-[0.4rem] text-[0.68rem] text-dim">
                  {formatOrdinal(rank())} of {props.allUsers.length} all time
                </span>
              )}
            </Show>
          </div>
        </div>

        <div class="mt-[1.9rem] overflow-x-auto rounded-2xl border border-line bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-[1.15rem] pt-4 pb-[0.9rem]">
          <YearStrip
            cells={cells()}
            cell={70}
            gap={6}
            labels
            podium
            label={`${props.user.login}, year by year`}
            onYearClick={props.onYearClick}
          />
        </div>

        <Show when={best()}>
          {(peakOfYears) => (
            <p class="mt-[0.9rem] text-[0.72rem] text-dim">
              Best year:{" "}
              <strong class="font-medium text-ink">{formatNumber(peakOfYears().count)}</strong>{" "}
              contributions in {peakOfYears().year}
            </p>
          )}
        </Show>
      </section>

      <div class="mt-[clamp(2.25rem,5vw,3.25rem)] mb-4 flex items-center gap-[0.85rem] text-[0.66rem] tracking-[0.2em] text-dimmer uppercase">
        <span>{props.year}</span>
        <span class="h-px flex-1 bg-line-soft" aria-hidden="true" />
      </div>

      <Show
        when={props.boardUser}
        fallback={
          <p class="text-[0.78rem] leading-[1.6] text-dim">
            No GitHub data came back for {props.user.login} in {props.year}.
          </p>
        }
      >
        {(boardUser) => (
          <section aria-label={`${props.user.login} in ${props.year}`}>
            <div class="overflow-x-auto rounded-2xl border border-line bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-[1.15rem] pt-4 pb-[0.9rem]">
              <Heatmap
                weeks={grid()!}
                cell={17}
                gap={3}
                months
                firstDay={props.firstDay}
                peakDate={peak()?.date}
                label={`${props.user.login} made ${formatNumber(boardUser().totalContributions)} contributions in ${props.year}`}
              />
            </div>

            <div class="mt-[0.9rem] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.72rem] text-dim">
              <p>
                <strong class="font-medium text-ink">
                  {formatNumber(boardUser().totalContributions)}
                </strong>{" "}
                contributions
                <Show when={props.boardRank}>
                  {(rank) => (
                    <>
                      {" "}
                      · {formatOrdinal(rank())} of {props.boardSize} this year
                    </>
                  )}
                </Show>
              </p>
              <Show when={peak()}>
                {(day) => (
                  <p>
                    Busiest day:{" "}
                    <strong class="font-medium text-ink">{formatNumber(day().count)}</strong>{" "}
                    contributions on {formatDayShort(day().date)}
                  </p>
                )}
              </Show>
            </div>
          </section>
        )}
      </Show>
    </>
  );
}
