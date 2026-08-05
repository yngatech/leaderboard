import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import type { AllTime, Board, BoardError } from "../shared/types";
import AllTimeRow from "./components/AllTimeRow";
import Heatmap from "./components/Heatmap";
import UserRow from "./components/UserRow";
import YearStrip from "./components/YearStrip";
import {
  boardYearRanks,
  boardYearThresholds,
  currentYear,
  groupGrid,
  groupYearStrip,
  peakDay,
  peakYear,
  todayIso,
} from "./lib/board";
import { formatAgo, formatDayShort, formatNumber } from "./lib/format";

/** The API accepts 2008; year navigation stops somewhere useful. */
const MIN_API_YEAR = 2008;
const MIN_NAV_YEAR = 2015;
const THIS_YEAR = currentYear();

type View = { kind: "year"; year: number } | { kind: "all" };

interface BoardPayload {
  board: Board;
  year: number;
  generatedAt: string | null;
  missing: string[];
}

interface AllTimePayload {
  data: AllTime;
  generatedAt: string | null;
  missing: string[];
}

async function readError(res: Response): Promise<string> {
  let message = `GitHub data is unavailable (${res.status}).`;
  try {
    const body = (await res.json()) as BoardError;
    if (body?.error) message = body.error;
  } catch {
    /* non-JSON error body */
  }
  return message;
}

