/**
 * Milestone ladders shared by the worker's Discord notifications and the
 * client's goals UI, so the two can never disagree about what a goal is.
 */
export const PERSONAL_MILESTONES = [
  100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000,
  7000, 7500, 8000, 9000, 10000, 11000, 12000, 12500, 13000, 14000, 15000,
  17500, 20000, 22500, 25000, 30000, 40000, 50000, 75000, 100000,
];
/** Original yearly ladder, retained so pending notifications survive its expansion. */
export const LEGACY_PERSONAL_MILESTONES = [
  100, 250, 500, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000,
];
export const BOARD_MILESTONES = [
  1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000, 100000,
];

/** The highest threshold reached, or 0 before the first rung. */
export function milestoneFor(total: number, thresholds: number[]): number {
  let milestone = 0;
  for (const threshold of thresholds) {
    if (total < threshold) break;
    milestone = threshold;
  }
  return milestone;
}

/** The next threshold above the total, or null past the top of the ladder. */
export function nextMilestone(total: number, thresholds: number[]): number | null {
  for (const threshold of thresholds) {
    if (total < threshold) return threshold;
  }
  return null;
}
