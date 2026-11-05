import { html, type Html } from "../html.ts";
import { LINK_QUIET } from "./ui.ts";

/* ---------------------------------------------------------------------------
   The document shell: everything that used to be index.html plus the App
   component's header, footer and page chrome, rendered per page so the title,
   description and year navigation can be real markup instead of effects.
--------------------------------------------------------------------------- */

/** Earliest year served by both routes and year navigation. */
export const MIN_PAGE_YEAR = 2008;

export function hrefForYear(year: number, thisYear: number): string {
  return year === thisYear ? "/" : `/${year}`;
}

/** The canonical origin, absolute because README snippets are read elsewhere. */
export const SITE = "https://leaderboard.ynga.tech";

/** Fixed inputs the shell needs on every page. */
export interface SiteChrome {
  /** The year in progress, which decides `/` and the nav's right edge. */
  thisYear: number;
  /** Fingerprinted asset URLs, resolved by the worker's own `?url` imports. */
  stylesUrl: string;
  enhanceUrl: string;
  /** The deployed commit, identified separately from data freshness in the footer. */
  buildSha: string;
}

export interface PageOptions {
  chrome: SiteChrome;
  /** Suffix after "git board — " in the tab title. */
  title: string;
  description: string;
  /** Which view the header nav describes; null renders no nav at all. */
  nav: { kind: "year" | "achievements"; year: number } | { kind: "all" } | { kind: "user" } | null;
  /** ISO timestamp the data was generated, shown as footer freshness metadata. */
  generatedAt?: string | null;
  /** Live pages refresh every ten minutes; archived years sit still. */
  liveCopy?: boolean;
  /** The page includes the current UTC day, which GitHub may still revise. */
  provisionalToday?: boolean;
  /** Machine-readable representation of this page's data. */
  alternate?: string;
  main: Html;
}

/**
 * The view switcher is a floating instrument panel: top right on a wide screen,
 * along the bottom edge on a phone, where a thumb can reach it. On an iPhone
 * it floats top centre instead, because iOS Safari keeps its own toolbar along
 * the bottom and two stacked bars read as clutter. The page scrolls underneath,
 * so it stays one tap away from anywhere.
 */
const NAV_PANEL =
  "instrument fixed top-5 right-[max(clamp(1.1rem,4vw,2.5rem),calc((100%-1180px)/2+clamp(1.1rem,4vw,2.5rem)))] z-40 flex items-center divide-x divide-line-soft max-phone:top-auto max-phone:right-auto max-phone:bottom-[calc(0.9rem+env(safe-area-inset-bottom))] max-phone:left-1/2 max-phone:ios:top-[calc(0.6rem+env(safe-area-inset-top))] max-phone:ios:bottom-auto max-phone:-translate-x-1/2";
/** Inside the panel's 1px frame, so a segment's fill meets its rounded corners. */
const NAV_SEGMENT_SHAPE =
  "flex h-9 items-center whitespace-nowrap first:rounded-l-[calc(var(--radius-control)-1px)] last:rounded-r-[calc(var(--radius-control)-1px)]";
const NAV_SEGMENT = `${NAV_SEGMENT_SHAPE} px-3.5 text-body font-medium text-secondary no-underline transition-colors duration-200 hover:bg-panel hover:text-ink max-phone:px-3`;
const NAV_CURRENT = `${NAV_SEGMENT_SHAPE} instrument-current px-4 type-rank`;

function navHtml(options: PageOptions): Html | null {
  const nav = options.nav;
  if (nav === null) return null;
  const { thisYear } = options.chrome;

  let items: Html;
  if (nav.kind === "all") {
    items = html`<a class="${NAV_SEGMENT}" href="/" aria-label="Show ${thisYear}"
        >← ${thisYear}</a
      ><span class="${NAV_CURRENT}" aria-current="page">all time</span>`;
  } else if (nav.kind === "user" || nav.kind === "achievements") {
    items = html`<a class="${NAV_SEGMENT}" href="/" aria-label="Show ${thisYear}">← board</a
      ><a class="${NAV_SEGMENT}" href="/all">all time</a>`;
  } else {
    const previous =
      nav.year - 1 >= MIN_PAGE_YEAR
        ? html`<a
            class="${NAV_SEGMENT}"
            href="${hrefForYear(nav.year - 1, thisYear)}"
            aria-label="Show ${nav.year - 1}"
            >← ${nav.year - 1}</a
          >`
        : null;
    const next =
      nav.year + 1 <= thisYear
        ? html`<a
            class="${NAV_SEGMENT}"
            href="${hrefForYear(nav.year + 1, thisYear)}"
            aria-label="Show ${nav.year + 1}"
            >${nav.year + 1} →</a
          >`
        : null;
    items = html`${previous}<span class="${NAV_CURRENT}" aria-current="page">${nav.year}</span
      >${next}<a class="${NAV_SEGMENT}" href="/all">all time</a>`;
  }

  return html`<nav class="${NAV_PANEL}" aria-label="View">${items}</nav>`;
}

