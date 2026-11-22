// Fast drop-in replacement for csv-reader 1.0.0 (make.fun's own reference CSV
// reader), written from its published spec and the reference source in the
// competition kit. It returns byte-identical answers for every input — same
// {columns, rows, errors}, same error codes, order, lines and rows — while
// running several times faster.
//
// How it stays identical
// -----------------------
// The reference reads one character at a time and builds every field by
// string concatenation. This reader makes the same decisions, only with
// bulk operations:
//
//   * A record whose physical line holds no double quote and no CR is read
//     with one slice + String.split(',') — the common case. A line ends at
//     LF or CRLF; the CR of a CRLF is excluded before the quote/CR check, so
//     CRLF files take the fast path too.
//   * Any other line is read field by field, but each unquoted field is one
//     slice up to the next comma or LF (found with indexOf), with stray CRs
//     dropped in bulk; each quoted field is one slice up to the next quote
//     (found with indexOf), with "" unescaped and CR/LF normalised in bulk.
//   * Line numbers, error order, and the record's start line/row are tracked
//     exactly as the reference tracks them: every LF, CRLF and lone CR
//     inside quotes counts one line; a lone CR outside quotes is a stray_cr
//     and counts no line; an unterminated quote rewinds the line count to
//     the opening quote before the text after it is re-read as unquoted.
//
// Nothing is cached between calls: run() is pure, like the reference.
// No dependencies, no lookup tables, no WebAssembly, no native code.

// How a field ended: at a comma (the record goes on), at a line break, or at
// the end of the text (the record ends).
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1; // drop a leading U+FEFF

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // A chunk of a quoted field, with each CRLF or lone CR inside it read as
  // LF, and `line` advanced by one per line break in it.
  function normChunk(chunk) {
    if (chunk.indexOf('\r') === -1) {
      let n = 0;
      let i = chunk.indexOf('\n');
      while (i !== -1) {
        n += 1;
        i = chunk.indexOf('\n', i + 1);
      }
      line += n;
      return chunk;
    }
    const norm = chunk.replace(/\r\n?/g, '\n');
    let n = 0;
    let i = norm.indexOf('\n');
    while (i !== -1) {
      n += 1;
      i = norm.indexOf('\n', i + 1);
    }
    line += n;
    return norm;
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    const iC = text.indexOf(',', pos);
    const iN = text.indexOf('\n', pos);
    let m; // the delimiter that ends the field, or -1 at the end of the text
    let isComma;
    if (iC === -1) {
      m = iN;
      isComma = false;
    } else if (iN === -1) {
      m = iC;
      isComma = true;
    } else if (iC < iN) {
      m = iC;
      isComma = true;
    } else {
      m = iN;
      isComma = false;
    }
    if (m === -1) {
      // To the end of the text: every CR in it is a stray one.
      const seg = text.slice(pos);
      const r = seg.indexOf('\r');
      if (r === -1) {
        value += seg;
        added += seg.length;
      } else {
        const parts = seg.split('\r');
        for (let i = 0; i < parts.length - 1; i += 1) error('stray_cr');
        const kept = parts.join('');
        value += kept;
        added += kept.length;
      }
      pos = len;
      return { value, ended: END, added };
    }
    // The field's content, without the CR of a CRLF line break.
    let end = m;
    if (!isComma && m > pos && text.charCodeAt(m - 1) === 13) end = m - 1;
    const seg = text.slice(pos, end);
    const r = seg.indexOf('\r');
    if (r === -1) {
      value += seg;
      added += seg.length;
    } else {
      const parts = seg.split('\r');
      for (let i = 0; i < parts.length - 1; i += 1) error('stray_cr');
      const kept = parts.join('');
      value += kept;
      added += kept.length;
    }
    pos = m + 1;
    if (isComma) return { value, ended: COMMA, added };
    line += 1;
    return { value, ended: LINE_BREAK, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote inside the field is one quote.
        value += normChunk(text.slice(pos, q));
        value += '"';
        pos = q + 2;
        continue;
      }
      value += normChunk(text.slice(pos, q));
      pos = q + 1;
      break;
    }
    if (pos >= len) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields;
    let quoted = false;
    // Fast path: the record is one physical line with no quote and no CR.
    // The CR of a CRLF line ending is excluded from the line first.
    const e = text.indexOf('\n', pos);
    const contentEnd =
      e === -1 ? len : e > pos && text.charCodeAt(e - 1) === 13 ? e - 1 : e;
    const lineStr = text.slice(pos, contentEnd);
    if (lineStr.indexOf('"') === -1 && lineStr.indexOf('\r') === -1) {
      fields = lineStr.split(',');
      pos = e === -1 ? len : e + 1;
      if (e !== -1) line += 1;
    } else {
      fields = [];
      let field;
      do {
        quoted = text.charCodeAt(pos) === 34;
        field = quoted ? readQuoted() : readUnquoted('');
        fields.push(field.value);
      } while (field.ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
