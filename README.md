# ynga git board

GitHub contribution leaderboard for a fixed set of accounts, live at
[leaderboard.ynga.tech](https://leaderboard.ynga.tech). Solid SPA served from a
Cloudflare Worker, which also fetches from the GitHub GraphQL API and renders the
markdown views.

## Routes

| Path | What it serves |
| --- | --- |
| `/` | The year in progress: ranked heatmaps |
| `/{year}` | An archived year, 2008 through the current one |
| `/all` | All-time: one year-strip per account, ranked by career total |
| `/{year}.md` | Markdown rankings for a year |
| `/all.md` | Markdown table, one row per account, one column per year |
| `/api/board?year=` | Board JSON for a year (`year` defaults to the current one) |
| `/api/all` | All-time JSON |

## Layout

- `worker/github.ts` — the people/account mapping (`PEOPLE`), GraphQL queries, and the
  batched archive fetch that keeps `/all` inside the 50-subrequest budget.
- `worker/index.ts` — routing, edge caching, markdown rendering.
- `src/` — the Solid app; `shared/types.ts` is the contract between the two.

Every route reads through one per-year JSON cache entry, so the API and the
markdown views never disagree about the numbers.

## Discord notifications

A scheduled Worker checks the current-year board every 30 minutes. When a new
account takes the lead, someone overtakes another account for any board
position, someone sets a daily contributions PB, someone beats the board's peak
daily contributions record, or a user or the board reaches a contribution
milestone, it posts an embed to Discord. Daily records and milestones restart
each calendar year. Durable state prevents duplicate messages; the first run
records a baseline without sending one.

Set the webhook as an encrypted Worker secret before deploying:

```sh
npx wrangler secret put DISCORD_WEBHOOK_URL
npm run deploy
```

## Caching

The year in progress caches for 30 minutes at the edge, 5 minutes in the browser.
Finished years cache for 30 days at the edge, 1 day in the browser — they only
move if someone retoggles private-contribution visibility.

## Development

```sh
npm install
npm run dev          # vite on :5173, app and Worker together
```

`@cloudflare/vite-plugin` runs the Worker in workerd inside the dev server, so
`:5173` gives you HMR on the app and the real Worker on `/api/*` and the
markdown views — including the `run_worker_first` and SPA-fallback routing from
`wrangler.jsonc`, rather than an approximation of it.

```sh
npm run typecheck
npm run preview      # build, then serve the built Worker
npm run deploy       # typecheck, build, wrangler deploy
```

`vite build` writes the client to `dist/client` and the Worker plus a generated
`wrangler.json` to `dist/leaderboard`; `wrangler deploy` picks that up on its
own, so `wrangler.jsonc` at the root stays the file you edit.

## Frontend preview deployments

Pull requests can be previewed with a separate Cloudflare Pages project. Connect
the project (for example, `leaderboard-ui-preview`) to this repository and set:

- Build command: `npm run build`
- Output directory: `dist/client`
- Preview branch deployments: enabled

In the Pages project's **Preview** environment, add a service binding named
`LEADERBOARD_API` that targets the production `leaderboard` Worker, then trigger
a new deployment. `functions/api/[[path]].ts` forwards `/api/*` requests through
that binding, while Pages serves the preview's frontend assets directly. Add the
same binding to the **Production** environment too if the project's main
`pages.dev` deployment should be usable.

This previews frontend changes only. API behavior, Durable Objects, scheduled
jobs, and Discord notifications continue to come from the production Worker.

The Worker needs a GitHub token with `read:user` to reach the contributions API.
Locally that goes in `.dev.vars` as `GITHUB_TOKEN=...`; in production it is a
Worker secret (`wrangler secret put GITHUB_TOKEN`). It is never sent to the
client.

## Adding a person or account

Add a person to `PEOPLE` in `worker/github.ts`. Their first account supplies the
login and profile shown on the board; contributions from every account in the
array are combined. Historic years fill in on the next cache miss; an
account with no GitHub data is listed under a "no GitHub data for" note rather
than dropped silently.
