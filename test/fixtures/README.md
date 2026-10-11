# Audit smoke checks

Run `npm test -- --runInBand` and `npm run build`, then start
`node test/fixtures/audit-browser-server.js`. Open http://127.0.0.1:3018.
This serves the production React build with deterministic API fixtures; it does
not run the scheduler, write production data, or call external providers.
Fixture records, logos, model values and timestamps are illustrative.

Checks performed for the audit fixes:

- Desktop picks: expand **Why this pick** and compare margin, probability,
  spread edge and total against the card; verify graded sample counts.
- At 320px and 390px: open Menu, reach all 15 links, close with Escape, and
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
