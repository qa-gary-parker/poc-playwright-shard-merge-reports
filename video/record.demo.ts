// Records the walkthrough from results/runs.json on stage.html, timed to the narration.
import { test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(here, 'out');
const SPEED = process.env.SPEED ?? '1.15';
const VOICE = process.env.VOICE ?? '';
// Cache key for a cloned voice includes the reference clip, so a new reference re-renders every line.
const voiceRef = path.join(os.homedir(), '.local/share/voice', VOICE + '.wav');
const VOICE_KEY = VOICE && fs.existsSync(voiceRef) ? `${VOICE}:${crypto.createHash('sha1').update(fs.readFileSync(voiceRef)).digest('hex').slice(0, 8)}` : VOICE;
// HQ=1: 2x-DPR CDP screencast instead of recordVideo, voice chain, -14 LUFS, variable pauses, room tone
const HQ = !!process.env.HQ;
const GAP = 550;
const GAP_IN = 380; // HQ: pause within a chapter
const GAP_OUT = 1000; // HQ: pause before a new chapter
// FAST=1: no narration, one screenshot per step in out/frames, no video
const FAST = !!process.env.FAST;

type Result = { status: string; ms: number; worker: number; attachments: string[]; error: string | null };
type Test = { shard: number; file: string; line: number; title: string; results: Result[]; shardStatus: string; shardMs: number };
type Job = { name: string; shard: number | null; conclusion: string; seconds: number; installSeconds: number | null; testSeconds: number | null; uploadStep: string | null };
type Run = { id: number; event: string; branch: string; conclusion: string; seconds: number; jobs: Job[]; artifacts: { name: string; bytes: number }[]; tests: Test[] };
const { green, red }: { green: Run; red: Run } = JSON.parse(fs.readFileSync(path.join(root, 'results', 'runs.json'), 'utf8'));
const SHARDS = [1, 2, 3, 4];
const shardJobs = (r: Run) => r.jobs.filter((j) => j.shard);
const job = (r: Run, n: number) => r.jobs.find((j) => j.shard === n)!;
const mergeJob = (r: Run) => r.jobs.find((j) => j.name === 'merge-reports')!;
const inShard = (r: Run, n: number) => r.tests.filter((t) => t.shard === n);
const testSecs = (r: Run, n: number) => Math.round(inShard(r, n)[0].shardMs / 100) / 10;
const otherSecs = (j: Job) => j.seconds - j.installSeconds! - j.testSeconds!;
const final = (t: Test) => t.results.at(-1)!.status;
const SLOW = 3000;
const slow = green.tests.filter((t) => t.results[0].ms > SLOW);
const failedTest = red.tests.find((t) => final(t) === 'failed')!;
const kb = (r: Run, name: string) => Math.round(r.artifacts.find((a) => a.name === name)!.bytes / 1000);
const blobKb = (r: Run) => SHARDS.map((n) => kb(r, `blob-report-${n}`));
const min = (xs: number[]) => Math.min(...xs);
const max = (xs: number[]) => Math.max(...xs);
const meanTest = SHARDS.reduce((a, n) => a + testSecs(green, n), 0) / 4;
const files = [...new Set(green.tests.map((t) => t.file))];

const shot = (name: string) => 'data:image/png;base64,' + fs.readFileSync(path.join(here, 'assets', `${name}.png`)).toString('base64');
const BOX: Record<string, number[]> = JSON.parse(fs.readFileSync(path.join(here, 'assets', 'boxes.json'), 'utf8'));
const box = (key: string) => { if (!BOX[key]) throw new Error('no box ' + key); return BOX[key]; };
const WORKFLOW = fs.readFileSync(path.join(root, '.github/workflows/playwright.yml'), 'utf8');
const [shardYml, mergeYml] = WORKFLOW.slice(WORKFLOW.indexOf('  playwright-tests:')).split('\n\n').map((s) => s.replace(/^ {2}/gm, ''));
const CONFIG = fs.readFileSync(path.join(root, 'playwright.config.ts'), 'utf8');
const configBody = CONFIG.slice(CONFIG.indexOf('export default'));
const DIFF = fs.readFileSync(path.join(here, 'assets', 'demo.diff'), 'utf8').split('\n').filter((l) => /^[ +-] /.test(l)).join('\n');
// The real `--list --shard=N/4` output, trimmed to file:line › title
const LIST = fs.readFileSync(path.join(here, 'assets', 'term-list.txt'), 'utf8').trim().split(/\n(?=\$)/)
  .map((block) => block.split('\n').map((l) => l.replace(/^ {2}\[chromium\] › (\S+):1 › /, '$1 › ')).join('\n'));
const listShard = (n: number) => LIST[n - 1].split('\n').filter((l) => l.includes(' › ')).length;
const PW = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies['@playwright/test'];

// Every number the narration says, checked against the data before recording
const SPOKEN: [string, number, number][] = [
  ['tests', green.tests.length, 17],
  ['spec files', files.length, 5],
  ['shards', shardJobs(green).length, 4],
  ['red run tests', red.tests.length, 17],
  ['green passed', green.tests.filter((t) => final(t) === 'passed').length, 17],
  ['red passed', red.tests.filter((t) => final(t) === 'passed').length, 16],
  ['red failed', red.tests.filter((t) => final(t) === 'failed').length, 1],
  ['slow export tests', slow.length, 3],
  ['slow tests are export tests', slow.filter((t) => t.file === 'export.spec.ts').length, 3],
  ['slow tests about 3.5 s (3.4 to 3.7)', slow.filter((t) => t.results[0].ms >= 3400 && t.results[0].ms <= 3700).length, 3],
  ['green other tests over half a second', green.tests.filter((t) => !slow.includes(t) && t.results[0].ms >= 500).length, 0],
  ['retries on CI', Number(/retries: process\.env\.CI \? (\d+) : 0/.exec(CONFIG)![1]), 2],
  ['blob retention days', Number(/retention-days: (\d+)\n\n/.exec(WORKFLOW)![1]), 1],
  ['html retention days', Number(/retention-days: (\d+)\n?$/.exec(WORKFLOW)![1]), 14],
  ['jobs per run', green.jobs.length, 5],
  ['green jobs passed', green.jobs.filter((j) => j.conclusion === 'success').length, 5],
  ['green run seconds', green.seconds, 60 + 25],
  ['green shortest shard job s', min(shardJobs(green).map((j) => j.seconds)), 35],
  ['green longest shard job s', max(shardJobs(green).map((j) => j.seconds)), 65],
  ['green merge s', mergeJob(green).seconds, 14],
  ['green smallest blob KB', min(blobKb(green)), 5],
  ['green largest blob KB', max(blobKb(green)), 6],
  ['green html KB', kb(green, 'html-report--attempt-1'), 204],
  ['shard 1 test s x10', testSecs(green, 1) * 10, 21],
  ['shard 2 test s x10', testSecs(green, 2) * 10, 104],
  ['shard 3 test s x10', testSecs(green, 3) * 10, 86],
  ['shard 4 test s x10', testSecs(green, 4) * 10, 30],
  ['shard 3 vs 1, whole times', Math.floor(testSecs(green, 3) / testSecs(green, 1)), 4],
  ['shard 2 vs 1, whole times', Math.floor(testSecs(green, 2) / testSecs(green, 1)), 4],
  ['shard 2 vs 1 under 5 times', Number(testSecs(green, 2) / testSecs(green, 1) < 5), 1],
  ['slowest shard by test time', SHARDS.reduce((a, n) => (testSecs(green, n) > testSecs(green, a) ? n : a)), 2],
  ['slowest shard job', shardJobs(green).reduce((a, j) => (j.seconds > a.seconds ? j : a)).shard!, 2],
  ['shard 1 tests', inShard(green, 1).length, 5],
  ['shard 2 tests', inShard(green, 2).length, 4],
  ['shard 3 tests', inShard(green, 3).length, 4],
  ['shard 4 tests', inShard(green, 4).length, 4],
  ['shard 1 add tests', inShard(green, 1).filter((t) => t.file === 'add.spec.ts').length, 4],
  ['shard 1 count tests', inShard(green, 1).filter((t) => t.file === 'count.spec.ts').length, 1],
  ['listing shard 1', listShard(1), 5],
  ['listing shard 2', listShard(2), 4],
  ['listing shard 3', listShard(3), 4],
  ['listing shard 4', listShard(4), 4],
  ['slow tests in shard 2', slow.filter((t) => t.shard === 2).length, 2],
  ['slow tests in shard 3', slow.filter((t) => t.shard === 3).length, 1],
  ['shards with export tests', new Set(green.tests.filter((t) => t.file === 'export.spec.ts').map((t) => t.shard)).size, 2],
  ['shards where install is the biggest part', shardJobs(green).filter((j) => j.installSeconds! > j.testSeconds! && j.installSeconds! > otherSecs(j)).length, 4],
  ['install min s', min(shardJobs(green).map((j) => j.installSeconds!)), 17],
  ['install max s', max(shardJobs(green).map((j) => j.installSeconds!)), 33],
  ['test step min s', min(shardJobs(green).map((j) => j.testSeconds!)), 3],
  ['test step max s', max(shardJobs(green).map((j) => j.testSeconds!)), 11],
  ['perfect split: seconds of tests per shard', Math.round(meanTest), 6],
  ['perfect split saves about s', Math.round(testSecs(green, 2) - meanTest), 4],
  ['red run artifacts', red.artifacts.length, 5],
  ['green run artifacts', green.artifacts.length, 5],
  ['red run blob artifacts', red.artifacts.filter((a) => a.name.startsWith('blob-report-')).length, 4],
  ['red run seconds', red.seconds, 60 + 18],
  ['red shard 2 failed', Number(job(red, 2).conclusion === 'failure'), 1],
  ['red other shards passed', shardJobs(red).filter((j) => j.shard !== 2 && j.conclusion === 'success').length, 3],
  ['red merge s', mergeJob(red).seconds, 16],
  ['red uploads that ran', shardJobs(red).filter((j) => j.uploadStep === 'success').length, 4],
  ['failed test attempts', failedTest.results.length, 3],
  ['failed test total s x10', Math.round(failedTest.results.reduce((a, r) => a + r.ms, 0) / 100), 162],
  ['attempts between 5 and 5.5 s', failedTest.results.filter((r) => r.ms > 5000 && r.ms < 5500).length, 3],
  ['attempts with 5000ms timeout', failedTest.results.filter((r) => r.error?.includes('Timeout: 5000ms')).length, 3],
  ['attempts looking for 2 open of 2', failedTest.results.filter((r) => r.error?.includes("getByText('2 open of 2')")).length, 3],
  ['trace attempt (0 = first run)', failedTest.results.findIndex((r) => r.attachments.includes('trace')), 1],
  ['attempts with a trace', failedTest.results.filter((r) => r.attachments.includes('trace')).length, 1],
  ['red shard 2 blob KB', kb(red, 'blob-report-2'), 58],
  ['red other blobs about 6 KB', SHARDS.filter((n) => n !== 2 && kb(red, `blob-report-${n}`) === 6).length, 3],
  ['red html KB', kb(red, 'html-report--attempt-1'), 681],
  ['workers other than 0', [...green.tests, ...red.tests].flatMap((t) => t.results).filter((r) => r.worker !== 0).length, 0],
];
for (const [what, got, said] of SPOKEN) if (got !== said) throw new Error(`narration says ${said} for ${what}, data has ${got}`);
if (PW !== '1.65.1') throw new Error('narration says 1.65.1');
if (green.event !== 'push' || green.branch !== 'main' || red.event !== 'pull_request' || red.conclusion !== 'failure') throw new Error('narration says push to main, red pull request run');
if (failedTest.title !== 'counts open items' || !DIFF.includes("-  await expect(page.getByText('1 open of 2'))") || !DIFF.includes("+  await expect(page.getByText('2 open of 2'))")) throw new Error('narration says the test expects 2 open of 2, the app shows 1 open of 2');

function speech(text: string) {
  if (FAST) return { wav: '', seconds: 0.3 };
  const dir = path.join(outDir, 'tts');
  fs.mkdirSync(dir, { recursive: true });
  const wav = path.join(dir, crypto.createHash('sha1').update(VOICE_KEY + SPEED + text).digest('hex').slice(0, 12) + '.wav');
  if (!fs.existsSync(wav)) execFileSync(path.join(os.homedir(), 'bin/tts'), [...(VOICE ? ['-v', VOICE] : []), '-s', SPEED, '-o', wav, text]);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }));
  return { wav, seconds };
}

