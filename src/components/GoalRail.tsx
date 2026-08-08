export interface GoalRailProps {
  /** Where the account, or the board, currently stands. */
  value: number;
  /** The number being walked towards. Zero or less draws an empty rail. */
  target: number;
  /** Row scale: a short hairline rather than the hero's full-width rule. */
  compact?: boolean;
}

/**
 * One determinate rule, drawn at two scales so a board goal and a personal one
 * read as the same kind of fact.
 *
 * The ramp is sized to the whole track rather than to the filled part, so the
 * colour itself carries the distance covered: an early total sits in the cold
 * violet and a nearly finished one arrives at ember. Gold is left out on
 * purpose — on this board it means leader, not progress.
 */
export default function GoalRail(props: GoalRailProps) {
  const fraction = () =>
    props.target > 0 ? Math.min(1, Math.max(0, props.value / props.target)) : 0;

  return (
    <span
      class="block overflow-hidden rounded-full bg-heat-0"
      classList={{
        "h-[3px] w-full": !props.compact,
        "h-[2px] w-16 max-phone:w-12": props.compact,
      }}
      // The numbers either side of the rail already say all of this.
      aria-hidden="true"
    >
      <span
        class="block h-full rounded-full bg-[linear-gradient(90deg,var(--color-heat-1)_0%,var(--color-heat-2)_62%,var(--color-heat-3)_100%)] bg-left bg-no-repeat transition-[width] duration-500"
        style={{
          width: `${(fraction() * 100).toFixed(2)}%`,
          // Stretch the ramp back out over the full track: the fill is
          // `fraction` of the track, so the gradient is 1/fraction of the fill.
          "background-size": `${fraction() > 0 ? (100 / fraction()).toFixed(2) : 100}% 100%`,
        }}
      />
    </span>
  );
}
