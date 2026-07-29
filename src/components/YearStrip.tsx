import { For, Show, createMemo } from "solid-js";
import type { YearCell } from "../lib/board";
import { formatNumber, formatOrdinal } from "../lib/format";

export interface YearStripProps {
  cells: YearCell[];
  /** Square edge in px at 1:1. The SVG scales down below that. */
  cell?: number;
  gap?: number;
  /** Print the year above each cell. */
  labels?: boolean;
  /** Print 1, 2, 3 inside the cells that placed that year. */
  podium?: boolean;
  /** Accessible summary of the strip. */
  label: string;
}

const LABEL_BAND = 17;
const PODIUM = 3;

/** The all-time counterpart to Heatmap: one row, one cell per year. */
export default function YearStrip(props: YearStripProps) {
  const cell = () => props.cell ?? 30;
  const gap = () => props.gap ?? 4;
  const pitch = () => cell() + gap();
  const top = () => (props.labels ? LABEL_BAND : 0);

  const width = createMemo(() => Math.max(0, props.cells.length * pitch() - gap()));
  const height = createMemo(() => cell() + top());

  const tooltip = (item: YearCell) => {
    const count = item.count === 1 ? "1 contribution" : `${formatNumber(item.count)} contributions`;
    const placing = item.rank ? ` · ${formatOrdinal(item.rank)} that year` : "";
    return `${count} in ${item.year}${placing}`;
  };

  return (
    <svg
      class="heatmap"
      viewBox={`0 0 ${width()} ${height()}`}
      width={width()}
      height={height()}
      role="img"
      aria-label={props.label}
      style={{ "max-width": `${width()}px` }}
    >
      <Show when={props.labels}>
        <For each={props.cells}>
          {(item, index) => (
            <text class="heatmap__month" x={index() * pitch()} y={LABEL_BAND - 6}>
              {item.year}
            </text>
          )}
        </For>
      </Show>
      <For each={props.cells}>
        {(item, index) => (
          <rect
            class="heatmap__day"
            data-state="day"
            data-level={item.level}
            x={index() * pitch()}
            y={top()}
            width={cell()}
            height={cell()}
            rx={Math.max(1, Math.round(cell() * 0.22))}
          >
            <title>{tooltip(item)}</title>
          </rect>
        )}
      </For>
      {/* Drawn after the squares so the digits sit on top of their own cell. */}
      <Show when={props.podium}>
        <For each={props.cells}>
          {(item, index) => (
            <Show when={item.rank && item.rank <= PODIUM}>
              <text
                class="heatmap__rank"
                data-level={item.level}
                x={index() * pitch() + cell() / 2}
                y={top() + cell() / 2}
                font-size={String(Math.round(cell() * 0.46))}
                text-anchor="middle"
                dominant-baseline="central"
              >
                {item.rank}
              </text>
            </Show>
          )}
        </For>
      </Show>
    </svg>
  );
}
