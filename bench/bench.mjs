// SwiftMark benchmark — no dependencies, no marked import.
//
// Usage:
//   node bench/bench.mjs [cases.json] [iterations]
//   node bench/bench.mjs                 (built-in sample documents)
//   node bench/bench.mjs cases.json 3    (3 timed runs over that file)
//
// cases.json is an array of {id, markdown} (the kit practice format).
// Reports CPU time (process.cpuUsage) and wall time per run, median.
// Deterministic: the same input always yields the same bytes, so the
// benchmark only measures speed, never correctness. Compare against
// marked 18.1.3 separately (marked is NOT a dependency of this repo
// and is deliberately not imported here).
import { readFileSync } from 'node:fs';
import { parse } from '../parse.js';

const SAMPLES = [
  '# Hello\n\nA plain paragraph with *emphasis*, **strong**, and `code`.\n\n- one\n- two\n- three\n',
  '## Table\n\n| Name | Value |\n|------|------:|\n| alpha | 1 |\n| beta | 2 |\n\nA [link](https://example.com) and an ![image](https://example.com/i.png).\n',
  '> A blockquote with a lazy continuation\nand a [reference][r] link.\n\n[r]: https://example.com "Title"\n\n```js\nconst x = 1;\n```\n',
  '# Big doc\n\n' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40) +
  '\n\n' + '## Section\n\n' + 'Some text with `inline code` and **bold** words. '.repeat(20) + '\n',
];

function loadCases(path) {
  if (!path) return SAMPLES.map((markdown, i) => ({ id: `sample-${i + 1}`, markdown }));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(data) ? data : data.cases;
}

function cpuMs(fn) {
  const t0 = process.cpuUsage();
  const w0 = performance.now();
  fn();
  const t1 = process.cpuUsage(t0);
  return { cpu: (t1.user + t1.system) / 1000, wall: performance.now() - w0 };
}

const casesPath = process.argv[2] ?? null;
const iterations = parseInt(process.argv[3] ?? '3', 10);
const cases = loadCases(casesPath);
const mds = cases.map((c) => c.markdown);
const totalChars = mds.reduce((a, s) => a + s.length, 0);

// Warmup (JIT + caches) — not timed.
for (const md of mds) parse(md);

const runs = [];
for (let i = 0; i < iterations; i += 1) {
  runs.push(cpuMs(() => { for (const md of mds) parse(md); }));
}
runs.sort((a, b) => a.cpu - b.cpu);
const med = runs[Math.floor(runs.length / 2)];
console.log(`cases=${mds.length} totalChars=${totalChars}`);
console.log(`cpu runs (ms): ${runs.map((r) => r.cpu.toFixed(0)).join(', ')}`);
console.log(`wall runs (ms): ${runs.map((r) => r.wall.toFixed(0)).join(', ')}`);
console.log(`median cpu=${med.cpu.toFixed(0)} ms wall=${med.wall.toFixed(0)} ms`);
console.log(`throughput=${(totalChars / (med.cpu / 1000) / 1e6).toFixed(2)} MB/s (cpu)`);
