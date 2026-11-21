// SQL over the model -> a DAX query. A SELECT names the model's columns to group by and
// aggregates of its measures (or columns), with the clauses of an aggregate query:
//
//   SELECT Product.Color, AGG(Orders) AS orders
//   FROM model
//   WHERE Customer.City IN ('Paris', 'Lyon')
//   GROUP BY ALL
//   HAVING orders > 2
//   ORDER BY orders DESC
//   LIMIT 10
//
// is SUMMARIZECOLUMNS of the groups and the aggregates, under CALCULATETABLE of the WHERE's
// conditions, FILTERed by the HAVING, with the ORDER BY of DAX; LIMIT and OFFSET are the
// SQL's. GROUP BY a, ROLLUP(b) with GROUPING(b) AS name in the SELECT is ROLLUPADDISSUBTOTAL;
// FETCH FIRST n ROWS WITH TIES is TOPN. A measure keeps its own definition: there is no way
// to change the filter context besides WHERE. The result is the DAX query's syntax tree
// (parser.js's), which the compiler takes as it is: no DAX text between them.
//
// Names: table.column, "quoted"."names" ('text' is text),
// [bracketed] ones, 'Table'[Column] as in DAX, or a column's name alone when one table has
// it. AGG(m) and MEASURE(m) are measure m (AGG(Orders), AGG(Sales.Orders)); SUM, AVG,
// MIN, MAX and COUNT (COUNT(DISTINCT c)) aggregate a column. FROM names the model.
import { DaxError } from './errors.js';

const lc = s => String(s).toLowerCase();
const sqlSyntax = (msg, pos, src) => new DaxError(`SQL syntax: ${msg}`, { code: 'SYNTAX', pos, src });
const sqlSemantic = msg => new DaxError(`SQL: ${msg}`, { code: 'SEMANTIC' });
const sqlUnsupported = msg => new DaxError(`SQL: ${msg} is not supported`, { code: 'UNSUPPORTED' });

// --- tokens ------------------------------------------------------------------------------
//   num, str ('text'), id (a bare name), qid ("name", [name], `name`), op

const OPS = ['<>', '!=', '<=', '>=', '||', '=', '<', '>', '+', '-', '*', '/', '%', '(', ')', ',', '.', ';'];

function lex(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const quoted = (close, kind, at) => {
    let v = '';
    i++;
    for (;;) {
      if (i >= n) throw sqlSyntax(`unterminated ${kind}`, at, src);
      if (src[i] === close) {
        if (src[i + 1] === close) { v += close; i += 2; continue; }
        i++;
        return v;
      }
      v += src[i++];
    }
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && src[i + 1] === '-') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) throw sqlSyntax('unterminated comment', i, src);
      i = e + 2;
      continue;
    }
    const at = i;
    if (c === "'") { out.push({ t: 'str', v: quoted("'", 'string', at), at, end: i }); continue; }
    if (c === '"') { out.push({ t: 'qid', v: quoted('"', 'quoted name', at), at, end: i }); continue; }
    if (c === '`') { out.push({ t: 'qid', v: quoted('`', 'quoted name', at), at, end: i }); continue; }
    if (c === '[') { out.push({ t: 'qid', v: quoted(']', '[name]', at), at, end: i }); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i));
      out.push({ t: 'num', v: m[0], at, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      const m = /^[\p{L}_][\p{L}\p{N}_$]*/u.exec(src.slice(i));
      out.push({ t: 'id', v: m[0], at, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw sqlSyntax(`unexpected character "${c}"`, i, src);
    out.push({ t: 'op', v: op, at, end: i + op.length });
    i += op.length;
  }
  return out;
}

// --- the syntax tree ---------------------------------------------------------------------
//   { k:'num'|'str', v }  { k:'null' }  { k:'bool', v }  { k:'date', v, time }
//   { k:'name', parts }  { k:'call', fn, args, distinct, star }  { k:'bin', op, l, r }
//   { k:'not', e }  { k:'neg', e }  { k:'in', e, list, not }  { k:'between', e, lo, hi, not }
//   { k:'isnull', e, not }  { k:'like', e, pat, not }  { k:'case', base, whens, else }
//   { k:'cast', e, type }
// Each node has `pos`, and `src`, the text it was written as.

const KEYWORDS = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'AS', 'AND',
  'OR', 'NOT', 'IN', 'IS', 'NULL', 'BETWEEN', 'LIKE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'NULLS',
  'ALL', 'DISTINCT', 'TRUE', 'FALSE', 'CAST', 'JOIN', 'UNION', 'ON', 'WITH', 'QUALIFY', 'WINDOW', 'OVER', 'INTERSECT',
  'EXCEPT', 'FETCH', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'USING', 'NATURAL']);
