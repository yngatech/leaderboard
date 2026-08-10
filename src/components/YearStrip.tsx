import { For, Show, createMemo, createSignal } from "solid-js";
import type { YearCell } from "../../shared/board";
import { formatNumber, formatOrdinal } from "../../shared/format";

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
  /** Make each year cell interactive. */
  onYearClick?: (year: number) => void;
}

const LABEL_BAND = 17;
const PODIUM = 3;

/** The all-time counterpart to Heatmap: one row, one cell per year. */
export default function YearStrip(props: YearStripProps) {
  const [focusedIndex, setFocusedIndex] = createSignal(0);
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

  const onCellKeyDown = (
    event: KeyboardEvent & { currentTarget: SVGRectElement },
    year: number,
    index: number,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onYearClick?.(year);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const next = Math.max(
      0,
      Math.min(props.cells.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)),
    );
    setFocusedIndex(next);
    const cells = event.currentTarget.parentElement?.querySelectorAll<SVGRectElement>(
      '[data-year-cell="true"]',
    );
    cells?.[next]?.focus();
  };

  return (
    <svg
      class="block h-auto w-full"
      viewBox={`0 0 ${width()} ${height()}`}
      width={width()}
      height={height()}
      role={props.onYearClick ? "group" : "img"}
      aria-label={props.label}
      style={{ "max-width": `${width()}px` }}
    >
      <Show when={props.labels}>
        <For each={props.cells}>
          {(item, index) => (
            <text
              class="fill-dimmer font-mono text-[10px] tracking-[0.06em]"
              x={index() * pitch()}
              y={LABEL_BAND - 6}
            >
              {item.year}
            </text>
          )}
        </For>
      </Show>
      <For each={props.cells}>
        {(item, index) => (
          <rect
            class="fill-heat-0 transition-[fill] duration-150 hover:stroke-1 hover:stroke-white/70 data-[level=1]:fill-heat-1 data-[level=2]:fill-heat-2 data-[level=3]:fill-heat-3 data-[level=4]:fill-heat-4"
            classList={{ "cursor-pointer": Boolean(props.onYearClick) }}
            data-state="day"
            data-level={item.level}
            x={index() * pitch()}
            y={top()}
            width={cell()}
            height={cell()}
            rx={Math.max(1, Math.round(cell() * 0.22))}
            role={props.onYearClick ? "link" : undefined}
            tabindex={props.onYearClick ? (index() === focusedIndex() ? 0 : -1) : undefined}
            data-year-cell={props.onYearClick ? "true" : undefined}
            aria-label={props.onYearClick ? `Show ${item.year}: ${tooltip(item)}` : undefined}
            onClick={() => {
              setFocusedIndex(index());
              props.onYearClick?.(item.year);
            }}
            onFocus={() => setFocusedIndex(index())}
            onKeyDown={(event) => onCellKeyDown(event, item.year, index())}
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
                // The two brightest steps of the ramp need a dark digit to read.
                // pointer-events-none keeps the cell's own hover and tooltip.
                class="pointer-events-none fill-ink font-mono font-medium data-[level=3]:fill-void data-[level=4]:fill-void"
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
