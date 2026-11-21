// How the Ossie query runners compare rows (ossie-query.mjs, ossie-wide.mjs, ossie-expand.mjs), as
// Ossie's compliance READMEs say: columns by position (names without regard to case), rows as a
// multiset, in order when the query has an ORDER BY of its own; a number equal (within 1e-9 of
// it), or, with `round`, equal once rounded to 2 places (as ost's tables round a double); NULL
// only to NULL. A value is a DuckDB value (getRowsJS) or the text of an ost table's cell.

// An ost table: a border, a header, a border, the rows, a border; an empty cell is NULL, a
// "quoted" cell the text in the quotes.
export function table(lines) {
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const body = lines.filter(l => l.startsWith('|'));
  const [head, ...rows] = body;
  const cell = c => (c === '' ? null : /^".*"$/.test(c) ? c.slice(1, -1).replaceAll('""', '"') : c);
  return { columns: cells(head), rows: rows.map(r => cells(r).map(cell)) };
}

// Whether the query orders its own rows: an ORDER BY outside parentheses.
export function ordered(q) {
  let depth = 0, top = '';
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === "'") { const e = q.indexOf("'", i + 1); i = e < 0 ? q.length : e; top += ' '; continue; }
    if (c === '-' && q[i + 1] === '-') { const e = q.indexOf('\n', i); i = e < 0 ? q.length : e; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth) top += c;
  }
  return /\bORDER\s+BY\b/i.test(top);
}

// A value as null, a number, or text.
export function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('T', ' ').replace(/\.000Z$/, '').replace(/Z$/, '');
  }
  if (typeof v === 'object' && 'toDouble' in v) return v.toDouble();
  if (typeof v === 'object') return String(v);
  return v;
}

const round2 = x => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
export function same(got, want, { round = false } = {}) {
  got = norm(got);
  want = norm(want);
  if (want === null || got === null) return want === null && got === null;
  if (typeof got === 'number') {
    const w = Number(want);
    if (Number.isNaN(w) || want === '') return false;
    return Math.abs(got - w) <= 1e-9 * Math.max(1, Math.abs(w)) || (round && round2(got) === w);
  }
  if (typeof want === 'number') return false;
  if (got === want) return true;
  // A timestamp at midnight against a date, and booleans, as ost writes them.
  return got.toLowerCase() === want.toLowerCase() && /^(true|false)$/i.test(got);
}

export const show = v => {
  v = norm(v);
  return v === null ? 'NULL' : String(v);
};

// Why `got` is not `want` (each { columns, rows }), or null when it is.
export function compare(got, want, inOrder, opts) {
  const lc = s => String(s).toLowerCase();
  if (got.columns.length !== want.columns.length) return `${got.columns.length} columns (${got.columns.join(', ')}), not ${want.columns.length} (${want.columns.join(', ')})`;
  if (got.columns.some((c, i) => lc(c) !== lc(want.columns[i]))) return `columns named ${got.columns.join(', ')}, not ${want.columns.join(', ')}`;
  if (got.rows.length !== want.rows.length) return `${got.rows.length} rows, not ${want.rows.length}`;
  const eq = (g, w) => g.every((v, i) => same(v, w[i], opts));
  if (inOrder) {
    const i = got.rows.findIndex((r, k) => !eq(r, want.rows[k]));
    return i < 0 ? null : `row ${i + 1} is ${got.rows[i].map(show).join(' | ')}, not ${want.rows[i].map(show).join(' | ')}`;
  }
  const left = [...want.rows];
  for (const r of got.rows) {
    const k = left.findIndex(w => eq(r, w));
    if (k < 0) return `row ${r.map(show).join(' | ')} is not expected`;
    left.splice(k, 1);
  }
  return null;
}

// Rows of a DuckDB query, as compare() takes them.
export async function rows(con, sql) {
  const r = await con.runAndReadAll(sql);
  return { columns: r.columnNames(), rows: r.getRowsJS() };
}
