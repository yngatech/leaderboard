# ynga git board

GitHub contribution leaderboard for a fixed set of accounts, live at
[leaderboard.ynga.tech](https://leaderboard.ynga.tech). A Cloudflare Worker
fetches from the GitHub GraphQL API and renders every page as static HTML at
the edge; a small script layers on live timestamps, arrow-key navigation and
the chart hover, and every page works without it.

## Routes

| Path | What it serves |
| --- | --- |
| `/` | The year in progress: ranked heatmaps |
| `/{year}` | An archived year, 2008 through the current one |
| `/all` | All-time: one year-strip per account, ranked by career total |
| `/u/{login}` | One account across every year |
| `/{year}.md` | Markdown rankings for a year |
| `/all.md` | Markdown table, one row per account, one column per year |
| `/api/board?year=` | Board JSON for a year (`year` defaults to the current one) |
| `/api/all` | All-time JSON |
| `/api/users/{login}` | One account's all-time totals and current-year daily JSON |
| `/.well-known/api-catalog` | RFC 9727 API catalogue as a JSON Linkset |

## Layout

- `worker/github.ts` — the people/account mapping (`PEOPLE`), GraphQL queries, and the
  batched archive fetch behind `/all`.
- `worker/index.ts` — routing, edge caching, markdown rendering.
- `worker/views/` — escaped Hono templates that render board data to HTML.
- `worker/enhance.js` — the progressive-enhancement script; append `?nojs=1` to any
  page to see it without one.
- `shared/` — types and the grid/ranking/formatting math, shared with the tests.

Every route reads through one per-year JSON cache entry, so the pages, the API
and the markdown views never disagree about the numbers.

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
move if someone retoggles private-contribution visibility. Rendered-page cache
keys include the deployed commit SHA, so a new commit renders fresh HTML at the
edge while keeping the underlying contribution-data caches warm.

## Development

```sh
npm install
npm run dev          # vite on :5173, the real Worker in workerd
```

`@cloudflare/vite-plugin` runs the Worker in workerd inside the dev server, so
`:5173` serves the rendered pages, `/api/*` and the markdown views for real —
including the `run_worker_first` routing from `wrangler.jsonc` — rather than an
approximation of it. The stylesheet and enhancement script are `?url` imports
in the Worker: fingerprinted assets in production, plain module URLs in dev.

```sh
npm run typecheck
npm test             # fast unit and renderer tests
npx playwright install chromium # once per machine
npm run test:e2e     # progressive-enhancement browser tests
npm run test:e2e:ui  # interactive runner, opened in T3 Preview
npm run test:all     # both test suites
npm run preview      # build, then serve the built Worker
npm run deploy       # typecheck, build, wrangler deploy
```

`vite build` writes the client to `dist/client` and the Worker plus a generated
`wrangler.json` to `dist/leaderboard`; `wrangler deploy` picks that up on its
own, so `wrangler.jsonc` at the root stays the file you edit.

## Pull request previews

Cloudflare Workers Builds uploads each non-`main` branch as a preview version
and adds its `workers.dev` URL to the pull request. The preview runs the branch's
real Worker and static assets, including the rendered pages and API routes.

Cloudflare cannot generate preview URLs for Worker versions with Durable Object
bindings. During a Workers Builds preview, `vite.config.ts` therefore removes
the notification-only Durable Object, migration, cron and production route from
the generated deployment config. The production build retains all four. A PR
preview reads live GitHub contribution data using the Worker's existing secret,
but it cannot run notifications or change their state.

Preview URLs are public unless Cloudflare Access is enabled, and versions on
trusted repository branches inherit the Worker's runtime secrets. Do not promote
a preview version to production: it intentionally has no notification state. A
normal `npm run deploy` always rebuilds from the complete production config.

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
