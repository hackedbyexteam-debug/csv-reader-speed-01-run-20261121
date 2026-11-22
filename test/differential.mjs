// Differential tests: my solve.js run() against csv-reader 1.0.0 (the reference,
// vendored under test/fixtures/csv-reader-1.0.0/ from the competition kit).
// Answers must be identical as JSON values (the scorer's comparison: same
// type, strings code unit for code unit, arrays in order, objects by keys).
//
// Usage:
//   node test/differential.mjs [--cases <cases.json> --expected <expected.json>]
//                              [--generated N] [--fuzz N]
//   --cases/--expected: the kit's practice set; compared against both the
//     reference and the published expected answers.
//   --generated N: N fresh generator-shaped cases (kit's published generator
//     + a seeded xoshiro128** stream, same shape as the real draw).
//   --fuzz N: N random tiny strings over the CSV alphabet.
//
// Exit code 0 when every comparison matches, 1 otherwise.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { run } from '../solve.js';
import { readCsv as reference } from './fixtures/csv-reader-1.0.0/index.js';
import { generate } from './fixtures/generator/csv-cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A JSON value with every object's keys in code-unit order: two values are
 *  equal when these strings are (the scorer's comparison). */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, input) {
  let mine;
  let ref;
  try {
    mine = run(input);
  } catch (e) {
    failures.push({ name, input, why: `mine threw: ${e.message}` });
    failed += 1;
    return;
  }
  try {
    ref = reference(input);
  } catch (e) {
    failures.push({ name, input, why: `reference threw: ${e.message}` });
    failed += 1;
    return;
  }
  if (canonical(mine) !== canonical(ref)) {
    failures.push({
      name,
      input,
      why: 'mismatch',
      mine: JSON.stringify(mine),
      ref: JSON.stringify(ref),
    });
    failed += 1;
    return;
  }
  passed += 1;
}

// ---------------------------------------------------------------------------
// xoshiro128** (the generator's stream, ported from the kit's rng.ts) so the
// generated cases are drawn exactly the way the competition draws them.
// ---------------------------------------------------------------------------
const rotl = (x, k) => (x << k) | (x >>> (32 - k));
class Rng {
  constructor(key) {
    const v = new DataView(key.buffer, key.byteOffset, 16);
    this.a = v.getUint32(0) | 0;
    this.b = v.getUint32(4) | 0;
    this.c = v.getUint32(8) | 0;
    this.d = v.getUint32(12) | 0;
    if ((this.a | this.b | this.c | this.d) === 0) throw new Error('zero state');
  }
  u32() {
    const a = this.a;
    const b = this.b;
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    let c = this.c ^ a;
    let d = this.d ^ b;
    const nb = b ^ c;
    const na = a ^ d;
    c ^= t;
    d = rotl(d, 11);
    this.a = na;
    this.b = nb;
    this.c = c;
    this.d = d;
    return result;
  }
  int(lo, hi) {
    const span = hi - lo + 1;
    const limit = Math.floor(2 ** 32 / span) * span;
    let x = this.u32();
    while (x >= limit) x = this.u32();
    return lo + (x % span);
  }
  float() {
    return this.u32() / 2 ** 32;
  }
  pick(xs) {
    return xs[this.int(0, xs.length - 1)];
  }
  chance(p) {
    return this.float() < p;
  }
}
function streamFor(seed, label, index) {
  const key = createHash('sha256')
    .update(`makefun/speed-home/rng/v1\n${seed}\n${label}\n${index}`)
    .digest();
  return new Rng(key);
}

