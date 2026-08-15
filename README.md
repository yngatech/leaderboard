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
| `/u/{login}.svg` | That account's year as a card, for a profile README |
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
- `worker/views/` — escaped Hono templates that render board data to HTML, plus
  `card.ts`, which renders the standalone SVG served at `/u/{login}.svg`.
- `worker/enhance.js` — the progressive-enhancement script; append `?nojs=1` to any
  page to see it without one.
- `shared/` — types and the grid/ranking/formatting/date math, shared with the tests.

Every route reads through one per-year JSON cache entry, so the pages, the API
and the markdown views never disagree about the numbers.

## README cards

`/u/{login}.svg` draws one account's year — the calendar grid, the year's
total, the all-time total, and the distance to the next milestone — as a card
to embed in a GitHub profile. Each account page carries the snippet:

```markdown
[![login on the ynga git board](https://leaderboard.ynga.tech/u/login.svg)](https://leaderboard.ynga.tech/u/login)
```

Only accounts in `PEOPLE` have a card; anything else is a 404. That is the
whole abuse story, and it has to be, because GitHub serves README images
through its own proxy: requests arrive from GitHub with no viewer `Referer` or
`Origin`, so an embed and a hotlink are indistinguishable. What makes the route
safe is that the set of cards that exist is small, enumerable and fully cached
at the edge.

An `<img>` renders SVG as an isolated document that may not fetch anything, so
the card inlines what it needs: the avatar as a data URI (cached separately
from the card, since profile pictures outlive deployments) and both site
typefaces from `worker/fonts/`, subset to the characters a card can print and
imported with Vite's `?inline`, which encodes them at build time. Refetch the
subsets with `node scripts/subset-fonts.ts` after changing the character set —
never at build time, so a deploy cannot depend on Google Fonts being up. Both
faces are OFL-1.1; the licences sit beside them.

Two caveats worth knowing before filing a bug. GitHub caches proxied images on
its own schedule, so a card in a README lags the site by hours whatever
`Cache-Control` we send. And in the first days of January a card still shows
the year that just finished — it switches on the second Monday, rather than
showing an empty grid and a zero for a fortnight.

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

The repository has separate Cloudflare Workers Builds connections for
`leaderboard` and `leaderboard-preview`. Non-production branch builds are
disabled on `leaderboard` and enabled on `leaderboard-preview`, which uploads
each branch version and adds its `workers.dev` URL to the pull request. The
preview runs the branch's real Worker and static assets, including the rendered
pages and API routes.

Cloudflare cannot generate preview URLs for a Worker that implements a Durable
Object. When Workers Builds identifies the connected Worker as
`leaderboard-preview`, `vite.config.ts` therefore removes the notification-only
Durable Object, migration, cron and production route from the generated
deployment config. The production Worker build retains all four. The preview
Worker has its own read-only GitHub token, but no Discord webhook; it cannot run
notifications or change their state.

The root `wrangler.jsonc` intentionally remains named `leaderboard`. The Vite
build writes the matching `leaderboard-preview` name into its generated Wrangler
configuration before the preview connection uploads it.

Wrangler derives a stable preview alias from `WORKERS_CI_BRANCH`, so every new
commit updates the same branch URL while retaining an immutable version URL.
Preview responses use `Cache-Control: no-store`, and live plus derived edge
caches are scoped to the commit SHA. The expensive finished-year source cache
is shared across preview commits until the account roster or its cache schema
changes. This keeps pushes deterministic without repeatedly rebuilding the
full GitHub archive.

Preview URLs are public unless Cloudflare Access is enabled, so non-production
branch builds must remain limited to trusted contributors. A normal
`npm run deploy` always targets `leaderboard` and rebuilds from the complete
production config.

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
