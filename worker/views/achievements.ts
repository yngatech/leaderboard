import { achievementFeed, type Achievement } from "../../shared/achievements.ts";
import { formatDayShort, formatDayYear, formatNumber } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { hrefForYear, MIN_PAGE_YEAR, pageHtml, type SiteChrome } from "./layout.ts";

const LINK = "text-ink underline decoration-line underline-offset-4 hover:text-accent";

export function achievementsHref(year: number, login?: string): string {
  return `/achievements?year=${year}${login ? `&person=${encodeURIComponent(login)}` : ""}`;
}

function personLink(login: string): Html {
  return html`<a class="${LINK} [overflow-wrap:anywhere]" href="/u/${login}">${login}</a>`;
}

function achievementCopy(event: Achievement): { title: Html; detail: string } {
  switch (event.kind) {
    case "yearly-milestone":
    case "lifetime-milestone": {
      const lifetime = event.kind === "lifetime-milestone";
      return {
        title: html`${personLink(event.login)} reached
          <strong class="font-medium text-accent">${formatNumber(event.threshold)}</strong>
          ${lifetime ? "all-time contributions" : `contributions in ${event.year}`}`,
        detail: lifetime ? "Lifetime milestone" : "Yearly milestone",
      };
    }
    case "board-milestone":
      return {
        title: html`Together, the board reached
          <strong class="font-medium text-accent">${formatNumber(event.threshold)}</strong>
          contributions in ${event.year}`,
        detail: "Board milestone",
      };
    case "personal-best":
      return {
        title: html`${personLink(event.login)} set a new best day with
          <strong class="font-medium text-accent">${formatNumber(event.count)}</strong>
          contributions`,
        detail: `Previous best in ${event.year}: ${formatNumber(event.previousCount)}`,
      };
    case "board-record":
      return {
        title: html`${event.logins.map((login, index) => html`${index > 0 ? " and " : ""}${personLink(login)}`)}
          set the board's single-person day record:
          <strong class="font-medium text-accent">${formatNumber(event.count)}</strong> contributions`,
        detail: `Previous record in ${event.year}: ${formatNumber(event.previousCount)}`,
      };
    case "anniversary":
      return {
        title: html`${personLink(event.login)} celebrated
          <strong class="font-medium text-accent">${formatNumber(event.years)}
            ${event.years === 1 ? "year" : "years"}</strong> on GitHub`,
        detail: "GitHub anniversary",
      };
  }
}

