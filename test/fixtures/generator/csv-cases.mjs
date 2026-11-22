// csv-reader-speed-01's case generator: generate(rng, index) draws one CSV file, {text, header}, from the case's own
// stream (rng.ts streamFor: the seed, "case" and the index), drawing only from rng. No corpus: every case is drawn.
//
// A file is 1.4 to 2.0 million characters (CASE_CHARS) of records of 8 to 18 columns, each column of a kind drawn for the
// file (whole numbers, decimals, dates, codes, words, phrases that hold commas and quotes, notes that span lines), its
// line break LF or CRLF, a BOM before it on one file in three, and a header record on two files in three (header is
// true when the index is not 2 more than a multiple of 3, so every set of 3 or more holds both). Every record but the
// header may be broken, each kind with its own chance (BROKEN): too few fields, too many, a stray CR inside an unquoted
// field, characters after a closing quote, a blank line before it; and on half the files one quote near the end opens a
// field that never closes, the records after it holding no quote at all. Some quoted fields are quoted for no need, and
// a note's line breaks inside its quotes are the file's own, a lone CR now and then.
//
// The answer to each file is make.fun's own csv-reader 1.0.0's reading of it (the oracle): every file holds short and
// long rows by the hundred, so a reader that keeps a ragged row's length, or does not record it, misses every case.
//
// Loading this module turns V8's incremental marking off for the draw's process (node:v8 setFlagsFromString), as the
// house baseline's main.ts does for the house entry: the oracle is the plain reader, whose values are chains of joined
// strings, and under the sandbox's gVisor marking them a step at a time cost the draw about 0.4 s of its wall on a
// rented box. It changes no byte the draw writes.

import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

/** The characters a file holds, at least: drawn from CASE_CHARS[0] to CASE_CHARS[1]. */
export const CASE_CHARS = Object.freeze([1_400_000, 2_000_000]);

/** The columns a file holds: drawn from COLUMNS[0] to COLUMNS[1]. */
export const COLUMNS = Object.freeze([8, 18]);

/** Each broken kind's chance on a record after the header (cumulative draws of one rng.float() a record). */
export const BROKEN = Object.freeze({ short_row: 0.01, long_row: 0.01, stray_cr: 0.004, quote_junk: 0.004, blank_line: 0.003 });

/** The chance a file holds one quote that never closes, at most UNTERMINATED_TAIL records before its end. */
export const UNTERMINATED_CHANCE = 0.5;
export const UNTERMINATED_TAIL = 20;

/** The kinds a column may be, and the chance a plain field is quoted all the same. */
export const KINDS = Object.freeze(['int', 'decimal', 'date', 'code', 'word', 'word', 'phrase', 'phrase', 'note', 'maybe']);
const NEEDLESS_QUOTE = 0.01;

/** What a broken field holds after its closing quote. */
const JUNK = Object.freeze(['kg', 'x', ' cm', '!', '?', ' (est.)', 'x"y']);

/** The words fields are drawn from (letters, digits and a few non-ASCII ones, so a reader keeps UTF-16 as it stands). */
export const WORDS = Object.freeze([
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike',
  'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee',
  'zulu', 'north', 'south', 'east', 'west', 'river', 'stone', 'field', 'market', 'harbor', 'station', 'garden', 'bridge',
  'tower', 'valley', 'amber', 'cobalt', 'crimson', 'ivory', 'jade', 'onyx', 'scarlet', 'teal', 'umber', 'violet', 'Zürich',
  'São Paulo', 'Kraków', 'Malmö', 'Ōsaka', 'naïve', 'café', 'façade', 'smörgås', '東京', '數據', 'Δέλτα', 'Москва',
  'O\'Brien', 'well-known', 'n/a', 'TBD', '#42', '50%', '(none)', 'x_1', 'A&B',
]);

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '0123456789';

