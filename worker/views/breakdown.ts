import type { ContributionBreakdown, ContributionKind } from "../../shared/types.ts";
import { formatDayYear, formatNumber } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { COUNTING_RULES_URL, SOURCE_SUMMARY, sourceChevronHtml } from "./layout.ts";

const LABELS: Record<ContributionKind, string> = {
  commits: "Commits",
  pullRequests: "Pull requests",
  issues: "Issues",
  reviews: "Reviews",
  repositories: "Repositories created",
};
const COLORS: Record<ContributionKind, string> = {
  commits: "bg-heat-4",
  pullRequests: "bg-heat-3",
  issues: "bg-heat-2",
  reviews: "bg-heat-1",
  repositories: "bg-dim",
};
const UNITS: Record<ContributionKind, [string, string]> = {
  commits: ["commit", "commits"],
  pullRequests: ["PR", "PRs"],
  issues: ["issue", "issues"],
  reviews: ["review", "reviews"],
  repositories: ["repository", "repositories"],
};

export function countingNoteHtml(): Html {
  return html`<details
    class="group open:basis-full text-[0.7rem] leading-[1.7] tracking-normal text-dim normal-case"
  >
    <summary class="${SOURCE_SUMMARY}">How GitHub counts these ${sourceChevronHtml()}</summary>
    <div class="mt-3 max-w-[75ch] rounded-xl border border-line-soft bg-panel p-4">
      <p>
        Commits count only on a repository's default branch (or gh-pages), and only when made with
        an email address linked to the account.
      </p>
      <p>A commit is dated by its author date, not when it was pushed or committed.</p>
      <p>Issues, pull requests and reviews count when they are opened or submitted.</p>
      <p>
        Private contributions show only as a count, and only if the person has turned on private
        contribution sharing.
      </p>
      <p>
        GitHub's counting does not always match its documentation, so these are the numbers GitHub
        reports.
      </p>
      <a
        class="text-accent underline"
        href="${COUNTING_RULES_URL}"
        target="_blank"
        rel="noreferrer noopener"
        >GitHub contribution reference</a
      >
    </div>
  </details>`;
}

export function breakdownHtml(data: ContributionBreakdown): Html {
  const day = data.window.kind === "day";
  const caption =
    data.window.kind === "day"
      ? `on ${formatDayYear(data.window.date)}`
      : `in ${data.window.year} so far`;
  const segments = [
    ...data.kinds.map((k) => ({
      label: LABELS[k.kind],
      count: k.total,
      color: COLORS[k.kind],
    })),
    { label: "Private", count: data.private, color: "breakdown-private" },
    {
      label: "Other (not attributed by GitHub's API)",
      count: Math.max(0, data.other),
      color: "bg-faint",
    },
  ].filter((s) => s.count > 0);
  // When GitHub's type counts exceed its calendar, normalize the visual split
  // to the reported type sum; preserve both exact counts and discrepancy in text.
  const sum = segments.reduce((n, s) => n + s.count, 0);
  const percentage = (count: number) => (sum ? (count / sum) * 100 : 0);
  const repos = new Map<string, { name: string; url: string; count: number; split: string[] }>();
  for (const kind of data.kinds) {
    for (const repo of kind.repositories) {
      const key = repo.nameWithOwner.toLowerCase();
      const found = repos.get(key) ?? {
        name: repo.nameWithOwner,
        url: repo.url,
        count: 0,
        split: [],
      };
      found.count += repo.count;
      found.split.push(`${formatNumber(repo.count)} ${UNITS[kind.kind][repo.count === 1 ? 0 : 1]}`);
      repos.set(key, found);
    }
  }
  const ordered = [...repos.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
  const remainder =
    ordered.slice(10).reduce((n, r) => n + r.count, 0) +
    data.kinds.reduce((n, k) => n + k.unlisted, 0);
  return html`<section
    id="${day ? "day-breakdown" : "year-breakdown"}"
    class="mt-4 rounded-2xl border border-line-soft bg-panel p-5 text-[0.75rem] leading-[1.7] text-dim"
  >
    ${day ? html`<a class="text-accent underline" href="/u/${data.login}">← whole year</a>` : null}
    <h3 class="mb-4 font-display text-lg font-bold text-ink">
      ${formatNumber(data.calendarTotal)} contributions ${caption}
    </h3>
    <div
      role="img"
      aria-label="${formatNumber(data.calendarTotal)} contributions ${caption}: ${segments.map((s) => `${s.label}: ${formatNumber(s.count)}`).join(", ")}${data.other < 0 ? "; split normalized to per-type counts" : ""}"
      class="flex h-5 overflow-hidden rounded-sm bg-faint"
    >
      ${segments.map((s) => html`<div class="${s.color} shrink-0" style="width:${percentage(s.count)}%" data-breakdown-count="${s.count}"></div>`)}
    </div>
    <ul class="my-4 flex flex-wrap gap-x-6 gap-y-2">
      ${segments.map((s) => html`<li class="flex items-center gap-2"><span aria-hidden="true" class="${s.color} inline-block size-3 rounded-xs"></span>${s.label}: ${formatNumber(s.count)} <span class="text-dimmer">(${percentage(s.count).toFixed(1)}%)</span></li>`)}
    </ul>
    ${data.other < 0 ? html`<p>GitHub's per-type counts come to ${formatNumber(-data.other)} more than its calendar total.</p>` : null}
    ${
      ordered.length
        ? html`<h4 class="mt-5 mb-2 text-ink">Top public repositories</h4>
            <ol class="divide-y divide-line-soft">
              ${ordered.slice(0, 10).map(
                (r) =>
                  html`<li class="flex flex-wrap justify-between gap-x-4 py-2">
                    <a
                      class="break-all text-ink underline hover:text-accent"
                      href="${r.url}"
                      target="_blank"
                      rel="noreferrer noopener"
                      >${r.name}</a
                    ><span
                      >${formatNumber(r.count)}
                      <span class="text-dimmer">(${r.split.join(" · ")})</span></span
                    >
                  </li>`,
              )}
            </ol>`
        : null
    }
    ${remainder > 0 ? html`<p class="mt-3">and ${formatNumber(remainder)} more contributions in other repositories</p>` : null}
  </section>`;
}