function marker(event: Achievement): Html {
  if (event.kind === "anniversary") return html`<span aria-hidden="true">🎂</span>`;
  const path = event.kind === "board-record" || event.kind === "personal-best"
    ? html`<path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v6m-4 2h8" />`
    : html`<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />`;
  return html`<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function achievementRows(events: readonly Achievement[], today: string): Html {
  return html`<ol class="divide-y divide-line-soft">${events.map((event) => {
    const copy = achievementCopy(event);
    return html`<li class="grid grid-cols-[1.8rem_minmax(0,1fr)_auto] items-start gap-x-3 py-4 max-phone:grid-cols-[1.6rem_minmax(0,1fr)] max-phone:gap-x-2.5"
      data-achievement="${event.id}">
      <span class="flex size-7 items-center justify-center rounded-lg bg-heat-0 text-accent max-phone:size-6">${marker(event)}</span>
      <div class="min-w-0 text-[0.78rem] leading-[1.7] text-secondary">
        <p>${copy.title}</p>
        <p class="mt-0.5 text-[0.72rem] text-muted">${copy.detail}${event.provisional
          ? html` <span class="ml-2 text-heat-3">Still counting</span>` : null}</p>
      </div>
      <time datetime="${event.date}" title="${formatDayYear(event.date)}"
        class="pt-1 text-[0.72rem] whitespace-nowrap text-muted max-phone:col-start-2 max-phone:mt-1 max-phone:pt-0">${event.date === today ? "Today" : formatDayShort(event.date)}</time>
    </li>`;
  })}</ol>`;
}

export interface RecentAchievementsOptions {
  events: readonly Achievement[];
  year: number;
  today: string;
  login?: string;
  historyAvailable?: boolean;
  complete?: boolean;
}

export function recentAchievementsHtml(options: RecentAchievementsOptions): Html {
  const events = achievementFeed(options.events, options.login).slice(0, 4);
  return html`<section id="achievements" class="mt-8 scroll-mt-4" aria-labelledby="achievements-heading">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-line pb-3">
      <h2 id="achievements-heading" class="font-display text-[1.25rem] font-semibold tracking-[-0.025em] text-ink">Recent achievements</h2>
      <a class="text-[0.72rem] font-medium text-secondary underline decoration-line underline-offset-4 hover:text-accent"
        href="${achievementsHref(options.year, options.login)}">View achievements</a>
    </div>
    ${events.length > 0 ? achievementRows(events, options.today) : html`<p class="py-5 text-[0.78rem] leading-[1.7] text-secondary">No achievements in ${options.year}.</p>`}
    ${availabilityNote(options)}
  </section>`;
}

function availabilityNote(options: Pick<RecentAchievementsOptions, "historyAvailable" | "complete">): Html | null {
  if (options.historyAvailable !== false && options.complete !== false) return null;
  return html`<p class="mt-3 text-[0.72rem] leading-[1.7] text-secondary">${options.historyAvailable === false
    ? "Lifetime achievements are unavailable while the contribution archive is incomplete. " : ""}${options.complete === false
    ? "Achievements for incomplete accounts and the board are unavailable while some contribution data is missing." : ""}</p>`;
}

export interface AchievementsPageOptions extends RecentAchievementsOptions {
  chrome: SiteChrome;
  logins: readonly string[];
  generatedAt: string | null;
}

export function achievementsPageHtml(options: AchievementsPageOptions): string {
  const { chrome, year, login, today } = options;
  const events = achievementFeed(options.events, login);
  const selectClass = "mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[0.78rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const main = html`<main class="mt-[clamp(2.5rem,6vw,4rem)] max-w-[850px]">
    <h2 class="font-display text-[clamp(2rem,5vw,3rem)] font-extrabold tracking-[-0.04em]">Achievements</h2>
    <p class="mt-3 max-w-[65ch] text-[0.78rem] leading-[1.8] text-secondary">Contribution milestones, record days and GitHub anniversaries.</p>
    <form action="/achievements" method="get" class="mt-6 grid grid-cols-[8rem_minmax(0,1fr)_auto] items-end gap-3 max-phone:grid-cols-[6rem_minmax(0,1fr)]">
      <label class="text-[0.72rem] text-secondary">Year<select class="${selectClass}" name="year">${Array.from(
        { length: chrome.thisYear - MIN_PAGE_YEAR + 1 }, (_, index) => chrome.thisYear - index,
      ).map((value) => html`<option value="${value}"${value === year ? html` selected` : null}>${value}</option>`)}</select></label>
      <label class="min-w-0 text-[0.72rem] text-secondary">Account<select class="${selectClass}" name="person">
        <option value="">Everyone</option>${options.logins.map((value) => html`<option value="${value}"${value === login ? html` selected` : null}>${value}</option>`)}
      </select></label>
      <button class="cursor-pointer rounded-lg border border-accent/50 px-4 py-2.5 text-[0.78rem] font-medium text-accent transition-colors hover:bg-accent/10 max-phone:col-span-2 max-phone:justify-self-start" type="submit">Show achievements</button>
    </form>
    <section class="mt-8" aria-label="${year} achievements${login ? ` for ${login}` : ""}">
      <div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <h3 class="font-display text-xl font-semibold tracking-[-0.025em]">${year}${login ? html` / ${personLink(login)}` : null}</h3>
        <span class="text-[0.72rem] text-muted">${formatNumber(events.length)} achievements</span>
      </div>
      ${events.length ? achievementRows(events.slice(0, 20), today) : html`<p class="py-8 text-[0.78rem] leading-[1.8] text-secondary">No achievements in ${year}${login ? ` for ${login}` : ""}.
        <a class="${LINK}" href="${hrefForYear(year, chrome.thisYear)}">Explore the contribution board</a>.</p>`}
      ${events.length > 20 ? html`<details class="mt-3">
        <summary class="w-fit cursor-pointer rounded-lg border border-line px-4 py-2.5 text-[0.75rem] font-medium text-secondary hover:text-accent">Show ${formatNumber(events.length - 20)} earlier ${events.length === 21 ? "achievement" : "achievements"}</summary>
        ${achievementRows(events.slice(20), today)}</details>` : null}
      ${availabilityNote(options)}
    </section>
  </main>`;
  return pageHtml({
    chrome, title: "achievements", description: "Contribution milestones and record days from the git board.",
    nav: { kind: "achievements", year }, generatedAt: options.generatedAt,
    liveCopy: year === chrome.thisYear, provisionalToday: year === chrome.thisYear, main,
  });
}
