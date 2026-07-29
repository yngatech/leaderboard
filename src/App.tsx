import { For, Match, Show, Switch, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import type { Board, BoardError } from "../shared/types";
import Heatmap from "./components/Heatmap";
import UserRow from "./components/UserRow";
import { groupPulse, peakDay } from "./lib/board";
import { formatAgo, formatDayShort, formatNumber } from "./lib/format";

interface BoardPayload {
  board: Board;
  generatedAt: string | null;
  missing: string[];
}

async function loadBoard(): Promise<BoardPayload> {
  const res = await fetch("/api/board", { headers: { Accept: "application/json" } });

  if (!res.ok) {
    let message = `GitHub data is unavailable (${res.status}).`;
    try {
      const body = (await res.json()) as BoardError;
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  return {
    board: (await res.json()) as Board,
    generatedAt: res.headers.get("X-Board-Generated"),
    missing: (res.headers.get("X-Board-Missing") ?? "").split(",").filter(Boolean),
  };
}

export default function App() {
  const [payload, { refetch }] = createResource(loadBoard);

  // Keeps "updated N minutes ago" honest on a tab left open.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(tick));

  // Reading a rejected resource re-throws, so guard every read outside the Switch.
  const settled = () => (payload.error ? undefined : payload());
  const board = () => settled()?.board ?? [];
  const total = createMemo(() => board().reduce((sum, user) => sum + user.totalContributions, 0));
  const pulse = createMemo(() => groupPulse(board()));
  const busiest = createMemo(() => peakDay(pulse()));

  return (
    <div class="shell">
      <header class="head">
        <div class="head__mark">
          <span class="head__domain">leaderboard.ynga.tech</span>
          <h1 class="head__title">git board</h1>
        </div>
      </header>

      <Switch>
        <Match when={payload.loading}>
          <section class="state" aria-live="polite">
            <p class="state__title">Reading the last 52 weeks…</p>
            <div class="skeleton" aria-hidden="true">
              <For each={Array.from({ length: 9 })}>{(_, i) => <div class="skeleton__row" style={{ "--i": i() }} />}</For>
            </div>
          </section>
        </Match>

        <Match when={payload.error}>
          <section class="state state--error" role="alert">
            <p class="state__title">The board didn't load.</p>
            <p class="state__detail">{(payload.error as Error).message}</p>
            <button class="button" type="button" onClick={() => void refetch()}>
              Try again
            </button>
          </section>
        </Match>

        <Match when={settled()}>
          <section class="pulse" aria-labelledby="pulse-heading">
            <div class="pulse__stat">
              <p class="pulse__number">{formatNumber(total())}</p>
              <h2 class="pulse__label" id="pulse-heading">
                contributions from {board().length} accounts in the last 52 weeks
              </h2>
            </div>

            <div class="pulse__plot">
              <Heatmap
                weeks={pulse()}
                cell={17}
                gap={3}
                months
                unit="contributions"
                label={`All ${board().length} accounts combined, day by day, over the last 52 weeks`}
              />
            </div>

            <div class="pulse__foot">
              <Show when={busiest()}>
                {(day) => (
                  <p class="pulse__peak">
                    Busiest day: <strong>{formatNumber(day().count)}</strong> contributions on{" "}
                    {formatDayShort(day().date)}
                  </p>
                )}
              </Show>
              <div class="legend">
                <span>cold</span>
                <For each={[0, 1, 2, 3, 4]}>{(level) => <i class="legend__swatch" data-level={level} />}</For>
                <span>hot</span>
              </div>
            </div>
          </section>

          <div class="board-head">
            <span>the board</span>
            <span class="board-head__rule" aria-hidden="true" />
            <span>sorted by contributions</span>
          </div>

          <main class="board">
            <For each={board()}>{(user, index) => <UserRow user={user} rank={index() + 1} />}</For>
          </main>

          <Show when={settled()!.missing.length > 0}>
            <p class="missing">
              No GitHub data came back for {settled()!.missing.join(", ")}. The account may have been
              renamed or removed.
            </p>
          </Show>
        </Match>
      </Switch>

      <footer class="foot">
        <p>
          Pulled from the GitHub GraphQL API. The board refreshes about every 30 minutes.
          <Show when={settled()?.generatedAt}>
            {(iso) => <span class="foot__stamp"> Updated {formatAgo(iso(), now())}.</span>}
          </Show>
        </p>
        <p class="foot__domain">leaderboard.ynga.tech</p>
      </footer>
    </div>
  );
}
