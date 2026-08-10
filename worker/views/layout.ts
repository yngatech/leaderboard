import { attr, escapeHtml } from "../html.ts";

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

/** Fixed inputs the shell needs on every page. */
export interface SiteChrome {
  /** The year in progress, which decides `/` and the nav's right edge. */
  thisYear: number;
  /** Fingerprinted asset URLs, resolved by the worker's own `?url` imports. */
  stylesUrl: string;
  enhanceUrl: string;
  /** The deployed commit, linked from the footer. */
  buildSha: string;
}

export interface PageOptions {
  chrome: SiteChrome;
  /** Suffix after "git board — " in the tab title. */
  title: string;
  description: string;
  /** Which view the header nav describes; null renders no nav at all. */
  nav: { kind: "year"; year: number } | { kind: "all" } | { kind: "user" } | null;
  /** ISO timestamp the data was generated, for the footer's Updated link. */
  generatedAt?: string | null;
  /** Live pages refresh on the half hour; archived years sit still. */
  liveCopy?: boolean;
  main: string;
}

const NAV_LINK =
  "min-w-16 text-center text-[0.78rem] whitespace-nowrap text-dim no-underline hover:text-accent max-phone:min-w-[3.4rem]";
const NAV_CURRENT =
  "font-display text-[clamp(1.9rem,5vw,2.6rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums";
const NAV_SPACER = `<span class="min-w-16 max-phone:min-w-[3.4rem]" aria-hidden="true"></span>`;

function navHtml(options: PageOptions): string {
  const nav = options.nav;
  if (nav === null) return "";
  const { thisYear } = options.chrome;

  let items = "";
  if (nav.kind === "all") {
    items = `<a class="${NAV_LINK}" href="/" aria-label="Show ${thisYear}">← ${thisYear}</a><span class="${NAV_CURRENT}">all time</span>`;
  } else if (nav.kind === "user") {
    items = `<a class="${NAV_LINK}" href="/" aria-label="Show ${thisYear}">← board</a><a class="${NAV_LINK}" href="/all">all time</a>`;
  } else {
    const previous =
      nav.year - 1 >= MIN_PAGE_YEAR
        ? `<a class="${NAV_LINK}" href="${hrefForYear(nav.year - 1, thisYear)}" aria-label="Show ${nav.year - 1}">← ${nav.year - 1}</a>`
        : NAV_SPACER;
    const next =
      nav.year + 1 <= thisYear
        ? `<a class="${NAV_LINK}" href="${hrefForYear(nav.year + 1, thisYear)}" aria-label="Show ${nav.year + 1}">${nav.year + 1} →</a>`
        : NAV_SPACER;
    items = `${previous}<span class="${NAV_CURRENT}">${nav.year}</span>${next}<a class="${NAV_LINK}" href="/all">all time</a>`;
  }

  return `<nav class="flex items-baseline justify-self-end gap-[clamp(0.6rem,2vw,1.2rem)] max-phone:justify-self-start max-phone:gap-[0.9rem]" aria-label="View">${items}</nav>`;
}

/**
 * Where the arrow keys go from here, carried as data attributes so the
 * enhancement script never re-derives routing. Absent attributes mean the
 * edge of the range.
 */
function arrowTargets(options: PageOptions): string {
  const nav = options.nav;
  const { thisYear } = options.chrome;
  if (nav === null || nav.kind === "user") return "";
  if (nav.kind === "all") return ` data-prev-href="${attr(hrefForYear(thisYear, thisYear))}"`;
  const previous =
    nav.year - 1 >= MIN_PAGE_YEAR ? ` data-prev-href="${attr(hrefForYear(nav.year - 1, thisYear))}"` : "";
  const next =
    nav.year < thisYear ? ` data-next-href="${attr(hrefForYear(nav.year + 1, thisYear))}"` : ` data-next-href="/all"`;
  return `${previous}${next}`;
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

function footerHtml(options: PageOptions): string {
  const { buildSha } = options.chrome;
  const cadence = options.liveCopy
    ? "Refreshes about every 30 minutes."
    : `${options.nav?.kind === "year" ? options.nav.year : "This year"} is final and cached for 7 days.`;

  let updated = "";
  if (options.generatedAt) {
    const stamp = formatUpdatedAt(options.generatedAt);
    updated = ` <a class="text-dim underline decoration-current/40 underline-offset-[3px] transition-colors hover:text-accent" href="https://github.com/yngatech/leaderboard/commit/${attr(buildSha)}" target="_blank" rel="noreferrer noopener" title="View deployed commit ${attr(buildSha.slice(0, 7))} on GitHub" aria-label="Data updated ${attr(stamp)}; view deployed source commit on GitHub">Updated <time datetime="${attr(options.generatedAt)}" data-ago>${escapeHtml(stamp)}</time>.</a>`;
  }

  return `<footer class="mt-[clamp(2.5rem,6vw,4rem)] flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-line-soft pt-[1.1rem] text-[0.68rem] leading-[1.6] text-dimmer"><p>Pulled from the GitHub GraphQL API. ${cadence}${updated}</p><p class="tracking-[0.16em] uppercase">leaderboard.ynga.tech</p></footer>`;
}

export function pageHtml(options: PageOptions): string {
  const { chrome } = options;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="dark">
    <title>git board — ${escapeHtml(options.title)}</title>
    <meta name="description" content="${attr(options.description)}">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&amp;family=DM+Mono:wght@300;400;500&amp;display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${attr(chrome.stylesUrl)}">
    <script type="module" src="${attr(chrome.enhanceUrl)}" defer></script>
  </head>
  <body${arrowTargets(options)}>
    <div class="relative z-[1] mx-auto max-w-[1180px] px-[clamp(1.1rem,4vw,2.5rem)] pt-[clamp(1.75rem,5vw,3.5rem)] pb-10">
      <header class="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-[clamp(1rem,4vw,3rem)] max-phone:grid-cols-[minmax(0,1fr)] max-phone:items-start">
        <div>
          <span class="block text-[0.7rem] tracking-[0.22em] text-dimmer uppercase">leaderboard.ynga.tech</span>
          <h1 class="mt-[0.45rem] font-display text-[clamp(2.6rem,7vw,4.1rem)] leading-[0.85] font-extrabold tracking-[-0.045em]">git board</h1>
        </div>
        ${navHtml(options)}
      </header>
      ${options.main}
      ${footerHtml(options)}
    </div>
  </body>
</html>
`;
}