// EXTRACT(field FROM x): DAX's function of the field.
const EXTRACT = new Set(['YEAR', 'QUARTER', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND']);

class Parser {
  constructor(src) { this.src = src; this.toks = lex(src); this.i = 0; }
  get tok() { return this.toks[this.i]; }
  err(msg, t = this.tok) { return sqlSyntax(msg, t ? t.at : this.src.length, this.src); }
  isKw(w, t = this.tok) { return t?.t === 'id' && t.v.toUpperCase() === w; }
  isOp(v, t = this.tok) { return t?.t === 'op' && t.v === v; }
  eatKw(w) { if (this.isKw(w)) { this.i++; return true; } return false; }
  eat(v) { if (this.isOp(v)) { this.i++; return true; } return false; }
  needKw(w) { if (!this.eatKw(w)) throw this.err(`expected ${w}`); }
  need(v) { if (!this.eat(v)) throw this.err(`expected "${v}"`); }
  node(x, from) {
    const last = this.toks[this.i - 1];
    return { ...x, pos: from, src: this.src.slice(from, last ? last.end : from).trim() };
  }

  // The whole text: WITH's queries, then one SELECT.
  query() {
    const withs = [];
    if (this.eatKw('WITH')) {
      do {
        const name = this.name1();
        this.needKw('AS');
        this.need('(');
        withs.push({ name, q: this.select() });
        this.need(')');
      } while (this.eat(','));
    }
    const q = this.select();
    this.eat(';');
    if (this.isKw('UNION') || this.isKw('INTERSECT') || this.isKw('EXCEPT')) throw sqlUnsupported(this.tok.v.toUpperCase());
    if (this.tok) throw this.err('unexpected text after the query');
    return { ...q, with: withs };
  }

  // FROM: relations, joined. A relation is a name (a dataset, a WITH's query) or a subquery,
  // with an alias.
  fromClause() {
    let l = this.relation();
    for (;;) {
      let type;
      if (this.isOp(',')) throw sqlUnsupported('FROM a, b: write CROSS JOIN');
      if (this.isKw('NATURAL') || this.isKw('USING')) throw sqlUnsupported(this.tok.v.toUpperCase());
      if (this.eatKw('JOIN')) type = 'inner';
      else if (this.eatKw('INNER')) { this.needKw('JOIN'); type = 'inner'; }
      else if (this.eatKw('CROSS')) { this.needKw('JOIN'); type = 'cross'; }
      else if (['LEFT', 'RIGHT', 'FULL'].some(w => this.isKw(w))) {
        type = this.tok.v.toLowerCase();
        this.i++;
        this.eatKw('OUTER');
        this.needKw('JOIN');
      } else return l;
      const r = this.relation();
      let on = null;
      if (type !== 'cross') {
        if (this.isKw('USING')) throw sqlUnsupported('JOIN ... USING: write ON');
        this.needKw('ON');
        on = this.expr();
      }
      l = { kind: 'join', type, l, r, on };
    }
  }
  relation() {
    const at = this.tok?.at ?? this.src.length;
    if (this.eat('(')) {
      const q = this.select();
      this.need(')');
      const alias = this.alias();
      if (!alias) throw this.err('a subquery in FROM needs a name (AS t)');
      return this.node({ kind: 'sub', q, alias }, at);
    }
    const parts = [this.name1()];
    while (this.eat('.')) parts.push(this.name1());
    return this.node({ kind: 'name', parts, alias: this.alias() }, at);
  }
  alias() {
    if (this.eatKw('AS')) return this.name1();
    const t = this.tok;
    if (t && (t.t === 'qid' || (t.t === 'id' && !KEYWORDS.has(t.v.toUpperCase())))) return this.name1();
    return null;
  }

  // One SELECT: in the whole text, a WITH's query or a subquery.
  select() {
    this.needKw('SELECT');
    if (this.isKw('DISTINCT')) throw sqlUnsupported('SELECT DISTINCT (GROUP BY groups already)');
    this.eatKw('ALL');
    const select = [];
    do {
      if (this.isOp('*')) throw sqlUnsupported('SELECT *: name the columns and aggregates');
      const at = this.tok?.at ?? this.src.length;
      const e = this.expr();
      let alias = null;
      if (this.eatKw('AS')) alias = this.name1();
      else if (this.tok && (this.tok.t === 'qid' || (this.tok.t === 'id' && !KEYWORDS.has(this.tok.v.toUpperCase())))) alias = this.name1();
      select.push({ e, alias, pos: at });
    } while (this.eat(','));
    this.needKw('FROM');
    // The model, by its name (one part, or qualified: ws.model), or its datasets as relations.
    const from = this.fromClause();
    let where = null, groupBy = null, having = null, limit = null, offset = null, orderAll = null;
    const orderBy = [];
    if (this.eatKw('WHERE')) where = this.expr();
    if (this.eatKw('GROUP')) {
      this.needKw('BY');
      if (this.eatKw('ALL')) groupBy = 'all';
      else { groupBy = []; do groupBy.push(this.expr()); while (this.eat(',')); }
    }
    if (this.eatKw('HAVING')) having = this.expr();
    if (this.isKw('QUALIFY') || this.isKw('WINDOW')) throw sqlUnsupported(this.tok.v.toUpperCase());
    if (this.eatKw('ORDER')) {
      this.needKw('BY');
      const direction = () => {
        let desc = false, nulls = null;
        if (this.eatKw('DESC')) desc = true; else this.eatKw('ASC');
        if (this.eatKw('NULLS')) {
          if (this.eatKw('FIRST')) nulls = 'first';
          else if (this.eatKw('LAST')) nulls = 'last';
          else throw this.err('expected FIRST or LAST after NULLS');
        }
        return { desc, nulls };
      };
      // ORDER BY ALL: every column of the SELECT, left to right, in one direction.
      if (this.eatKw('ALL')) orderAll = direction();
      else do orderBy.push({ e: this.expr(), ...direction() }); while (this.eat(','));
    }
    if (this.eatKw('LIMIT')) limit = this.count();
    if (this.eatKw('OFFSET')) {
      offset = this.count();
      if (!this.eatKw('ROWS')) this.eatKw('ROW');
    }
    // FETCH FIRST n ROWS ONLY is LIMIT n; WITH TIES keeps the rows tied with the n-th.
    let ties = null;
    if (this.eatKw('FETCH')) {
      if (!this.eatKw('FIRST') && !this.eatKw('NEXT')) throw this.err('expected FIRST or NEXT');
      if (limit != null) throw this.err('LIMIT and FETCH both');
      const n = this.count();
      if (!this.eatKw('ROWS') && !this.eatKw('ROW')) throw this.err('expected ROWS');
      if (this.eatKw('ONLY')) limit = n;
      else {
        this.needKw('WITH');
        this.needKw('TIES');
        if (offset != null) throw sqlUnsupported('OFFSET with FETCH … WITH TIES');
        ties = n;
      }
    }
    return { select, from, where, groupBy, having, orderBy, orderAll, limit, offset, ties };
  }
  count() {
    const t = this.tok;
    if (t?.t !== 'num' || !/^\d+$/.test(t.v)) throw this.err('expected a whole number');
    this.i++;
    return Number(t.v);
  }
  name1() {
    const t = this.tok;
    if (t?.t === 'qid' || (t?.t === 'id' && !KEYWORDS.has(t.v.toUpperCase()))) { this.i++; return t.v; }
    throw this.err('expected a name');
  }

  expr() { return this.or(); }
  or() {
    const at = this.tok?.at;
    let l = this.and();
    while (this.eatKw('OR')) l = this.node({ k: 'bin', op: 'OR', l, r: this.and() }, at);
    return l;
  }
  and() {
    const at = this.tok?.at;
    let l = this.not();
    while (this.eatKw('AND')) l = this.node({ k: 'bin', op: 'AND', l, r: this.not() }, at);
    return l;
  }
  not() {
    const at = this.tok?.at;
    if (this.eatKw('NOT')) return this.node({ k: 'not', e: this.not() }, at);
    return this.cmp();
  }
  cmp() {
    const at = this.tok?.at;
    const l = this.add();
    const t = this.tok;
    if (t?.t === 'op' && ['=', '<>', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      this.i++;
      return this.node({ k: 'bin', op: t.v === '!=' ? '<>' : t.v, l, r: this.add() }, at);
    }
    if (this.eatKw('IS')) {
      const not = this.eatKw('NOT');
      this.needKw('NULL');
      return this.node({ k: 'isnull', e: l, not }, at);
    }
    const not = this.isKw('NOT') && ['IN', 'BETWEEN', 'LIKE'].some(w => this.isKw(w, this.toks[this.i + 1])) && (this.i++, true);
    if (this.eatKw('IN')) {
      this.need('(');
      if (this.isKw('SELECT')) {
        const q = this.select();
        this.need(')');
        return this.node({ k: 'insub', e: l, q, not }, at);
      }
      const list = [];
      do list.push(this.expr()); while (this.eat(','));
      this.need(')');
      return this.node({ k: 'in', e: l, list, not }, at);
    }
    if (this.eatKw('BETWEEN')) {
      const lo = this.add();
      this.needKw('AND');
      return this.node({ k: 'between', e: l, lo, hi: this.add(), not }, at);
    }
    if (this.eatKw('LIKE')) return this.node({ k: 'like', e: l, pat: this.add(), not }, at);
    if (not) throw this.err('expected IN, BETWEEN or LIKE');
    return l;
  }
  add() {
    const at = this.tok?.at;
    let l = this.mul();
    for (;;) {
      const t = this.tok;
      if (!(t?.t === 'op' && ['+', '-', '||'].includes(t.v))) return l;
      this.i++;
      l = this.node({ k: 'bin', op: t.v, l, r: this.mul() }, at);
    }
  }
  mul() {
    const at = this.tok?.at;
    let l = this.unary();
    for (;;) {
      const t = this.tok;
      if (!(t?.t === 'op' && ['*', '/', '%'].includes(t.v))) return l;
      this.i++;
      l = this.node({ k: 'bin', op: t.v, l, r: this.unary() }, at);
    }
  }
  unary() {
    const at = this.tok?.at;
    if (this.eat('-')) return this.node({ k: 'neg', e: this.unary() }, at);
    if (this.eat('+')) return this.unary();
    return this.primary();
  }
  primary() {
    const t = this.tok;
    if (!t) throw this.err('the query ends too soon');
    const at = t.at;
    this.i++;
    if (t.t === 'num') return this.node({ k: 'num', v: t.v }, at);
    if (t.t === 'str') {
      // 'Table'[Column], as DAX writes it.
      if (this.tok?.t === 'qid' && this.src[this.tok.at] === '[') {
        const c = this.tok;
        this.i++;
        return this.node({ k: 'name', parts: [t.v, c.v] }, at);
      }
      return this.node({ k: 'str', v: t.v }, at);
    }
    if (t.t === 'op' && t.v === '(') {
      // A scalar subquery: one row, one column.
      if (this.isKw('SELECT')) {
        const q = this.select();
        this.need(')');
        return this.node({ k: 'subquery', q }, at);
      }
      const e = this.expr();
      // (a, b): a row, as a level of ROLLUP groups its columns.
      if (this.eat(',')) {
        const items = [e];
        do items.push(this.expr()); while (this.eat(','));
        this.need(')');
        return this.node({ k: 'row', items }, at);
      }
      this.need(')');
      return e;
    }
    if (t.t === 'qid') return this.dotted(t.v, at);
    if (t.t === 'id') {
      const up = t.v.toUpperCase();
      if (up === 'NULL') return this.node({ k: 'null' }, at);
      if (up === 'TRUE' || up === 'FALSE') return this.node({ k: 'bool', v: up === 'TRUE' }, at);
      if ((up === 'DATE' || up === 'TIMESTAMP') && this.tok?.t === 'str') {
        const s = this.tok;
        this.i++;
        return this.node({ k: 'date', v: s.v, time: up === 'TIMESTAMP' }, at);
      }
      if (up === 'CASE') return this.caseExpr(at);
      if (up === 'EXTRACT' && this.isOp('(')) {
        this.i++;
        const field = this.tok?.t === 'id' ? this.tok.v.toUpperCase() : null;
        if (!EXTRACT.has(field)) throw this.err(`EXTRACT of ${[...EXTRACT].join(', ')}`);
        this.i++;
        this.needKw('FROM');
        const e = this.expr();
        this.need(')');
        return this.node({ k: 'call', fn: field, args: [e], distinct: false, star: false }, at);
      }
      if (up === 'CAST' && this.isOp('(')) {
        this.i++;
        const e = this.expr();
        this.needKw('AS');
        const type = this.name1();
        if (this.eat('(')) { while (!this.isOp(')') && this.tok) this.i++; this.need(')'); }
        this.need(')');
        return this.node({ k: 'cast', e, type }, at);
      }
      if (this.isOp('(')) {
        this.i++;
        if (this.isKw('SELECT')) throw sqlUnsupported('a subquery');
        const distinct = this.eatKw('DISTINCT');
        const args = [];
        let star = false;
        if (this.isOp('*')) { this.i++; star = true; }
        else if (!this.isOp(')')) do args.push(this.expr()); while (this.eat(','));
        this.need(')');
        if (this.isKw('OVER')) throw sqlUnsupported('a window function');
        return this.node({ k: 'call', fn: up, args, distinct, star }, at);
      }
      if (KEYWORDS.has(up)) { this.i--; throw this.err(`unexpected ${t.v}`); }
      return this.dotted(t.v, at);
    }
    this.i--;
    throw this.err('unexpected token');
  }
  dotted(first, at) {
    const parts = [first];
    while (this.eat('.')) {
      if (this.isOp('*')) throw sqlUnsupported('table.*');
      parts.push(this.name1());
    }
    return this.node({ k: 'name', parts }, at);
  }
  caseExpr(at) {
    const base = this.isKw('WHEN') ? null : this.expr();
    const whens = [];
    while (this.eatKw('WHEN')) {
      const w = this.expr();
      this.needKw('THEN');
      whens.push([w, this.expr()]);
    }
    if (!whens.length) throw this.err('expected WHEN');
    const els = this.eatKw('ELSE') ? this.expr() : null;
    this.needKw('END');
    return this.node({ k: 'case', base, whens, else: els }, at);
  }
}

export function parseSql(src) { return new Parser(src).query(); }

// --- SQL -> the DAX query's syntax tree ---------------------------------------------------
// The translator builds the tree parser.js builds for DAX, so a SELECT is the same plan to the
// compiler as the DAX query it stands for, with no DAX text between them. printDax writes the
// tree as DAX (what sqlToDax returns, for a log to show), and parsing that gives the same tree.

const AGGS = { SUM: 'SUM', AVG: 'AVERAGE', AVERAGE: 'AVERAGE', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNTA' };
const FUNCS = { LENGTH: 'LEN', CHAR_LENGTH: 'LEN', SUBSTRING: 'MID', SUBSTR: 'MID', CEIL: 'CEILING' };
const CASTS = { INT: 'INTEGER', INTEGER: 'INTEGER', BIGINT: 'INTEGER', SMALLINT: 'INTEGER', TINYINT: 'INTEGER',
  DOUBLE: 'DOUBLE', FLOAT: 'DOUBLE', REAL: 'DOUBLE', DECIMAL: 'DOUBLE', NUMERIC: 'DOUBLE',
  VARCHAR: 'STRING', TEXT: 'STRING', STRING: 'STRING', CHAR: 'STRING', BOOLEAN: 'BOOLEAN', BOOL: 'BOOLEAN',
  DATE: 'DATETIME', TIMESTAMP: 'DATETIME', DATETIME: 'DATETIME' };

// The DAX tree's nodes (parser.js).
const D = {
  num: v => ({ k: 'num', v: String(v) }),
  str: v => ({ k: 'str', v: String(v) }),
  call: (fn, ...args) => ({ k: 'call', fn, args }),
  col: c => ({ k: 'col', table: c.table.name, name: c.name }),
  ref: name => ({ k: 'col', table: null, name }),
  bin: (op, l, r) => ({ k: 'bin', op, l, r }),
  not: e => ({ k: 'not', e }),
  neg: e => ({ k: 'neg', e }),
  in: (e, items) => ({ k: 'in', e, set: { k: 'table', rows: items.map(x => [x]) } }),
  word: name => ({ k: 'name', name }),
};
const isAggCall = e => e.k === 'call' && (e.fn === 'AGG' || e.fn === 'MEASURE' || e.fn in AGGS);
const isGrouping = e => e.k === 'call' && e.fn === 'GROUPING';

// A DAX tree as DAX text: every operator in parentheses, names quoted.
export function printDax(e) {
  switch (e.k) {
    case 'num': return e.v;
    case 'str': return `"${e.v.replace(/"/g, '""')}"`;
    case 'bool': return e.v ? 'TRUE' : 'FALSE';
    case 'col': return `${e.table != null ? `'${e.table.replace(/'/g, "''")}'` : ''}[${e.name.replace(/]/g, ']]')}]`;
    case 'name': return e.name;
    case 'call': return `${e.fn}(${e.args.map(printDax).join(', ')})`;
    case 'bin': return `(${printDax(e.l)} ${e.op} ${printDax(e.r)})`;
    case 'neg': return `(-${printDax(e.e)})`;
    case 'not': return `NOT(${printDax(e.e)})`;
    case 'in': return `(${printDax(e.e)} IN ${printDax(e.set)})`;
    case 'table': return `{${e.rows.map(r => r.length === 1 ? printDax(r[0]) : `(${r.map(printDax).join(', ')})`).join(', ')}}`;
  }
  throw new DaxError(`printDax: a ${e.k} node`);
}
export const printDaxQuery = q => (q.defines?.length ? `DEFINE\n${q.defines.map(d => `VAR ${d.name} = ${printDax(d.e)}`).join('\n')}\n` : '') + q.evaluates.map(ev => `EVALUATE ${printDax(ev.e)}${ev.order.length
  ? ` ORDER BY ${ev.order.map(o => `${printDax(o.e)}${o.desc ? ' DESC' : ''}`).join(', ')}` : ''}`).join('\n');

