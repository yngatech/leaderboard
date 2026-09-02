import { html, type Html } from "../html.ts";

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
  nav: { kind: "year"; year: number } | { kind: "all" } | { kind: "user" } | null;
  /** ISO timestamp the data was generated, shown as footer freshness metadata. */
  generatedAt?: string | null;
  /** Live pages refresh on the half hour; archived years sit still. */
  liveCopy?: boolean;
  /** The page includes the current UTC day, which GitHub may still revise. */
  provisionalToday?: boolean;
  /** Machine-readable representation of this page's data. */
  alternate?: string;
  main: Html;
}

const NAV_LINK =
  "min-w-16 text-center text-[0.78rem] whitespace-nowrap text-dim no-underline hover:text-accent max-phone:min-w-[3.4rem]";
const NAV_CURRENT =
  "font-display text-[clamp(1.9rem,5vw,2.6rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums";
const NAV_SPACER = html`<span
  class="min-w-16 max-phone:min-w-[3.4rem]"
  aria-hidden="true"
></span>`;

function navHtml(options: PageOptions): Html | null {
  const nav = options.nav;
  if (nav === null) return null;
  const { thisYear } = options.chrome;

  let items: Html;
  if (nav.kind === "all") {
    items = html`<a class="${NAV_LINK}" href="/" aria-label="Show ${thisYear}"
        >← ${thisYear}</a
      ><span class="${NAV_CURRENT}">all time</span>`;
  } else if (nav.kind === "user") {
    items = html`<a class="${NAV_LINK}" href="/" aria-label="Show ${thisYear}">← board</a
      ><a class="${NAV_LINK}" href="/all">all time</a>`;
  } else {
    const previous =
      nav.year - 1 >= MIN_PAGE_YEAR
        ? html`<a
            class="${NAV_LINK}"
            href="${hrefForYear(nav.year - 1, thisYear)}"
            aria-label="Show ${nav.year - 1}"
            >← ${nav.year - 1}</a
          >`
        : NAV_SPACER;
    const next =
      nav.year + 1 <= thisYear
        ? html`<a
            class="${NAV_LINK}"
            href="${hrefForYear(nav.year + 1, thisYear)}"
            aria-label="Show ${nav.year + 1}"
            >${nav.year + 1} →</a
          >`
        : NAV_SPACER;
    items = html`${previous}<span class="${NAV_CURRENT}">${nav.year}</span>${next}<a
        class="${NAV_LINK}"
        href="/all"
        >all time</a
      >`;
  }

  return html`<nav
    class="flex items-baseline justify-self-end gap-[clamp(0.6rem,2vw,1.2rem)] max-phone:justify-self-start max-phone:gap-[0.9rem]"
    aria-label="View"
  >
    ${items}
  </nav>`;
}

/**
 * Where the arrow keys go from here, carried as data attributes so the
 * enhancement script never re-derives routing. Absent attributes mean the
 * edge of the range.
 */
function arrowTargets(options: PageOptions): { previous?: string; next?: string } {
  const nav = options.nav;
  const { thisYear } = options.chrome;
  if (nav === null || nav.kind === "user") return {};
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

const FOOTER_LINK =
  "text-dim underline decoration-current/40 underline-offset-[3px] transition-colors hover:text-accent";

/** The reference page, not the troubleshooting page: only this one lists what counts. */
const COUNTING_RULES_URL =
  "https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference";

/** The disclosure trigger: a footer link that happens to unfold instead of navigate. */
const SOURCE_SUMMARY = `${FOOTER_LINK} inline-flex list-none cursor-pointer items-center gap-[0.35rem] decoration-dotted [&::-webkit-details-marker]:hidden`;

/**
 * The note itself, lifted above the trigger so opening it never reflows the
 * footer. Its containing block is the footer column, an ancestor of the
 * `wrap-sep` line, so the separator clip never reaches it.
 */
const SOURCE_PANEL =
  "absolute bottom-[calc(100%+0.55rem)] left-0 z-20 w-[min(26rem,100%)] rounded-[0.6rem] border border-line-soft bg-panel px-[0.85rem] py-[0.7rem] text-dim shadow-[0_14px_30px_-20px_rgba(0,0,0,0.95)]";

/**
 * One line of visible copy, everything else folded away: the provenance and
 * freshness rules only matter to a reader who asks for them, and `details`
 * answers pointer, touch and keyboard without a line of script.
 */
function sourceNoteHtml(options: PageOptions): Html {
  const cadence = options.liveCopy
    ? "Data is cached for about 30 minutes."
    : `${options.nav?.kind === "year" ? options.nav.year : "This year"} is final, so data is cached for 7 days.`;
  // Only the pages that actually include today can be behind on today.
  const provisional = options.provisionalToday
    ? html`<p class="mt-[0.4rem]">Today's counts may lag GitHub activity.</p>`
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
    class="mt-[clamp(2.5rem,6vw,4rem)] grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-[clamp(1.5rem,4vw,3rem)] gap-y-[0.9rem] border-t border-line-soft pt-[1.1rem] text-[0.68rem] leading-[1.6] text-dimmer max-phone:grid-cols-[minmax(0,1fr)]"
  >
    <div class="relative min-w-0">
      <div class="wrap-sep">${sourceNoteHtml(options)}${updated}</div>
      <p class="mt-[0.25rem]">
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
      <p class="tracking-[0.16em] uppercase">leaderboard.ynga.tech</p>
      <p class="mt-[0.25rem]">
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
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&amp;family=DM+Mono:wght@300;400;500&amp;display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${chrome.stylesUrl}">
    <script type="module" src="${chrome.enhanceUrl}" defer></script>
  </head>
  <body${arrowAttributes}>
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
`.toString();
}
