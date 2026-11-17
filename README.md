# poc-playwright-shard-merge-reports

Shard a Playwright suite across 4 GitHub Actions jobs, then merge the 4 results into one HTML report.

- `.github/workflows/playwright.yml`: a 4-job shard matrix, one blob report per job, and a merge job.
- `playwright.config.ts`: the `blob` reporter on CI, `html` locally.
- `site/`: a small checklist app. `tests/`: 17 tests against it.

Run locally: `npm ci && npx playwright install chromium && npx playwright test`.