function kids(e) {
  switch (e.k) {
    case 'bin': return [e.l, e.r];
    case 'not': case 'neg': case 'isnull': case 'cast': case 'insub': return [e.e];
    case 'in': return [e.e, ...e.list];
    case 'between': return [e.e, e.lo, e.hi];
    case 'like': return [e.e, e.pat];
    case 'call': return e.args;
    case 'row': return e.items;
    case 'case': return [e.base, ...e.whens.flat(), e.else].filter(Boolean);
    default: return [];
  }
}
const hasAgg = e => isAggCall(e) || kids(e).some(hasAgg);
// A constant: names no column, measure or aggregate (a literal, or an expression of them).
const isConstant = e => e.k !== 'name' && e.k !== 'row' && e.k !== 'subquery' && e.k !== 'insub' && !isAggCall(e) && !isGrouping(e)
  && kids(e).every(isConstant);

// An expression with each node `f` returns in place of it (`f` returns null to keep it).
function mapExpr(e, f) {
  if (!e) return e;
  const hit = f(e);
  if (hit) return hit;
  const m = x => mapExpr(x, f);
  switch (e.k) {
    case 'bin': return { ...e, l: m(e.l), r: m(e.r) };
    case 'not': case 'neg': case 'isnull': case 'cast': case 'insub': return { ...e, e: m(e.e) };
    case 'in': return { ...e, e: m(e.e), list: e.list.map(m) };
    case 'between': return { ...e, e: m(e.e), lo: m(e.lo), hi: m(e.hi) };
    case 'like': return { ...e, e: m(e.e), pat: m(e.pat) };
    case 'call': return { ...e, args: e.args.map(m) };
    case 'row': return { ...e, items: e.items.map(m) };
    case 'case': return { ...e, base: m(e.base), whens: e.whens.map(([w, t]) => [m(w), m(t)]), else: m(e.else) };
    default: return e;
  }
}
const someExpr = (e, f) => !!e && (f(e) || kids(e).some(x => someExpr(x, f)));
// A SELECT's expressions, each mapped by `f`.
const mapQuery = (q, f) => ({
  ...q,
  select: q.select.map(s => ({ ...s, e: f(s.e) })),
  where: q.where && f(q.where),
  groupBy: Array.isArray(q.groupBy) ? q.groupBy.map(f) : q.groupBy,
  having: q.having && f(q.having),
  orderBy: q.orderBy.map(o => ({ ...o, e: f(o.e) })),
});
const andOf = (a, b) => (a && b ? { k: 'bin', op: 'AND', l: a, r: b, src: `${a.src} AND ${b.src}` } : a ?? b);
// The FROM's relations, left to right: [{ rel, type, on }], the first with no type.
function leavesOf(from) {
  if (from.kind !== 'join') return [{ rel: from, type: null, on: null }];
  return [...leavesOf(from.l), { rel: from.r, type: from.type, on: from.on }];
}
// A measure that counts: 0 over no rows in SQL, where DAX's count is blank.
const COUNTS = /^\s*(?:COUNTROWS|COUNTA?|COUNTAX|COUNTX|DISTINCTCOUNT|DISTINCTCOUNTNOBLANK)\s*\(/i;
// Whether a measure is a count, 0 over no rows over datasets: its SQL's COUNT when it was read
// from SQL (an Ossie metric: NULLIF(COUNT(..), 0) is NULL there), else its DAX's.
const isCount = m => (m.sql != null ? /^\s*COUNT\s*\(/i.test(m.sql) : COUNTS.test(m.text));
// Whether a DAX tree can be other than blank where what it aggregates is: a COALESCE, IF,
// SWITCH or ISBLANK in it.
const fills = x => !!x && typeof x === 'object' && ((x.k === 'call' && ['COALESCE', 'IF', 'SWITCH', 'ISBLANK'].includes(x.fn))
  || Object.values(x).some(v => (Array.isArray(v) ? v.some(fills) : fills(v))));

export class SqlTranslator {
  constructor(model) { this.model = model; this.base = this; this.defines = []; }

  // A column by its parts: [table, column] or [column], of the one table that has it. Over the
  // datasets of a FROM (`scope`), [alias, column] or [column] of one of them.
  column(parts) {
    if (this.scope) {
      const rels = [...this.scope.rels.values()];
      if (parts.length === 2) {
        const r = this.scope.rels.get(lc(parts[0]));
        return r ? r.table.colMap.get(lc(parts[1])) ?? null : null;
      }
      if (parts.length !== 1) return null;
      const found = rels.map(r => ({ r, c: r.table.colMap.get(lc(parts[0])) })).filter(x => x.c);
      if (found.length > 1) throw sqlSemantic(`column ${parts[0]} is in several relations (${found.map(x => x.r.alias).join(', ')}); name its relation`);
      return found[0]?.c ?? null;
    }
    if (parts.length === 2) return this.model.findColumn(parts[0], parts[1]);
    if (parts.length !== 1) return null;
    const found = [...this.model.tables.values()].map(t => t.colMap.get(lc(parts[0]))).filter(c => c && !c.query);
    if (found.length > 1) throw sqlSemantic(`column ${parts[0]} is in several tables (${found.map(c => c.table.name).join(', ')}); name its table`);
    return found[0] ?? null;
  }
  measure(parts) {
    if (this.scope) {
      const m = parts.length <= 2 ? this.model.measure(parts[parts.length - 1]) : null;
      if (!m) return null;
      if (parts.length === 2) return this.scope.rels.get(lc(parts[0]))?.table === m.table ? m : null;
      return [...this.scope.rels.values()].some(r => r.table === m.table) ? m : null;
    }
    const m = parts.length <= 2 ? this.model.measure(parts[parts.length - 1]) : null;
    if (!m || (parts.length === 2 && lc(m.table.name) !== lc(parts[0]))) return null;
    return m;
  }
  // A measure: qualified, so a column of the same name in a row does not hide it.
  measureRef(m) { return this.model.findColumn(m.table.name, m.name) ? D.ref(m.name) : { k: 'col', table: m.table.name, name: m.name }; }
  // A name that must be a column of the model.
  needColumn(e) {
    const c = e.k === 'name' ? this.column(e.parts) : null;
    if (c) return c;
    if (e.k === 'name' && this.measure(e.parts)) throw sqlSemantic(`${e.src} is a measure: aggregate it with AGG(${e.src})`);
    if (e.k === 'name') throw sqlSemantic(`the model has no column ${e.src}`);
    throw sqlUnsupported(`${e.src}: a column is named here`);
  }

  // An expression as a DAX tree. `ctx.mode`:
  //   'where'  conditions on columns, no aggregate
  //   'agg'    a SELECT expression with aggregates: no column outside one
  //   'having' on a group's row: its columns, the SELECT's names, aggregates
  // `ctx.items` (having) maps the DAX of the SELECT's aggregates to their columns.
  dax(e, ctx) {
    if (ctx.items && hasAgg(e)) {
      const hit = ctx.items.get(printDax(this.dax(e, { ...ctx, items: null, zero: false })));
      if (hit) return hit;
    }
    const sub = x => this.dax(x, ctx);
    // Over datasets, SQL's NULLs: a comparison with one is not true (DAX's blank equals blank,
    // 0 and ""). Each operand that is not a constant is known not to be blank.
    const known = (pairs, x) => {
      if (!this.sqlNulls) return x;
      const guards = pairs.filter(([s]) => !isConstant(s)).map(([, d]) => D.not(D.call('ISBLANK', d)));
      return [x, ...guards].reduce((a, b) => D.bin('&&', a, b));
    };
    const CMP = new Set(['=', '<>', '<', '<=', '>', '>=']);
    switch (e.k) {
      case 'num': return D.num(e.v);
      case 'str': return D.str(e.v);
      case 'null': return D.call('BLANK');
      case 'bool': return D.call(e.v ? 'TRUE' : 'FALSE');
      case 'date': {
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(e.v.trim());
        if (!m) throw sqlSemantic(`${e.src} is not a date`);
        const d = D.call('DATE', D.num(+m[1]), D.num(+m[2]), D.num(+m[3]));
        return m[4] != null ? D.bin('+', d, D.call('TIME', D.num(+m[4]), D.num(+m[5]), D.num(+(m[6] ?? 0)))) : d;
      }
      case 'name': return this.nameDax(e, ctx);
      case 'neg': return D.neg(sub(e.e));
      case 'not': return this.sqlNulls ? this.falseDax(e.e, ctx) : D.not(sub(e.e));
      case 'bin': {
        const l = sub(e.l), r = sub(e.r);
        if (e.op === '%') return D.call('MOD', l, r);
        if (CMP.has(e.op)) return known([[e.l, l], [e.r, r]], D.bin(e.op, l, r));
        const x = D.bin({ AND: '&&', OR: '||', '||': '&' }[e.op] ?? e.op, l, r);
        // Over datasets, SQL's NULLs: NULL + 1 is NULL (DAX's BLANK + 1 is 1), and so are
        // NULL - 1, 1 / NULL and NULL || 'a'.
        if (this.sqlNulls && ['+', '-', '/', '||'].includes(e.op)) {
          const blanks = [[e.l, l], [e.r, r]].filter(([s]) => !isConstant(s)).map(([, d]) => D.call('ISBLANK', d));
          if (blanks.length) return D.call('IF', blanks.reduce((a, b) => D.bin('||', a, b)), D.call('BLANK'), x);
        }
        return x;
      }
      case 'isnull': return e.not ? D.not(D.call('ISBLANK', sub(e.e))) : D.call('ISBLANK', sub(e.e));
      case 'in': {
        const v = sub(e.e), x = D.in(v, e.list.map(sub));
        return known([[e.e, v]], e.not ? D.not(x) : x);
      }
      case 'between': {
        const x = sub(e.e), lo = sub(e.lo), hi = sub(e.hi), b = D.bin('&&', D.bin('>=', x, lo), D.bin('<=', x, hi));
        return known([[e.e, x], [e.lo, lo], [e.hi, hi]], e.not ? D.not(b) : b);
      }
      case 'like': {
        if (e.pat.k !== 'str') throw sqlUnsupported('LIKE with a pattern that is not a constant');
        const p = e.pat.v, inner = p.replace(/^%/, '').replace(/%$/, '');
        if (/[%_]/.test(inner)) throw sqlUnsupported(`LIKE '${p}' (only 'x', 'x%', '%x' and '%x%')`);
        const x = sub(e.e), s = D.str(inner), n = D.num([...inner].length);
        const starts = p.startsWith('%'), ends = p.length > 1 && p.endsWith('%');
        const c = starts && ends ? D.call('CONTAINSSTRING', x, s) : ends ? D.bin('=', D.call('LEFT', x, n), s)
          : starts ? D.bin('=', D.call('RIGHT', x, n), s) : D.bin('=', x, s);
        return e.not ? D.not(c) : c;
      }
      case 'case': {
        const parts = e.whens.flatMap(([w, t]) => [sub(w), sub(t)]);
        if (e.else) parts.push(sub(e.else));
        return D.call('SWITCH', e.base ? sub(e.base) : D.call('TRUE'), ...parts);
      }
      case 'cast': {
        const t = CASTS[e.type.toUpperCase()];
        if (!t) throw sqlUnsupported(`CAST to ${e.type}`);
        return D.call('CONVERT', sub(e.e), D.word(t));
      }
      case 'subquery': {
        // A scalar subquery: its own query, in no filter of the one around it; a variable of
        // the query, its one value. One row, so an aggregate with no GROUP BY.
        const sq = this.subquery(e.q);
        if (sq.names.length !== 1) throw sqlSemantic(`a scalar subquery has one column: ${e.src}`);
        if (e.q.groupBy || !sq.oneRow) throw sqlUnsupported(`a scalar subquery that can have several rows (${e.src})`);
        return this.variable(D.call('MAXX', sq.table, D.ref(sq.names[0])));
      }
      case 'insub': {
        const sq = this.subquery(e.q, { distinct: true });
        if (sq.names.length !== 1) throw sqlSemantic(`IN (SELECT ...) has one column: ${e.src}`);
        const x = { k: 'in', e: sub(e.e), set: D.call('SELECTCOLUMNS', sq.table, D.str(sq.names[0]), D.ref(sq.names[0])) };
        return e.not ? D.not(x) : x;
      }
      case 'call': {
        if (isAggCall(e)) return this.aggDax(e, ctx);
        if (isGrouping(e)) {
          const a = ctx.mode === 'having' && e.args.length === 1 && e.args[0].k === 'name' ? ctx.groupings?.get(this.column(e.args[0].parts)) : null;
          if (a) return a;
          throw sqlSemantic(`${e.src}: GROUPING is a column of the SELECT, of a column a ROLLUP of the GROUP BY rolls up`);
        }
        if (e.star || e.distinct) throw sqlSyntax(`${e.fn} is not an aggregate`, e.pos, e.src);
        // NULLIF(a, b): NULL where a is b. == is DAX's equality in which BLANK is only BLANK.
        if (e.fn === 'NULLIF') {
          if (e.args.length !== 2) throw sqlSemantic(`NULLIF takes two arguments: ${e.src}`);
          const [a, b] = e.args.map(sub);
          return D.call('IF', D.bin('==', a, b), D.call('BLANK'), a);
        }
        return D.call(FUNCS[e.fn] ?? e.fn, ...e.args.map(sub));
      }
    }
    throw sqlUnsupported(e.src);
  }

  // Over datasets, where a condition is false, not unknown: NOT of it is true there only (SQL's
  // NOT of a comparison with a NULL is not true either).
  falseDax(e, ctx) {
    const sub = x => this.dax(x, ctx);
    const known = (pairs, x) => [x, ...pairs.filter(([s]) => !isConstant(s)).map(([, d]) => D.not(D.call('ISBLANK', d)))]
      .reduce((a, b) => D.bin('&&', a, b));
    const NEG = { '=': '<>', '<>': '=', '<': '>=', '<=': '>', '>': '<=', '>=': '<' };
    switch (e.k) {
      case 'not': return sub(e.e);
      case 'bool': return D.call(e.v ? 'FALSE' : 'TRUE');
      case 'null': return D.call('FALSE');
      case 'isnull': return e.not ? D.call('ISBLANK', sub(e.e)) : D.not(D.call('ISBLANK', sub(e.e)));
      case 'bin':
        if (e.op === 'AND') return D.bin('||', this.falseDax(e.l, ctx), this.falseDax(e.r, ctx));
        if (e.op === 'OR') return D.bin('&&', this.falseDax(e.l, ctx), this.falseDax(e.r, ctx));
        if (NEG[e.op]) {
          const l = sub(e.l), r = sub(e.r);
          return known([[e.l, l], [e.r, r]], D.bin(NEG[e.op], l, r));
        }
        break;
      case 'in': {
        const v = sub(e.e), x = D.in(v, e.list.map(sub));
        return known([[e.e, v]], e.not ? x : D.not(x));
      }
      case 'between': {
        const x = sub(e.e), lo = sub(e.lo), hi = sub(e.hi), b = D.bin('&&', D.bin('>=', x, lo), D.bin('<=', x, hi));
        return known([[e.e, x], [e.lo, lo], [e.hi, hi]], e.not ? b : D.not(b));
      }
    }
    // Anything else: false where it is neither true nor blank.
    const x = sub(e);
    return D.bin('&&', D.not(x), D.not(D.call('ISBLANK', x)));
  }

  nameDax(e, ctx) {
    if (ctx.mode === 'having' && e.parts.length === 1) {
      const a = ctx.aliases.get(lc(e.parts[0]));
      if (a) return a;
    }
    const c = this.needColumn(e);
    if (ctx.mode === 'agg') throw sqlUnsupported(`column ${e.src} in an expression with an aggregate`);
    if (ctx.mode === 'having' && !ctx.groups.includes(c)) throw sqlSemantic(`column ${e.src} must be in GROUP BY to be used in HAVING`);
    return D.col(c);
  }

  aggDax(e, ctx) {
    if (ctx.mode === 'where') throw sqlSemantic(`an aggregate in WHERE (${e.src}): use HAVING`);
    if (ctx.inAgg) throw sqlSemantic(`an aggregate inside an aggregate (${e.src})`);
    const arg = e.args[0];
    if (e.fn === 'AGG' || e.fn === 'MEASURE') {
      if (e.args.length !== 1 || e.distinct || arg.k !== 'name') throw sqlSemantic(`${e.fn} takes a measure: ${e.src}`);
      const m = this.measure(arg.parts);
      if (!m) throw sqlSemantic(`the model has no measure ${arg.src}`);
      const ref = this.measureRef(m);
      return ctx.zero && isCount(m) ? D.call('COALESCE', ref, D.num(0)) : ref;
    }
    if (e.star) throw sqlUnsupported(`${e.src}: a model has no single table to count; COUNT a column, or AGG a measure`);
    if (e.args.length !== 1 || arg.k !== 'name') throw sqlUnsupported(`${e.src}: an aggregate of something other than a column`);
    const c = this.column(arg.parts);
    if (!c) {
      if (this.measure(arg.parts)) throw sqlSemantic(`${arg.src} is a measure: use AGG(${arg.src})`);
      throw sqlSemantic(`the model has no column ${arg.src}`);
    }
    const zero = x => (ctx.zero && e.fn === 'COUNT' ? D.call('COALESCE', x, D.num(0)) : x);
    if (e.distinct) {
      if (e.fn !== 'COUNT') throw sqlUnsupported(`${e.fn}(DISTINCT …)`);
      return zero(D.call('DISTINCTCOUNTNOBLANK', D.col(c)));
    }
    return zero(D.call(AGGS[e.fn], D.col(c)));
  }

  // The query -> { query (the DAX query's tree), limit, offset }.
  translate(src) {
    this.defines = [];
    const r = this.translateQuery(parseSql(src));
    return { query: { defines: this.defines, evaluates: r.query.evaluates }, limit: r.limit, offset: r.offset };
  }

  // FROM the model (its name): a DAX query's rules. FROM its datasets, as relations (each
  // `dataset` or `model.dataset`, with an alias): the rules of Apache Ossie's Relational Query
  // Interface (core-spec/relational_semantics.md): the groups are those of the rows, a count
  // over no rows is 0.
  translateQuery(q) {
    if (!q.with?.length && q.from.kind === 'name' && !this.datasetOf(q.from.parts)) return this.aggregate(q);
    return this.relational(q);
  }
  datasetOf(parts) { return this.model.hasTable(parts[parts.length - 1]) ? this.model.table(parts[parts.length - 1]) : null; }

  // A query of its own, inside this one: { table, names, oneRow }. LIMIT is TOPN, so it keeps
  // the rows tied with the last one.
  subquery(q, { distinct = false } = {}) {
    // From the translator itself: not the names of the query around it.
    const t = Object.create(this.base);
    t.scope = null;
    t.ossie = null;
    t.distinctOk = distinct;
    const r = t.translateQuery(q);
    const [ev] = r.query.evaluates;
    let table = ev.e;
    if (r.offset != null) throw sqlUnsupported('OFFSET in a subquery');
    if (r.limit != null) {
      if (!ev.order.length) throw sqlUnsupported('LIMIT with no ORDER BY in a subquery');
      table = D.call('TOPN', D.num(r.limit), table, ...ev.order.flatMap(o => [o.e, D.word(o.desc ? 'DESC' : 'ASC')]));
    }
    return { table, names: r.names, oneRow: r.oneRow };
  }
  // A variable of the query (DEFINE VAR): computed once, in no filter.
  variable(e) {
    const name = `__v${this.defines.length + 1}`;
    this.defines.push({ kind: 'var', name, e });
    return D.word(name);
  }

  // A FROM of datasets: WITH's queries and subqueries in it put in place (a subquery that
  // only passes rows through: its relations join the FROM, its WHERE the query's), and a join
  // to a subquery whose columns only its ON reads is a filter (TREATAS of its rows).
  relational(q) {
    const withs = new Map((q.with ?? []).map(w => [lc(w.name), w.q]));
    const leaves = leavesOf(q.from).map(l => {
      const r = l.rel;
      if (r.kind === 'name' && r.parts.length === 1 && withs.has(lc(r.parts[0])))
        return { ...l, rel: { kind: 'sub', q: { ...withs.get(lc(r.parts[0])), with: q.with }, alias: r.alias ?? r.parts[0], src: r.src } };
      return l;
    });
    const itemName = s => s.alias ?? (s.e.k === 'name' ? s.e.parts[s.e.parts.length - 1] : s.e.src);
    let where = q.where;
    const semis = [], substs = [], out = [];
    for (const [i, l] of leaves.entries()) {
      if (l.rel.kind !== 'sub') { out.push(l); continue; }
      const a = lc(l.rel.alias), names = new Set(l.rel.q.select.map(s => lc(itemName(s))));
      const refsIt = e => someExpr(e, x => x.k === 'name' && (x.parts.length === 2 ? lc(x.parts[0]) === a : x.parts.length === 1 && names.has(lc(x.parts[0]))));
      const elsewhere = [...q.select.map(s => s.e), q.where, ...(Array.isArray(q.groupBy) ? q.groupBy : []), q.having, ...q.orderBy.map(o => o.e),
        ...leaves.filter(x => x !== l).map(x => x.on)].some(e => e && refsIt(e));
      const pairs = i > 0 && l.type === 'inner' && !elsewhere ? this.onPairs(l.on, a) : null;
      if (pairs) { semis.push({ q: l.rel.q, pairs }); continue; }
      const sq = l.rel.q;
      if (sq.groupBy || sq.having || sq.limit != null || sq.offset != null || sq.ties != null || sq.orderBy.length || sq.orderAll
        || sq.select.some(s => hasAgg(s.e)))
        throw sqlUnsupported(`${l.rel.src}: a subquery in FROM that aggregates, other than a filter of a join`);
      if (sq.from.kind === 'sub' || sq.from.kind === 'join') throw sqlUnsupported(`${l.rel.src}: a subquery of a subquery or of a join in FROM`);
      // Its names, of its one relation.
      const inner = sq.from, alias = inner.alias ?? inner.parts[inner.parts.length - 1];
      const t = this.datasetOf(inner.parts);
      if (!t) throw sqlSemantic(`the model has no dataset ${inner.parts.join('.')}`);
      const qualify = e => mapExpr(e, x => (x.k === 'name' && x.parts.length === 1 ? { ...x, parts: [alias, x.parts[0]] } : null));
      substs.push({ alias: a, map: new Map(sq.select.map(s => [lc(itemName(s)), qualify(s.e)])) });
      const cond = sq.where && qualify(sq.where);
      if (i === 0 || l.type === 'inner' || l.type === 'cross') where = andOf(where, cond);
      else if (cond) throw sqlUnsupported(`${l.rel.src}: a subquery with a WHERE on the outer side of a join`);
      out.push({ ...l, rel: { kind: 'name', parts: inner.parts, alias, src: inner.src } });
    }
    const subst = e => mapExpr(e, x => {
      if (x.k !== 'name') return null;
      for (const s of substs) {
        if (x.parts.length === 2 && lc(x.parts[0]) === s.alias) {
          const hit = s.map.get(lc(x.parts[1]));
          if (!hit) throw sqlSemantic(`${x.src}: ${x.parts[0]} has no column ${x.parts[1]}`);
          return hit;
        }
        if (x.parts.length === 1 && s.map.has(lc(x.parts[0]))) return s.map.get(lc(x.parts[0]));
      }
      return null;
    });
    const flat = mapQuery({ ...q, where }, subst);
    const joins = out.map(l => ({ ...l, on: l.on && subst(l.on) }));

    const rels = new Map();
    for (const l of joins) {
      const t = this.datasetOf(l.rel.parts);
      if (!t) throw sqlSemantic(`the model has no dataset ${l.rel.parts.join('.')}`);
      const alias = l.rel.alias ?? l.rel.parts[l.rel.parts.length - 1];
      if (rels.has(lc(alias))) throw sqlSemantic(`two relations of the FROM are named ${alias}: name one AS another`);
      rels.set(lc(alias), { alias, table: t, type: l.type, on: l.on });
    }
    const t = Object.create(this);
    t.scope = { rels };
    t.sqlNulls = true;
    // A join's filters: each subquery's rows, on the columns its ON matches them to (of one
    // relation).
    const filters = semis.map(s => {
      const sq = this.subquery(s.q, { distinct: true });
      const name = y => sq.names.find(n => lc(n) === lc(y)) ?? (() => { throw sqlSemantic(`the subquery has no column ${y}`); })();
      const cols = s.pairs.map(p => t.needColumn(p.other));
      const alias = new Set(s.pairs.map(p => lc(p.other.parts[0])));
      if (alias.size > 1) throw sqlUnsupported('a join to a subquery on the columns of several relations');
      return { alias: [...alias][0],
        dax: D.call('TREATAS', D.call('SELECTCOLUMNS', sq.table, ...s.pairs.flatMap(p => [D.str(name(p.y)), D.ref(name(p.y))])), ...cols.map(D.col)) };
    });
    // One dataset, or a star of them (star()), grouped by their columns: SUMMARIZECOLUMNS.
    // Anything else: the joined rows.
    const plain = e => e.k === 'name' || hasAgg(e) || isConstant(e) || isGrouping(e);
    const byColumns = !Array.isArray(flat.groupBy) || flat.groupBy.every(g => g.k === 'name' || g.k === 'num' || (g.k === 'call' && g.fn === 'ROLLUP'));
    const simple = flat.select.every(s => plain(s.e)) && byColumns;
    const star = simple && rels.size > 1 ? this.star(rels, flat) : null;
    if (!simple || (rels.size > 1 && !star)) return t.joined(flat, rels, filters);
    const list = [...rels.values()];
    t.ossie = { root: (star?.root ?? list[0]).table, filters: [...filters.map(f => f.dax), ...(star?.filters ?? [])], distinctOk: !!this.distinctOk };
    if (star) {
      // Each AGG(r.m) as the star reads it.
      t.aggDax = function (e, ctx) {
        const d = SqlTranslator.prototype.aggDax.call(this, e, ctx);
        const parts = e.args[0].parts;
        const r = parts.length === 2 ? rels.get(lc(parts[0])) : list.find(x => x.table === this.measure(parts).table);
        return star.measure(r, d, this);
      };
    }
    return t.aggregate(star ? { ...flat, where: andOf(flat.where, star.where) } : flat);
  }

  // Joins along the model's relationships, from the many side to the one side, that repeat no
  // row of a measure: SUMMARIZECOLUMNS, as a DAX query over the model, gives Ossie's answers.
  // Two shapes, else null (the joined rows, joined()):
  //   - a star (or snowflake) from one root: every other relation is the one side of one ON
  //     that is a relationship's columns, by INNER JOIN or by a LEFT JOIN that adds it. The
  //     root's rows are the groups'; another relation's measure is CALCULATE(m, root), its
  //     rows those the root's reach. An INNER JOIN keeps the root's rows that have a match:
  //     the one side's key is not blank (its blank row holds the others). Other conditions
  //     of an INNER JOIN's ON are the WHERE's.
  //   - o LEFT JOIN m, o the one side: o's rows are the groups', and every column outside an
  //     AGG is o's; m's measures read the rows of m that match a row of o and that the ON's
  //     other conditions keep.
  // An aggregate of a column (SUM(x)) over a join is not such a query.
  star(rels, q) {
    const list = [...rels.values()];
    if (new Set(list.map(r => r.table)).size !== list.length) return null;
    const plainAgg = e => someExpr(e, x => isAggCall(x) && x.fn !== 'AGG' && x.fn !== 'MEASURE');
    if ([...q.select.map(s => s.e), q.having, ...q.orderBy.map(o => o.e)].some(e => e && plainAgg(e))) return null;
    const colRel = parts => {
      if (parts.length === 2) {
        const r = rels.get(lc(parts[0])), c = r?.table.colMap.get(lc(parts[1]));
        return c ? { r, c } : null;
      }
      const found = parts.length === 1 ? list.map(r => ({ r, c: r.table.colMap.get(lc(parts[0])) })).filter(x => x.c) : [];
      return found.length === 1 ? found[0] : null;
    };
    const conjuncts = e => {
      const out = [];
      const split = x => (x.k === 'bin' && x.op === 'AND' ? (split(x.l), split(x.r)) : out.push(x));
      split(e);
      return out;
    };
    const edges = [];
    let where = null;
    const extra = new Map();
    for (const [i, r] of list.entries()) {
      if (i === 0) continue;
      if (r.type !== 'inner' && r.type !== 'left') return null;
      let edge = null;
      const rest = [];
      for (const c of conjuncts(r.on)) {
        if (!edge && c.k === 'bin' && c.op === '=' && c.l.k === 'name' && c.r.k === 'name') {
          const a = colRel(c.l.parts), b = colRel(c.r.parts);
          const other = a && b && (a.r === r) !== (b.r === r) ? (a.r === r ? b.r : a.r) : null;
          const rel = other && list.indexOf(other) < i ? this.model.relationships.find(x => x.active && !x.self
            && x.fromCard === 'many' && x.toCard === 'one' && ((x.from === a.c && x.to === b.c) || (x.from === b.c && x.to === a.c))) : null;
          if (rel) {
            const many = rel.from === a.c ? a.r : b.r;
            edge = { many, one: many === a.r ? b.r : a.r, type: r.type, rel, added: r };
            continue;
          }
        }
        rest.push(c);
      }
      if (!edge) return null;
      edges.push(edge);
      if (rest.length && r.type === 'inner') where = rest.reduce(andOf, where);
      else if (rest.length) extra.set(r, rest.reduce(andOf));
    }
    // Names outside an AGG, of the query's own columns.
    const outside = [];
    const walk = e => {
      if (!e) return;
      if (e.k === 'name') outside.push(e);
      if (isAggCall(e)) return;
      kids(e).forEach(walk);
    };
    [...q.select.map(s => s.e), q.where, ...(Array.isArray(q.groupBy) ? q.groupBy : []), q.having, ...q.orderBy.map(o => o.e)].forEach(walk);

    const [o, m] = list;
    if (list.length === 2 && edges[0].type === 'left' && edges[0].many === m) {
      // o LEFT JOIN m: groups of o; m's measures under the ON's other conditions, all on m.
      const cond = extra.get(m);
      const ofM = e => someExpr(e, x => x.k === 'name' && colRel(x.parts)?.r === m);
      const ofO = e => someExpr(e, x => x.k === 'name' && colRel(x.parts)?.r === o);
      if (outside.some(x => colRel(x.parts)?.r === m) || (cond && ofO(cond)) || (cond && !ofM(cond))) return null;
      // m's rows are those that match a row of o: its key is not blank (a pet with no owner
      // is no row of emp LEFT JOIN pet). KEEPFILTERS: the group's own filter on that key stays.
      const matched = D.call('KEEPFILTERS', D.not(D.call('ISBLANK', D.col(edges[0].rel.to))));
      return {
        root: o, where, filters: [],
        measure: (r, d, t) => (r === m ? D.call('CALCULATE', d, matched, ...(cond ? [D.call('KEEPFILTERS', t.dax(cond, { mode: 'where' }))] : [])) : d),
      };
    }
    // A star: a LEFT JOIN adds a one side, and no ON says more than its relationship's columns.
    if (extra.size || edges.some(e => e.type === 'left' && e.one !== e.added)) return null;
    const roots = list.filter(r => !edges.some(e => e.one === r));
    if (roots.length !== 1 || list.some(r => edges.filter(e => e.one === r).length > 1)) return null;
    const [root] = roots;
    return {
      root, where,
      filters: edges.filter(e => e.type === 'inner').map(e => D.not(D.call('ISBLANK', D.col(e.rel.to)))),
      measure: (r, d) => (r === root ? d : D.call('CALCULATE', d, D.word(root.table.name))),
    };
  }

  // A FROM of datasets joined in any way, as spec Section 9's reference strategy, in DAX. The
  // joined rows are a variable, each relation's columns in it named alias.column; the groups
  // are their distinct values (a variable); each AGG(r.m) is the measure over the rows of r's
  // table whose key the group's rows hold (TREATAS): each row once, however often the join
  // repeats it, and none for the rows an outer join pads. A relation's key is its dataset's
  // primary_key.
  joined(q, rels, filters) {
    const list = [...rels.values()];
    const keysOf = r => {
      const ks = r.table.keys ?? (r.table.key ? [r.table.key] : []);
      if (!ks.length) throw sqlUnsupported(`a join of ${r.alias}, whose dataset has no primary_key`);
      return ks;
    };
    const jn = (r, c) => `${r.alias}.${c.name}`;
    const colOf = parts => {
      if (parts.length === 2) {
        const r = rels.get(lc(parts[0])), c = r?.table.colMap.get(lc(parts[1]));
        return c ? { r, c } : null;
      }
      if (parts.length !== 1) return null;
      const found = list.map(r => ({ r, c: r.table.colMap.get(lc(parts[0])) })).filter(x => x.c);
      if (found.length > 1) throw sqlSemantic(`column ${parts[0]} is in several relations (${found.map(x => x.r.alias).join(', ')}); name its relation`);
      return found[0] ?? null;
    };
    const measureOf = parts => {
      const m = parts.length <= 2 ? this.model.measure(parts[parts.length - 1]) : null;
      if (!m) return null;
      if (parts.length === 2) {
        const r = rels.get(lc(parts[0]));
        return r && r.table === m.table ? { r, m } : null;
      }
      const found = list.filter(r => r.table === m.table);
      if (found.length > 1) throw sqlSemantic(`measure ${parts[0]} is in several relations (${found.map(r => r.alias).join(', ')}); name its relation`);
      return found.length ? { r: found[0], m } : null;
    };
    // The columns each relation brings: its key, and those the query names.
    const need = new Map(list.map(r => [r, new Set(keysOf(r))]));
    const exprs = [...q.select.map(s => s.e), q.where, ...(Array.isArray(q.groupBy) ? q.groupBy : []), q.having,
      ...q.orderBy.map(o => o.e), ...list.map(r => r.on)];
    for (const e of exprs) someExpr(e, x => {
      if (x.k === 'name') { const hit = colOf(x.parts); if (hit) need.get(hit.r).add(hit.c); }
      return false;
    });
    const rowsOf = r => {
      const t = D.call('SELECTCOLUMNS', D.word(r.table.name), ...[...need.get(r)].flatMap(c => [D.str(jn(r, c)), D.col(c)]));
      const own = filters.filter(f => f.alias === lc(r.alias)).map(f => f.dax);
      return own.length ? D.call('CALCULATETABLE', t, ...own) : t;
    };

    // Expressions over the joined rows ('where': a row's) or over a group's row (the others,
    // where a column is a group's and AGG a measure of the group).
    const groups = [], measures = [];
    const base = SqlTranslator.prototype;
    const g = Object.create(this);
    g.scope = null;
    g.nameDax = function (e, ctx) {
      const hit = colOf(e.parts);
      if (!hit) {
        if (measureOf(e.parts)) throw sqlSemantic(`${e.src} is a measure: aggregate it with AGG(${e.src})`);
        throw sqlSemantic(`no relation of the FROM has a column ${e.src}`);
      }
      const ref = D.ref(jn(hit.r, hit.c));
      if (ctx.mode === 'where') return ref;
      const gr = groups.find(x => x.key === printDax(ref));
      if (!gr) throw sqlSemantic(`column ${e.src} must be in GROUP BY`);
      return D.ref(gr.name);
    };
    g.dax = function (e, ctx) {
      if (ctx.mode !== 'where' && !hasAgg(e) && !isConstant(e) && e.k !== 'name' && e.k !== 'subquery') {
        const gr = groups.find(x => x.key === printDax(base.dax.call(g, e, { ...ctx, mode: 'where' })));
        if (gr) return D.ref(gr.name);
      }
      return base.dax.call(g, e, ctx);
    };
    g.aggDax = function (e, ctx) {
      if (ctx.mode === 'where') throw sqlSemantic(`an aggregate in WHERE (${e.src}): use HAVING`);
      if (e.fn !== 'AGG' && e.fn !== 'MEASURE') throw sqlUnsupported(`${e.src}: an aggregate of a column over a join (AGG a measure)`);
      const arg = e.args[0];
      if (e.args.length !== 1 || e.distinct || arg.k !== 'name') throw sqlSemantic(`${e.fn} takes a measure: ${e.src}`);
      const hit = measureOf(arg.parts);
      if (!hit) throw sqlSemantic(`no relation of the FROM has a measure ${arg.src}`);
      const key = `${lc(hit.r.alias)}|${lc(hit.m.name)}`;
      let x = measures.find(y => y.key === key);
      if (!x) measures.push(x = { key, name: `__m${measures.length + 1}`, ...hit });
      return D.ref(x.name);
    };
    const w = e => g.dax(e, { mode: 'where' });

    // The joined rows, left to right. RIGHT JOIN keeps the columns' order, for a UNION after it.
    let J = rowsOf(list[0]);
    const names = [...need.get(list[0])].map(c => jn(list[0], c));
    for (const r of list.slice(1)) {
      const B = rowsOf(r), mine = [...need.get(r)].map(c => jn(r, c));
      const on = r.on ? w(r.on) : null;
      const keep = t => D.call('SELECTCOLUMNS', t, ...[...names, ...mine].flatMap(n => [D.str(n), D.ref(n)]));
      if (r.type === 'cross') J = D.call('GENERATE', J, B);
      else if (r.type === 'inner') J = D.call('GENERATE', J, D.call('FILTER', B, on));
      else if (r.type === 'left') J = D.call('GENERATEALL', J, D.call('FILTER', B, on));
      else if (r.type === 'right') J = keep(D.call('GENERATEALL', B, D.call('FILTER', J, on)));
      else {
        const onlyB = D.call('SELECTCOLUMNS', D.call('FILTER', B, D.call('ISEMPTY', D.call('FILTER', J, on))),
          ...names.flatMap(n => [D.str(n), D.call('BLANK')]), ...mine.flatMap(n => [D.str(n), D.ref(n)]));
        J = D.call('UNION', D.call('GENERATEALL', J, D.call('FILTER', B, on)), onlyB);
      }
      names.push(...mine);
    }
    const all = this.variable(J);
    const rows = q.where ? this.variable(D.call('FILTER', all, w(q.where))) : all;

    // The items, and the groups: GROUP BY's expressions, each named by the item it is.
    const itemName = s => s.alias ?? (s.e.k === 'name' ? s.e.parts[s.e.parts.length - 1] : s.e.src);
    const items = q.select.map(s => ({ e: s.e, name: itemName(s), agg: hasAgg(s.e), constant: isConstant(s.e) }));
    const seen = new Set();
    for (const it of items) {
      if (isGrouping(it.e)) throw sqlUnsupported(`${it.e.src}: GROUPING over a join`);
      if (seen.has(lc(it.name))) throw sqlSemantic(`two columns of the result are named ${it.name}`);
      seen.add(lc(it.name));
    }
    if (!q.groupBy && !q.having && !items.some(it => it.agg)) throw sqlUnsupported('the rows of a join, with no aggregate');
    const fields = items.filter(it => !it.agg && !it.constant);
    const groupExprs = q.groupBy === 'all' ? fields.map(it => it.e) : (q.groupBy ?? []).map(x => {
      if (x.k === 'num' && /^\d+$/.test(x.v)) {
        const it = items[Number(x.v) - 1];
        if (!it || it.agg) throw sqlSemantic(`GROUP BY ${x.v} is not a column of the SELECT`);
        return it.e;
      }
      if (x.k === 'call' && x.fn === 'ROLLUP') throw sqlUnsupported('ROLLUP over a join');
      if (x.k === 'name' && x.parts.length === 1 && !colOf(x.parts)) {
        const it = fields.find(f => lc(f.name) === lc(x.parts[0]));
        if (it) return it.e;
      }
      return x;
    });
    for (const x of groupExprs) {
      const dax = w(x), key = printDax(dax);
      if (!groups.some(gr => gr.key === key)) groups.push({ dax, key, name: null });
    }
    for (const it of fields) {
      const gr = groups.find(x => x.key === printDax(w(it.e)));
      if (!gr) throw sqlSemantic(`${it.e.src} must be in GROUP BY`);
      it.group = gr;
      gr.name ??= it.name;
    }
    groups.forEach((gr, i) => { gr.name ??= `__g${i + 1}`; });
    // The groups' values, with no lineage: a measure's CALCULATE on a group's row then has no
    // filter of the row to transition (its REMOVEFILTERS would not remove all of them: TODO.md).
    const unlinked = x => (x.k === 'col' ? D.call('IF', D.call('ISBLANK', x), D.call('BLANK'), x) : x);
    const spine = this.variable(groups.length
      ? D.call('DISTINCT', D.call('SELECTCOLUMNS', rows, ...groups.flatMap(gr => [D.str(gr.name), unlinked(gr.dax)])))
      : D.call('ROW', D.str('__all'), D.num(1)));

    const out = items.map(it => (it.group ? D.ref(it.group.name) : g.dax(it.e, { mode: 'agg' })));
    const having = q.having && g.dax(q.having, { mode: 'having' });
    const orderBy = q.orderAll ? items.map((_, i) => ({ e: { k: 'num', v: String(i + 1), src: String(i + 1) }, ...q.orderAll })) : q.orderBy;
    const order = orderBy.flatMap(o => {
      let i = -1;
      if (o.e.k === 'num' && /^\d+$/.test(o.e.v)) i = Number(o.e.v) - 1;
      else if (o.e.k === 'name' && o.e.parts.length === 1) i = items.findIndex(it => lc(it.name) === lc(o.e.parts[0]));
      if (i < 0) { const d = printDax(g.dax(o.e, { mode: 'agg' })); i = out.findIndex(x => printDax(x) === d); }
      if (i < 0 || i >= items.length) throw sqlUnsupported(`ORDER BY ${o.e.src}: order by a column of the result`);
      const key = { e: D.ref(items[i].name), desc: o.desc };
      if (!o.nulls || o.nulls === (o.desc ? 'last' : 'first')) return [key];
      return [{ e: D.call('ISBLANK', key.e), desc: o.nulls === 'first' }, key];
    });

    // Each measure, on each group: its relation's keys among the group's rows, none padded.
    const value = x => {
      const ks = keysOf(x.r);
      const padded = ks.map(c => D.call('ISBLANK', D.ref(jn(x.r, c)))).reduce((a, b) => D.bin('&&', a, b));
      const cond = [D.not(padded), ...groups.map(gr => D.bin('==', gr.dax, D.ref(gr.name)))].reduce((a, b) => D.bin('&&', a, b));
      const keys = D.call('SELECTCOLUMNS', D.call('FILTER', rows, cond), ...ks.flatMap((c, i) => [D.str(`__k${i + 1}`), D.ref(jn(x.r, c))]));
      const v = D.call('CALCULATE', this.measureRef(x.m), D.call('REMOVEFILTERS'), D.call('TREATAS', keys, ...ks.map(D.col)));
      return isCount(x.m) ? D.call('COALESCE', v, D.num(0)) : v;
    };
    let table = D.call('ADDCOLUMNS', spine, ...measures.flatMap(x => [D.str(x.name), value(x)]));
    if (having) table = D.call('FILTER', table, having);
    table = D.call('SELECTCOLUMNS', table, ...items.flatMap((it, k) => [D.str(it.name), out[k]]));
    return {
      query: { defines: [], evaluates: [{ e: table, order, start: [] }] }, limit: q.limit, offset: q.offset,
      names: items.map(it => it.name), oneRow: !groups.length && !q.having,
    };
  }
  // A join's ON as [{ other, y }] when it is equalities of a column of `alias` (y) to a column
  // of another relation (other); null otherwise.
  onPairs(on, alias) {
    const conj = [];
    const split = e => (e.k === 'bin' && e.op === 'AND' ? (split(e.l), split(e.r)) : conj.push(e));
    split(on);
    const mine = x => x.k === 'name' && x.parts.length === 2 && lc(x.parts[0]) === alias;
    const pairs = [];
    for (const c of conj) {
      if (c.k !== 'bin' || c.op !== '=') return null;
      const [y, other] = mine(c.l) ? [c.l, c.r] : mine(c.r) ? [c.r, c.l] : [null, null];
      if (!y || other.k !== 'name' || mine(other) || (other.parts.length === 1)) return null;
      pairs.push({ y: y.parts[1], other });
    }
    return pairs.length ? pairs : null;
  }

  // One SELECT's aggregate query. `this.ossie`, over datasets: { root (the table whose rows
  // the groups are), filters (DAX tables, CALCULATETABLE's) }.
  aggregate(q) {
    const ossie = this.ossie ?? null;
    // The SELECT's items: a column (a group), GROUPING of a rolled-up column (its subtotal
    // flag), an expression of aggregates, or a constant (the same on every row; a column
    // added to the result, never to SUMMARIZECOLUMNS, where it would keep rows no measure has).
    const names = new Set();
    const items = q.select.map(({ e, alias }) => {
      if (isGrouping(e)) {
        if (e.args.length !== 1 || e.args[0].k !== 'name') throw sqlUnsupported(`${e.src}: GROUPING of one column`);
        return { e, grouping: this.needColumn(e.args[0]), name: alias ?? e.src };
      }
      if (isConstant(e)) return { e, constant: this.dax(e, { mode: 'agg' }), name: alias ?? e.src };
      if (!hasAgg(e)) {
        if (e.k !== 'name') throw sqlUnsupported(`${e.src}: a SELECT item is a column, an expression of aggregates or a constant`);
        const c = this.needColumn(e);
        return { e, col: c, name: alias ?? c.name, renamed: alias != null && alias !== c.name };
      }
      const plain = this.dax(e, { mode: 'agg' });
      const m = isAggCall(e) && (e.fn === 'AGG' || e.fn === 'MEASURE') ? this.measure(e.args[0].parts) : null;
      // Over datasets, a count is 0 over no rows (SQL's). An item that is one: 0 in the result,
      // as in SUMMARIZECOLUMNS it stays blank, so that the groups are those of the rows. A count
      // inside an expression: 0 there, and the expression blank where the group has no rows.
      const count = !!ossie && (m ? isCount(m) : isAggCall(e) && e.fn === 'COUNT');
      const ast = ossie && !isAggCall(e) ? this.dax(e, { mode: 'agg', zero: true }) : plain;
      return { e, ast, key: printDax(plain), name: alias ?? m?.name ?? e.src, count, filled: !!ossie && !isAggCall(e) && fills(ast) };
    });
    for (const it of items) {
      if (names.has(lc(it.name))) throw sqlSemantic(`two columns of the result are named ${it.name}`);
      names.add(lc(it.name));
    }
    const dims = items.filter(it => it.col), flags = items.filter(it => it.grouping), aggs = items.filter(it => it.ast);
    const constants = items.filter(it => it.constant);

    // The groups, and the ROLLUPs: each one ROLLUPADDISSUBTOTAL, whose levels are a column or
    // a parenthesised group of them (ROLLUPGROUP), each named by the SELECT's GROUPING of it.
    let groups;
    const rollups = [];
    const groupCol = g => {
      if (g.k === 'num' && /^\d+$/.test(g.v)) {
        const it = items[Number(g.v) - 1];
        if (!it) throw sqlSemantic(`GROUP BY ${g.v}: the SELECT has ${items.length} items`);
        if (!it.col) throw sqlSemantic(`GROUP BY ${g.v} is not a column`);
        return it.col;
      }
      if (g.k === 'name') {
        const c = (g.parts.length === 1 && dims.find(d => lc(d.name) === lc(g.parts[0]))?.col) || this.column(g.parts);
        if (!c) throw sqlSemantic(`the model has no column ${g.src}`);
        return c;
      }
      throw sqlUnsupported(`GROUP BY ${g.src}: groups are columns`);
    };
    if (q.groupBy === 'all') {
      if (flags.length) throw sqlSemantic(`${flags[0].e.src}: GROUPING needs a ROLLUP in the GROUP BY`);
      groups = dims.map(d => d.col);
    } else if (q.groupBy) {
      groups = [];
      for (const g of q.groupBy) {
        if (g.k === 'call' && g.fn === 'ROLLUP') {
          if (!g.args.length) throw sqlSemantic('ROLLUP of nothing');
          rollups.push(g.args.map(level => {
            const cols = (level.k === 'row' ? level.items : [level]).map(groupCol);
            const flag = flags.find(f => cols.includes(f.grouping))
              // Over datasets, a level the SELECT has no GROUPING of: its flag, left out of the result.
              ?? (ossie ? { name: `__level${rollups.length + 1}_${cols.map(c => c.name).join('_')}`, hidden: true } : null);
            if (!flag) throw sqlSemantic(`ROLLUP(${level.src}) needs GROUPING(${level.k === 'row' ? level.items[0].src : level.src}) in the SELECT: its subtotal rows' flag`);
            return { cols, flag };
          }));
          continue;
        }
        const c = groupCol(g);
        if (!groups.includes(c)) groups.push(c);
      }
    } else if (ossie && dims.length && !aggs.length && !q.having && ossie.distinctOk) {
      // Rows with no aggregate, where only their values matter (a join's filter, IN): its values.
      groups = dims.map(d => d.col);
    } else {
      if (dims.length) throw sqlSemantic(`column ${dims[0].e.src} is not aggregated: add GROUP BY ALL`);
      if (flags.length) throw sqlSemantic(`${flags[0].e.src}: GROUPING needs a ROLLUP in the GROUP BY`);
      groups = [];
    }
    const rolled = rollups.flat().flatMap(l => l.cols);
    const grouped = [...groups, ...rolled];
    if (q.groupBy !== 'all') for (const d of dims) if (!grouped.includes(d.col)) throw sqlSemantic(`column ${d.e.src} must be in GROUP BY`);
    for (const f of flags) if (!rolled.includes(f.grouping)) throw sqlSemantic(`${f.e.src}: ${f.grouping.name} is not rolled up by a ROLLUP`);
    for (const c of rolled) if (groups.includes(c)) throw sqlSemantic(`${c.name} is both grouped and rolled up`);

    // HAVING's names: the SELECT's, on the groups' rows.
    const itemRef = it => it.col ? D.col(it.col) : it.constant ?? D.ref(it.name);
    const zeroRef = it => (it.count ? D.call('COALESCE', itemRef(it), D.num(0)) : itemRef(it));
    const aliases = new Map(items.map(it => [lc(it.name), zeroRef(it)]));
    const aggItems = new Map(aggs.map(it => [it.key, zeroRef(it)]));
    const groupings = new Map(rollups.flat().flatMap(l => l.cols.map(c => [c, D.ref(l.flag.name)])));
    const having = q.having && this.dax(q.having, { mode: 'having', groups: grouped, aliases, items: aggItems, groupings, zero: !!ossie });

    // An expression that is not blank over no rows (a count made 0, COALESCE): blank where the
    // group has none of the root's rows, so that it makes no group of its own.
    const guard = it => (it.filled && grouped.length ? D.call('IF', D.call('ISBLANK', D.call('COUNTROWS', D.word(ossie.root.name))), D.call('BLANK'), it.ast) : it.ast);
    const aggArgs = aggs.flatMap(it => [D.str(it.name), guard(it)]);
    const rollupArgs = rollups.map(levels => D.call('ROLLUPADDISSUBTOTAL', ...levels.flatMap(l => [
      l.cols.length > 1 ? D.call('ROLLUPGROUP', ...l.cols.map(D.col)) : D.col(l.cols[0]), D.str(l.flag.name)])));
    // Over datasets, a group is one the rows have: the root's rows counted beside the
    // aggregates, so that a group whose aggregates are all blank is kept.
    const ROWS = '__rows';
    const rowsArgs = ossie && grouped.length ? [D.str(ROWS), D.call('COUNTROWS', D.word(ossie.root.name))] : [];
    let table = grouped.length || (q.groupBy && !aggs.length && !constants.length)
      ? D.call('SUMMARIZECOLUMNS', ...groups.map(D.col), ...rollupArgs, ...rowsArgs, ...aggArgs)
      // Nothing to group or aggregate: the one row is the constants'.
      : D.call('ROW', ...(aggArgs.length ? aggArgs : constants.flatMap(it => [D.str(it.name), it.constant])));
    if (having) table = D.call('FILTER', table, having);

    // WHERE: one filter of CALCULATETABLE per condition joined by AND, each on the columns of
    // one table or, if not, of the columns it names.
    if (q.where) {
      const conj = [];
      const split = e => (e.k === 'bin' && e.op === 'AND' ? (split(e.l), split(e.r)) : conj.push(e));
      split(q.where);
      const filters = conj.map(e => {
        const dax = this.dax(e, { mode: 'where' });
        const cols = [];
        const walk = x => {
          if (x.k === 'name') { const c = this.column(x.parts); if (c && !cols.includes(c)) cols.push(c); }
          kids(x).forEach(walk);
        };
        walk(e);
        // A condition on no column (WHERE FALSE), over datasets: on the rows of the root, all
        // of them or none.
        if (!cols.length && ossie) return D.call('FILTER', D.call('ALL', D.word(ossie.root.name)), dax);
        if (!cols.length) throw sqlUnsupported(`WHERE ${e.src}: a condition on no column`);
        if (new Set(cols.map(c => c.table)).size === 1) return dax;
        const all = c => D.call('ALL', D.col(c));
        return D.call('FILTER', cols.length === 1 ? all(cols[0]) : D.call('CROSSJOIN', ...cols.map(all)), dax);
      });
      table = D.call('CALCULATETABLE', table, ...filters, ...(ossie?.filters ?? []));
    } else if (ossie?.filters.length) table = D.call('CALCULATETABLE', table, ...ossie.filters);

    // The result's columns in the SELECT's order and names; over datasets, a count blank over
    // no rows is 0.
    const scOrder = [...groups.map(g => dims.find(d => d.col === g)), ...aggs];
    const same = !ossie && !rollups.length && scOrder.length === items.length && scOrder.every((it, i) => it === items[i]) && !dims.some(d => d.renamed);
    const outItem = it => (it.count ? D.call('COALESCE', itemRef(it), D.num(0)) : itemRef(it));
    if (!same) table = D.call('SELECTCOLUMNS', table, ...items.flatMap(it => [D.str(it.name), outItem(it)]));

    // ORDER BY: a SELECT item (its name, its position, or the same expression), or an
    // aggregate on the result's rows.
    const outRef = it => it.col && !it.renamed ? D.col(it.col) : D.ref(it.name);
    // ORDER BY ALL: by every item's position.
    const orderBy = q.orderAll
      ? items.map((_, i) => ({ e: { k: 'num', v: String(i + 1), src: String(i + 1) }, ...q.orderAll }))
      : q.orderBy;
    const order = orderBy.flatMap(o => {
      const key = this.orderKey(o, { items, dims, aggs, outRef });
      // NULLS FIRST or LAST, where DAX sorts blanks the other way: by ISBLANK first.
      if (!o.nulls || o.nulls === (o.desc ? 'last' : 'first')) return [key];
      if (!ossie) throw sqlUnsupported(`NULLS ${o.nulls.toUpperCase()} with ${o.desc ? 'DESC' : 'ASC'} (blanks sort first ascending, last descending)`);
      return [{ e: D.call('ISBLANK', key.e), desc: o.nulls === 'first' }, key];
    });

    // FETCH FIRST n ROWS WITH TIES: TOPN, which keeps the rows tied with the n-th on the ORDER BY.
    if (q.ties != null) {
      if (!order.length) throw sqlSemantic('FETCH … WITH TIES needs an ORDER BY');
      table = D.call('TOPN', D.num(q.ties), table, ...order.flatMap(o => [o.e, D.word(o.desc ? 'DESC' : 'ASC')]));
    }

    return {
      query: { defines: [], evaluates: [{ e: table, order, start: [] }] }, limit: q.limit, offset: q.offset,
      names: items.map(it => it.name), oneRow: !grouped.length && !q.groupBy && !q.having,
    };
  }

  // An ORDER BY key: a SELECT item (its name, its position, or the same expression), or an
  // aggregate on the result's rows.
  orderKey({ e, desc }, { items, dims, aggs, outRef }) {
    let it = null;
    if (e.k === 'num' && /^\d+$/.test(e.v)) {
      it = items[Number(e.v) - 1];
      if (!it) throw sqlSemantic(`ORDER BY ${e.v}: the SELECT has ${items.length} items`);
    } else if (e.k === 'name') {
      it = (e.parts.length === 1 && items.find(x => lc(x.name) === lc(e.parts[0])))
        || dims.find(d => d.col === this.column(e.parts));
      if (!it) throw sqlSemantic(`ORDER BY ${e.src}: not a column of the result`);
    } else if (hasAgg(e)) {
      const d = printDax(this.dax(e, { mode: 'agg' }));
      it = aggs.find(a => a.key === d);
      if (!it) {
        const outAliases = new Map(items.map(x => [lc(x.name), outRef(x)]));
        const outItems = new Map(aggs.map(a => [a.key, D.ref(a.name)]));
        return { e: this.dax(e, { mode: 'having', groups: dims.map(x => x.col), aliases: outAliases, items: outItems }), desc };
      }
    } else throw sqlUnsupported(`ORDER BY ${e.src}: order by a column of the result`);
    return { e: outRef(it), desc };
  }
}

export const isSql = text => /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*SELECT\b/i.test(text);
// What compile() takes as SQL: a SELECT, or a WITH's queries and then one.
export const isSqlQuery = text => /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:SELECT|WITH)\b/i.test(text);

// --- a statement with the model in it ------------------------------------------------------
// Any SQL of the engine in which a SELECT over the model is a relation: in parentheses,
// wherever the engine takes a subquery (a WITH's query, FROM, an arm of a UNION, IN). The
// model is not a table (a measure has no value until the groups are chosen), so it is named
// only as the FROM of such a SELECT. The scanner reads what nesting depends on: strings,
// quoted names, comments and parentheses. The rest is the engine's SQL, passed through as
// written.

const WORD = /[\p{L}_][\p{L}\p{N}_$]*/uy;
const DOLLAR = /\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/uy;

function scan(src) {
  const toks = [];
  let i = 0, depth = 0;
  const n = src.length;
  const skipTo = (close, from, kind, at) => {
    const e = src.indexOf(close, from);
    if (e < 0) throw sqlSyntax(`unterminated ${kind}`, at, src);
    return e + close.length;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && src[i + 1] === '-') { const e = src.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { i = skipTo('*/', i + 2, 'comment', i); continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      // E'...': a backslash takes the next character, a quote too.
      const escapes = c === "'" && /^[Ee]$/.test(src[i - 1] ?? '') && !/[\w$]/.test(src[i - 2] ?? '');
      for (;;) {
        let e = src.indexOf(c, j);
        if (escapes) { for (e = j; e < n && src[e] !== c; e++) if (src[e] === '\\') e++; if (e >= n) e = -1; }
        if (e < 0) throw sqlSyntax(c === '"' ? 'unterminated quoted name' : 'unterminated string', i, src);
        if (src[e + 1] === c) { j = e + 2; continue; }
        j = e + 1;
        break;
      }
      if (c === '"') toks.push({ t: 'name', v: src.slice(i + 1, j - 1).replaceAll('""', '"'), at: i, depth });
      i = j;
      continue;
    }
    if (c === '$') {
      DOLLAR.lastIndex = i;
      const d = DOLLAR.exec(src);
      if (d) { i = skipTo(d[0], i + d[0].length, 'dollar-quoted string', i); continue; }
    }
    if (c === '(') { toks.push({ t: '(', at: i, depth }); depth++; i++; continue; }
    if (c === ')') {
      if (!depth) throw sqlSyntax('a ")" with no "("', i, src);
      depth--;
      toks.push({ t: ')', at: i, depth });
      i++;
      continue;
    }
    WORD.lastIndex = i;
    const w = WORD.exec(src);
    if (w) { toks.push({ t: 'word', v: w[0], at: i, depth }); i += w[0].length; continue; }
    toks.push({ t: 'op', v: c, at: i, depth });
    i++;
  }
  if (depth) throw sqlSyntax('a "(" with no ")"', src.length, src);
  return toks;
}

// A model's name as its parts: an array as it is, or SQL text — `model`, `ws.model`,
// `"Sales WS".model` — split at the dots outside quotes, the quotes undone.
export function nameParts(name) {
  if (Array.isArray(name)) return name.map(String);
  const parts = [];
  const s = String(name);
  let cur = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      i++;
      while (i < s.length) {
        if (s[i] === '"') { if (s[i + 1] === '"') { cur += '"'; i += 2; continue; } i++; break; }
        cur += s[i++];
      }
      continue;
    }
    if (c === '.') { parts.push(cur.trim()); cur = ''; i++; continue; }
    cur += c;
    i++;
  }
  parts.push(cur.trim());
  return parts;
}

