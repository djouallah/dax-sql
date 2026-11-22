// Display helpers: the compiler's SQL laid out on lines and highlighted, and DAX highlighted.
// Display only: the SQL that runs is the compiler's, as it wrote it.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (c, s) => `<span class="${c}">${esc(s)}</span>`;

const SQL_TOKEN = /('(?:[^']|'')*')|("(?:[^"]|"")*"|\[[^\]\n]*\])|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_$]*)|(\s+)|(<=|>=|<>|!=|\|\||::|->>|->|.)/gy;
const KW = new Set(`SELECT FROM WHERE GROUP BY ORDER HAVING JOIN LEFT RIGHT FULL INNER OUTER CROSS APPLY ON AS AND OR NOT
  IN IS NULL DISTINCT CASE WHEN THEN ELSE END WITH MATERIALIZED UNION ALL EXCEPT INTERSECT EXISTS ASC DESC NULLS FIRST
  LAST CAST LIMIT OFFSET FETCH NEXT ROWS ONLY TOP OVER PARTITION FILTER QUALIFY WINDOW TRUE FALSE LATERAL BETWEEN LIKE
  RECURSIVE VALUES ROW RANGE UNBOUNDED PRECEDING FOLLOWING CURRENT`.split(/\s+/));

// The clauses that start a line, longest first.
const CLAUSES = [
  'LEFT OUTER JOIN', 'FULL OUTER JOIN', 'GROUP BY', 'ORDER BY', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'INNER JOIN',
  'CROSS JOIN', 'CROSS APPLY', 'OUTER APPLY', 'UNION ALL', 'JOIN', 'FROM', 'WHERE', 'HAVING', 'QUALIFY', 'UNION',
  'EXCEPT', 'INTERSECT', 'LIMIT', 'OFFSET', 'WINDOW', 'SELECT',
].map(c => c.split(' '));

function lexSql(sql) {
  const out = [];
  SQL_TOKEN.lastIndex = 0;
  let m;
  while (SQL_TOKEN.lastIndex < sql.length && (m = SQL_TOKEN.exec(sql))) {
    const [t, str, id, num, word, ws] = m;
    if (ws) continue;
    out.push(str ? { k: 'str', t } : id ? { k: 'id', t } : num ? { k: 'num', t }
      : word ? { k: KW.has(word.toUpperCase()) ? 'kw' : 'word', t, u: word.toUpperCase() } : { k: 'p', t });
  }
  return out;
}

const NO_SPACE_BEFORE = new Set([',', ')', '.', '[', ']']);
const NO_SPACE_AFTER = new Set(['(', '.', '[']);

