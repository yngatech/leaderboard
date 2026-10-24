import { MIN_INSIGHT_PRS, type Intent, type PrInsights } from "../insights.ts";
import { formatAgo, formatNumber } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { CARD, LEDGER_TERM, LEDGER_VALUE } from "./card-styles.ts";

const LABELS: Record<Intent, string> = { feat: "features", fix: "fixes", refactor: "refactoring", docs: "docs", test: "tests", chore: "maintenance", perf: "performance", ci: "CI", build: "build", deps: "dependencies", unknown: "unknown" };
const COLORS = ["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-public"];
const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

export function insightsHtml(data: PrInsights): Html {
  if (data.total < MIN_INSIGHT_PRS) return html`<section id="pr-insights" class="text-[0.75rem] leading-[1.7] text-faint"><p>PR style needs at least ${MIN_INSIGHT_PRS} public PRs opened this year; ${formatNumber(data.total)} found.</p></section>`;
  const size = data.size;
  const intents = Object.entries(data.intent.mix) as [Intent, number][];
  const maxBucket = Math.max(1, ...size.buckets.map((b) => b.count));
  return html`<section id="pr-insights" aria-label="PR style" class="${CARD} border-line-soft px-[1.3rem] py-[1.15rem] text-[0.75rem] leading-[1.7] text-dim max-phone:px-4">
    <header class="mb-5"><h3 class="font-display text-[24px] font-bold tracking-[-0.03em] text-ink">PR style <span class="text-dim">/ ${data.year}</span></h3>
      <p>${formatNumber(data.total)} public PRs opened across ${data.accounts.join(" + ")}. All states; forks included.</p></header>
    <div class="grid grid-cols-2 gap-7 max-phone:grid-cols-1">
      <div>
        <h4 class="${LEDGER_TERM}">size · additions + deletions</h4>
        ${size.measured >= MIN_INSIGHT_PRS ? html`<dl class="my-3 flex flex-wrap gap-x-7 gap-y-2">
          <div><dt>median lines</dt><dd class="${LEDGER_VALUE} font-display text-[30px] leading-tight text-accent">${formatNumber(size.median!)}</dd></div>
          <div><dt>small PRs (&lt;100 lines)</dt><dd class="${LEDGER_VALUE} font-display text-[30px] leading-tight">${percent(size.smallShare!)}</dd></div>
        </dl>
        <ul class="space-y-1.5" aria-label="PR size histogram">
          ${size.buckets.map((bucket, i) => html`<li class="grid grid-cols-[2rem_1fr_3rem] items-center gap-2"><span>${bucket.label}</span><span class="h-2 rounded-[2px] ${COLORS[i]}" style="width:${100 * bucket.count / maxBucket}%"></span><span class="text-right tabular-nums">${formatNumber(bucket.count)}</span></li>`)}
        </ul>
        <p class="mt-2 text-[0.66rem] text-faint">XS 0–9 · S 10–99 · M 100–499 · L 500–999 · XL 1,000+ lines</p>
        ${size.biggestNetDeletion ? html`<p class="mt-3">Biggest net deletion: <a class="text-ink underline hover:text-accent" href="${size.biggestNetDeletion.url}" target="_blank" rel="noreferrer noopener">${formatNumber(size.biggestNetDeletion.lines)} lines ↗</a></p>` : null}` : html`<p class="mt-3 text-faint">Not enough complete file lists to show size statistics.</p>`}
        <p class="mt-2 text-[0.69rem] text-faint">${formatNumber(size.measured)} complete file lists; ${formatNumber(size.incomplete)} unavailable or over 100 files excluded from size.</p>
      </div>
      <div>
        <h4 class="${LEDGER_TERM} mb-3">intent mix</h4>
        <ul class="space-y-1">
          ${intents.filter(([intent, count]) => count > 0 || intent === "unknown").map(([intent, count]) => html`<li class="flex items-baseline justify-between gap-3 ${intent === "unknown" ? "text-faint" : ""}"><span>${LABELS[intent]}</span><span class="tabular-nums"><strong class="${LEDGER_VALUE}">${formatNumber(count)}</strong> <span class="inline-block w-[4.5rem] text-right">${percent(count / data.total)}</span></span></li>`)}
        </ul>
        <p class="mt-3 text-[0.69rem] text-faint">Title → branch → exclusive paths. ${formatNumber(data.intent.scopedTitles)} titles use an area scope; areas alone leave intent unknown.</p>
      </div>
    </div>
    <div class="mt-5 border-t border-line-soft pt-4">
      <h4 class="${LEDGER_TERM}">agent-attributed</h4>
      <p class="mt-1"><strong class="${LEDGER_VALUE} font-display text-[30px] leading-tight text-accent">${percent(data.agents.share!)}</strong> <span class="ml-2">${formatNumber(data.agents.attributed)} of ${formatNumber(data.total)} PRs carry a recognized marker</span></p>
      <ul class="mt-2 flex flex-wrap gap-2" aria-label="Attributed agents">${data.agents.agents.map((agent) => html`<li class="rounded-full border border-line px-2.5 py-0.5 text-ink">${agent.name} <span class="text-dim">${formatNumber(agent.count)}</span></li>`)}</ul>
      <p class="mt-3 text-[0.69rem] text-faint">${formatNumber(data.agents.evidence.bodyFooter)} body disclosures · ${formatNumber(data.agents.evidence.commitTrailer)} commit trailers · ${formatNumber(data.agents.evidence.commitAuthor)} commit author identities · ${formatNumber(data.agents.evidence.prAuthor)} PR author identities. Categories and agents can overlap.</p>
      <p class="mt-1 text-[0.69rem] text-faint">Markers can describe prose, coding or other assistance, including inherited commits. Unmarked work is unknown. First 50 commits and 5 authors per commit inspected; ${formatNumber(data.agents.incompleteCommits)} PRs have incomplete commit evidence.</p>
    </div>
    <details class="mt-4 border-t border-line-soft pt-3 text-[0.69rem] text-faint"><summary class="cursor-pointer text-dim">How to read this prototype</summary>
      <p class="mt-2">Size excludes common lockfiles, dist/build/vendor/generated/node_modules directories, minified JS, maps and snapshots. Path rules are heuristics. Size describes workflow, not productivity. Intent is declared or inferred from metadata.</p>
      <p class="mt-2">Public PRs created in ${data.year}, deduplicated across accounts. This is a different cohort from contribution totals. Refreshed <time datetime="${data.generatedAt}" data-ago>${formatAgo(data.generatedAt)}</time>; background refresh runs about daily. <a class="underline hover:text-accent" href="/api/users/${data.login}/insights">Summary JSON</a></p>
    </details>
  </section>`;
}