// The SELECTs over the model in a statement: `whole` when the statement is one, else
// `relations`, each the text between its parentheses ({ start, end, text }). `name` is the
// model's name in FROM: one part, or qualified (`ws.model`, or its parts as an array).
export function modelRelations(src, name = 'model') {
  const toks = scan(src);
  const kw = (t, w) => t?.t === 'word' && t.v.toUpperCase() === w;
  const parts = nameParts(name).map(lc);
  const dot = t => t?.t === 'op' && t.v === '.';
  const isName = t => t?.t === 'word' || t?.t === 'name';
  // Whether the model's name, all its parts, starts at toks[k]: alone, or with one of its
  // datasets (model.dataset).
  const isModelAt = k => {
    if (dot(toks[k - 1])) return false;
    for (let p = 0; p < parts.length; p++) {
      const t = toks[k + 2 * p];
      if (!isName(t) || lc(t.v) !== parts[p]) return false;
      if (p < parts.length - 1 && !dot(toks[k + 2 * p + 1])) return false;
    }
    const after = k + 2 * parts.length - 1;
    if (!dot(toks[after])) return true;
    return isName(toks[after + 1]) && !dot(toks[after + 2]);
  };
  // Whether the SELECT at toks[s] reads the model: its own FROM, at its own depth.
  const readsModel = s => {
    const d = toks[s].depth;
    for (let k = s + 1; k < toks.length && toks[k].depth >= d; k++) if (toks[k].depth === d && kw(toks[k], 'FROM')) return isModelAt(k + 1);
    return false;
  };
  const setOp = toks.some(t => t.depth === 0 && ['UNION', 'INTERSECT', 'EXCEPT'].some(w => kw(t, w)));
  if (kw(toks[0], 'SELECT') && readsModel(0) && !setOp) return { whole: true, relations: [] };
  const relations = [];
  // An arm of a UNION, INTERSECT or EXCEPT with no parentheses: from its SELECT to the next
  // set operator at its depth, or to the ORDER BY, LIMIT or OFFSET of the whole after the last
  // one. It is put in place as SELECT * FROM (its SQL).
  const SETOPS = ['UNION', 'INTERSECT', 'EXCEPT'];
  const armAt = s => {
    const d = toks[s].depth;
    const atArm = s === 0 || (toks[s - 1].depth === d && (SETOPS.some(w => kw(toks[s - 1], w)) || ['ALL', 'DISTINCT'].some(w => kw(toks[s - 1], w))));
    if (!setOp || d !== 0 || !atArm || !readsModel(s)) return -1;
    let e = s + 1;
    for (; e < toks.length; e++) {
      const x = toks[e];
      if (x.depth !== 0 || x.t === ')') continue;
      if (SETOPS.some(w => kw(x, w))) break;
      if ((kw(x, 'ORDER') && kw(toks[e + 1], 'BY')) || kw(x, 'LIMIT') || kw(x, 'OFFSET') || (x.t === 'op' && x.v === ';')) break;
    }
    return e;
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const arm = kw(t, 'SELECT') ? armAt(k) : -1;
    if (arm >= 0) {
      const end = arm < toks.length ? toks[arm].at : src.length;
      relations.push({ start: t.at, end, text: src.slice(t.at, end).trim(), arm: true });
      k = arm - 1;
      continue;
    }
    if (t.t === '(' && kw(toks[k + 1], 'SELECT') && readsModel(k + 1)) {
      let e = k + 1;
      while (!(toks[e].t === ')' && toks[e].depth === t.depth)) e++;
      relations.push({ start: t.at + 1, end: toks[e].at, text: src.slice(t.at + 1, toks[e].at) });
      k = e;
      continue;
    }
    if ((kw(t, 'FROM') || kw(t, 'JOIN')) && isModelAt(k + 1))
      throw new DaxError(`SQL: the model is not a table: ask it in a SELECT ... FROM ${nameParts(name).join('.')} in parentheses (a subquery, or a WITH's query)`,
        { code: 'SEMANTIC', pos: toks[k + 1].at, src });
  }
  return { whole: false, relations };
}
