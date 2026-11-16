import { MIN_INSIGHT_PRS, type AttributionCount, type CreditRole, type CreditRow, type Intent, type PrInsights } from "../insights.ts";
import { formatAgo, formatNumber } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { BUTTON_QUIET, CARD, LEDGER_TERM, LEDGER_VALUE, LINK, sectionHeadingHtml } from "./ui.ts";
import { agentIcon } from "./agent-icons.ts";

const LABELS: Record<Intent, string> = { feat: "features", fix: "fixes", refactor: "refactoring", docs: "docs", test: "tests", chore: "maintenance", perf: "performance", ci: "CI & build", deps: "dependencies", unknown: "unknown" };
const COLORS = ["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-public"];
// Brand colours: Simple Icons 16.35.0 catalogue; OpenAI is monochrome.
// Clay is Claude's accent for Anthropic; neutral brands use light ink on this dark panel.
const BRAND_COLORS = new Map([
  ["Anthropic", "#D97757"], ["Claude Code", "#D97757"], ["OpenAI", "#F5F5F5"], ["Codex", "#F5F5F5"],
  ["Google", "#4285F4"], ["Gemini CLI", "#4285F4"], ["xAI", "#B8BEC8"],
  ["Mistral", "#FA520F"], ["DeepSeek", "#5786FE"], ["Moonshot/Kimi", "#ECEAF7"],
  ["Qwen/Alibaba", "#9C85FF"], ["Zhipu/GLM", "#B8BEC8"], ["Meta", "#4285E8"],
  ["Jules", "#A494EF"],
]);
const agentColor = (name: string) => BRAND_COLORS.get(name) ?? "#ECEAF7";
const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

// Rows past this sit in a native disclosure rather than being summed into a misleading remainder.
const MAIN_CREDITS = 6;
const ROLE_COLUMNS: [CreditRole, string][] = [["writing", "wrote"], ["review", "reviewed"], ["other", "other"], ["unspecified", "unstated"]];
const NUMBER = "py-1.5 pl-2 text-right tabular-nums align-top max-phone:p-0 max-phone:text-left max-phone:before:mr-1 max-phone:before:text-muted max-phone:before:content-[attr(data-label)]";

function providerMark(provider: string | null): Html {
  return html`<span class="mt-px shrink-0" style="color:${provider ? agentColor(provider) : "var(--color-muted)"}" title="${provider ?? "unrecognized provider"}">${agentIcon(provider ?? "")}</span>`;
}

function countCell(value: number, label: string, strong = false): Html {
  return value ? html`<td role="cell" class="${NUMBER} ${strong ? LEDGER_VALUE : "text-secondary"}" data-label="${label}">${formatNumber(value)}</td>`
    : html`<td role="cell" class="${NUMBER} text-muted max-phone:hidden" data-label="${label}"><span aria-hidden="true">–</span><span class="sr-only">0</span></td>`;
}

function creditRowHtml(row: CreditRow): Html {
  const model = row.model
    ? html`<span class="text-ink">${row.model}</span>${row.provider ? html`<span class="sr-only"> (${row.provider})</span>` : null}`
    : html`<span class="text-muted">${row.provider ? `${row.provider}, ` : ""}model not stated</span>`;
  return html`<tr role="row" class="border-t border-line-soft max-phone:flex max-phone:flex-wrap max-phone:gap-x-3 max-phone:gap-y-1 max-phone:py-2">
    <th role="rowheader" scope="row" class="py-1.5 pr-2 text-left align-top font-normal max-phone:basis-full max-phone:p-0"><span class="flex items-start gap-1.5">${providerMark(row.provider)}<span class="min-w-0 wrap-anywhere">${model}</span></span></th>
    <td role="cell" class="py-1.5 pr-2 align-top max-phone:basis-full max-phone:p-0 max-phone:pl-5">${row.harness
      ? html`<span class="inline-flex items-start gap-1.5 text-secondary"><span class="mt-px shrink-0" style="color:${agentColor(row.harness)}">${agentIcon(row.harness)}</span>${row.harness}</span>`
      : html`<span class="text-muted">harness not stated</span>`}</td>
    ${countCell(row.prs, "PRs", true)}
    ${ROLE_COLUMNS.map(([role, label]) => countCell(row.roles[role], label))}
  </tr>`;
}