/** The favicon's 3×3 heat grid, drawn in the theme's ramp. */
const BRAND_MARK = html`<svg class="size-[1.375rem] shrink-0" viewBox="0 0 22 22" aria-hidden="true">
  <rect class="fill-heat-0" x="0" y="0" width="6" height="6" rx="1.5" />
  <rect class="fill-heat-1" x="8" y="0" width="6" height="6" rx="1.5" />
  <rect class="fill-heat-2" x="16" y="0" width="6" height="6" rx="1.5" />
  <rect class="fill-heat-2" x="0" y="8" width="6" height="6" rx="1.5" />
  <rect class="fill-heat-3" x="8" y="8" width="6" height="6" rx="1.5" />
  <rect class="fill-heat-4" x="16" y="8" width="6" height="6" rx="1.5" />
  <rect class="fill-heat-1" x="0" y="16" width="6" height="6" rx="1.5" />
  <rect class="fill-heat-4" x="8" y="16" width="6" height="6" rx="1.5" />
  <rect class="fill-heat-3" x="16" y="16" width="6" height="6" rx="1.5" />
</svg>`;

/**
 * The site's name, set small: the page's own number is the headline, so the
 * brand only has to say where you are and take you home. It sits level with
 * the desktop panel, which floats at the same height.
 */
const BRAND = html`<a
  class="flex items-center gap-2.5 text-ink no-underline transition-colors hover:text-accent"
  href="/"
  >${BRAND_MARK}<span class="type-brand">git board</span></a
>`;

/**
 * Where the arrow keys go from here, carried as data attributes so the
 * enhancement script never re-derives routing. Absent attributes mean the
 * edge of the range.
 */
function arrowTargets(options: PageOptions): { previous?: string; next?: string } {
  const nav = options.nav;
  const { thisYear } = options.chrome;
  if (nav === null || nav.kind === "user" || nav.kind === "achievements") return {};
  if (nav.kind === "all") return { previous: hrefForYear(thisYear, thisYear) };
  return {
    previous: nav.year - 1 >= MIN_PAGE_YEAR ? hrefForYear(nav.year - 1, thisYear) : undefined,
    next: nav.year < thisYear ? hrefForYear(nav.year + 1, thisYear) : "/all",
  };
}

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * The absolute moment the data was generated. The page may be served from the
 * edge cache well after it was rendered, so a baked-in "5 minutes ago" would
 * lie; the enhancement script upgrades this to a live relative time.
 */
function formatUpdatedAt(iso: string): string {
  return `${timeFmt.format(new Date(iso))} UTC`;
}

const FOOTER_LINK = LINK_QUIET;

/** The reference page, not the troubleshooting page: only this one lists what counts. */
export const COUNTING_RULES_URL =
  "https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference";

/** The disclosure trigger: a footer link that happens to unfold instead of navigate. */
const SOURCE_SUMMARY = `${FOOTER_LINK} inline-flex list-none cursor-pointer items-center gap-1.5 decoration-dotted [&::-webkit-details-marker]:hidden`;

/**
 * The note itself, lifted above the trigger so opening it never reflows the
 * footer. Its containing block is the footer column, an ancestor of the
 * `wrap-sep` line, so the separator clip never reaches it.
 */
const SOURCE_PANEL =
  "absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-[min(26rem,100%)] instrument px-3.5 py-3 text-secondary";

