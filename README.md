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

- `worker/github.ts` — the account list (`LOGINS`), GraphQL queries, and the
  batched archive fetch that keeps `/all` inside the 50-subrequest budget.
- `worker/index.ts` — routing, edge caching, markdown rendering.
- `src/` — the Solid app; `shared/types.ts` is the contract between the two.

Every route reads through one per-year JSON cache entry, so the API and the
markdown views never disagree about the numbers.

## Caching

The year in progress caches for 30 minutes at the edge, 5 minutes in the browser.
Finished years cache for 30 days at the edge, 1 day in the browser — they only
move if someone retoggles private-contribution visibility.

## Development

Run both, in two terminals:

```sh
npm install
npm run dev:worker   # wrangler dev, the API on :8787
npm run dev          # vite on :5173, /api proxied to the worker
```

Work against `:5173` — you get HMR on the app and real board data from the
Worker. `wrangler dev` on its own serves the last `npm run build` output from
`dist/`, so use it alone only to check the markdown views or asset routing.

```sh
npm run typecheck
npm run deploy       # typecheck, build, wrangler deploy
```

The Worker needs a GitHub token with `read:user` to reach the contributions API.
Locally that goes in `.dev.vars` as `GITHUB_TOKEN=...`; in production it is a
Worker secret (`wrangler secret put GITHUB_TOKEN`). It is never sent to the
client.

## Adding an account

Add the login to `LOGINS` in `worker/github.ts` and deploy. Historic years fill
in on the next cache miss; an account with no GitHub data is listed under a
"no GitHub data for" note rather than dropped silently.