function creditTableHtml(rows: CreditRow[], caption: string, visibleHead: boolean): Html {
  return html`<table role="table" class="w-full table-fixed border-collapse text-meta max-phone:block">
    <caption class="sr-only">${caption}</caption>
    <colgroup><col><col class="w-[8.5rem]">${[0, 1, 2, 3, 4].map(() => html`<col class="w-[4.5rem]">`)}</colgroup>
    <thead role="rowgroup" class="${visibleHead ? "text-fine text-muted max-phone:sr-only" : "sr-only"}"><tr role="row">
      <th role="columnheader" scope="col" class="pb-1 text-left font-normal">model</th>
      <th role="columnheader" scope="col" class="pb-1 text-left font-normal">harness</th>
      <th role="columnheader" scope="col" class="pb-1 text-right font-normal">PRs</th>
      ${ROLE_COLUMNS.map(([, label]) => html`<th role="columnheader" scope="col" class="pb-1 text-right font-normal">${label}</th>`)}
    </tr></thead>
    <tbody role="rowgroup" class="max-phone:block">${rows.map(creditRowHtml)}</tbody>
  </table>`;
}

function chipsHtml(term: string, label: string, entries: AttributionCount[]): Html | null {
  return entries.length ? html`<div class="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-fine text-secondary"><span>${term}</span><ul class="flex flex-wrap gap-x-2 gap-y-1" aria-label="${label}">${entries.map((entry) => html`<li class="inline-flex items-center gap-1 rounded-full border border-line-soft px-2 py-0.5"><span style="color:${agentColor(entry.name)}">${agentIcon(entry.name)}</span>${entry.name} <span>${formatNumber(entry.count)}</span></li>`)}</ul></div>` : null;
}

function agentCreditsHtml(data: PrInsights): Html {
  const agents = data.agents;
  const credits = agents.credits;
  const shown = credits.length > MAIN_CREDITS + 1 ? credits.slice(0, MAIN_CREDITS) : credits;
  const rest = credits.slice(shown.length);
  const pairs = agents.pairs.filter((pair) => pair.writer !== pair.reviewer).slice(0, 3);
  return html`<div class="mt-5 border-t border-line-soft pt-4">
      <h3 class="${LEDGER_TERM}">agent credits</h3>
      <p class="mt-1"><strong class="${LEDGER_VALUE}">${formatNumber(agents.attributed)}</strong> of ${formatNumber(data.total)} public PRs carry recognized credits</p>
      ${credits.length ? html`<div class="mt-3">${creditTableHtml(shown, "Credited models and harnesses: PRs per declared role", true)}</div>
      ${rest.length ? html`<details class="group/credits mt-2">
        <summary class="${BUTTON_QUIET} w-fit list-none [&::-webkit-details-marker]:hidden"><span class="group-open/credits:hidden">Show ${formatNumber(rest.length)} more</span><span class="hidden group-open/credits:inline">Show fewer</span></summary>
        <div class="mt-2">${creditTableHtml(rest, "More credited models and harnesses", false)}</div>
      </details>` : null}` : null}
      ${pairs.length ? html`<div class="mt-4 text-meta">
        <h4 class="${LEDGER_TERM}">different writer and reviewer models</h4>
        <ul class="mt-1.5 max-w-[42rem] space-y-1" aria-label="Different writer and reviewer models on the same PR">${pairs.map((pair) => html`<li class="flex items-baseline justify-between gap-3"><span class="min-w-0 wrap-anywhere"><span class="text-ink">${pair.writer}</span> wrote, <span class="text-ink">${pair.reviewer}</span> reviewed</span><span class="shrink-0 tabular-nums">${formatNumber(pair.prs)} PR${pair.prs === 1 ? "" : "s"}</span></li>`)}</ul>
      </div>` : null}
      ${chipsHtml("harnesses", "Agent harnesses", agents.harnesses)}
      ${chipsHtml("hosts", "Agent hosts", agents.hosts)}
      ${credits.length ? html`<p class="mt-3 text-fine leading-relaxed text-muted">Each row counts PRs, once per role. A PR can credit several models and roles, so rows overlap. Unstated means an agent was named without saying what it did, as in commit identities and generated-with lines.</p>` : null}
      <p class="mt-1 text-fine text-muted">Unmarked PRs remain unknown.${agents.incompleteCommits ? ` Commit attribution incomplete for ${formatNumber(agents.incompleteCommits)} PR${agents.incompleteCommits === 1 ? "" : "s"}.` : ""}</p>
      ${agents.incompleteCredits ? html`<p class="mt-1 text-fine text-muted">Credit parsing limited for ${formatNumber(agents.incompleteCredits)} PR${agents.incompleteCredits === 1 ? "" : "s"} with unusually long or numerous credits.</p>` : null}
    </div>`;
}

