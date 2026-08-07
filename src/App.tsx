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
import CumulativeChart from "./components/CumulativeChart";
import Heatmap from "./components/Heatmap";
import UserRow from "./components/UserRow";
import YearStrip from "./components/YearStrip";
import {
  boardYearRanks,
  boardYearThresholds,
  cumulativeSeries,
  currentYear,
  groupGrid,
  groupYearStrip,
  peakDay,
  peakYear,
  todayIso,
} from "./lib/board";
import { firstDayForLocale, formatAgo, formatDayShort, formatNumber } from "./lib/format";

declare const __BUILD_COMMIT_SHA__: string;

/** Earliest year accepted by both routes and year navigation. */
const MIN_API_YEAR = 2008;
const THIS_YEAR = currentYear();
const SOURCE_COMMIT_URL = `https://github.com/yngatech/leaderboard/commit/${__BUILD_COMMIT_SHA__}`;

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
  const firstDay = firstDayForLocale(navigator.language);

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

  const onViewKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }

    const current = view();
    if (!current) return;

    let href: string | null = null;
    if (current.kind === "all") {
      if (event.key === "ArrowLeft") href = hrefForYear(THIS_YEAR);
    } else if (event.key === "ArrowLeft" && current.year > MIN_API_YEAR) {
      href = hrefForYear(current.year - 1);
    } else if (event.key === "ArrowRight") {
      href = current.year < THIS_YEAR ? hrefForYear(current.year + 1) : "/all";
    }

    if (!href) return;
    event.preventDefault();
    navigate(href);
  };

  window.addEventListener("keydown", onViewKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onViewKeyDown));

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
  const highestUserTotal = createMemo(() =>
    board().reduce((highest, user) => Math.max(highest, user.totalContributions), 0),
  );
  const highestDailyTotal = createMemo(() =>
    board().reduce(
      (highest, user) =>
        user.weeks.reduce(
          (userHighest, week) =>
            week.days.reduce((weekHighest, day) => Math.max(weekHighest, day.count), userHighest),
          highest,
        ),
      0,
    ),
  );
  const pulse = createMemo(() => groupGrid(board(), shownYear(), today, firstDay));
  const busiest = createMemo(() => peakDay(pulse()));
  /** Only the year in progress has a "so far" worth drawing. */
  const climb = createMemo(() =>
    shownYear() === THIS_YEAR ? cumulativeSeries(board(), shownYear(), today) : [],
  );

  const allUsers = () => allSettled()?.data.users ?? [];
  const allYears = () => allSettled()?.data.years ?? [];
  const allRanked = createMemo(() =>
    [...allUsers()].sort((a, b) => b.total - a.total || a.login.localeCompare(b.login)),
  );
  const allThresholds = createMemo(() => boardYearThresholds(allUsers()));
  const allRanks = createMemo(() => boardYearRanks(allUsers(), allYears()));
  const allTotal = createMemo(() => allUsers().reduce((sum, user) => sum + user.total, 0));
  const highestAllTimeTotal = createMemo(() =>
    allUsers().reduce((highest, user) => Math.max(highest, user.total), 0),
  );
  const highestYearTotal = createMemo(() =>
    allUsers().reduce(
      (highest, user) =>
        Object.values(user.byYear).reduce(
          (userHighest, count) => Math.max(userHighest, count),
          highest,
        ),
      0,
    ),
  );
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
    <div class="relative z-[1] mx-auto max-w-[1180px] px-[clamp(1.1rem,4vw,2.5rem)] pt-[clamp(1.75rem,5vw,3.5rem)] pb-10">
      <header class="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-[clamp(1rem,4vw,3rem)] max-phone:grid-cols-[minmax(0,1fr)] max-phone:items-start">
        <div>
          <span class="block text-[0.7rem] tracking-[0.22em] text-dimmer uppercase">
            leaderboard.ynga.tech
          </span>
          <h1 class="mt-[0.45rem] font-display text-[clamp(2.6rem,7vw,4.1rem)] leading-[0.85] font-extrabold tracking-[-0.045em]">
            git board
          </h1>
        </div>

        <Show when={view()}>
          <nav
            class="flex items-baseline justify-self-end gap-[clamp(0.6rem,2vw,1.2rem)] max-phone:justify-self-start max-phone:gap-[0.9rem]"
            aria-label="View"
          >
            <Show when={isAll()}>
              <a
                class="min-w-16 text-center text-[0.78rem] whitespace-nowrap text-dim no-underline hover:text-accent max-phone:min-w-[3.4rem]"
                href="/"
                onClick={onLinkClick}
                aria-label={`Show ${THIS_YEAR}`}
              >
                ← {THIS_YEAR}
              </a>
              <span class="font-display text-[clamp(1.9rem,5vw,2.6rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
                all time
              </span>
            </Show>

            <Show when={viewedYear()}>
              {(viewed) => (
                <>
                  <Show
                    when={viewed() - 1 >= MIN_API_YEAR}
                    fallback={
                      <span class="min-w-16 max-phone:min-w-[3.4rem]" aria-hidden="true" />
                    }
                  >
                    <a
                      class="min-w-16 text-center text-[0.78rem] whitespace-nowrap text-dim no-underline hover:text-accent max-phone:min-w-[3.4rem]"
                      href={hrefForYear(viewed() - 1)}
                      onClick={onLinkClick}
                      aria-label={`Show ${viewed() - 1}`}
                    >
                      ← {viewed() - 1}
                    </a>
                  </Show>

                  <span class="font-display text-[clamp(1.9rem,5vw,2.6rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
                    {viewed()}
                  </span>

                  <Show
                    when={viewed() + 1 <= THIS_YEAR}
                    fallback={
                      <span class="min-w-16 max-phone:min-w-[3.4rem]" aria-hidden="true" />
                    }
                  >
                    <a
                      class="min-w-16 text-center text-[0.78rem] whitespace-nowrap text-dim no-underline hover:text-accent max-phone:min-w-[3.4rem]"
                      href={hrefForYear(viewed() + 1)}
                      onClick={onLinkClick}
                      aria-label={`Show ${viewed() + 1}`}
                    >
                      {viewed() + 1} →
                    </a>
                  </Show>

                  <a
                    class="min-w-16 text-center text-[0.78rem] whitespace-nowrap text-dim no-underline hover:text-accent max-phone:min-w-[3.4rem]"
                    href="/all"
                    onClick={onLinkClick}
                  >
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
          <section class="mt-[clamp(2.5rem,6vw,4rem)] rounded-2xl border border-line bg-panel p-[1.6rem]">
            <p class="font-display text-[1.3rem] font-semibold tracking-[-0.02em] text-ink">
              Nothing here.
            </p>
            <p class="mt-2 max-w-[60ch] text-[0.78rem] leading-[1.6] text-dim">
              Boards run from {MIN_API_YEAR} to {THIS_YEAR}, plus all time.
            </p>
            <a
              class="mt-[1.1rem] inline-block cursor-pointer rounded-[9px] border border-accent/50 bg-transparent px-[1.1rem] py-[0.55rem] font-mono text-[0.75rem] tracking-[0.05em] text-accent no-underline transition-colors duration-200 hover:bg-accent/12"
              href="/"
              onClick={onLinkClick}
            >
              Show {THIS_YEAR}
            </a>
          </section>
        </Match>

        <Match when={loading()}>
          <section class="mt-[clamp(2.5rem,6vw,4rem)]" aria-live="polite">
            <p class="text-[0.85rem] text-dim">Loading {isAll() ? "all time" : viewedYear()}…</p>
            <div class="mt-5 flex flex-col gap-[0.6rem]" aria-hidden="true">
              <For each={Array.from({ length: 9 })}>
                {(_, i) => (
                  <div
                    class="h-[88px] animate-shimmer rounded-2xl bg-[linear-gradient(90deg,#12162b_20%,#1a2040_50%,#12162b_80%)] [background-size:220%_100%] [animation-delay:calc(var(--i,0)*90ms)]"
                    style={{ "--i": i() }}
                  />
                )}
              </For>
            </div>
          </section>
        </Match>

        <Match when={failure()}>
          <section
            class="mt-[clamp(2.5rem,6vw,4rem)] rounded-2xl border border-heat-3/45 bg-heat-3/8 p-[1.6rem]"
            role="alert"
          >
            <p class="font-display text-[1.3rem] font-semibold tracking-[-0.02em] text-ink">
              The board didn't load.
            </p>
            <p class="mt-2 max-w-[60ch] text-[0.78rem] leading-[1.6] text-dim">
              {failure()!.message}
            </p>
            <button
              class="mt-[1.1rem] inline-block cursor-pointer rounded-[9px] border border-accent/50 bg-transparent px-[1.1rem] py-[0.55rem] font-mono text-[0.75rem] tracking-[0.05em] text-accent transition-colors duration-200 hover:bg-accent/12"
              type="button"
              onClick={retry}
            >
              Try again
            </button>
          </section>
        </Match>

        <Match when={isAll() && allSettled()}>
          <section class="mt-[clamp(2.5rem,6vw,4rem)] animate-rise" aria-labelledby="pulse-heading">
            <div>
              <p class="bg-[linear-gradient(96deg,var(--color-heat-4)_12%,var(--color-heat-3)_58%,var(--color-heat-2)_96%)] bg-clip-text font-display text-[clamp(3.6rem,12vw,7.5rem)] leading-[0.8] font-extrabold tracking-[-0.055em] tabular-nums text-transparent">
                {formatNumber(allTotal())}
              </p>
              <h2
                class="mt-[0.9rem] max-w-[44ch] font-mono text-[0.8rem] leading-[1.6] font-normal text-dim"
                id="pulse-heading"
              >
                contributions from {allUsers().length} accounts, {allSpan()}
              </h2>
            </div>

            <div class="mt-[1.9rem] overflow-x-auto rounded-2xl border border-line bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-[1.15rem] pt-4 pb-[0.9rem]">
              <YearStrip
                cells={allPulse()}
                cell={70}
                gap={6}
                labels
                label={`All ${allUsers().length} accounts combined, year by year, ${allSpan()}`}
                onYearClick={(year) => navigate(hrefForYear(year))}
              />
            </div>

            <div class="mt-[0.9rem] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.72rem] text-dim">
              <Show when={allBest()}>
                {(peak) => (
                  <p>
                    Biggest year:{" "}
                    <strong class="font-medium text-ink">{formatNumber(peak().count)}</strong>{" "}
                    contributions in {peak().year}
                  </p>
                )}
              </Show>
              <div class="flex items-center gap-[0.32rem] tracking-[0.04em] text-dimmer">
                <span>less</span>
                <For each={[0, 1, 2, 3, 4]}>
                  {(level) => (
                    <i
                      class="size-[11px] rounded-[3px] bg-heat-0 data-[level=1]:bg-heat-1 data-[level=2]:bg-heat-2 data-[level=3]:bg-heat-3 data-[level=4]:bg-heat-4"
                      data-level={level}
                    />
                  )}
                </For>
                <span>more</span>
              </div>
            </div>
          </section>

          <div class="mt-[clamp(2.25rem,5vw,3.25rem)] mb-4 flex items-center gap-[0.85rem] text-[0.66rem] tracking-[0.2em] text-dimmer uppercase">
            <span>the board</span>
            <span class="h-px flex-1 bg-line-soft" aria-hidden="true" />
          </div>

          <main class="flex flex-col gap-[0.6rem]">
            <For each={allRanked()}>
              {(user, index) => (
                <AllTimeRow
                  user={user}
                  rank={index() + 1}
                  years={allYears()}
                  thresholds={allThresholds()}
                  ranks={allRanks()}
                  highestTotal={highestAllTimeTotal()}
                  highestYearTotal={highestYearTotal()}
                />
              )}
            </For>
          </main>

          <Show when={allSettled()!.missing.length > 0}>
            <p class="mt-[1.1rem] text-[0.7rem] leading-[1.6] text-dimmer">
              No GitHub data came back for {allSettled()!.missing.join(", ")}. The account may have
              been renamed or removed.
            </p>
          </Show>
        </Match>

        <Match when={settled()}>
          <section class="mt-[clamp(2.5rem,6vw,4rem)] animate-rise" aria-labelledby="pulse-heading">
            <div>
              <p class="bg-[linear-gradient(96deg,var(--color-heat-4)_12%,var(--color-heat-3)_58%,var(--color-heat-2)_96%)] bg-clip-text font-display text-[clamp(3.6rem,12vw,7.5rem)] leading-[0.8] font-extrabold tracking-[-0.055em] tabular-nums text-transparent">
                {formatNumber(total())}
              </p>
              <h2
                class="mt-[0.9rem] max-w-[44ch] font-mono text-[0.8rem] leading-[1.6] font-normal text-dim"
                id="pulse-heading"
              >
                contributions from {board().length} accounts in {shownYear()}
              </h2>
            </div>

            <div class="mt-[1.9rem] overflow-x-auto rounded-2xl border border-line bg-[linear-gradient(180deg,#12162b_0%,#0d1122_100%)] px-[1.15rem] pt-4 pb-[0.9rem]">
              <Heatmap
                weeks={pulse()}
                cell={17}
                gap={3}
                months
                firstDay={firstDay}
                unit="contributions"
                peakDate={busiest()?.date}
                label={`All ${board().length} accounts combined, day by day, in ${shownYear()}`}
              />
            </div>

            <div class="mt-[0.9rem] flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.72rem] text-dim">
              <Show when={busiest()}>
                {(day) => (
                  <p>
                    Busiest day:{" "}
                    <strong class="font-medium text-ink">{formatNumber(day().count)}</strong>{" "}
                    contributions on {formatDayShort(day().date)}
                  </p>
                )}
              </Show>
              <div class="flex items-center gap-[0.32rem] tracking-[0.04em] text-dimmer">
                <span>less</span>
                <For each={[0, 1, 2, 3, 4]}>
                  {(level) => (
                    <i
                      class="size-[11px] rounded-[3px] bg-heat-0 data-[level=1]:bg-heat-1 data-[level=2]:bg-heat-2 data-[level=3]:bg-heat-3 data-[level=4]:bg-heat-4"
                      data-level={level}
                    />
                  )}
                </For>
                <span>more</span>
                <Show when={shownYear() === THIS_YEAR}>
                  <span class="w-2" aria-hidden="true" />
                  <i
                    class="size-[11px] rounded-[3px] border border-future-line bg-transparent"
                    data-state="future"
                  />
                  <span>to come</span>
                </Show>
              </div>
            </div>
          </section>

          <div class="mt-[clamp(2.25rem,5vw,3.25rem)] mb-4 flex items-center gap-[0.85rem] text-[0.66rem] tracking-[0.2em] text-dimmer uppercase">
            <span>the board</span>
            <span class="h-px flex-1 bg-line-soft" aria-hidden="true" />
          </div>

          <main class="flex flex-col gap-[0.6rem]">
            <For each={board()}>
              {(user, index) => (
                <UserRow
                  user={user}
                  rank={index() + 1}
                  year={shownYear()}
                  today={today}
                  firstDay={firstDay}
                  highestTotal={highestUserTotal()}
                  highestDailyTotal={highestDailyTotal()}
                />
              )}
            </For>
          </main>

          <Show when={settled()!.missing.length > 0}>
            <p class="mt-[1.1rem] text-[0.7rem] leading-[1.6] text-dimmer">
              No GitHub data came back for {settled()!.missing.join(", ")}. The account may have been
              renamed or removed.
            </p>
          </Show>

          <Show when={climb().length > 0}>
            <CumulativeChart series={climb()} year={shownYear()} today={today} />
          </Show>
        </Match>
      </Switch>

      <footer class="mt-[clamp(2.5rem,6vw,4rem)] flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-line-soft pt-[1.1rem] text-[0.68rem] leading-[1.6] text-dimmer">
        <p>
          Pulled from the GitHub GraphQL API.{" "}
          <Show when={!liveCopy()} fallback={<>Refreshes about every 30 minutes.</>}>
            {shownYear()} is final and cached for 7 days.
          </Show>
          <Show when={generatedAt()}>
            {(iso) => (
              <>
                {" "}
                <a
                  class="text-dim underline decoration-current/40 underline-offset-[3px] transition-colors hover:text-accent"
                  href={SOURCE_COMMIT_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`View deployed commit ${__BUILD_COMMIT_SHA__.slice(0, 7)} on GitHub`}
                  aria-label={`Data updated ${formatAgo(iso(), now())}; view deployed source commit on GitHub`}
                >
                  Updated {formatAgo(iso(), now())}.
                </a>
              </>
            )}
          </Show>
        </p>
        <p class="tracking-[0.16em] uppercase">leaderboard.ynga.tech</p>
      </footer>
    </div>
  );
}
