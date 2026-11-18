// Writes results/runs.json from the two CI runs: job and step times from the GitHub API, tests from the blob reports.
// Blob reports expire after 1 day. Usage: gh run download <id> -D <dir>/<id> for each run, then node video/collect.mjs <dir>
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'qa-gary-parker/poc-playwright-shard-merge-reports';
const RUNS = { green: 44123317088, red: 44130118878 };
const [dir] = process.argv.slice(2);
if (!dir) throw new Error('usage: node video/collect.mjs <artifacts dir>');
const gh = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const secs = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;

const out = {};
for (const [key, id] of Object.entries(RUNS)) {
  const run = gh(`repos/${REPO}/actions/runs/${id}`);
  const jobs = gh(`repos/${REPO}/actions/runs/${id}/jobs`).jobs.map((j) => {
    const step = (re) => j.steps.find((s) => re.test(s.name));
    const time = (re) => (step(re) ? secs(step(re).started_at, step(re).completed_at) : null);
    return {
      name: j.name,
      shard: Number(j.name.match(/\((\d+), \d+\)/)?.[1]) || null,
      conclusion: j.conclusion,
      seconds: secs(j.started_at, j.completed_at),
      installSeconds: time(/playwright install/),
      testSeconds: time(/playwright test/),
      uploadStep: step(/upload-artifact/)?.conclusion ?? null,
    };
  }).sort((a, b) => (a.shard ?? 99) - (b.shard ?? 99));
  const artifacts = gh(`repos/${REPO}/actions/runs/${id}/artifacts`).artifacts.map((a) => ({ name: a.name, bytes: a.size_in_bytes }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tests = [];
  for (const blob of readdirSync(join(dir, String(id))).filter((d) => d.startsWith('blob-report-'))) {
    const zip = join(dir, String(id), blob, readdirSync(join(dir, String(id), blob))[0]);
    const events = execFileSync('unzip', ['-p', zip, 'report.jsonl'], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .trim().split('\n').map((l) => JSON.parse(l));
    const shard = events.find((e) => e.method === 'onBlobReportMetadata').params.shard.current;
    const byId = new Map();
    for (const e of events.filter((e) => e.method === 'onProject')) {
      for (const suite of e.params.project.suites) for (const t of suite.entries) {
        byId.set(t.testId, { shard, file: t.location.file, line: t.location.line, title: t.title, results: [] });
      }
    }
    const worker = new Map(events.filter((e) => e.method === 'onTestBegin').map((e) => [e.params.result.id, e.params.result.parallelIndex]));
    const attach = new Map();
    for (const e of events.filter((e) => e.method === 'onAttach')) {
      attach.set(e.params.resultId, [...(attach.get(e.params.resultId) ?? []), ...e.params.attachments.map((a) => a.name)]);
    }
    for (const e of events.filter((e) => e.method === 'onTestEnd')) {
      const r = e.params.result;
      // eslint-disable-next-line no-control-regex
      const error = r.errors[0]?.message.replace(/\u001b\[\d+m/g, '').split('\n').slice(0, 5).join('\n') ?? null;
      byId.get(e.params.test.testId).results.push({ status: r.status, ms: r.duration, worker: worker.get(r.id), attachments: attach.get(r.id) ?? [], error });
    }
    const end = events.find((e) => e.method === 'onEnd').params.result;
    tests.push(...[...byId.values()].map((t) => ({ ...t, shardStatus: end.status, shardMs: Math.round(end.duration) })));
  }
  tests.sort((a, b) => a.shard - b.shard || a.file.localeCompare(b.file) || a.line - b.line);
  out[key] = {
    id, url: run.html_url, event: run.event, branch: run.head_branch, conclusion: run.conclusion,
    seconds: secs(run.run_started_at, run.updated_at), jobs, artifacts, tests,
  };
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'results', 'runs.json');
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(file);
