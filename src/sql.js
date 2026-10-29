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
  'EXCEPT', 'FETCH']);

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

  query() {
    if (this.isKw('WITH')) throw sqlUnsupported('WITH');
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
    // The model, by its name: one part, or qualified (ws.model).
    let from = this.name1();
    while (this.eat('.')) from += `.${this.name1()}`;
    if (this.isKw('JOIN') || this.isOp(',')) throw sqlUnsupported('a FROM other than the model');
    if (this.eatKw('AS')) this.name1();
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
    this.eat(';');
    if (this.isKw('UNION') || this.isKw('INTERSECT') || this.isKw('EXCEPT')) throw sqlUnsupported(this.tok.v.toUpperCase());
    if (this.tok) throw this.err('unexpected text after the query');
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
      if (this.isKw('SELECT')) throw sqlUnsupported('a subquery');
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
      if (this.isKw('SELECT')) throw sqlUnsupported('a subquery');
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
export const printDaxQuery = q => q.evaluates.map(ev => `EVALUATE ${printDax(ev.e)}${ev.order.length
  ? ` ORDER BY ${ev.order.map(o => `${printDax(o.e)}${o.desc ? ' DESC' : ''}`).join(', ')}` : ''}`).join('\n');

function kids(e) {
  switch (e.k) {
    case 'bin': return [e.l, e.r];
    case 'not': case 'neg': case 'isnull': case 'cast': return [e.e];
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
const isConstant = e => e.k !== 'name' && e.k !== 'row' && !isAggCall(e) && !isGrouping(e) && kids(e).every(isConstant);

export class SqlTranslator {
  constructor(model) { this.model = model; }

  // A column by its parts: [table, column] or [column], of the one table that has it.
  column(parts) {
    if (parts.length === 2) return this.model.findColumn(parts[0], parts[1]);
    if (parts.length !== 1) return null;
    const found = [...this.model.tables.values()].map(t => t.colMap.get(lc(parts[0]))).filter(c => c && !c.query);
    if (found.length > 1) throw sqlSemantic(`column ${parts[0]} is in several tables (${found.map(c => c.table.name).join(', ')}); name its table`);
    return found[0] ?? null;
  }
  measure(parts) {
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
      const hit = ctx.items.get(printDax(this.dax(e, { ...ctx, items: null })));
      if (hit) return hit;
    }
    const sub = x => this.dax(x, ctx);
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
      case 'not': return D.not(sub(e.e));
      case 'bin': {
        const l = sub(e.l), r = sub(e.r);
        if (e.op === '%') return D.call('MOD', l, r);
        return D.bin({ AND: '&&', OR: '||', '||': '&' }[e.op] ?? e.op, l, r);
      }
      case 'isnull': return e.not ? D.not(D.call('ISBLANK', sub(e.e))) : D.call('ISBLANK', sub(e.e));
      case 'in': {
        const x = D.in(sub(e.e), e.list.map(sub));
        return e.not ? D.not(x) : x;
      }
      case 'between': {
        const x = sub(e.e), b = D.bin('&&', D.bin('>=', x, sub(e.lo)), D.bin('<=', x, sub(e.hi)));
        return e.not ? D.not(b) : b;
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
      case 'call': {
        if (isAggCall(e)) return this.aggDax(e, ctx);
        if (isGrouping(e)) {
          const a = ctx.mode === 'having' && e.args.length === 1 && e.args[0].k === 'name' ? ctx.groupings?.get(this.column(e.args[0].parts)) : null;
          if (a) return a;
          throw sqlSemantic(`${e.src}: GROUPING is a column of the SELECT, of a column a ROLLUP of the GROUP BY rolls up`);
        }
        if (e.star || e.distinct) throw sqlSyntax(`${e.fn} is not an aggregate`, e.pos, e.src);
        return D.call(FUNCS[e.fn] ?? e.fn, ...e.args.map(sub));
      }
    }
    throw sqlUnsupported(e.src);
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
      return this.measureRef(m);
    }
    if (e.star) throw sqlUnsupported(`${e.src}: a model has no single table to count; COUNT a column, or AGG a measure`);
    if (e.args.length !== 1 || arg.k !== 'name') throw sqlUnsupported(`${e.src}: an aggregate of something other than a column`);
    const c = this.column(arg.parts);
    if (!c) {
      if (this.measure(arg.parts)) throw sqlSemantic(`${arg.src} is a measure: use AGG(${arg.src})`);
      throw sqlSemantic(`the model has no column ${arg.src}`);
    }
    if (e.distinct) {
      if (e.fn !== 'COUNT') throw sqlUnsupported(`${e.fn}(DISTINCT …)`);
      return D.call('DISTINCTCOUNTNOBLANK', D.col(c));
    }
    return D.call(AGGS[e.fn], D.col(c));
  }

  // The query -> { query (the DAX query's tree), limit, offset }.
  translate(src) {
    const q = parseSql(src);
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
      const ast = this.dax(e, { mode: 'agg' });
      const m = isAggCall(e) && (e.fn === 'AGG' || e.fn === 'MEASURE') ? this.measure(e.args[0].parts) : null;
      return { e, ast, key: printDax(ast), name: alias ?? m?.name ?? e.src };
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
            const flag = flags.find(f => cols.includes(f.grouping));
            if (!flag) throw sqlSemantic(`ROLLUP(${level.src}) needs GROUPING(${level.k === 'row' ? level.items[0].src : level.src}) in the SELECT: its subtotal rows' flag`);
            return { cols, flag };
          }));
          continue;
        }
        const c = groupCol(g);
        if (!groups.includes(c)) groups.push(c);
      }
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
    const aliases = new Map(items.map(it => [lc(it.name), itemRef(it)]));
    const aggItems = new Map(aggs.map(it => [it.key, D.ref(it.name)]));
    const groupings = new Map(rollups.flat().flatMap(l => l.cols.map(c => [c, D.ref(l.flag.name)])));
    const having = q.having && this.dax(q.having, { mode: 'having', groups: grouped, aliases, items: aggItems, groupings });

    const aggArgs = aggs.flatMap(it => [D.str(it.name), it.ast]);
    const rollupArgs = rollups.map(levels => D.call('ROLLUPADDISSUBTOTAL', ...levels.flatMap(l => [
      l.cols.length > 1 ? D.call('ROLLUPGROUP', ...l.cols.map(D.col)) : D.col(l.cols[0]), D.str(l.flag.name)])));
    let table = grouped.length || (q.groupBy && !aggs.length && !constants.length)
      ? D.call('SUMMARIZECOLUMNS', ...groups.map(D.col), ...rollupArgs, ...aggArgs)
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
        if (!cols.length) throw sqlUnsupported(`WHERE ${e.src}: a condition on no column`);
        if (new Set(cols.map(c => c.table)).size === 1) return dax;
        const all = c => D.call('ALL', D.col(c));
        return D.call('FILTER', cols.length === 1 ? all(cols[0]) : D.call('CROSSJOIN', ...cols.map(all)), dax);
      });
      table = D.call('CALCULATETABLE', table, ...filters);
    }

    // The result's columns in the SELECT's order and names.
    const scOrder = [...groups.map(g => dims.find(d => d.col === g)), ...aggs];
    const same = !rollups.length && scOrder.length === items.length && scOrder.every((it, i) => it === items[i]) && !dims.some(d => d.renamed);
    if (!same) table = D.call('SELECTCOLUMNS', table, ...items.flatMap(it => [D.str(it.name), itemRef(it)]));

    // ORDER BY: a SELECT item (its name, its position, or the same expression), or an
    // aggregate on the result's rows.
    const outRef = it => it.col && !it.renamed ? D.col(it.col) : D.ref(it.name);
    // ORDER BY ALL: by every item's position.
    const orderBy = q.orderAll
      ? items.map((_, i) => ({ e: { k: 'num', v: String(i + 1), src: String(i + 1) }, ...q.orderAll }))
      : q.orderBy;
    const order = orderBy.map(({ e, desc, nulls }) => {
      if (nulls && nulls !== (desc ? 'last' : 'first')) throw sqlUnsupported(`NULLS ${nulls.toUpperCase()} with ${desc ? 'DESC' : 'ASC'} (blanks sort first ascending, last descending)`);
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
    });

    // FETCH FIRST n ROWS WITH TIES: TOPN, which keeps the rows tied with the n-th on the ORDER BY.
    if (q.ties != null) {
      if (!order.length) throw sqlSemantic('FETCH … WITH TIES needs an ORDER BY');
      table = D.call('TOPN', D.num(q.ties), table, ...order.flatMap(o => [o.e, D.word(o.desc ? 'DESC' : 'ASC')]));
    }

    return { query: { defines: [], evaluates: [{ e: table, order, start: [] }] }, limit: q.limit, offset: q.offset };
  }
}

export const isSql = text => /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*SELECT\b/i.test(text);

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
      for (;;) {
        const e = src.indexOf(c, j);
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
  // Whether the model's name, all its parts and nothing more, starts at toks[k].
  const isModelAt = k => {
    if (dot(toks[k - 1])) return false;
    for (let p = 0; p < parts.length; p++) {
      const t = toks[k + 2 * p];
      if (!(t?.t === 'word' || t?.t === 'name') || lc(t.v) !== parts[p]) return false;
      if (p < parts.length - 1 && !dot(toks[k + 2 * p + 1])) return false;
    }
    return !dot(toks[k + 2 * parts.length - 1]);
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
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
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