/**
 * One line of visible copy, everything else folded away: the provenance and
 * freshness rules only matter to a reader who asks for them, and `details`
 * answers pointer, touch and keyboard without a line of script.
 */
function sourceNoteHtml(options: PageOptions): Html {
  const cadence = options.liveCopy
    ? "Data refreshes about every 10 minutes."
    : `${options.nav && "year" in options.nav ? options.nav.year : "This year"} is final, so data is cached for 7 days.`;
  // Only the pages that actually include today can be behind on today.
  const provisional = options.provisionalToday
    ? html`<p class="mt-1.5">Today's counts may lag GitHub activity.</p>`
    : null;

  return html`<details class="group inline-block">
    <summary class="${SOURCE_SUMMARY}">
      Data sourced from GitHub
      <svg
        class="size-[0.6rem] shrink-0 transition-transform duration-200 group-open:rotate-180"
        viewBox="0 0 10 6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M1 1.4 5 4.6 9 1.4" />
      </svg>
    </summary>
    <div class="${SOURCE_PANEL}">
      <p>Contributions are read from public GitHub profile calendars. ${cadence}</p>
      ${provisional}
    </div>
  </details>`;
}

function footerHtml(options: PageOptions): Html {
  const { buildSha } = options.chrome;

  // Null on pages rendered without data, where the source note stands alone.
  const updated = options.generatedAt
    ? (() => {
        const stamp = formatUpdatedAt(options.generatedAt);
        return html`<span
          >Updated <time datetime="${options.generatedAt}" data-ago>${stamp}</time></span
        >`;
      })()
    : null;

  const shortBuildSha = buildSha.slice(0, 7);

  return html`<footer
    class="mt-footer grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-[clamp(1.5rem,4vw,3rem)] gap-y-3.5 border-t border-line-soft pt-4.5 text-meta leading-relaxed text-muted max-phone:grid-cols-[minmax(0,1fr)]"
  >
    <div class="relative min-w-0">
      <div class="wrap-sep">${sourceNoteHtml(options)}${updated}</div>
      <p class="mt-1">
        <a
          class="${FOOTER_LINK}"
          href="${COUNTING_RULES_URL}"
          target="_blank"
          rel="noreferrer noopener"
          >What counts as a contribution?</a
        >
      </p>
    </div>
    <div class="min-w-0 text-right max-phone:text-left">
      <p>leaderboard.ynga.tech</p>
      <p class="mt-1">
        <a
          class="${FOOTER_LINK}"
          href="https://github.com/yngatech/leaderboard/commit/${buildSha}"
          target="_blank"
          rel="noreferrer noopener"
          title="View deployed commit ${shortBuildSha} on GitHub"
          aria-label="View deployed source commit ${shortBuildSha} on GitHub"
          >Deployed ${shortBuildSha}</a
        >
      </p>
    </div>
  </footer>`;
}

export function pageHtml(options: PageOptions): string {
  const { chrome } = options;
  const arrows = arrowTargets(options);
  const arrowAttributes = html`${arrows.previous
    ? html` data-prev-href="${arrows.previous}"`
    : null}${arrows.next ? html` data-next-href="${arrows.next}"` : null}`;
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="dark">
    <title>git board — ${options.title}</title>
    <meta name="description" content="${options.description}">
    ${options.alternate
      ? html`<link rel="alternate" type="application/json" href="${options.alternate}">`
      : null}
    <link rel="api-catalog" type="application/linkset+json" href="/.well-known/api-catalog">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&amp;family=DM+Mono:wght@400;500&amp;display=swap" rel="stylesheet">
    <style>html { background: #0a0c18; }</style>
    <link rel="stylesheet" href="${chrome.stylesUrl}">
    <script type="module" src="${chrome.enhanceUrl}" defer></script>
  </head>
  <body${arrowAttributes}>
    <div class="relative z-[1] mx-auto max-w-[1180px] px-[clamp(1.1rem,4vw,2.5rem)] pt-4 pb-10 max-phone:pb-24 max-phone:ios:pt-15 max-phone:ios:pb-10">
      <header class="flex h-[2.875rem] items-center">
        <h1>${BRAND}</h1>
        ${navHtml(options)}
      </header>
      ${options.main}
      ${footerHtml(options)}
    </div>
  </body>
</html>
`.toString();
}
