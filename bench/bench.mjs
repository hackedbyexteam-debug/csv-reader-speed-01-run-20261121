// Benchmark: my solve.js run() against csv-reader 1.0.0 (the reference) on the
// kit's practice set, in-process (CPU time via process.cpuUsage, the same
// user+system measure the harness uses) and end to end through main.ts.
//
// Usage:
//   node bench/bench.mjs --cases <practice/input/cases.json>
//                        [--expected <practice/reference/expected.json>]
//                        [--iters N]
//
// The baseline copy under bench/baseline/ is the kit's house baseline, used
// only to measure against locally; it is not part of the entry.

import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { run as mine } from '../solve.js';
import { readCsv as reference } from '../test/fixtures/csv-reader-1.0.0/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const casesPath = argVal('--cases', null);
const expectedPath = argVal('--expected', null);
const iters = Number(argVal('--iters', '7'));
if (!casesPath) {
  console.error('usage: node bench/bench.mjs --cases <cases.json> [--expected <expected.json>] [--iters N]');
  process.exit(2);
}

const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const totalChars = cases.reduce((n, c) => n + String(c.input.text).length, 0);
console.log(`cases: ${cases.length}, total input: ${(totalChars / 1e6).toFixed(2)} MB`);
for (const c of cases) console.log(`  ${c.id}: ${(String(c.input.text).length / 1e6).toFixed(2)} MB, header=${c.input.header}`);

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function timeFn(fn, label) {
  // Warm-up (JIT + inline caches), then timed iterations.
  for (let i = 0; i < 2; i++) for (const c of cases) fn(c.input);
  const cpu = [];
  const wall = [];
  for (let i = 0; i < iters; i++) {
    const c0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    for (const c of cases) fn(c.input);
    const t1 = process.hrtime.bigint();
    const c1 = process.cpuUsage(c0);
    cpu.push((c1.user + c1.system) / 1000);
    wall.push(Number(t1 - t0) / 1e6);
  }
  cpu.sort((a, b) => a - b);
  wall.sort((a, b) => a - b);
  const med = (xs) => xs[Math.floor(xs.length / 2)];
  console.log(
    `${label}: CPU median ${med(cpu).toFixed(1)} ms (min ${cpu[0].toFixed(1)}, max ${cpu[cpu.length - 1].toFixed(1)}), ` +
      `wall median ${med(wall).toFixed(1)} ms, ${(totalChars / 1e6 / (med(cpu) / 1000)).toFixed(1)} MB/s CPU`,
  );
  return med(cpu);
}

const refCpu = timeFn(reference, 'reference csv-reader 1.0.0 run() ');
const myCpu = timeFn(mine, 'mine                 run() ');
console.log(`speedup (run() CPU): ${(refCpu / myCpu).toFixed(2)}x`);

// End to end: node main.ts over the practice set, mine vs the house baseline.
function endToEnd(dir, label) {
  const outDir = join(ROOT, 'bench', '.out-' + label.replace(/[^a-z0-9]+/gi, '-'));
  mkdirSync(outDir, { recursive: true });
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, ['main.ts'], {
      cwd: dir,
      env: {
        ...process.env,
        MAKEFUN_INPUT_DIR: dirname(casesPath),
        MAKEFUN_OUTPUT_DIR: outDir,
      },
      encoding: 'utf8',
    });
    const t1 = process.hrtime.bigint();
    if (r.status !== 0) {
      console.log(`${label}: main.ts failed (status ${r.status})\n${r.stderr}`);
      return null;
    }
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  console.log(`${label}: main.ts wall median ${times[1].toFixed(1)} ms (runs ${times.map((t) => t.toFixed(0)).join(', ')})`);
  return { outDir, ms: times[1] };
}

const mineE2E = endToEnd(ROOT, 'mine');
const baseE2E = endToEnd(join(ROOT, 'bench', 'baseline'), 'baseline');
if (mineE2E && baseE2E) {
  const a = readFileSync(join(mineE2E.outDir, 'answers.json'), 'utf8');
  const b = readFileSync(join(baseE2E.outDir, 'answers.json'), 'utf8');
  console.log(`end-to-end outputs identical: ${a === b}`);
  console.log(`end-to-end speedup (wall): ${(baseE2E.ms / mineE2E.ms).toFixed(2)}x`);
  if (expectedPath) {
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
    const mineAnswers = JSON.parse(a);
    const ok = mineAnswers.every((ans, i) => canonical(ans) === canonical(expected.cases[i].output));
    console.log(`end-to-end answers match published expected.json: ${ok}`);
  }
}