// ---------------------------------------------------------------------------
// Hand-written edge corpus: every corner of the spec, each with header true
// and false where it matters.
// ---------------------------------------------------------------------------
const EDGE_TEXTS = [
  '',
  '\uFEFF',
  '\uFEFFa,b\n1,2\n',
  'a,b\n1,2\n',
  'a,b\n1,2',
  'a',
  'a\n',
  'a,b,',
  ',',
  ',,',
  ',\n',
  'a,,c\n1,,3\n',
  ',a\n,1\n',
  'a,b\r\n1,2\r\n',
  'a,b\r1,2\r',
  'a,b\r\n1,2\n3,4\r\n',
  'a\rb\nc\rd\n',
  '\r',
  '\r\n',
  '\n',
  '\n\n\n',
  '\r\n\r\n',
  'a,b\n\n1,2\n',
  'a,b\r\n\r\n1,2\r\n',
  'a,b\n\r\n1,2\n',
  'a,b\n\r1,2\n',
  '\ra,b\n1,2\n',
  'a,b\n\r',
  'a,b\n1,2\n\r',
  'a,b\n1,2\r',
  'a,b\n1,2\r\r',
  'a,b\n1,2\n\n\n',
  '"a","b"\n"1","2"\n',
  '""\n',
  '"",""\n',
  '""""\n',
  '"""\n',
  '"a""b",c\n',
  '"a""",b\n',
  '"a"',
  '"a"x\n',
  '"a"x,b\n',
  '"a" ,b\n',
  '"a"kg,b\n',
  '"a"x"y,b\n',
  '"a" (est.),b\n',
  '"a"!,b\n',
  '"a"?,b\n',
  '"a" cm,b\n',
  '"a"\r,b\n',
  '"a"\r\n,b\n',
  '"a"\r',
  '"a"\r\n',
  '"a",\n',
  'a,"b"x\n',
  'a,"b"x',
  '"a\nb",c\n1,2\n',
  '"a\r\nb",c\n1,2\n',
  '"a\rb",c\n1,2\n',
  '"a\r\rb",c\n',
  '"a\n\nb",c\n1,2\n',
  '"a\nb\nc",d\n"e\nf",g\n',
  '"a\rb\rc",d\n',
  '"a,b",c\n',
  '"a""b""c",d\n',
  'a"b,c\n',
  'a"b"c,d\n',
  'a""b,c\n',
  '"ab',
  '"ab,cd',
  '"ab\ncd',
  '"ab\ncd\nef',
  '"ab\r\ncd',
  '"a""b',
  '"a""b\nc,d\n',
  '"a""b",c\n"d",e\n',
  '"a,b',
  '"a,b\nc,d\ne,f\n',
  '"a,b\nc,d',
  '"x',
  '"x\ny,z\n',
  'h1,h2\n"x',
  'a,b\n"x,y\n',
  'a,b,c\n1,2\n',
  'a,b,c\n1,2,3,4\n',
  'a\n1,2\n',
  'a,b\n1\n2,3,4\n',
  'a,b,c\n1\n22,33\n444,555,666,777\n',
  'a,b\n"1","2","3"\n',
  'a,b\n"1\n2",3\n4,5\n',
  'a,b\n"1\r2",3\n4,5\n',
  'a,b\n"1\r\n2",3\n4,5\n',
  'a,b\n"1\n2\n3",4\n5,6\n7,8\n',
  'a,b\n"1\n2",3,4\n5,6\n',
  'a,b\n1,"2\n3"\n4,5\n',
  'a,b\r\n"1\r\n2",3\r\n4,5\r\n',
  'x\ny\n',
  'x\ny',
  'a,b\n"unterminated',
  'a,b\n1,"unterminated\n2,3\n',
  'a,b\n1,2\n"tail',
  'a,b\n1,2\n"tail,more\nnext,line\n',
  'Zürich,São Paulo\ncafé,naïve\n',
  '😀,🎉\n🚀,🌍\n',
  '"😀\n🎉",x\n',
  '\uFEFF\uFEFFa,b\n',
  'a,b\n\uFEFF1,2\n',
  'a\u0000b,c\n',
  'a,b\n1,2\n3,4',
  'a,b\n1,2\n3,4\n',
  'a,b\n1,2\n\n',
  '"a",b\n"c\nd",e\n"f",g\n',
  'a,b\n"x"y"z",w\n',
  'a,b\n"x"\r"y",w\n',
  'a,b\n"x"\r\ny,w\n',
  'a,b\n"x"\ry,w\n',
  'a,b\n"x",y\n"z"w,v\n',
  'a,b\n"x"w\nv,y\n',
  'col\n"a"\n"b"\n"c"\n',
  'col\n"a\nb"\n"c"\n',
  'a,b,c,d,e,f,g,h\n1,2,3,4,5,6,7,8\n',
  'a,b\n' + 'x'.repeat(100000) + ',2\n',
  'a,b\n"' + 'y'.repeat(100000) + '",2\n',
  'a,b\n"' + 'y'.repeat(50000) + '\n' + 'z'.repeat(50000) + '",2\n3,4\n',
  'a,b\n"' + 'q"'.repeat(20000) + '",2\n',
  'a,b\n' + 'r'.repeat(5000) + '\r' + 's'.repeat(5000) + ',2\n',
  'a,b\n"x""y""z",w\n',
  'a,b\n"x""",w\n',
  'a,b\n"""x",w\n',
  'a,b\n""""x",w\n',
  'a,b\n"x""""y",w\n',
  'a,b\n,,\n,,\n',
  'a,b\n,\n,\n',
  'a\n\n\n1\n\n\n2\n',
  'a,b\n1,2\n3\n\n4,5,6\n\n7,8\n',
];

for (const t of EDGE_TEXTS) {
  check(`edge header=true ${JSON.stringify(t.slice(0, 60))}`, { text: t, header: true });
  check(`edge header=false ${JSON.stringify(t.slice(0, 60))}`, { text: t, header: false });
}

