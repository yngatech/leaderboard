import { Show } from "solid-js";
import type { BoardGoal } from "../../shared/board";
import { formatNumber } from "../../shared/format";
import GoalRail from "./GoalRail";

export interface BoardGoalLineProps {
  goal: BoardGoal;
}

/**
 * The next round number the board is walking towards, under the year's running
 * total. Deliberately quiet and deliberately short: the giant figure above is
 * the headline, and this only says how much of the walk is left. Past the top
 * of the ladder there is nothing to aim at, so nothing is drawn.
 */
export default function BoardGoalLine(props: BoardGoalLineProps) {
  return (
    <Show when={props.goal.nextMilestone}>
      {(target) => (
        <div class="mt-[1.15rem] max-w-[30rem]">
          <div class="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 font-mono text-[0.74rem]">
            <p class="text-dim">
              <span class="text-[0.6rem] tracking-[0.18em] text-dimmer uppercase">
                next board target
              </span>{" "}
              <span class="tabular-nums text-ink">{formatNumber(props.goal.total)}</span> of{" "}
              <span class="tabular-nums">{formatNumber(target())}</span>
            </p>
            {/* Remaining is only ever null when there is no target, and there
                is a target inside this branch. */}
            <p class="tabular-nums text-dimmer">{formatNumber(props.goal.remaining ?? 0)} to go</p>
          </div>

          <div class="mt-[0.6rem]">
            <GoalRail value={props.goal.total} target={target()} />
          </div>
        </div>
      )}
    </Show>
  );
}
