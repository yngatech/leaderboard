# ynga git board

GitHub contribution leaderboard for a fixed set of accounts, live at
[leaderboard.ynga.tech](https://leaderboard.ynga.tech). A Cloudflare Worker
reads each account's public contributions page for its totals, GraphQL for the
profile around them, and renders every page as static HTML at the edge; a small script layers on live timestamps, arrow-key navigation and
the chart hover, and every page works without it.

## Routes

`GET /api/users/{login}/breakdown` returns the current year contribution split;
`?date=YYYY-MM-DD` selects a single UTC day. User pages accept `?day=YYYY-MM-DD`
and link each heatmap day to its breakdown.

| Path | What it serves |
| --- | --- |
| `/` | The year in progress: ranked heatmaps |
| `/{year}` | An archived year, 2008 through the current one |
| `/all` | All-time: one year-strip per account, ranked by career total |
| `/achievements` | Contribution milestones, record improvements and anniversaries; optional `?year=&person=` filters |
| `/u/{login}` | One account across every year; `?day=YYYY-MM-DD` selects day detail |
| `/u/{login}.svg` | That account's year as a card, for a profile README |
| `/u/{login}/year.svg` | Badge: that account's contributions this year |
| `/u/{login}/all.svg` | Badge: that account's contributions all time |
| `/u/{login}/streak.svg` | Badge: that account's current contribution streak |
| `/{year}.md` | Markdown rankings for a year |
| `/all.md` | Markdown table, one row per account, one column per year |
| `/api/board?year=` | Board JSON for a year (`year` defaults to the current one) |
| `/api/all` | All-time JSON |
| `/api/users/{login}` | One account's all-time totals and current-year daily JSON |
| `/api/users/{login}/breakdown` | Contribution types and public repositories; optional `?date=YYYY-MM-DD` |
| `/api/users/{login}/insights` | Durable Object current-year public PR style summary; 202 while awaiting cron collection |
| `/.well-known/api-catalog` | RFC 9727 API catalogue as a JSON Linkset |

## Layout

The board and account pages show recent achievements. `/achievements` browses a
selected year's milestones, daily record improvements and GitHub anniversaries
without requiring JavaScript. History is reconstructed from contribution dates
using the current milestone ladders; late pushes and visibility changes can revise
it, and today's counts are provisional. Records reset yearly, exclude the first
active day's baseline, and combine a personal best with its matching board record.
Board achievements use the current roster. Each view reads only its selected
year's daily calendar and cached finished-year totals for lifetime offsets.
Incomplete sources suppress lifetime or board achievements while leaving supported
personal entries available.

- `worker/github.ts` — the people/account mapping (`PEOPLE`), the contribution
  fetches and their retries, and the batched archive fetch behind `/all`.
- `worker/index.ts` — routing, edge caching, markdown rendering.
- `worker/views/` — escaped Hono templates that render board data to HTML, plus
  `card.ts` and `badge.ts`, which render the standalone SVGs served under `/u/{login}`,
  and `mono.ts`, the advance-width measuring both of them lay out against.
- `worker/enhance.js` — the progressive-enhancement script; append `?nojs=1` to any
  page to see it without one.
- `shared/` — types and the grid/ranking/formatting/cake-day math, shared with the tests.

Every route reads through one per-year JSON cache entry, so the pages, the API
and the markdown views never disagree about the numbers. A contributions page
that will not load is retried rather than answered from GraphQL, which counts
only the private contributions the board's own token can see; if it stays down,
the last numbers GitHub gave stand in for a day. Every response built from
them says so, with `X-Board-Stale: 1` and `X-Board-Cache: STALE`.

## README cards and badges

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

`/u/{login}/year.svg`, `/u/{login}/all.svg`, and `/u/{login}/streak.svg` are small facts without
the card around them: a 20px shields-shaped pill, label left and value right, so
they line up in a README row beside badges from anywhere else. Only the palette
is ours, which is the reason to draw them here rather than point shields.io at
`/api/users/{login}`. The account page carries their snippet too:

```markdown
[![contributions this year](https://leaderboard.ynga.tech/u/login/year.svg)](https://leaderboard.ynga.tech/u/login) [![contributions all time](https://leaderboard.ynga.tech/u/login/all.svg)](https://leaderboard.ynga.tech/u/login) [![current streak](https://leaderboard.ynga.tech/u/login/streak.svg)](https://leaderboard.ynga.tech/u/login)
```

A badge carries no avatar and no typeface — nothing in one comes from GitHub
except the number, and the layout measures the rest against the system mono
advance in `views/mono.ts`. That is the whole difference between a badge under
two kilobytes and a card over a hundred. Each badge reads one of the same two
cached feeds as the card, so it costs no GitHub request the board was not already making.
The streak badge uses the live calendar year's daily data, counts any day with
at least one contribution, and keeps yesterday's streak while today is still
quiet. Like the board's streak display, it starts over at the year boundary.

Two caveats worth knowing before filing a bug. GitHub caches proxied images on
its own schedule, so a card or badge in a README lags the site by hours whatever
`Cache-Control` we send. And in the first days of January they still show the
year that just finished — they switch on the second Monday, rather than showing
an empty grid and a zero for a fortnight.

## Cake day

An account's cake day is the anniversary, in UTC, of the day GitHub created it.
A person with more than one account celebrates the oldest of them, and a
29 February account celebrates on 1 March in a common year. The year board
marks the day with a badge on the row; an archived year never does, because it
is a record of that year rather than of the day it is read on.

## Discord notifications

A Durable Object alarm checks the current-year board every 10 minutes. When a new
account takes the lead, someone overtakes another account for any board
position, someone sets a daily contributions PB, someone beats the board's peak
daily contributions record, or a user or the board reaches a contribution
milestone, it posts a rich message to Discord. Daily records and yearly milestones
restart each calendar year. Durable state prevents duplicate messages; the
first run records a baseline without sending one.

Yearly personal milestones run from 100 through 100,000, with intermediate
steps including 750, 1,500, 2,000, 13,000, and 14,000. Goal displays and Discord
use the same ladder. When expanding the ladder, pending notifications from
the original ladder finish first, then newly introduced rungs already passed
are recorded silently.

Personal all-time milestones use a separate ladder from 100 through 100,000,
including 12,500, 17,500, 20,000, and 22,500. Account pages show the next
lifetime target and the distance to it. Checks combine the cached finished-year
archive with the freshly checked live year
and wait when the archive is stale or incomplete. The first check and newly
added accounts are seeded silently. Later crossings announce the highest new
threshold once, even across year changes, total corrections, or an account
leaving and rejoining the board. Each successful post is checkpointed so a
failed webhook can retry without repeating earlier posts.
Yearly and lifetime notifications are checked independently, so a failed post
in one group does not prevent the other group's milestones from being sent.

The first live-board read that reaches the Durable Object starts the alarm
chain; request `/api/board` after deploying to start it once any cached response
expires. Each alarm saves the next run before fetching GitHub or sending
notifications, so failures leave another check scheduled. Later live-board
reads restart the chain if its alarm is missing, without postponing a pending
check. There is no cron trigger. Local development and local preview builds do
not start alarms. Native deployed previews run alarms in their own namespace.
`npm run preview` builds with the `local-preview` mode, which
disables both alarm startup and execution while retaining production page and
cache behavior. Serving that build or running dev also stops any persisted
local alarm before it can fetch or post.

A daily PB or board record is announced at most once per account and day. If
that day keeps climbing, the rises are saved quietly, and the first check after
the UTC day ends posts one wrap-up with where the day finished: one per account
for PBs, and one for the board from whoever finished the day on top while it
is still the record (a newer record already says what it beat). A day is never
announced again, and contributions landing on it after its wrap-up stay quiet.
For the first week of a new year the check also fetches the finished year's
board, so 31 December is wrapped up, and a record set late that day announced,
from that year's complete data.

Cake days are the exception to that baseline. Their durable state only records
which accounts have already been announced this calendar year, so a cake day
falling on a fresh Durable Object is still posted, and the stored year is what
lets the next one through without a rollover step. Accounts that leave the
board keep their entry, so one that comes back the same year cannot be posted
twice.

Set the webhook as an encrypted Worker secret before deploying:

```sh
npx wrangler secret put DISCORD_WEBHOOK_URL
npm run deploy
```

Notifications can ping people instead of linking their GitHub logins. Store
the optional GitHub-login-to-Discord-ID map as another encrypted secret; keep
the IDs quoted so JSON does not round them:

```sh
npx wrangler secret put DISCORD_USER_IDS
# Enter, for example: {"example-user":"123456789012345678"}
```

GitHub logins are matched case-insensitively. Mapped mentions use Discord
Components V2 cards so they stay beside the message and avatar while still
notifying the people named. Position changes mention both mapped accounts;
board-wide milestones do not ping anyone. An account missing from the map keeps
its GitHub profile link, including when the secret is absent or malformed.
Entries with invalid IDs or duplicate logins are skipped without disabling
valid mappings; warnings identify the affected GitHub logins. Discord IDs are
never logged or included in public pages or API responses.

## Caching

The same alarm check stores the current-year board it fetched in the
Durable Object, and the site renders the year in progress from that snapshot,
so the board and notification checks share one source. A check that gets a
partial board from GitHub leaves the last full one in place. If no snapshot is
newer than 30 minutes (local development, preview builds, a stopped alarm), the
site fetches the board from GitHub itself and caches it for 5 minutes.

Computed PR insights also live in the same Durable Object, shared across Cloudflare locations and retained across Worker restarts and deploys. Profile HTML continues to use the existing rendered-page edge cache.

The year in progress caches for 1 minute at the edge and in the browser.

Finished years cache for 30 days at the edge, 1 day in the browser — they only
move if someone retoggles private-contribution visibility. Rendered-page cache
keys include the deployed commit SHA, so a new commit renders fresh HTML at the
edge while keeping the underlying contribution-data caches warm.

Contribution breakdowns cache for 30 days once their window has finished. While
it is live (it includes today, or ended less than a day ago), a day caches for
about a minute and the year so far for 30 minutes, since GitHub takes a couple
of seconds to answer it. Private repositories are never named; private work
appears only as a count.

## PR style prototype

User pages show a public-PR panel once at least 10 qualifying PRs are available. The cohort is PRs authored by any of the person's accounts and opened in the current UTC year, in public repositories, including forks and every PR state. GraphQL search runs in disjoint monthly windows, subdividing busy months before the 1,000-result search cap; PR node IDs are deduplicated across accounts. Search errors or incomplete search coverage leave the previous summary intact.

Adjusted size is additions plus deletions from complete file lists, excluding the small shared path heuristic in `worker/insights.ts`: common lockfiles, dist/build/vendor/generated/node_modules directories, minified JavaScript, source maps and snapshots. The first 100 files are inspected; PRs with missing or longer file lists are excluded from size statistics and counted in the coverage note. Size statistics need 10 measured PRs. Buckets are XS 0–9, S 10–99, M 100–499, L 500–999 and XL 1,000+ lines; small means fewer than 100. Biggest net deletion uses deletions minus additions with the same exclusions. These are workflow descriptors, not productivity scores.

Intent uses a known title prefix (Conventional Commits or bracket tag), then a typed branch prefix, then complete, nonempty docs-only/tests-only/dependencies-only/CI-only path lists. Each PR has one primary intent. Scoped Commits area prefixes are recorded separately and do not invent feature/fix intent. Unknown remains in the denominator and display. Title signals take precedence when signals disagree.

Agent-attributed means a recognized disclosure in the PR body, a commit coauthor trailer, or a recognized agent author/coauthor identity. The summary retains those evidence categories separately, deduplicates repeated markers per PR, and shows overlapping agent-family counts. Dependabot and Renovate identities do not count. Commit inspection is bounded to the first 50 commits and first 5 authors each, with incomplete coverage reported. Markers can describe prose or inherited history; neither attribution nor its absence establishes who wrote the code. Only PR-contained commit metadata is inspected; there is no commit-history crawl.

Every 10-minute cron also refreshes one due person's insights, at most once per day per summary. The existing SQLite-backed `LeaderState` Durable Object stores only computed summaries under `insights:<year>:<primaryLogin>`, with a schema version field; raw bodies, messages and author emails stay in collection memory. Account changes and schema version mismatches treat the summary as missing. Refresh attempts are serialized separately from notifications and keep a timestamp under `insights-attempt:<year>:<primaryLogin>` for the one-hour failure cooldown. Collection failures preserve the last valid summary. Page and JSON requests only read the Durable Object and never initiate collection. Missing, malformed or unavailable summaries hide the panel and return HTTP 202 from the JSON endpoint. JSON accepts GET/HEAD and uses the same canonical roster logins as other user APIs.

Summaries have no automatic expiry and are available across Cloudflare locations through the shared object. Preview builds currently omit the Durable Object binding and cron, so they omit the panel; any environment with the binding can read its stored summaries without collecting on visits. Locally, `curl http://localhost:5173/cdn-cgi/handler/scheduled` runs one refresh tick; repeat after it finishes to populate the next person.

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
npm run test:worker  # build both alarm modes and run integration tests in workerd
npm run test:all     # all suites, including a build for the Worker tests
npm run preview      # build, then serve the built Worker
npm run deploy       # typecheck, build, wrangler deploy
```

`vite build` writes the client to `dist/client` and the Worker plus a generated
`wrangler.json` to `dist/leaderboard`; `wrangler deploy` picks that up on its
own, so `wrangler.jsonc` at the root stays the file you edit.

## Pull request previews

Branch deployments use [native Worker Previews](https://developers.cloudflare.com/workers/previews/)
under the single `leaderboard` Worker and its Builds connection. `main` deploys
production; other trusted branches create native previews. Each branch preview
runs its own Worker code, static assets, SQLite-backed `LeaderState` namespace
and alarm.
Cloudflare isolates the namespace automatically, keeps its state across pushes
to that branch, and deletes the state when the preview is deleted.

`wrangler.jsonc` keeps the class and migration at the top level and repeats the
`LEADER_STATE` binding in `previews.durable_objects.bindings`, because the code
accesses it through `env`. Do not add `script_name`: the class must belong to
this Worker for automatic isolation. Assets stay at the top level. Production
routes and cron triggers do not target native previews.

The top-level `preview_urls: true` enables native `workers.dev` Preview URLs.
Apply this setting through a production deployment of `main`; deploying a branch
preview does not change the parent Worker's URL settings. Setting it to `false`
leaves native previews with no active URL unless a preview custom domain is configured.

`npm run deploy:preview` builds in `worker-preview` mode and runs
`wrangler preview --worker-name leaderboard`. The preview name defaults
to the current branch. Workers Builds also selects preview behavior from
`WORKERS_CI_BRANCH`, including when its Worker-name override is `leaderboard`.
Both builds keep the same Worker name, bindings and migration. Production
routes remain at the top level and are ignored by the native Preview command.
`npm run deploy` builds production behavior and deploys `leaderboard`.

The `Deployments` workflow handles the shared `Workers Builds: leaderboard`
check. A Preview URL identifies a preview; otherwise the GitHub check suite
branch distinguishes production from branch builds. Missing branch metadata
stops reporting instead of assuming production. For a preview it requests
`/api/board` to start the isolated alarm chain, and records a GitHub deployment.
A missing GitHub credential or a failed initial board fetch fails that warm-up
rather than recording a usable preview. Alarms then refresh the board every
10 minutes. Preview builds never send Discord notifications or update their
checkpoints, even if a webhook is present.

### One-time Workers Builds setup

Existing Builds connections require Cloudflare's [one-time switch to Worker
Previews](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/#existing-workers-connected-to-builds).
Prepare these settings on `leaderboard` when adopting this change:

1. In Settings > Builds, select **Set up Worker Previews**. Configure the Preview
   Base with the three GitHub App secrets described below. Native previews do
   not inherit the Worker's existing secrets. Leave Discord secrets out of
   Preview Base.
2. Enable preview builds for trusted branches and keep the build command
   `npm run build`. Set the Preview command to `npm run deploy:preview` and keep
   the production deploy command as `npm run deploy`, then complete **Switch to
   Worker Previews**. Cloudflare documents this switch as irreversible.
3. Add a GitHub Actions repository secret named `CLOUDFLARE_PREVIEW_API_TOKEN`
   for the `preview-cleanup.yml` workflow. Use an API token scoped to managing
   previews on `leaderboard`; it needs Workers Scripts edit access.
   There is no need to grant access to production routes.
4. Once previews through `leaderboard` are verified, disable the old
   `leaderboard-preview` Builds connection to avoid duplicate branch builds.
   The old Worker can be retired separately after its remaining previews are
   no longer needed.

If a build still logs `Executing user deploy command: npx wrangler versions upload`,
the Builds connection is using its saved legacy command. With the Durable
Object retained, that command fails on the pending migration. Complete the
switch and set the Preview command above, then retry the build. The native
`wrangler preview` command applies migrations within the isolated preview.

Set Preview Base credentials before creating previews. Later Base secret
changes affect newly created previews; update an existing preview's secrets
explicitly when needed. Keep secret values out of the repository.

The cleanup workflow runs trusted default-branch code when a same-repository
PR closes, then deletes that branch's preview, deployments, and DO storage.
It requires the cleanup token above. For manual cleanup with a local Wrangler
login, run `npm run delete:preview -- --name <branch>`. Deleting preview state
is permanent; a reopened PR starts with fresh storage.

Preview URLs are public unless Cloudflare Access is enabled, so branch builds
must remain limited to trusted contributors. Each preview provides a stable
URL for its latest deployment and an immutable URL for each deployment.
Responses use `Cache-Control: no-store`, and live plus derived edge caches are
scoped to the commit SHA. The expensive finished-year source cache is shared
across preview commits until the account roster or its cache schema changes.

Production and deployed PR previews authenticate GitHub API requests as a
GitHub App, with its own rate limit. The App needs no permissions, only an
installation. It reads three secrets:
`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`.
The key must be PKCS#8; convert GitHub's download with
`openssl pkcs8 -topk8 -nocrypt -in app.private-key.pem -out app.pk8.pem`.

Set all three as Worker secrets on `leaderboard`. For native previews, set
each with `wrangler preview base-config secret put <SECRET_NAME> --worker-name leaderboard`,
providing the value privately through stdin or the prompt. Use
`wrangler preview secret put <SECRET_NAME> --worker-name leaderboard --name <branch>`
to update an already-created preview. Deployed builds require every App secret
and never fall back to a personal token.

For local `npm run dev` and `npm run preview`, a personal token with `read:user`
in the ignored `.dev.vars` file is enough:

```sh
GITHUB_TOKEN=...
```

Complete App credentials take precedence if configured locally. Neither
credential is sent to the client.

## Adding a person or account

Add a person to `PEOPLE` in `worker/github.ts`. Their first account supplies the
login and profile shown on the board; contributions from every account in the
array are combined. Historic years fill in on the next cache miss; an
account with no GitHub data is listed under a "no GitHub data for" note rather
than dropped silently.