type Stage = (fn: string, ...args: unknown[]) => Promise<void>;
type Step = { ch?: string; cap: string; say: string; act?: (S: Stage) => Promise<unknown> };
const yml = async (S: Stage, which: 'shard' | 'merge') => {
  await S('clear');
  await S('term', 'y', `.github/workflows/playwright.yml · ${which === 'shard' ? 'shard jobs' : 'merge job'}`, 'blue');
  await S('code', 'y', which === 'shard' ? shardYml : mergeYml);
};
const config = async (S: Stage) => {
  await S('clear');
  await S('term', 'c', 'playwright.config.ts', 'blue');
  await S('code', 'c', configBody);
};

const steps: Step[] = [
  {
    ch: 'The problem',
    cap: '4 shards, 4 reports',
    say: 'Sharding splits a Playwright suite over several C I jobs, so each job runs part of it. The catch is that each job then has its own report.',
    act: (S) => S('card', '<h1>--shard=1/4 … --shard=4/4</h1><h2>4 jobs, <span class="w">4 separate reports</span></h2><h2 id="h2"></h2>'),
  },
  {
    cap: 'Goal: one merged HTML report',
    say: 'Nobody wants to open four reports. So in this guide, I set up four shard jobs in GitHub Actions, and merge their results into one HTML report.',
    act: (S) => S('append', '#h2', '→ <span class="g">1 merged HTML report</span>'),
  },
  {
    cap: 'Then I broke one test on purpose',
    say: 'Then I broke one test on purpose. The failing shard went red, the merge job still ran, and the merged report showed the failure, with its trace.',
    act: async (S) => {
      await S('clear');
      await S('card', '<h1>Then I broke one test</h1><ul><li><b>✗</b>the failing shard went red</li><li><b>✓</b>the merge job still ran</li><li><b>✓</b>the merged report showed the failure<span>with its trace</span></li></ul>');
    },
  },
  {
    cap: 'Green run: 17 of 17 passed · red run: 16 passed, 1 failed',
    say: 'Both runs are real, and both are in the repository. The green run passed all seventeen tests. The red run had sixteen passed, and one failed.',
    act: async (S) => {
      await S('clear');
      await S('card', '<h1>Two real runs</h1><div class="cols"><div class="col"><b class="g">17 of 17 passed</b><span>green run · push to main</span></div><div class="col"><b class="r">16 passed, 1 failed</b><span>red run · pull request #1</span></div></div>');
    },
  },
  {
    cap: 'In this video',
    say: 'In this video: the setup, the workflow, the four lines that matter, a green run, why one shard was slower, a failing run, and what I would copy.',
    act: async (S) => {
      await S('clear');
      await S('card', '<h1>In this video</h1><ul><li><b>1</b>the setup and the workflow</li><li><b>2</b>the four lines that matter</li><li><b>3</b>a green run, and why one shard was slower</li><li><b>4</b>a failing run, from red shard to trace</li><li><b>5</b>what I would copy</li></ul>');
    },
  },

  {
    ch: 'The setup',
    cap: 'A small checklist app. 17 tests in 5 spec files.',
    say: 'Here is the setup. A small checklist app, and seventeen tests in five spec files.',
    act: async (S) => {
      await S('clear');
      await S('term', 't', 'tests/', 'blue', 'big');
      await S('code', 't', files.map((f) => `${f.padEnd(16)}${green.tests.filter((t) => t.file === f).length} tests`).join('\n') + `\n${'total'.padEnd(16)}${green.tests.length} tests`);
    },
  },
  {
    cap: '3 of the 4 export tests wait about 3.5 s',
    say: 'Three of the export tests wait for an export to finish. That takes about three and a half seconds. In the green run, every other test took less than half a second.',
    act: (S) => S('mark', 't', 'export.spec.ts'),
  },
  {
    cap: `@playwright/test ${PW} · Chromium only`,
    say: 'Playwright one sixty-five point one, Chromium only. Fully parallel is on, and there are two retries on C I.',
    act: async (S) => { await config(S); await S('mark', 'c', 'fullyParallel'); await S('mark', 'c', 'retries'); },
  },
  {
    cap: "reporter: 'blob' on CI, 'html' locally",
    say: 'The config sends results to the blob reporter on C I, and to the HTML reporter on your own machine.',
    act: (S) => S('mark', 'c', 'reporter:'),
  },
  {
    cap: "trace: 'on-first-retry'",
    say: 'And it records a trace on the first retry. That matters later, when a test fails.',
    act: (S) => S('mark', 'c', 'trace:'),
  },

  {
    ch: 'The workflow',
    cap: 'Job 1: a matrix of 4 shards',
    say: 'Now the workflow. The first job is a matrix. Shard index one to four, and shard total four. GitHub starts one job for each index.',
    act: async (S) => { await yml(S, 'shard'); await S('mark', 'y', 'shardIndex: [1, 2, 3, 4]'); await S('mark', 'y', 'shardTotal: [4]'); },
  },
  {
    cap: 'npx playwright test --shard=N/4',
    say: 'Each job installs Chromium, and runs only its part of the suite, with the shard flag. Shard one of four, two of four, and so on.',
    act: async (S) => { await S('mark', 'y', 'playwright install'); await S('mark', 'y', '--shard='); },
  },
  {
    cap: 'Upload the blob report as blob-report-N',
    say: 'Then each job uploads its blob report as an artifact, named blob report, plus the shard index. It only has to live for one day.',
    act: async (S) => { await S('mark', 'y', 'name: blob-report'); await S('mark', 'y', 'retention-days: 1'); },
  },
  {
    cap: 'Job 2: merge-reports waits for every shard',
    say: 'The second job is merge reports. It waits for every shard, and downloads all the blob reports into one folder.',
    act: async (S) => { await yml(S, 'merge'); await S('mark', 'y', 'needs: [playwright-tests]'); await S('mark', 'y', 'pattern: blob-report-*'); },
  },
  {
    cap: 'npx playwright merge-reports --reporter html',
    say: 'Then it runs playwright merge reports, with the HTML reporter, on that folder.',
    act: (S) => S('mark', 'y', 'merge-reports --reporter html'),
  },
  {
    cap: 'One HTML report artifact, kept 14 days',
    say: 'And it uploads the merged HTML report as one artifact, kept for fourteen days.',
    act: (S) => S('mark', 'y', 'retention-days: 14'),
  },
  {
    cap: 'Based on the Playwright sharding docs',
    say: 'This follows the sharding page in the Playwright docs, with current action versions.',
  },

  {
    ch: 'Four lines that matter',
    cap: 'Four lines decide what happens on a red run',
    say: 'Most of that is plumbing. Four lines decide what happens when a test fails.',
    act: async (S) => {
      await S('clear');
      await S('card', "<h1>Four lines that matter</h1><ul><li><b>1</b>fail-fast: false</li><li><b>2</b>reporter: 'blob' on CI</li><li><b>3</b>if: ${{ !cancelled() }}<span>on the upload step, and on the merge job</span></li><li><b>4</b>merge-multiple: true</li></ul>");
    },
  },
  {
    cap: '1. fail-fast: false',
    say: 'One. Fail fast, false. By default, GitHub cancels the rest of a matrix when one job fails. Then the other shards never finish, and their tests are missing from the report.',
    act: async (S) => { await yml(S, 'shard'); await S('mark', 'y', 'fail-fast: false'); },
  },
  {
    cap: 'With fail-fast: false, every shard runs to the end',
    say: 'With fail fast set to false, every shard runs to the end, even when another one has failed.',
  },
  {
    cap: "2. reporter: 'blob' on CI",
    say: 'Two. The blob reporter on C I. A blob report is a zip of raw results, not a report you read. Merge reports needs blob reports as its input.',
    act: async (S) => { await config(S); await S('mark', 'c', 'reporter:'); },
  },
  {
    cap: '3. if: ${{ !cancelled() }} on the upload step',
    say: 'Three. If not cancelled, on the upload step. By default, a step only runs if every step before it passed. Without this line, a red shard skips its upload.',
    act: async (S) => { await yml(S, 'shard'); await S('mark', 'y', 'if: ${{ !cancelled() }}'); },
  },
  {
    cap: '... and on the merge job',
    say: 'The same line goes on the merge job. Without it, one red shard skips the merge, and there is no report on the run where you need it most.',
    act: async (S) => { await yml(S, 'merge'); await S('mark', 'y', 'if: ${{ !cancelled() }}'); },
  },
  {
    cap: '!cancelled() still skips both when you cancel the run',
    say: 'Not cancelled still skips both, when someone cancels the run. That is what you want.',
  },
  {
    cap: '4. merge-multiple: true',
    say: 'Four. Merge multiple, true. The download action matches every blob report artifact, and puts all the zip files in one folder. Merge reports reads that folder.',
    act: async (S) => { await S('mark', 'y', 'pattern: blob-report-*'); await S('mark', 'y', 'merge-multiple: true'); },
  },
  {
    cap: 'html-report--attempt-${{ github.run_attempt }}',
    say: 'One more detail. The HTML artifact name ends with the run attempt. So a re-run uploads a new report, instead of failing on a name that already exists.',
    act: (S) => S('mark', 'y', 'run_attempt'),
  },

  {
    ch: 'A green run',
    cap: 'Push to main: 1m 25s, all 5 jobs passed',
    say: 'Here is a green run, from a push to main. It took one minute and twenty-five seconds, from start to end. All five jobs passed.',
    act: async (S) => { await S('clear'); await S('shot', shot('gh-run-green'), 'github.com · actions run 44123317088 · push to main', 'wide'); await S('ring', box('gh-run-green.duration'), 'pass'); },
  },
  {
    cap: 'Four shard jobs side by side: 35 to 65 s each',
    say: 'The four shard jobs ran side by side. Each one took between thirty-five and sixty-five seconds.',
    act: (S) => S('ring', box('gh-run-green.shards'), 'pass'),
  },
  {
    cap: 'merge-reports: 14 s',
    say: 'The merge job started after the last shard finished, and took fourteen seconds.',
    act: (S) => S('ring', box('gh-run-green.merge'), 'pass'),
  },
  {
    cap: '5 artifacts: 4 blob reports, 5 to 6 KB each · 1 HTML report, 204 KB',
    say: 'The run has five artifacts. Each shard uploaded one blob report, five to six kilobytes each. The merged HTML report was two hundred and four kilobytes.',
    act: (S) => S('ring', box('gh-run-green.artifacts'), 'pass'),
  },
  {
    cap: 'The merged report: 17 tests, 17 passed',
    say: 'And this is the merged report. All seventeen tests, all passed. Tests from four jobs, in one list.',
    act: async (S) => { await S('clear'); await S('shot', shot('report-green'), 'html-report--attempt-1 · green run', 'wide'); await S('ring', box('report-green.counts'), 'pass'); },
  },
  {
    cap: 'Test time per shard. Shard 1: 2.1 s',
    say: 'But the shards were not equal. Here is the test time for each shard, from the blob reports. Shard one took two point one seconds.',
    act: async (S) => {
      await S('clear');
      await S('chart', 'Test time per shard', 'green run · seconds · from the blob reports');
      await S('bar', `shard 1 · ${inShard(green, 1).length} tests`, testSecs(green, 1), 11, 'pass', 's');
    },
  },
  {
    cap: 'Shard 2: 10.4 s · shard 3: 8.6 s',
    say: 'Shard two took ten point four seconds, and shard three took eight point six.',
    act: async (S) => {
      await S('bar', `shard 2 · ${inShard(green, 2).length} tests`, testSecs(green, 2), 11, 'warn', 's');
      await S('bar', `shard 3 · ${inShard(green, 3).length} tests`, testSecs(green, 3), 11, 'warn', 's');
    },
  },
  {
    cap: 'Shard 4: 3 s',
    say: 'And shard four took three seconds.',
    act: (S) => S('bar', `shard 4 · ${inShard(green, 4).length} tests`, testSecs(green, 4), 11, 'pass', 's'),
  },
  {
    cap: 'Shards 2 and 3: 4 to 5 times the test time of shard 1',
    say: 'So shards two and three took four to five times as long on tests as shard one. Same suite, same runner.',
  },

  {
    ch: 'Why shard 2 was slowest',
    cap: 'Playwright splits by count, in file order',
    say: 'Why? Playwright splits the tests by count, in file order. It does not look at how long they take. Here is the real list for each shard.',
    act: async (S) => {
      await S('clear');
      await S('term', 'a', 'npx playwright test --list · shards 1 and 2', 'pass');
      await S('code', 'a', LIST[0] + '\n\n' + LIST[1]);
      await S('term', 'b', 'npx playwright test --list · shards 3 and 4', 'pass');
      await S('code', 'b', LIST[2] + '\n\n' + LIST[3]);
    },
  },
  {
    cap: '17 tests over 4 shards: 5, 4, 4, 4',
    say: 'Seventeen tests over four shards is five, four, four, and four. Shard one got the first five. Four add tests, and one count test.',
    act: async (S) => { await S('mark', 'a', 'Total: 5 tests'); },
  },
  {
    cap: 'Shard 2 got 2 of the 3 slow export tests',
    say: 'Shard two got two of the three slow export tests. Shard three got the third.',
    act: async (S) => {
      await S('mark', 'a', 'exports an empty checklist');
      await S('mark', 'a', 'exports every item');
      await S('mark', 'b', 'exports done items too');
    },
  },
  {
    cap: 'fullyParallel: the split is by test, not by file',
    say: 'Because fully parallel is on, the split is by test, not by file. The export file is cut in two, between shard two and shard three.',
  },
  {
    cap: 'Where each job spent its time',
    say: 'There is a bigger point in the job times. Most of each job went on setup, not tests.',
    act: async (S) => {
      await S('clear');
      await S('chart', 'Where each shard job spent its time', 'green run · seconds · from the GitHub API');
      for (const n of SHARDS) {
        const j = job(green, n);
        await S('stack', `shard ${n}`, [[j.installSeconds, 'blue'], [j.testSeconds, 'pass'], [otherSecs(j), 'muted']], 66, 's');
      }
      await S('key', [['install Chromium', 'blue'], ['test step', 'pass'], ['checkout, npm ci, upload, other', 'muted']]);
    },
  },
  {
    cap: 'Install Chromium: 17 to 33 s · test step, with startup: 3 to 11 s',
    say: 'Installing Chromium took seventeen to thirty-three seconds per shard. The test step, with its startup, took three to eleven.',
  },
  {
    cap: 'In every shard job, the install was the biggest part',
    say: 'In every shard job, the Chromium install was the biggest part. Bigger than the test step, and bigger than all the other steps put together.',
  },
  {
    cap: `A perfect split: about ${Math.round(meanTest)} s of tests per shard, not ${testSecs(green, 2)} s`,
    say: 'A perfect split would give each shard about six seconds of tests, against ten point four on shard two. That saves about four seconds. The setup is paid once per shard, whatever the split.',
  },

  {
    ch: 'A failing test',
    cap: 'Pull request #1 breaks one assertion',
    say: 'Now the failure path. I opened a pull request that breaks one assertion. The count test now expects two open of two, where the app shows one open of two.',
    act: async (S) => {
      await S('clear');
      await S('term', 'd', 'demo/one-failing-test · tests/count.spec.ts', 'fail', 'big');
      await S('code', 'd', DIFF);
      await S('mark', 'd', "+  await expect(page.getByText('2 open of 2'))");
    },
  },
  {
    cap: 'The run: 1m 18s, Failure',
    say: 'Here is that run. One minute and eighteen seconds, and the status is failure.',
    act: async (S) => { await S('clear'); await S('shot', shot('gh-run-red'), 'github.com · actions run 44130118878 · pull request #1', 'wide'); await S('ring', box('gh-run-red.status'), 'fail'); },
  },
  {
    cap: 'Shard 2 failed. Shards 1, 3 and 4 ran to the end.',
    say: 'Shard two failed. Shards one, three, and four passed, and ran to the end. That is fail fast, false, doing its job.',
    act: (S) => S('ring', box('gh-run-red.shards'), 'fail'),
  },
  {
    cap: 'merge-reports still ran: 16 s, passed',
    say: 'And the merge job still ran, and passed, in sixteen seconds. That is the not cancelled line.',
    act: (S) => S('ring', box('gh-run-red.merge'), 'pass'),
  },
  {
    cap: '5 artifacts: 4 blob reports, 1 HTML report',
    say: 'The run has five artifacts. Four blob reports, one from each shard, including the red one, and the merged HTML report. Without the upload from shard two, the failure would be missing from the report.',
    act: (S) => S('ring', box('gh-run-red.artifacts'), 'pass'),
  },
  {
    cap: 'A green merge job does not hide the failure',
    say: 'The green merge job does not hide anything. One shard failed, so the run failed, and the pull request check is red.',
    act: (S) => S('ring', box('gh-run-red.status'), 'fail'),
  },
  {
    cap: 'Merged report: 16 passed, 1 failed',
    say: 'Here is the merged report from that run. Seventeen tests. Sixteen passed, and one failed.',
    act: async (S) => { await S('clear'); await S('shot', shot('report-red'), 'html-report--attempt-1 · red run', 'wide'); await S('ring', box('report-red.counts'), 'fail'); },
  },
  {
    cap: 'counts open items: 16.2 s in total',
    say: 'The failed test is at the top. It took sixteen point two seconds in total, because it ran three times.',
    act: (S) => S('ring', box('report-red.failed'), 'fail'),
  },
  {
    cap: 'Run, Retry #1, Retry #2: a little over 5 s each',
    say: 'Open it, and there are three attempts. The first run, and two retries. Each one took a little over five seconds, and failed.',
    act: async (S) => { await S('clear'); await S('shot', shot('report-red-test'), 'counts open items · 3 attempts', 'wide'); await S('ring', box('report-red-test.tabs'), 'fail'); },
  },
  {
    cap: "getByText('2 open of 2') · Timeout: 5000ms",
    say: 'The error is the same each time. It waited five seconds for the text, two open of two, and never found it.',
    act: (S) => S('ring', box('report-red-test.error'), 'fail'),
  },
  {
    cap: 'Retry #1 recorded a trace',
    say: 'With trace on first retry, the first retry recorded a trace. Here it is, attached to retry one, in the merged report.',
    act: async (S) => { await S('clear'); await S('shot', shot('report-red-retry1'), 'counts open items · Retry #1', 'wide'); await S('ring', box('report-red-retry1.trace'), 'warn'); },
  },
  {
    cap: 'The failed step: the expect, after 5 s',
    say: 'The steps above it show where it stopped. The expect step ran for five seconds, then failed.',
    act: (S) => S('ring', box('report-red-retry1.expect'), 'fail'),
  },
  {
    cap: 'The trace opens from the merged report',
    say: 'And the trace opens straight from the merged report. You do not need to find the shard that ran it.',
    act: async (S) => { await S('clear'); await S('shot', shot('trace'), 'trace viewer · from the merged report', 'wide'); await S('ring', box('trace.action'), 'fail'); },
  },
  {
    cap: 'The page says 1 open of 2. The test expects 2.',
    say: 'The snapshot shows the page at that moment. It says one open of two. The test expected two. So the app is right, and the test is wrong. That is the bug I put in.',
    act: (S) => S('ring', box('trace.page'), 'warn'),
  },
  {
    cap: 'Shard 2 blob report: 58 KB · the others: about 6 KB',
    say: 'The trace has a cost. The blob report from the second shard was fifty-eight kilobytes, against about six for each of the others.',
    act: async (S) => {
      await S('clear');
      await S('chart', 'Artifact size', 'red run · kilobytes');
      for (const n of SHARDS) await S('bar', `blob-report-${n}`, kb(red, `blob-report-${n}`), 700, n === 2 ? 'fail' : 'muted', 'KB');
    },
  },
  {
    cap: 'HTML report: 681 KB · green run: 204 KB',
    say: 'The merged HTML report grew too. Six hundred and eighty-one kilobytes, against two hundred and four for the green run. It now carries the trace, and the trace viewer to open it.',
    act: async (S) => {
      await S('bar', 'html-report · red run', kb(red, 'html-report--attempt-1'), 700, 'fail', 'KB');
      await S('bar', 'html-report · green run', kb(green, 'html-report--attempt-1'), 700, 'pass', 'KB');
    },
  },
  {
    cap: 'Open it: npx playwright show-report',
    say: 'To open it yourself, download the HTML report artifact, unzip it, and run show report on the folder.',
    act: async (S) => {
      await S('clear');
      await S('term', 'a', 'your terminal', 'pass', 'big');
      await S('type', 'a', 'gh run download 44130118878 -n html-report--attempt-1 -D report');
      await S('type', 'a', 'npx playwright show-report report');
    },
  },

  {
    ch: 'Limits',
    cap: 'One small suite, Chromium only, one run of each case',
    say: 'Now the limits. One small suite of seventeen tests. Chromium only, and one run of each case.',
    act: async (S) => {
      await S('clear');
      await S('card', '<h1>Limits</h1><ul id="lim"><li><b>-</b>17 tests, Chromium only<span>one green run, one red run</span></li></ul>');
    },
  },
  {
    cap: 'Each shard ran 1 test at a time',
    say: 'Each shard ran one test at a time, with one worker. So the shard split is the only parallel work here.',
    act: (S) => S('append', '#lim', '<li><b>-</b>1 test at a time per shard<span>the shard split is the only parallel work</span></li>'),
  },
  {
    cap: 'Not run: without fail-fast: false, or without !cancelled()',
    say: 'I did not run the workflow without fail fast false, or without not cancelled. What happens without them is the GitHub default, from its docs.',
    act: (S) => S('append', '#lim', '<li><b>-</b>not run without fail-fast: false or !cancelled()<span>that behaviour is the GitHub default, from its docs</span></li>'),
  },
  {
    cap: 'Blob reports: 1 day · HTML report: 14 days',
    say: 'And the blob reports in this workflow expire after one day. Only the HTML report stays, for fourteen days.',
    act: (S) => S('append', '#lim', '<li><b>-</b>blob reports expire after 1 day<span>the merged HTML report stays for 14 days</span></li>'),
  },

  {
    ch: 'Try it',
    cap: 'Clone it and run it',
    say: 'To try it, clone the repository, install, and run the suite. On your machine, it uses the HTML reporter, not blob.',
    act: async (S) => {
      await S('clear');
      await S('term', 'a', 'your terminal', 'pass', 'big');
      await S('type', 'a', 'git clone https://github.com/qa-gary-parker/poc-playwright-shard-merge-reports');
      await S('type', 'a', 'npm ci && npx playwright install chromium');
      await S('type', 'a', 'npx playwright test');
    },
  },
  {
    cap: 'See the split: --list --shard=2/4',
    say: 'To see the split without running anything, list the tests for one shard. This is shard two of four.',
    act: async (S) => {
      await S('type', 'a', 'npx playwright test --list --shard=2/4');
      await S('code', 'a', LIST[1].split('\n').filter((l) => !l.startsWith('$')).join('\n'));
    },
  },
  {
    cap: 'Every number here: results/runs.json',
    say: 'Every number in this video comes from the two runs. Job and step times from the GitHub API, tests from the blob reports. You can find them in the results folder.',
    act: async (S) => {
      await S('clear');
      await S('term', 'r', 'results/runs.json · red run, the failed test', 'blue');
      const { results, ...rest } = failedTest;
      await S('code', 'r', ['{', ...Object.entries(rest).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`), '  "results": [',
        ...results.map(({ error: _e, ...r }) => `    ${JSON.stringify(r).replace(/,"/g, ', "')},`), '  ]', '}'].join('\n'));
    },
  },

  {
    ch: 'What to do',
    cap: '1. Copy the four lines together',
    say: 'What would I do with this? One. Copy the four lines together. Without fail fast false, or not cancelled, a red run can end with tests missing from the report, or with no report at all.',
    act: async (S) => {
      await S('clear');
      await S('card', '<h1>What I would do</h1><ul id="todo"><li><b>1</b>Copy the four lines together<span>fail-fast: false · blob · !cancelled() twice · merge-multiple</span></li></ul>');
    },
  },
  {
    cap: '2. Break one test on purpose, once',
    say: 'Two. Break one test on purpose, once, and check that the merged report shows it. A green run never shows what happens when a test fails.',
    act: (S) => S('append', '#todo', '<li><b>2</b>Break one test on purpose, once<span>red run: 16 passed, 1 failed, trace in the report</span></li>'),
  },
  {
    cap: '3. Look where the slow tests landed',
    say: 'Three. If one shard is much slower than the others, look at where the slow tests landed. The split counts tests, not seconds.',
    act: (S) => S('append', '#todo', '<li><b>3</b>Look where the slow tests landed<span>shard 2: 10.4 s of tests · shard 1: 2.1 s</span></li>'),
  },
  {
    cap: 'playwright-shard-balancer plans shards from durations',
    say: 'I maintain a tool for that, called playwright shard balancer. It plans the shards from recorded test durations instead. It is linked in the description.',
  },
  {
    cap: '4. Check the setup time before adding shards',
    say: 'Four. Before you add more shards, look at the setup time. Every shard pays for the Chromium install again. Here, that was seventeen to thirty-three seconds per shard.',
    act: (S) => S('append', '#todo', '<li><b>4</b>Check setup time before adding shards<span>Chromium install: 17 to 33 s per shard</span></li>'),
  },
];

const END_SECONDS = 10;
const END_SAY = 'The code, every run, and the write-up are linked in the description.';

test('record the walkthrough', async ({ browser }, testInfo) => {
  const says = [...steps.map((s) => s.say), END_SAY];
  let lines = says.map(speech);
  if (VOICE && !FAST) {
    const tsv = path.join(outDir, 'narration-pre.tsv');
    fs.writeFileSync(tsv, says.map((s) => `0\t${s}`).join('\n') + '\n');
    execFileSync(path.join(os.homedir(), 'bin/tts-check'), [tsv, path.join(outDir, 'tts'), VOICE, SPEED, '4'], { stdio: 'inherit' });
    lines = says.map(speech);
  }
  const viewport = testInfo.project.use.viewport!;
  const context = await browser.newContext(HQ
    ? { viewport, deviceScaleFactor: 2 }
    : { viewport, recordVideo: { dir: testInfo.outputDir, size: viewport } });
  const page: Page = await context.newPage();
  const frames: { t: number; file: string }[] = [];
  const frameDir = path.join(outDir, 'hq-frames');
  let cdp: Awaited<ReturnType<typeof context.newCDPSession>> | undefined;
  if (HQ && !FAST) {
    fs.rmSync(frameDir, { recursive: true, force: true });
    fs.mkdirSync(frameDir, { recursive: true });
    cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = path.join(frameDir, `${String(frames.length).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ t: metadata.timestamp! * 1000, file });
      cdp!.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
  }
  await page.goto('file://' + path.join(here, 'stage.html'));
  await page.evaluate(() => document.fonts.ready);
  const S: Stage = (fn, ...args) => page.evaluate(([f, a]) => (window as any).S[f as string](...(a as unknown[])), [fn, args] as const);

  if (cdp) await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
  const start = Date.now();
  const at = () => (Date.now() - start) / 1000;
  const cues: { at: number; wav: string; say: string }[] = [];
  const chapters: string[] = [];
  let chapter = 0;
  if (FAST) fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  await page.waitForTimeout(400);
  for (const [i, step] of steps.entries()) {
    if (step.ch) {
      await S('chapter', ++chapter, step.ch);
      const t = Math.floor(at());
      chapters.push(`${chapter === 1 ? '0:00' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`} ${step.ch}`);
    }
    const began = Date.now();
    cues.push({ at: at(), wav: lines[i].wav, say: step.say });
    await S('caption', step.cap);
    await S('fresh');
    await step.act?.(S);
    const gap = HQ ? (steps[i + 1]?.ch || i === steps.length - 1 ? GAP_OUT : GAP_IN) : GAP;
    await page.waitForTimeout(Math.max(0, lines[i].seconds * 1000 + gap - (Date.now() - began)));
    if (FAST) await page.screenshot({ path: path.join(outDir, 'frames', `${String(i + 1).padStart(2, '0')}.png`) });
  }
  await S('end', [
    ['write-up', 'garyparker.dev/blog/\nplaywright-sharding-merge-reports-github-actions'],
    ['source', 'github.com/qa-gary-parker/\npoc-playwright-shard-merge-reports'],
    ['docs', 'playwright.dev/docs/test-sharding'],
  ], '4 shards → 1 report · red run: 16 passed, 1 failed, trace included');
  cues.push({ at: at(), wav: lines[steps.length].wav, say: END_SAY });
  if (FAST) {
    await page.screenshot({ path: path.join(outDir, 'frames', 'end.png') });
    await context.close();
    return;
  }
  await page.waitForTimeout(END_SECONDS * 1000);
  const length = at();

  const webm = path.join(outDir, 'walkthrough.webm');
  let videoIn: string[];
  if (HQ) {
    await cdp!.send('Page.stopScreencast');
    await context.close();
    // Frames arrive only when the page changes: hold each until the next one.
    const list = frames.map((f, i) => {
      const end = i + 1 < frames.length ? frames[i + 1].t : start + length * 1000;
      return `file '${f.file}'\nduration ${(Math.max(1, end - Math.max(f.t, start)) / 1000).toFixed(4)}`;
    });
    const concat = path.join(frameDir, 'list.txt');
    fs.writeFileSync(concat, list.join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`);
    const firstAt = Math.max(0, (frames[0].t - start) / 1000);
    videoIn = ['-f', 'concat', '-safe', '0', '-i', concat];
    if (firstAt > 0.01) videoIn = ['-itsoffset', firstAt.toFixed(3), ...videoIn];
  } else {
    const video = page.video()!;
    await context.close();
    await video.saveAs(webm);
    videoIn = ['-i', webm];
  }
  fs.writeFileSync(path.join(outDir, 'chapters.txt'), chapters.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'narration.tsv'), cues.map((c) => `${c.at.toFixed(2)}\t${c.say}`).join('\n') + '\n');

  const inputs = cues.flatMap((c) => ['-i', c.wav]);
  const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.at * 1000)}:all=1[a${i}]`).join(';');
  const mix = cues.map((_, i) => `[a${i}]`).join('');
  // HQ voice chain: rumble cut, less boxiness, presence, de-ess, gentle compression, faint room tone, -14 LUFS (YouTube)
  const voice = HQ
    ? 'highpass=f=80,equalizer=f=300:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1.2:g=2.5,deesser=i=0.4,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2'
    : 'anull';
  const room = HQ ? `;anoisesrc=colour=brown:amplitude=0.0035:sample_rate=48000:duration=${length.toFixed(3)},lowpass=f=3000[room]` : '';
  const voiceMix = `${mix}amix=inputs=${cues.length}:normalize=0:duration=longest,apad,${voice}`;
  const audio = HQ
    ? `${delays}${room};${voiceMix}[v];[v][room]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1:LRA=11[aout]`
    : `${delays};${voiceMix},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  const video = HQ ? ['-vf', 'fps=30', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-tune', 'stillimage'] : ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium'];
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...videoIn, ...inputs,
    '-filter_complex', audio,
    '-map', '0:v', '-map', '[aout]', ...video, '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', length.toFixed(3), '-movflags', '+faststart', path.join(outDir, 'walkthrough.mp4')]);
  if (HQ) {
    const LIMIT = 'alimiter=limit=0.5:attack=3:release=60:level=false';
    // Second loudness pass: measure the mix, then apply linear gain to exactly -14 LUFS / -1 dBTP.
    const mp4 = path.join(outDir, 'walkthrough.mp4');
    const tmp = path.join(outDir, 'walkthrough.pre-loudnorm.mp4');
    fs.renameSync(mp4, tmp);
    const err = spawnSync('ffmpeg', ['-hide_banner', '-i', tmp, '-af', `${LIMIT},loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const m = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-c:v', 'copy', '-af',
      `${LIMIT},loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4]);
    fs.rmSync(tmp);
  }
  console.log(`walkthrough.mp4 ${length.toFixed(1)} s, ${cues.length} lines, ${lines.reduce((a, l) => a + l.seconds, 0).toFixed(1)} s of speech`);
  console.log(chapters.join('\n'));
});
