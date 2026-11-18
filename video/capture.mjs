// Screenshots for the walkthrough: the two runs on GitHub and both merged HTML reports.
// Usage: node video/capture.mjs <artifacts dir>   (the same dir as video/collect.mjs)
import { chromium } from '@playwright/test';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/qa-gary-parker/poc-playwright-shard-merge-reports';
const [dir] = process.argv.slice(2);
if (!dir) throw new Error('usage: node video/capture.mjs <artifacts dir>');
const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets');
mkdirSync(assets, { recursive: true });

// The trace viewer needs http, not file://
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.zip': 'application/zip', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.md': 'text/markdown', '.png': 'image/png' };
const server = createServer((req, res) => {
  const file = join(dir, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const report = (id) => `http://127.0.0.1:${server.address().port}/${id}/html-report--attempt-1/index.html`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const page = await context.newPage();
const REPORT = { clip: { x: 200, y: 0, width: 1000, height: 860 } };
const shot = (name, opts = {}) => page.screenshot({ path: join(assets, `${name}.png`), ...opts });
// Highlight boxes for the video: the union of the locators' boxes, in % of the shot
const VIEW = { x: 0, y: 0, width: 1400, height: 860 };
const boxes = {};
const box = async (key, clip, ...locators) => {
  const bs = await Promise.all(locators.map((l) => l.boundingBox()));
  if (bs.includes(null)) throw new Error(`no box for ${key}`);
  const x = Math.min(...bs.map((b) => b.x)) - 6, y = Math.min(...bs.map((b) => b.y)) - 6;
  const r = Math.max(...bs.map((b) => b.x + b.width)) + 6, btm = Math.max(...bs.map((b) => b.y + b.height)) + 6;
  boxes[key] = [(x - clip.x) / clip.width, (y - clip.y) / clip.height, (r - x) / clip.width, (btm - y) / clip.height].map((v) => +(v * 100).toFixed(2));
};

// Logged out, the PR page has no checks box; the run page shows the PR, the red status and every job
for (const [name, id] of [['gh-run-green', 44123317088], ['gh-run-red', 44130118878]]) {
  await page.goto(`${REPO}/actions/runs/${id}`);
  await page.getByText('Show all jobs').click();
  await page.getByRole('link', { name: 'playwright-tests (4, 4)' }).first().waitFor();
  await page.waitForTimeout(1000);
  const clip = { x: 0, y: 150, width: 1400, height: 560 };
  await shot(name, { clip });
  const graph = (job) => page.locator('streaming-graph-job', { hasText: job });
  await box(`${name}.duration`, clip, page.getByText('Total duration'), page.getByRole('link', { name: /^1m \d+s$/ }));
  await box(`${name}.shards`, clip, graph('playwright-tests (1, 4)'), graph('playwright-tests (4, 4)'));
  await box(`${name}.shard2`, clip, graph('playwright-tests (2, 4)'));
  await box(`${name}.merge`, clip, graph('merge-reports'));
  await box(`${name}.status`, clip, page.getByText('Status', { exact: true }), page.getByText(/^(Success|Failure)$/));
  const summary = page.getByRole('region', { name: 'Workflow run summary' });
  await box(`${name}.artifacts`, clip, summary.getByText('Artifacts', { exact: true }), summary.getByRole('link', { name: /^\d+$/ }));
}

await page.goto(report(44123317088));
await page.getByText('adds an item').waitFor();
await shot('report-green', REPORT);
const chip = (name) => page.locator('a', { hasText: new RegExp(`^${name}\\s*\\d+$`) }).first();
await box('report-green.counts', REPORT.clip, chip('All'), chip('Passed'));
await page.goto(report(44130118878));
await page.getByText('counts open items').waitFor();
await shot('report-red', REPORT);
await box('report-red.counts', REPORT.clip, chip('Passed'), chip('Failed'));
await box('report-red.failed', REPORT.clip, page.getByRole('link', { name: 'counts open items' }), page.getByText('16.2s'), page.getByText('count.spec.ts:8'));
await page.getByRole('link', { name: 'counts open items' }).click();
await page.getByText('Retry #1').waitFor();
await shot('report-red-test', REPORT);
await box('report-red-test.tabs', REPORT.clip, page.getByRole('tab').first(), page.getByRole('tab').nth(2));
await box('report-red-test.error', REPORT.clip, page.getByText(/Locator: getByText/));
await page.getByText('Retry #1').click();
await page.getByText('Traces').first().scrollIntoViewIfNeeded();
await shot('report-red-retry1', REPORT);
await box('report-red-retry1.expect', REPORT.clip, page.getByText('Expect "toBeVisible"', { exact: true }).filter({ visible: true }), page.getByText('5.0s').filter({ visible: true }));
await box('report-red-retry1.trace', REPORT.clip, page.locator('img').filter({ visible: true }).last(), page.getByText('trace', { exact: true }).filter({ visible: true }));
await page.locator('a[href*="trace/index.html"]').first().click();
await page.getByText('toBeVisible').first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);
await shot('trace');
await box('trace.action', VIEW, page.getByText('toBeVisible').first(), page.getByText("getByText('2 open of 2')").first());
const openText = page.frameLocator('iframe.snapshot-visible').getByText('1 open of 2');
await box('trace.page', VIEW, openText);
// The text sits in a full-width block: narrow the box to the text itself
const textShare = await openText.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().width / e.getBoundingClientRect().width; });
boxes['trace.page'][2] = +(boxes['trace.page'][2] * textShare + 1).toFixed(2);
writeFileSync(join(assets, 'boxes.json'), JSON.stringify(boxes, null, 2) + '\n');

await browser.close();
server.close();