async function loadBoard(year: number): Promise<BoardPayload> {
  const res = await fetch(`/api/board?year=${year}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(await readError(res));

  return {
    board: (await res.json()) as Board,
    // Trust the response, so the grid can never be drawn for the wrong year.
    year: Number(res.headers.get("X-Board-Year") ?? year),
    generatedAt: res.headers.get("X-Board-Generated"),
    missing: (res.headers.get("X-Board-Missing") ?? "").split(",").filter(Boolean),
  };
}

async function loadAllTime(): Promise<AllTimePayload> {
  const res = await fetch("/api/all", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(await readError(res));

  return {
    data: (await res.json()) as AllTime,
    generatedAt: res.headers.get("X-Board-Generated"),
    missing: (res.headers.get("X-Board-Missing") ?? "").split(",").filter(Boolean),
  };
}

/** `/` is the year in progress, `/2024` an archived year, `/all` the lot. */
function viewForPath(pathname: string): View | null {
  if (pathname === "/" || pathname === "") return { kind: "year", year: THIS_YEAR };
  if (pathname === "/all" || pathname === "/all/") return { kind: "all" };

  const match = /^\/(\d{4})\/?$/.exec(pathname);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= MIN_API_YEAR && year <= THIS_YEAR ? { kind: "year", year } : null;
}

function hrefForYear(year: number): string {
  return year === THIS_YEAR ? "/" : `/${year}`;
}

export default function App() {
  const [pathname, setPathname] = createSignal(window.location.pathname);

  const onPopState = () => setPathname(window.location.pathname);
  window.addEventListener("popstate", onPopState);
  onCleanup(() => window.removeEventListener("popstate", onPopState));

  const navigate = (href: string) => {
    if (href !== window.location.pathname) {
      window.history.pushState(null, "", href);
      setPathname(href);
    }
    window.scrollTo({ top: 0 });
  };

  const onLinkClick = (event: MouseEvent & { currentTarget: HTMLAnchorElement }) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(event.currentTarget.getAttribute("href") ?? "/");
  };

  const view = createMemo(() => viewForPath(pathname()));
  const isAll = () => view()?.kind === "all";
  const viewedYear = () => {
    const current = view();
    return current && current.kind === "year" ? current.year : null;
  };

  const [payload, { refetch }] = createResource(() => viewedYear() ?? undefined, loadBoard);
  const [allPayload, { refetch: refetchAll }] = createResource(
    () => (isAll() ? true : undefined),
    loadAllTime,
  );

  // Keeps "updated N minutes ago" honest on a tab left open.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(tick));

  // Reading a rejected resource re-throws, so guard every read outside the Switch.
  const settled = () => (payload.error ? undefined : payload());
  const allSettled = () => (allPayload.error ? undefined : allPayload());
  const loading = () => (isAll() ? allPayload.loading : payload.loading);
  const failure = () => (isAll() ? allPayload.error : payload.error) as Error | undefined;
  const retry = () => void (isAll() ? refetchAll() : refetch());
  const generatedAt = () => (isAll() ? allSettled()?.generatedAt : settled()?.generatedAt);

  const board = () => settled()?.board ?? [];
  const shownYear = () => settled()?.year ?? viewedYear() ?? THIS_YEAR;
  /** /all always includes the year in progress, so it refreshes on that schedule. */
  const liveCopy = () => isAll() || shownYear() === THIS_YEAR;
  const today = todayIso();

  const total = createMemo(() => board().reduce((sum, user) => sum + user.totalContributions, 0));
  const pulse = createMemo(() => groupGrid(board(), shownYear(), today));
  const busiest = createMemo(() => peakDay(pulse()));

  const allUsers = () => allSettled()?.data.users ?? [];
  const allYears = () => allSettled()?.data.years ?? [];
  const allRanked = createMemo(() =>
    [...allUsers()].sort((a, b) => b.total - a.total || a.login.localeCompare(b.login)),
  );
  const allThresholds = createMemo(() => boardYearThresholds(allUsers()));
  const allRanks = createMemo(() => boardYearRanks(allUsers(), allYears()));
  const allTotal = createMemo(() => allUsers().reduce((sum, user) => sum + user.total, 0));
  const allPulse = createMemo(() => groupYearStrip(allUsers(), allYears()));
  const allBest = createMemo(() => peakYear(allPulse()));
  const allSpan = () => {
    const years = allYears();
    return years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : "";
  };

  createEffect(() => {
    const current = view();
    document.title =
      current === null
        ? "git board — not found"
        : current.kind === "all"
          ? "git board — all time"
          : `git board — ${current.year}`;
  });

  return (
    <div class="shell">
      <header class="head">
        <div class="head__mark">
          <span class="head__domain">leaderboard.ynga.tech</span>
          <h1 class="head__title">git board</h1>
        </div>

        <Show when={view()}>
          <nav class="years" aria-label="View">
            <Show when={isAll()}>
              <a class="years__step" href="/" onClick={onLinkClick} aria-label={`Show ${THIS_YEAR}`}>
                ← {THIS_YEAR}
              </a>
              <span class="years__current">all time</span>
            </Show>

            <Show when={viewedYear()}>
              {(viewed) => (
                <>
                  <Show
                    when={viewed() - 1 >= MIN_NAV_YEAR}
                    fallback={<span class="years__step years__step--blank" aria-hidden="true" />}
                  >
                    <a
                      class="years__step"
                      href={hrefForYear(viewed() - 1)}
                      onClick={onLinkClick}
                      aria-label={`Show ${viewed() - 1}`}
                    >
                      ← {viewed() - 1}
                    </a>
                  </Show>

                  <span class="years__current">{viewed()}</span>

                  <Show
                    when={viewed() + 1 <= THIS_YEAR}
                    fallback={<span class="years__step years__step--blank" aria-hidden="true" />}
                  >
                    <a
                      class="years__step"
                      href={hrefForYear(viewed() + 1)}
                      onClick={onLinkClick}
                      aria-label={`Show ${viewed() + 1}`}
                    >
                      {viewed() + 1} →
                    </a>
                  </Show>

                  <a class="years__step years__step--all" href="/all" onClick={onLinkClick}>
                    all time
                  </a>
                </>
              )}
            </Show>
          </nav>
        </Show>
      </header>

      <Switch>
        <Match when={view() === null}>
          <section class="state state--empty">
            <p class="state__title">Nothing here.</p>
            <p class="state__detail">
              Boards run from {MIN_API_YEAR} to {THIS_YEAR}, plus all time.
            </p>
            <a class="button" href="/" onClick={onLinkClick}>
              Show {THIS_YEAR}
            </a>
          </section>
        </Match>

        <Match when={loading()}>
          <section class="state" aria-live="polite">
            <p class="state__title">Loading {isAll() ? "all time" : viewedYear()}…</p>
            <div class="skeleton" aria-hidden="true">
              <For each={Array.from({ length: 9 })}>
                {(_, i) => <div class="skeleton__row" style={{ "--i": i() }} />}
              </For>
            </div>
          </section>
        </Match>

        <Match when={failure()}>
          <section class="state state--error" role="alert">
            <p class="state__title">The board didn't load.</p>
            <p class="state__detail">{failure()!.message}</p>
            <button class="button" type="button" onClick={retry}>
              Try again
            </button>
          </section>
        </Match>

        <Match when={isAll() && allSettled()}>
          <section class="pulse" aria-labelledby="pulse-heading">
            <div class="pulse__stat">
              <p class="pulse__number">{formatNumber(allTotal())}</p>
              <h2 class="pulse__label" id="pulse-heading">
                contributions from {allUsers().length} accounts, {allSpan()}
              </h2>
            </div>

            <div class="pulse__plot">
              <YearStrip
                cells={allPulse()}
                cell={70}
                gap={6}
                labels
                label={`All ${allUsers().length} accounts combined, year by year, ${allSpan()}`}
              />
            </div>

            <div class="pulse__foot">
              <Show when={allBest()}>
                {(peak) => (
                  <p class="pulse__peak">
                    Biggest year: <strong>{formatNumber(peak().count)}</strong> contributions in{" "}
                    {peak().year}
                  </p>
                )}
              </Show>
              <div class="legend">
                <span>less</span>
                <For each={[0, 1, 2, 3, 4]}>
                  {(level) => <i class="legend__swatch" data-level={level} />}
                </For>
                <span>more</span>
              </div>
            </div>
          </section>

          <div class="board-head">
            <span>the board</span>
            <span class="board-head__rule" aria-hidden="true" />
            <span>sorted by all-time total</span>
          </div>

          <main class="board">
            <For each={allRanked()}>
              {(user, index) => (
                <AllTimeRow
                  user={user}
                  rank={index() + 1}
                  years={allYears()}
                  thresholds={allThresholds()}
                  ranks={allRanks()}
                />
              )}
            </For>
          </main>

          <Show when={allSettled()!.missing.length > 0}>
            <p class="missing">
              No GitHub data came back for {allSettled()!.missing.join(", ")}. The account may have
              been renamed or removed.
            </p>
          </Show>
        </Match>

        <Match when={settled()}>
          <section class="pulse" aria-labelledby="pulse-heading">
            <div class="pulse__stat">
              <p class="pulse__number">{formatNumber(total())}</p>
              <h2 class="pulse__label" id="pulse-heading">
                contributions from {board().length} accounts in {shownYear()}
              </h2>
            </div>

            <div class="pulse__plot">
              <Heatmap
                weeks={pulse()}
                cell={17}
                gap={3}
                months
                unit="contributions"
                peakDate={busiest()?.date}
                label={`All ${board().length} accounts combined, day by day, in ${shownYear()}`}
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
                <span>less</span>
                <For each={[0, 1, 2, 3, 4]}>
                  {(level) => <i class="legend__swatch" data-level={level} />}
                </For>
                <span>more</span>
                <Show when={shownYear() === THIS_YEAR}>
                  <span class="legend__gap" aria-hidden="true" />
                  <i class="legend__swatch" data-state="future" />
                  <span>to come</span>
                </Show>
              </div>
            </div>
          </section>

          <div class="board-head">
            <span>the board</span>
            <span class="board-head__rule" aria-hidden="true" />
            <span>sorted by {shownYear()} total</span>
          </div>

          <main class="board">
            <For each={board()}>
              {(user, index) => (
                <UserRow user={user} rank={index() + 1} year={shownYear()} today={today} />
              )}
            </For>
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
          Pulled from the GitHub GraphQL API.{" "}
          <Show when={!liveCopy()} fallback={<>Refreshes about every 30 minutes.</>}>
            {shownYear()} is final and cached for 7 days.
          </Show>
          <Show when={generatedAt()}>
            {(iso) => <span class="foot__stamp"> Updated {formatAgo(iso(), now())}.</span>}
          </Show>
        </p>
        <p class="foot__domain">leaderboard.ynga.tech</p>
      </footer>
    </div>
  );
}