// A wide record with many columns, and a long file of small rows.
check('wide 60 cols', {
  text: Array.from({ length: 60 }, (_, i) => `c${i}`).join(',') + '\n' +
    Array.from({ length: 200 }, () => Array.from({ length: 60 }, (_, i) => `v${i}`).join(',')).join('\n'),
  header: true,
});
check('many rows 20000', {
  text: 'a,b,c\n' + '1,2,3\n'.repeat(20000),
  header: true,
});
check('many rows no trailing newline', {
  text: 'a,b,c\n' + '1,2,3\n'.repeat(19999) + '1,2,3',
  header: true,
});
check('many rows CRLF', {
  text: 'a,b,c\r\n' + '1,2,3\r\n'.repeat(5000),
  header: true,
});
check('many rows quoted', {
  text: 'a,b\n' + '"x,y",2\n'.repeat(5000),
  header: true,
});
check('many rows multiline notes', {
  text: 'a,b\n' + '"line1\nline2",2\n'.repeat(2000),
  header: true,
});

// ---------------------------------------------------------------------------
// Random fuzz: tiny strings over the CSV alphabet, plus random structured rows.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const fuzzN = Number(argVal('--fuzz', '3000'));
const genN = Number(argVal('--generated', '12'));

const ALPHABET = ['a', 'b', ',', '"', '\n', '\r', ' ', 'x'];
{
  const rnd = mulberry32(0x9e3779b9);
  for (let i = 0; i < fuzzN; i++) {
    const n = Math.floor(rnd() * 48);
    let s = '';
    for (let j = 0; j < n; j++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    if (rnd() < 0.15) s = '\uFEFF' + s;
    check(`fuzz#${i} ${JSON.stringify(s)}`, { text: s, header: rnd() < 0.5 });
  }
}
// Structured fuzz: random records, random quoting, random breakage.
{
  const rnd = mulberry32(1234567);
  const words = ['alpha', 'beta', 'x,y', 'q"q', 'a\nb', 'a\rb', 'a\r\nb', '', ' ', '42', 'café'];
  for (let i = 0; i < 1500; i++) {
    const width = 1 + Math.floor(rnd() * 6);
    const nrec = 1 + Math.floor(rnd() * 8);
    const eol = rnd() < 0.5 ? '\n' : '\r\n';
    const lines = [];
    for (let r = 0; r < nrec; r++) {
      const nf = Math.max(0, width + Math.floor(rnd() * 5) - 2);
      const fs = [];
      for (let f = 0; f < nf; f++) {
        let v = words[Math.floor(rnd() * words.length)];
        const quote = v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r') || rnd() < 0.2;
        if (quote) v = `"${v.replaceAll('"', '""')}"`;
        if (rnd() < 0.05) v += ['kg', 'x', '!', '"'][Math.floor(rnd() * 4)];
        if (rnd() < 0.05) v = `${v.slice(0, 1)}\r${v.slice(1)}`;
        fs.push(v);
      }
      lines.push(fs.join(','));
      if (rnd() < 0.05) lines.push('');
    }
    let text = lines.join(eol);
    if (rnd() < 0.7) text += eol;
    if (rnd() < 0.1) text = '\uFEFF' + text;
    check(`structured-fuzz#${i}`, { text, header: rnd() < 0.5 });
  }
}

// ---------------------------------------------------------------------------
// Fresh generator-shaped cases, drawn like the competition draws them.
// ---------------------------------------------------------------------------
{
  const seed = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  for (let i = 0; i < genN; i++) {
    const input = generate(streamFor(seed, 'case', i), i % 3 === 2 ? 2 : i);
    check(`generated#${i} len=${input.text.length} header=${input.header}`, input);
  }
}

// ---------------------------------------------------------------------------
// The kit's practice set, when given.
// ---------------------------------------------------------------------------
const casesPath = argVal('--cases', null);
const expectedPath = argVal('--expected', null);
if (casesPath && expectedPath) {
  const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const byId = new Map(expected.cases.map((c) => [c.id, c.output]));
  for (const c of cases) {
    check(`practice ${c.id}`, c.input);
    const mine = run(c.input);
    const want = byId.get(c.id);
    if (canonical(mine) !== canonical(want)) {
      failures.push({ name: `practice-expected ${c.id}`, why: 'differs from published expected.json' });
      failed += 1;
    } else {
      passed += 1;
    }
    // The reference itself must also match the published expected answers.
    const ref = reference(c.input);
    if (canonical(ref) !== canonical(want)) {
      failures.push({ name: `practice-reference ${c.id}`, why: 'reference differs from published expected.json' });
      failed += 1;
    } else {
      passed += 1;
    }
  }
}

console.log(`differential: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures.slice(0, 10)) {
    console.log('FAIL', f.name, '-', f.why);
    if (f.input) console.log('  input:', JSON.stringify(f.input).slice(0, 400));
    if (f.mine) console.log('  mine:', f.mine.slice(0, 600));
    if (f.ref) console.log('  ref :', f.ref.slice(0, 600));
  }
  process.exit(1);
}
