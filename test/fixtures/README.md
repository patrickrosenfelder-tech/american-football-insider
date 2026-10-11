# Audit smoke checks

Run `npm test -- --runInBand` and `npm run build`, then start
`node test/fixtures/audit-browser-server.js`. Open http://127.0.0.1:3018.
This serves the production React build with deterministic API fixtures; it does
not run the scheduler, write production data, or call external providers.
Fixture records, logos, model values and timestamps are illustrative.

Checks performed for the audit fixes:

- Desktop picks: expand **Why this pick** and compare margin, probability,
  spread edge and total against the card; verify graded sample counts.
- At 320px and 390px: open More, reach all 15 links, close with Escape, and
  verify the header stays inside the viewport. Data Status scrolls inside its table.
- Search news for Bills; verify its query, results and labeled team filter.
- Teams → Buffalo Bills: verify Week 7 bye and team-specific page metadata.
- Data Status: verify partial refresh is degraded with separate last success,
  last attempt and timed error details.
- Visit Picks, then create `../fail-picks` relative to the repository. Navigate
  to News and back: saved picks remain, with one stale banner and Retry.
  Navigate to an uncached week: show an error rather than another week's picks.
  Remove `../fail-picks`, then Retry: the requested week loads.

Automated tests cover the underlying provider normalization, legacy content
repair, model presentation, concurrent refreshes, failures and status recovery.
Browser fixtures do not establish live-provider uptime or production deployment.

## Preserve the approved design

The active production design was recovered from local commit `f96f868`, whose
12 commits after `4d74f13` were missing from GitHub master. Its compiled CSS was
verified byte-for-byte against the live CSS `/assets/index-B0ZZfxuV.css`.
Those commits must remain in the repository so a future build retains the
light theme, current score cards, filters and postgame context links.

`designBaseline.test.js` protects that stylesheet, Scores component and GameCard.
Accessibility CSS is appended separately; do not update these baseline hashes
without reviewing and approving a deliberate visual change.

For identical-data comparisons, set `AUDIT_SCOREBOARD` to a captured public
`/api/games` JSON response. `AUDIT_DIST` selects a saved reference build and
`AUDIT_PORT` allows reference and candidate servers to run side by side.
The audit compared all 15 card rectangles at 1280px, and tested Final/Upcoming
filters, score values, postgame links and responsive navigation.

## Hosted PR #5 preview

Preview: https://american-football-insider-pr5.fly.dev

Deploy the PR branch explicitly with
`fly deploy --config fly.pr5.toml --app american-football-insider-pr5 --remote-only --ha=false`.
Production's `fly.toml` remains separate. The preview has its own app, machine,
SQLite volume and canonical URL; no production credentials are copied. Its
responses use `X-Robots-Tag: noindex, nofollow`.

The preview stops when idle and starts on access. Its independent database
warms public feeds and generates picks after startup, so historical tracked
records and AI summaries can differ from production. AI provider credentials
are not configured in the preview. Merging the PR does not deploy production.
