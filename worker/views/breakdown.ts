import type { ContributionBreakdown, ContributionKind } from "../../shared/types.ts";
import { formatDayLong, formatNumber } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { CARD, CARD_LEDGER, LEDGER_TERM, LEDGER_VALUE } from "./card-styles.ts";

const LABELS: Record<ContributionKind, string> = {
  commits: "commits",
  pullRequests: "pull requests",
  issues: "issues",
  reviews: "reviews",
  repositories: "repos created",
};
const COLORS: Record<ContributionKind, string> = {
  commits: "bg-heat-4",
  pullRequests: "bg-heat-3",
  issues: "bg-heat-2",
  reviews: "bg-heat-1",
  repositories: "bg-muted",
};
const UNITS: Record<ContributionKind, [string, string]> = {
  commits: ["commit", "commits"],
  pullRequests: ["PR", "PRs"],
  issues: ["issue", "issues"],
  reviews: ["review", "reviews"],
  repositories: ["repo created", "repos created"],
};
const CAPTIONS: Record<ContributionKind, string> = {
  commits: "default branch, linked email, by author date",
  pullRequests: "counted when opened",
  issues: "counted when opened",
  reviews: "counted when submitted",
  repositories: "new repositories",
};
interface Segment {
  label: string;
  count: number;
  color: string;
}

function publicSegments(data: ContributionBreakdown): Segment[] {
  return data.kinds.filter((k) => k.total > 0).map((k) => ({
    label: LABELS[k.kind], count: k.total, color: COLORS[k.kind],
  }));
}

function hiddenSegments(data: ContributionBreakdown): Segment[] {
  return [
    { label: "private", count: data.private, color: "breakdown-private" },
    { label: "not itemised", count: data.other, color: "bg-muted" },
  ].filter((s) => s.count > 0);
}

function barHtml(parts: Segment[], height: string): Html {
  return html`<div role="img" aria-label="${parts.map((s) => `${s.label}: ${formatNumber(s.count)}`).join(", ") || "0 contributions"}"
    class="flex ${height} gap-[2px] overflow-hidden rounded-[3px]">
    ${parts.map((s) => html`<span class="${s.color} min-w-[2px]" style="flex:${s.count} 0 0" data-breakdown-count="${s.count}"></span>`)}
  </div>`;
}

function splitHtml(parts: Segment[]): Html {
  return html`<ul class="mt-2 flex flex-wrap gap-x-[22px] gap-y-1 text-[0.72rem]">
    ${parts.map((s) => html`<li><strong class="${LEDGER_VALUE}">${formatNumber(s.count)}</strong> ${s.label}</li>`)}
  </ul>`;
}

function discrepancyHtml(data: ContributionBreakdown): Html | null {
  return data.other < 0 ? html`<p class="mt-2 text-[0.72rem] text-muted">GitHub's per-type counts come to ${formatNumber(-data.other)} more than its calendar total.</p>` : null;
}