export function insightsHtml(data: PrInsights): Html {
  const heading = sectionHeadingHtml("PR style", {
    first: true,
    headingId: "pr-insights-heading",
    aside: html`<p class="text-meta">${formatNumber(data.total)} public PRs · ${data.year}</p>`,
  });
  if (data.total < MIN_INSIGHT_PRS) return html`<section id="pr-insights" aria-labelledby="pr-insights-heading" class="mt-section scroll-mt-4">
    ${heading}<p class="text-body leading-relaxed text-muted">Insights appear after at least ${MIN_INSIGHT_PRS} public PRs.</p>
  </section>`;
  const size = data.size;
  const intents = Object.entries(data.intent.mix) as [Intent, number][];
  const maxBucket = Math.max(1, ...size.buckets.map((b) => b.count));
  return html`<section id="pr-insights" aria-labelledby="pr-insights-heading" class="mt-section scroll-mt-4">
    ${heading}
    <div class="${CARD} border-line-soft px-card-x py-card-y text-body leading-relaxed text-secondary">
    <div class="grid grid-cols-2 gap-7 max-phone:grid-cols-1">
      <div>
        <h3 class="${LEDGER_TERM}">size</h3>
        ${size.measured >= MIN_INSIGHT_PRS ? html`<dl class="my-3 flex flex-wrap gap-x-7 gap-y-2">
          <div><dt>median lines</dt><dd class="mt-1 type-figure-lg text-accent">${formatNumber(size.median!)}</dd></div>
          <div><dt>small PRs (&lt;100 lines)</dt><dd class="mt-1 type-figure-lg text-ink">${percent(size.smallShare!)}</dd></div>
        </dl>
        <ul class="space-y-1.5" aria-label="PR size histogram">
          ${size.buckets.map((bucket, i) => html`<li class="grid grid-cols-[2rem_1fr_3rem] items-center gap-2"><span>${bucket.label}</span><span class="h-1.5 rounded-cell ${COLORS[i]}" style="width:${100 * bucket.count / maxBucket}%"></span><span class="text-right tabular-nums">${formatNumber(bucket.count)}</span></li>`)}
        </ul>
        <p class="mt-2 text-fine text-muted">XS 0–9 · S 10–99 · M 100–499 · L 500–999 · XL 1,000+ lines</p>
        ${size.biggestNetDeletion ? html`<p class="mt-3">biggest net deletion: <a class="${LINK}" href="${size.biggestNetDeletion.url}" target="_blank" rel="noreferrer noopener">${formatNumber(size.biggestNetDeletion.lines)} lines ↗</a></p>` : null}` : html`<p class="mt-3 text-muted">Not enough complete file lists to show size statistics.</p>`}
        <p class="mt-2 text-fine text-muted">Common lockfiles and generated files excluded.${size.incomplete ? html` ${formatNumber(size.incomplete)} PRs omitted with incomplete file lists.` : null}</p>
      </div>
      <div>
        <h3 class="${LEDGER_TERM} mb-3">intent mix</h3>
        <ul class="space-y-1">
          ${intents.filter(([intent, count]) => count > 0 || intent === "unknown").map(([intent, count]) => html`<li class="flex items-baseline justify-between gap-3 ${intent === "unknown" ? "text-muted" : ""}"><span>${LABELS[intent]}</span><span class="tabular-nums"><strong class="${LEDGER_VALUE}">${formatNumber(count)}</strong> <span class="inline-block w-[4.5rem] text-right">${percent(count / data.total)}</span></span></li>`)}
        </ul>
      </div>
    </div>
    ${agentCreditsHtml(data)}
    <p class="mt-3 text-fine text-muted">updated <time datetime="${data.generatedAt}" data-ago>${formatAgo(data.generatedAt)}</time></p>
    </div>
  </section>`;
}
