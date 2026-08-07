export type Thresholds = [number, number, number];

export function quartiles(values: number[]): Thresholds {
  const sorted = values.filter((n) => n > 0).sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return [at(0.25), at(0.5), at(0.75)];
}

export function levelFor(count: number, thresholds: Thresholds): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}
