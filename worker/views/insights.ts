import { MIN_INSIGHT_PRS, type Intent, type PrInsights } from "../insights.ts";
import { formatAgo, formatNumber } from "../../shared/format.ts";
import { html, type Html } from "../html.ts";
import { CARD, LEDGER_TERM, LEDGER_VALUE } from "./card-styles.ts";
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
  ["Jules", "#A494EF"], ["unknown model", "#918FB4"], ["unknown harness", "#918FB4"],
]);
const agentColor = (name: string) => BRAND_COLORS.get(name) ?? "#ECEAF7";
const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

export function insightsHtml(data: PrInsights): Html {
  const heading = html`<header class="mb-4 flex flex-wrap items-center gap-x-[0.85rem] gap-y-2 text-[0.78rem] font-medium text-secondary">
    <h2 id="pr-insights-heading">PR style</h2>
    <span class="h-px min-w-6 flex-[1_1_24px] bg-line-soft" aria-hidden="true"></span>
    <p class="text-[0.72rem]">${formatNumber(data.total)} public PRs · ${data.year}</p>
  </header>`;
  if (data.total < MIN_INSIGHT_PRS) return html`<section id="pr-insights" aria-labelledby="pr-insights-heading" class="mt-[clamp(2.25rem,5vw,3.25rem)] scroll-mt-4">
    ${heading}<p class="text-[0.75rem] leading-[1.7] text-muted">Insights appear after at least ${MIN_INSIGHT_PRS} public PRs.</p>
  </section>`;
  const size = data.size;
  const intents = Object.entries(data.intent.mix) as [Intent, number][];
  const maxBucket = Math.max(1, ...size.buckets.map((b) => b.count));
  // Provider counts overlap; unknown model accounts for markers with no detectable vendor.
  const providerMentions = data.agents.providers.reduce((sum, provider) => sum + provider.count, 0);
  return html`<section id="pr-insights" aria-labelledby="pr-insights-heading" class="mt-[clamp(2.25rem,5vw,3.25rem)] scroll-mt-4">
    ${heading}
    <div class="${CARD} border-line-soft px-[1.3rem] py-[1.15rem] text-[0.75rem] leading-[1.7] text-secondary max-phone:px-4">
    <div class="grid grid-cols-2 gap-7 max-phone:grid-cols-1">
      <div>
        <h3 class="${LEDGER_TERM}">size</h3>
        ${size.measured >= MIN_INSIGHT_PRS ? html`<dl class="my-3 flex flex-wrap gap-x-7 gap-y-2">
          <div><dt>median lines</dt><dd class="${LEDGER_VALUE} font-display text-[30px] leading-tight text-accent">${formatNumber(size.median!)}</dd></div>
          <div><dt>small PRs (&lt;100 lines)</dt><dd class="${LEDGER_VALUE} font-display text-[30px] leading-tight">${percent(size.smallShare!)}</dd></div>
        </dl>
        <ul class="space-y-1.5" aria-label="PR size histogram">
          ${size.buckets.map((bucket, i) => html`<li class="grid grid-cols-[2rem_1fr_3rem] items-center gap-2"><span>${bucket.label}</span><span class="h-2 rounded-[2px] ${COLORS[i]}" style="width:${100 * bucket.count / maxBucket}%"></span><span class="text-right tabular-nums">${formatNumber(bucket.count)}</span></li>`)}
        </ul>
        <p class="mt-2 text-[0.66rem] text-muted">XS 0–9 · S 10–99 · M 100–499 · L 500–999 · XL 1,000+ lines</p>
        ${size.biggestNetDeletion ? html`<p class="mt-3">biggest net deletion: <a class="text-ink underline hover:text-accent" href="${size.biggestNetDeletion.url}" target="_blank" rel="noreferrer noopener">${formatNumber(size.biggestNetDeletion.lines)} lines ↗</a></p>` : null}` : html`<p class="mt-3 text-muted">Not enough complete file lists to show size statistics.</p>`}
        <p class="mt-2 text-[0.69rem] text-muted">Common lockfiles and generated files excluded.${size.incomplete ? html` ${formatNumber(size.incomplete)} PRs omitted with incomplete file lists.` : null}</p>
      </div>
      <div>
        <h3 class="${LEDGER_TERM} mb-3">intent mix</h3>
        <ul class="space-y-1">
          ${intents.filter(([intent, count]) => count > 0 || intent === "unknown").map(([intent, count]) => html`<li class="flex items-baseline justify-between gap-3 ${intent === "unknown" ? "text-muted" : ""}"><span>${LABELS[intent]}</span><span class="tabular-nums"><strong class="${LEDGER_VALUE}">${formatNumber(count)}</strong> <span class="inline-block w-[4.5rem] text-right">${percent(count / data.total)}</span></span></li>`)}
        </ul>
      </div>
    </div>
    <div class="mt-5 border-t border-line-soft pt-4">
      <h3 class="${LEDGER_TERM}">agent-attributed</h3>
      <p class="mt-1"><strong class="${LEDGER_VALUE} font-display text-[30px] leading-tight text-accent">${percent(data.agents.share!)}</strong> <span class="ml-2">${formatNumber(data.agents.attributed)} of ${formatNumber(data.total)} PRs carry a recognized marker</span></p>
      ${providerMentions ? html`<div class="mt-3 flex h-2 gap-px overflow-hidden rounded-[2px]" role="img" aria-label="Model provider split within attributed PRs; PRs can count for multiple providers, including unknown model. ${data.agents.providers.map((provider) => `${provider.name}: ${formatNumber(provider.count)}`).join("; ")}">
        ${data.agents.providers.map((provider) => html`<span class="h-full min-w-0" style="flex:${provider.count} 1 0%;background:${agentColor(provider.name)}" title="${provider.name}: ${percent(provider.count / providerMentions)} of provider mentions"></span>`)}
      </div>` : null}
      ${data.agents.attributed ? html`<ul class="mt-3 flex flex-wrap gap-2" aria-label="Model providers">${data.agents.providers.map((provider) => html`<li class="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 ${provider.name === "unknown model" ? "text-secondary" : "text-ink"}"><span style="color:${agentColor(provider.name)}">${agentIcon(provider.name)}</span>${provider.name} <span class="text-secondary">${formatNumber(provider.count)}</span></li>`)}</ul>
      <div class="mt-2 flex items-baseline gap-2 text-[0.66rem] text-secondary"><span>via</span><ul class="flex flex-wrap gap-x-3 gap-y-1" aria-label="Agent harnesses">${data.agents.harnesses.map((harness) => html`<li class="inline-flex items-center gap-1 rounded-full border border-line-soft px-2 py-0.5"><span style="color:${agentColor(harness.name)}">${agentIcon(harness.name)}</span>${harness.name} <span>${formatNumber(harness.count)}</span></li>`)}</ul></div>` : null}
      <p class="mt-2 text-[0.69rem] text-muted">PR and commit markers; unmarked PRs remain unknown. Providers can overlap.</p>
      ${data.agents.incompleteCommits ? html`<p class="mt-1 text-[0.69rem] text-muted">Commit attribution incomplete for ${formatNumber(data.agents.incompleteCommits)} PR${data.agents.incompleteCommits === 1 ? "" : "s"}.</p>` : null}
    </div>
    <p class="mt-3 text-[0.66rem] text-muted">updated <time datetime="${data.generatedAt}" data-ago>${formatAgo(data.generatedAt)}</time></p>
    </div>
  </section>`;
}