/** A JSON-ready string field drawn for a column of `kind`; `bare` keeps it free of commas, quotes and line breaks. */
function value(rng, kind, eol, bare) {
  switch (kind) {
    case 'int': {
      const n = rng.int(0, 9) === 0 ? -rng.int(1, 99_999) : rng.int(0, 9_999_999);
      return rng.int(0, 49) === 0 ? `00${n < 0 ? -n : n}` : String(n);
    }
    case 'decimal':
      return `${rng.int(0, 99_999)}.${DIGITS[rng.int(0, 9)]}${DIGITS[rng.int(0, 9)]}`;
    case 'date':
      return `${rng.int(1990, 2030)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
    case 'code':
      return `${LETTERS[rng.int(0, 23)]}${LETTERS[rng.int(0, 23)]}-${rng.int(100, 99_999)}`;
    case 'word':
      return rng.pick(WORDS);
    case 'maybe':
      return rng.chance(0.4) ? '' : rng.pick(WORDS);
    case 'phrase': {
      const n = rng.int(2, 6);
      let s = rng.pick(WORDS);
      for (let i = 1; i < n; i++) s += (!bare && rng.chance(0.1) ? ', ' : ' ') + rng.pick(WORDS);
      if (!bare && rng.chance(0.12)) s = `"${s}" ${rng.pick(WORDS)}`;
      return s;
    }
    case 'note': {
      if (bare || rng.chance(0.85)) return rng.chance(0.3) ? '' : rng.pick(WORDS);
      const lines = rng.int(2, 4);
      let s = rng.pick(WORDS);
      for (let i = 1; i < lines; i++) s += (rng.chance(0.1) ? '\r' : eol) + rng.pick(WORDS) + ' ' + rng.pick(WORDS);
      return s;
    }
    default:
      throw new Error(`no column kind ${kind}`);
  }
}

/** `s` as a CSV field: quoted when it must be (a comma, a quote or a line break in it), or now and then for no need. */
function cell(rng, s) {
  let must = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 44 || c === 34 || c === 10 || c === 13) {
      must = true;
      break;
    }
  }
  if (must) return `"${s.replaceAll('"', '""')}"`;
  return s !== '' && rng.chance(NEEDLESS_QUOTE) ? `"${s}"` : s;
}

/** One CSV file: {text, header} (the header). */
export function generate(rng, index) {
  const header = index % 3 !== 2;
  const eol = rng.chance(0.5) ? '\r\n' : '\n';
  const bom = rng.chance(1 / 3);
  const width = rng.int(COLUMNS[0], COLUMNS[1]);
  const kinds = Array.from({ length: width }, () => rng.pick(KINDS));
  const target = rng.int(CASE_CHARS[0], CASE_CHARS[1]);
  const unterminated = rng.chance(UNTERMINATED_CHANCE);
  // Where the unterminated quote goes: this many records before the end, which hold no quote after it.
  const tail = rng.int(1, UNTERMINATED_TAIL);
  const out = [];
  let length = 0;
  const push = (s) => {
    out.push(s);
    length += s.length;
  };
  if (bom) push('\uFEFF');
  if (header) push(kinds.map((k, i) => `${k}_${i + 1}`).join(',') + eol);
  const s = BROKEN;
  const cuts = [s.short_row, s.short_row + s.long_row, s.short_row + s.long_row + s.stray_cr, s.short_row + s.long_row + s.stray_cr + s.quote_junk];
  const blank = cuts[3] + s.blank_line;
  // The body is drawn to its target, then the tail: on a file with an unterminated quote, TAIL records that hold no
  // quote, the first of them opening the quote that never closes; on any other file, one more record.
  let tailLeft = unterminated ? tail : 1;
  let opened = false;
  while (tailLeft > 0) {
    const last = length >= target;
    const bare = last && unterminated;
    const fields = kinds.map((k) => value(rng, k, eol, bare));
    const x = rng.float();
    if (x < cuts[0]) fields.length = width - rng.int(1, Math.min(3, width - 1));
    else if (x < cuts[1]) for (let n = rng.int(1, 3); n > 0; n--) fields.push(value(rng, rng.pick(KINDS), eol, bare));
    const crAt = x >= cuts[1] && x < cuts[2] ? rng.int(0, fields.length - 1) : -1;
    const junkAt = x >= cuts[2] && x < cuts[3] && !bare ? rng.int(0, fields.length - 1) : -1;
    let line = '';
    for (let i = 0; i < fields.length; i++) {
      let f;
      if (i === crAt) f = `${rng.pick(WORDS)}\r${rng.pick(WORDS)}`.replaceAll(',', ' ').replaceAll('"', ' ');
      else if (i === junkAt) f = `"${fields[i].replaceAll('"', '""')}"${rng.pick(JUNK)}`;
      else if (bare) f = fields[i];
      else f = cell(rng, fields[i]);
      line += i === 0 ? f : `,${f}`;
    }
    if (x >= cuts[3] && x < blank) push(eol);
    if (bare && !opened) {
      opened = true;
      line = `"${line}`;
    }
    push(line + eol);
    if (last) tailLeft -= 1;
  }
  // Now and then the last line break is left off.
  let text = out.join('');
  if (rng.chance(0.3)) text = text.slice(0, text.length - eol.length);
  return { text, header };
}
