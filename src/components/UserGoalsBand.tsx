import { Show } from "solid-js";
import type { UserGoals } from "../lib/board";
import { formatNumber, formatOrdinal } from "../lib/format";
import GoalRail from "./GoalRail";

export interface UserGoalsBandProps {
  goals: UserGoals;
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
export default function UserGoalsBand(props: UserGoalsBandProps) {
  /** The total itself, recovered from the gap — no extra prop to keep in step. */
  const reached = (target: number) => target - (props.goals.toMilestone ?? 0);

  return (
    <div class="border-t border-line-soft bg-[rgba(10,12,24,0.32)] px-[1.3rem] py-[0.72rem] max-phone:px-4 max-phone:py-[0.65rem]">
      <dl class="flex flex-wrap items-center gap-x-6 gap-y-[0.55rem] font-mono text-[0.72rem] leading-tight max-phone:gap-x-[1.1rem]">
        <Show when={props.goals.nextMilestone}>
          {(target) => (
            <div class="flex items-center gap-[0.6rem]">
              <dt class={TERM}>next milestone</dt>
              <dd class="flex items-center gap-[0.6rem] text-dim">
                <span>
                  <strong class="font-medium tabular-nums text-ink">
                    {formatNumber(props.goals.toMilestone ?? 0)}
                  </strong>{" "}
                  to <span class="tabular-nums">{formatNumber(target())}</span>
                </span>
                <GoalRail value={reached(target())} target={target()} compact />
              </dd>
            </div>
          )}
        </Show>

        <Show
          when={props.goals.above}
          fallback={
            // The leader has nobody above, so the same slot measures downwards.
            <Show when={props.goals.leadMargin !== null}>
              <div class="flex items-center gap-[0.6rem]">
                <dt class={TERM}>rank gap</dt>
                <dd class="text-dim">
                  leads by{" "}
                  <strong class="font-medium tabular-nums text-ink">
                    {formatNumber(props.goals.leadMargin ?? 0)}
                  </strong>
                </dd>
              </div>
            </Show>
          }
        >
          {(above) => (
            <div class="flex min-w-0 items-center gap-[0.6rem]">
              <dt class={TERM}>rank gap</dt>
              {/* A 39-character login is legal, so let it break rather than
                  push the card past the viewport on a narrow phone. */}
              <dd class="min-w-0 break-words text-dim">
                <Show
                  when={above().behind > 0}
                  fallback={<>level with <span class="text-ink">{above().login}</span></>}
                >
                  <strong class="font-medium tabular-nums text-ink">
                    {formatNumber(above().behind)}
                  </strong>{" "}
                  behind <span class="text-ink">{above().login}</span>
                </Show>{" "}
                <span class="text-dimmer">({formatOrdinal(above().rank)})</span>
              </dd>
            </div>
          )}
        </Show>
      </dl>
    </div>
  );
}