/** Public repositories merge across kinds; a capped kind leaves the remainder's repository count unknown. */
function repositoriesHtml(data: ContributionBreakdown, limit: number): Html {
  const repos = new Map<string, { name: string; url: string; count: number; parts: Segment[] }>();
  for (const kind of data.kinds) {
    for (const repo of kind.repositories) {
      if (repo.count <= 0) continue;
      const key = repo.nameWithOwner.toLowerCase();
      const found = repos.get(key) ?? { name: repo.nameWithOwner, url: repo.url, count: 0, parts: [] };
      found.count += repo.count;
      found.parts.push({ label: UNITS[kind.kind][repo.count === 1 ? 0 : 1], count: repo.count, color: COLORS[kind.kind] });
      repos.set(key, found);
    }
  }
  const ordered = [...repos.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const unlisted = data.kinds.reduce((n, k) => n + k.unlisted, 0);
  const rest = ordered.slice(limit);
  const remainder = rest.reduce((n, r) => n + r.count, 0) + unlisted;
  return html`<ol>
    ${ordered.slice(0, limit).map((r) => {
      const split = [...r.parts].sort((a, b) => b.count - a.count).map((s) => `${formatNumber(s.count)} ${s.label}`).join(" · ");
      return html`<li class="grid grid-cols-[minmax(0,15rem)_minmax(0,1fr)_3.5rem] items-center gap-3.5 py-[5px] max-phone:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_2.5rem] max-phone:gap-2">
        <a class="truncate text-ink hover:text-accent hover:underline" href="${r.url}" target="_blank" rel="noreferrer noopener">${r.name}</a>
        <div><div style="width:${(r.count / ordered[0].count) * 100}%">${barHtml(r.parts, "h-[6px]")}</div></div>
        <span class="text-right tabular-nums" title="${split}">${formatNumber(r.count)}<span class="sr-only">: ${split}</span></span>
      </li>`;
    })}
  </ol>
  ${remainder > 0 ? html`<p class="mt-1.5 text-[0.72rem] text-muted">and ${formatNumber(remainder)} more in ${unlisted > 0 ? "other repositories" : `${formatNumber(rest.length)} other ${rest.length === 1 ? "repository" : "repositories"}`}</p>` : null}`;
}

function contributions(count: number): string {
  return count === 1 ? "contribution" : "contributions";
}

export function breakdownHtml(data: ContributionBreakdown): Html {
  const kinds = publicSegments(data);
  const publicTotal = kinds.reduce((n, s) => n + s.count, 0);
  const parts = [
    ...(publicTotal > 0 ? [{ label: "public", count: publicTotal, color: "bg-public" }] : []),
    ...hiddenSegments(data),
  ];
  const year = data.window.kind === "year" ? data.window.year : Number(data.window.date.slice(0, 4));
  return html`<section id="year-breakdown" class="${CARD} border-line-soft px-[1.3rem] py-[1.15rem] font-mono text-[0.75rem] leading-[1.7] text-secondary max-phone:px-4">
    <header class="mb-3.5"><h3><strong class="mr-1.5 font-display text-[30px] leading-none font-extrabold tracking-[-0.03em] tabular-nums text-accent">${formatNumber(data.calendarTotal)}</strong> ${contributions(data.calendarTotal)} in ${year} so far</h3></header>
    ${barHtml(parts, "h-[10px]")}${splitHtml(parts)}${discrepancyHtml(data)}
    ${publicTotal > 0 ? html`
      <h4 class="${LEDGER_TERM} mt-[22px] mb-2.5">public, by type</h4>
      ${barHtml(kinds, "h-[14px]")}
      <dl class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-[18px] gap-y-3">
        ${data.kinds.filter((k) => k.total > 0).map((k) => html`<div>
          <dt class="${LEDGER_TERM} flex items-center gap-1.5"><span aria-hidden="true" class="${COLORS[k.kind]} inline-block size-2 rounded-[2px]"></span>${LABELS[k.kind]}</dt>
          <dd class="mt-0.5"><strong class="${LEDGER_VALUE} text-[15px]">${formatNumber(k.total)}</strong><span class="block text-[0.72rem] leading-[1.4] text-muted">${CAPTIONS[k.kind]}</span></dd>
        </div>`)}
      </dl>
      <h4 class="${LEDGER_TERM} mt-[22px] mb-2.5">top repositories</h4>
      ${repositoriesHtml(data, 5)}` : html`<p class="mt-4 text-muted">No public contributions to break down this year.</p>`}
  </section>`;
}

export function dayBreakdownHtml(
  date: string,
  data: ContributionBreakdown | null,
  login: string,
  pageYear: number,
  /** The heatmap cell and year labels the panel was measured against. */
  measured?: { cell: string; year: string },
): Html {
  const tags = measured
    ? html` data-cell-label="${measured.cell}" data-year-label="${measured.year}"`
    : null;
  const close = html`<a data-day-close class="shrink-0 text-[0.72rem] text-secondary hover:text-accent" href="/u/${login}#year">close ×</a>`;
  if (!data || data.window.kind !== "day") {
    return html`<section id="day-breakdown" data-date="${date}"${tags} class="${CARD_LEDGER} flex items-baseline justify-between gap-4 text-[0.75rem] text-muted"><p>Breakdown unavailable for this day right now.</p>${close}</section>`;
  }
  const caption = formatDayLong(date).replace(",", "");
  const parts = publicSegments(data);
  const labels = parts.map((s) => ({ ...s, label: s.count === 1 ? (s.label === "pull requests" ? "pull request" : s.label === "repos created" ? "repo created" : s.label.slice(0, -1)) : s.label })).sort((a, b) => b.count - a.count);
  return html`<section id="day-breakdown" data-date="${date}"${tags} class="${CARD_LEDGER} font-mono text-[0.75rem] leading-[1.7] text-secondary">
    <header class="mb-3.5 flex items-baseline justify-between gap-4"><h3><strong class="mr-1.5 font-display text-xl leading-none font-extrabold tracking-[-0.03em] tabular-nums text-accent">${formatNumber(data.calendarTotal)}</strong> ${contributions(data.calendarTotal)} on ${Number(date.slice(0, 4)) === pageYear ? caption.replace(/ \d{4}$/, "") : caption}</h3>${close}</header>
    ${barHtml([...parts, ...hiddenSegments(data)], "h-[10px]")}
    ${splitHtml([...labels, ...hiddenSegments(data)])}${discrepancyHtml(data)}
    ${parts.length > 0 ? html`<div class="mt-3">${repositoriesHtml(data, 4)}</div>` : null}
  </section>`;
}