// SQL on lines: a clause at the start of a line, a subquery indented, the items of a SELECT
// list one a line.
export function formatSql(sql) {
  const toks = lexSql(sql);
  const lines = [];
  let line = [], indent = 0;
  const stack = []; // per '(': { sub: is it a subquery, indent: the indent around it }
  let selectDepth = null; // the paren depth at which the current SELECT list is
  // A line's level: the indent, one more after a SELECT list's comma.
  let cont = false, level = null;
  const flush = (more = false) => {
    if (line.length) lines.push({ level: level ?? indent + (cont ? 1 : 0), html: line.join('') });
    line = []; level = null; cont = more;
  };
  const lineLevel = () => level ?? indent + (cont ? 1 : 0);
  const push = (html, tok, prev, before) => {
    const unary = prev?.t === '-' && (!before || before.t === '(' || before.t === ',' || before.k === 'kw' || /^[-+*\/=<>]/.test(before.t) && before.k === 'p');
    const space = line.length && prev && !unary && !NO_SPACE_AFTER.has(prev.t) && !NO_SPACE_BEFORE.has(tok.t)
      && !(tok.t === '(' && (prev.k === 'word' || (prev.k === 'kw' && /^(CAST|FILTER|OVER|ROW)$/.test(prev.u))));
    line.push((space ? ' ' : '') + html);
  };
  const render = tok => tok.k === 'kw' ? span('kw', tok.t) : tok.k === 'str' ? span('str', tok.t)
    : tok.k === 'id' ? span('id', tok.t) : tok.k === 'num' ? span('num', tok.t)
    : tok.k === 'word' ? span('fn', tok.t) : esc(tok.t);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i], prev = toks[i - 1];
    if (tok.k === 'kw') {
      const c = CLAUSES.find(c => c.every((w, j) => toks[i + j]?.u === w));
      // A clause starts a line, unless it is the SELECT just after its subquery's '('.
      const inFn = stack.length && !stack[stack.length - 1].sub;
      const distinctFrom = tok.u === 'FROM' && prev?.u === 'DISTINCT' && /^(IS|NOT)$/.test(toks[i - 2]?.u);
      if (c && !inFn && !distinctFrom && !(tok.u === 'SELECT' && prev?.t === '(')) {
        flush();
        const words = toks.slice(i, i + c.length);
        line.push(words.map(render).join(' '));
        i += c.length - 1;
        selectDepth = tok.u === 'SELECT' ? stack.length : selectDepth === stack.length ? null : selectDepth;
        continue;
      }
      if (tok.u === 'SELECT') selectDepth = stack.length;
    }
    if (tok.t === '(') {
      const sub = toks[i + 1]?.u === 'SELECT' || toks[i + 1]?.u === 'WITH';
      push('(', tok, prev);
      const at = lineLevel();
      stack.push({ sub, indent, selectDepth, at });
      if (sub) { flush(); indent = at + 1; }
      continue;
    }
    if (tok.t === ')') {
      const top = stack.pop() ?? { sub: false, indent };
      if (top.sub) { flush(); indent = top.indent; level = top.at; }
      selectDepth = top.selectDepth;
      push(')', tok, top.sub ? null : prev);
      continue;
    }
    if (tok.t === ',' && selectDepth === stack.length) {
      push(',', tok, prev);
      flush(true);
      continue;
    }
    // A CTE after the one before: "), f2 AS (" puts f2 on its own line.
    if (prev?.t === ',' && stack.length === 0 && toks[i + 1]?.u === 'AS') flush();
    push(render(tok), tok, prev, toks[i - 2]);
  }
  flush();
  return lines.map(l => '  '.repeat(l.level) + l.html).join('\n');
}

// DAX highlighted, its layout kept.
const DAX_TOKEN = /(\/\/[^\n]*|--[^\n]*)|("(?:[^"]|"")*")|('(?:[^']|'')*'(?:\[[^\]]*\])?|[A-Za-z_][A-Za-z0-9_]*\[[^\]]*\])|(\[[^\]]*\])|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|(\s+)|(.)/gy;
const DAX_KW = new Set(['EVALUATE', 'DEFINE', 'VAR', 'RETURN', 'MEASURE', 'ORDER', 'BY', 'ASC', 'DESC', 'START', 'AT', 'TRUE', 'FALSE', 'IN', 'NOT', 'AND', 'OR']);
export function highlightDax(dax) {
  let out = '', m;
  DAX_TOKEN.lastIndex = 0;
  while (DAX_TOKEN.lastIndex < dax.length && (m = DAX_TOKEN.exec(dax))) {
    const [t, com, str, colref, measure, num, word, ws] = m;
    out += com ? span('com', t) : str ? span('str', t) : colref ? span('id', t) : measure ? span('ms', t)
      : num ? span('num', t) : word ? (DAX_KW.has(t.toUpperCase()) ? span('kw', t) : span('fn', t))
      : ws ? t : esc(t);
  }
  return out;
}

// A result's rows from an Arrow table (DuckDB-WASM), as plain values.
export function arrowRows(table) {
  const fields = table.schema.fields;
  const conv = fields.map(f => {
    const t = String(f.type);
    if (/^Date/.test(t)) return v => v == null ? null : new Date(Number(v)).toISOString().slice(0, 10);
    if (/^Timestamp/.test(t)) {
      const unit = f.type.unit ?? 1; // 0 s, 1 ms, 2 us, 3 ns
      const div = [1e-3, 1, 1e3, 1e6][unit];
      return v => v == null ? null : new Date(Number(v) / div).toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, '');
    }
    if (/^Decimal/.test(t)) {
      const scale = f.type.scale;
      return v => v == null ? null : Number(String(v)) / 10 ** scale;
    }
    return v => typeof v === 'bigint' ? Number(v) : v;
  });
  const cols = fields.map((f, i) => table.getChildAt(i));
  const rows = [];
  for (let r = 0; r < table.numRows; r++) rows.push(cols.map((c, i) => conv[i](c.get(r))));
  return { names: fields.map(f => f.name), rows };
}

// A value as a cell's text.
export function cell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
