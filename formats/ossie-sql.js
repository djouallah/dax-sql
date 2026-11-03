// DAX and Apache Ossie's portable SQL (OSSIE_SQL_2026), both ways, for formats/ossie.js. Not
// part of the package's API.
//   measureSql(ast, tables, measures)     a measure as a dataset-scoped metric, or null
//   columnSql(ast, table)                 a calculated column as a field expression, or null
//   metricDax(sql, dataset, datasets)     a metric's SQL as the DAX of a measure
//   fieldDax(sql, table, columns)         a field's SQL as the DAX of a calculated column
// DAX goes to SQL only where the two give the same numbers, BLANK and NULL included; anything
// else is null, and the caller keeps the DAX. So:
//   - a measure reads the columns of one table only, which is the metric's dataset;
//   - SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTROWS, DISTINCTCOUNT, DISTINCTCOUNTNOBLANK,
//     their X forms over that table, DIVIDE, * and a division by a number, and a measure
//     reference (inlined: a metric cannot reference another);
//   - not + or -: BLANK + 1 is 1 in DAX and NULL + 1 is NULL in SQL;
//   - not CALCULATE: a filter argument replaces the filter on its column, which no SQL
//     aggregate says; nor VAR, IF, time intelligence, RELATED...
// A count over no rows is BLANK in DAX and 0 in SQL, hence NULLIF(COUNT(..), 0); a division is
// a double in DAX whatever its operands, hence CAST(.. AS DOUBLE). The way back reads that
// subset as it is written, and the plain forms other tools write (COUNT(*), a / b, a + b).
import { parseExpression } from '../src/parser.js';

// SQL's reserved words that are also likely column names; such a name is quoted.
const RESERVED = new Set(`ALL AND ANY AS ASC AT BETWEEN BY CASE CAST CHECK COLUMN CREATE CROSS CURRENT
  CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER DATE DAY DEFAULT DELETE DESC DISTINCT DROP
  ELSE END EXCEPT EXISTS FALSE FETCH FILTER FOR FROM FULL GROUP HAVING HOUR IN INNER INSERT INTERSECT
  INTERVAL INTO IS JOIN KEY LEFT LIKE LIMIT MINUTE MONTH NATURAL NOT NULL OFFSET ON OR ORDER OUTER OVER
  PARTITION RIGHT ROW ROWS SECOND SELECT SET SOME TABLE THEN TIME TIMESTAMP TO TRUE UNION UNIQUE
  UPDATE USER USING VALUE VALUES WHEN WHERE WINDOW WITH YEAR`.split(/\s+/));
export const sqlName = n => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !RESERVED.has(n.toUpperCase()) ? n : `"${n.replace(/"/g, '""')}"`);

const lc = s => String(s).toLowerCase();
const NUMERIC = ['Integer', 'Decimal', 'Float'];
const wider = (a, b) => NUMERIC[Math.max(NUMERIC.indexOf(a), NUMERIC.indexOf(b))];
const paren = x => (x.bin ? `(${x.sql})` : x.sql);
const num = a => a?.k === 'num' || (a?.k === 'neg' && a.e.k === 'num');
const numText = a => (a.k === 'neg' ? `-${a.e.v}` : a.v);
const toDouble = x => (x.type === 'Float' && !x.bin ? x.sql : `CAST(${x.sql} AS DOUBLE)`);

// --- DAX -> SQL -------------------------------------------------------------------------------

// `tables`: Map(lower-cased name -> { name, columns: Map(lower-cased name -> { name, type,
// source }) }); `measures`: Map(lower-cased name -> { ast }). The result is { sql, type, table }:
// `table` the one table it reads, the metric's dataset.
export function measureSql(ast, tables, measures) {
  const reads = new Set();
  const seen = new Set();
  const column = (c, t) => {
    const col = t?.columns.get(lc(c.name));
    if (!col) return null;
    reads.add(t.name);
    return col;
  };
  const tableOf = name => tables.get(lc(name));
  // A column named in an aggregate: T[c] (or [c] inside an iterator over T).
  const colRef = (a, row) => {
    if (a?.k !== 'col') return null;
    const t = a.table == null ? row : tableOf(a.table);
    if (row && t !== row) return null;
    return column(a, t);
  };
  function rowExpr(a, row) {
    if (!a) return null;
    if (num(a)) return { sql: numText(a), type: /^-?\d+$/.test(numText(a)) ? 'Integer' : 'Float', lit: true };
    if (a.k === 'col') {
      const c = colRef(a, row);
      return c && NUMERIC.includes(c.type) ? { sql: sqlName(c.name), type: c.type } : null;
    }
    return arith(a, x => rowExpr(x, row));
  }
  // * of two, or / by a number other than 0: the operators with the same BLANK rules as NULL.
  function arith(a, sub) {
    if (a.k !== 'bin') return null;
    if (a.op === '*') {
      const l = sub(a.l), r = sub(a.r);
      if (!l || !r || (l.lit && r.lit)) return null;
      return { sql: `${paren(l)} * ${paren(r)}`, type: wider(l.type, r.type), bin: true, agg: l.agg || r.agg };
    }
    if (a.op === '/' && num(a.r) && Number(numText(a.r)) !== 0) {
      const l = sub(a.l);
      if (!l || l.lit) return null;
      return { sql: `${toDouble(l)} / ${numText(a.r)}`, type: 'Float', bin: true, agg: l.agg };
    }
    return null;
  }
  const AGG = { SUM: 'SUM', AVERAGE: 'AVG', MIN: 'MIN', MAX: 'MAX' };
  const AGGX = { SUMX: 'SUM', AVERAGEX: 'AVG', MINX: 'MIN', MAXX: 'MAX' };
  function aggregate(fn, inner) {
    if ((fn === 'SUM' || fn === 'AVG') && !NUMERIC.includes(inner.type)) return null;
    const arg = fn === 'AVG' && inner.type === 'Integer' ? `CAST(${inner.sql} AS DOUBLE)` : inner.sql;
    const type = fn === 'AVG' ? (inner.type === 'Decimal' ? 'Decimal' : 'Float') : inner.type;
    return { sql: `${fn}(${arg})`, type, agg: true };
  }
  function expr(a) {
    if (!a) return null;
    if (num(a)) return { sql: numText(a), type: /^-?\d+$/.test(numText(a)) ? 'Integer' : 'Float', lit: true };
    if (a.k === 'col' && a.table == null) {
      const m = measures.get(lc(a.name));
      if (!m || seen.has(lc(a.name))) return null;
      seen.add(lc(a.name));
      const x = expr(m.ast);
      seen.delete(lc(a.name));
      return x;
    }
    if (a.k === 'bin') return arith(a, expr);
    if (a.k !== 'call') return null;
    const args = a.args;
    if (AGG[a.fn] && args.length === 1) {
      const c = colRef(args[0]);
      return c && aggregate(AGG[a.fn], { sql: sqlName(c.name), type: c.type });
    }
    if (AGGX[a.fn] && args.length === 2 && args[0].k === 'name') {
      const t = tableOf(args[0].name);
      const inner = t && rowExpr(args[1], t);
      if (!inner || inner.lit) return null;
      reads.add(t.name);
      return aggregate(AGGX[a.fn], inner);
    }
    if ((a.fn === 'COUNT' || a.fn === 'COUNTA' || a.fn === 'DISTINCTCOUNTNOBLANK' || a.fn === 'DISTINCTCOUNT') && args.length === 1) {
      const c = colRef(args[0]);
      if (!c) return null;
      const f = sqlName(c.name);
      const count = a.fn === 'COUNT' || a.fn === 'COUNTA' ? `COUNT(${f})`
        : a.fn === 'DISTINCTCOUNTNOBLANK' ? `COUNT(DISTINCT ${f})`
        // DISTINCTCOUNT counts BLANK as a value; COUNT(DISTINCT) skips NULL.
          : `COUNT(DISTINCT ${f}) + MAX(CASE WHEN ${f} IS NULL THEN 1 ELSE 0 END)`;
      return { sql: `NULLIF(${count}, 0)`, type: 'Integer', agg: true };
    }
    if (a.fn === 'COUNTROWS' && args.length === 1 && args[0].k === 'name') {
      const t = tableOf(args[0].name);
      if (!t) return null;
      reads.add(t.name);
      return { sql: 'NULLIF(COUNT(*), 0)', type: 'Integer', agg: true };
    }
    if (a.fn === 'DIVIDE' && (args.length === 2 || (args.length === 3 && num(args[2])))) {
      const l = expr(args[0]), r = expr(args[1]);
      if (!l || !r || !(l.agg || r.agg)) return null;
      const sql = args.length === 2
        ? `${toDouble(l)} / NULLIF(${r.sql}, 0)`
        : `CASE WHEN ${paren(r)} IS NULL OR ${paren(r)} = 0 THEN ${numText(args[2])} ELSE ${toDouble(l)} / ${paren(r)} END`;
      return { sql, type: 'Float', bin: args.length === 2, agg: true };
    }
    return null;
  }
  const x = expr(ast);
  if (!x?.agg || reads.size !== 1) return null;
  return { sql: x.sql, type: x.type, table: [...reads][0] };
}

// A calculated column of `home` as a field expression: its operands are the table's data
// columns, written as their source columns (a field expression reads the source).
export function columnSql(ast, home) {
  function row(a) {
    if (!a) return null;
    if (num(a)) return { sql: numText(a), type: /^-?\d+$/.test(numText(a)) ? 'Integer' : 'Float', lit: true };
    if (a.k === 'col') {
      if (a.table != null && lc(a.table) !== lc(home.name)) return null;
      const c = home.columns.get(lc(a.name));
      return c?.source != null && NUMERIC.includes(c.type) ? { sql: sqlName(c.source), type: c.type } : null;
    }
    if (a.k !== 'bin') return null;
    if (a.op === '*') {
      const l = row(a.l), r = row(a.r);
      return l && r && !(l.lit && r.lit) ? { sql: `${paren(l)} * ${paren(r)}`, type: wider(l.type, r.type), bin: true } : null;
    }
    if (a.op === '/' && num(a.r) && Number(numText(a.r)) !== 0) {
      const l = row(a.l);
      return l && !l.lit ? { sql: `${toDouble(l)} / ${numText(a.r)}`, type: 'Float', bin: true } : null;
    }
    return null;
  }
  const x = row(ast);
  return x && !x.lit ? x.sql : null;
}

export const parseDax = text => {
  try { return parseExpression(text); } catch { return null; }
};

// --- SQL -> DAX -------------------------------------------------------------------------------

function lexSql(src) {
  const out = [];
  const re = /\s+|("(?:[^"]|"")*")|('(?:[^']|'')*')|(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_][A-Za-z0-9_$]*)|(<>|!=|<=|>=|\|\||[-+*/%(),.=<>])/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (!(m = re.exec(src))) throw new Error(`unexpected '${src[at]}'`);
    if (m[1]) out.push({ t: 'id', v: m[1].slice(1, -1).replace(/""/g, '"'), q: true });
    else if (m[2]) out.push({ t: 'str', v: m[2].slice(1, -1).replace(/''/g, "'") });
    else if (m[3]) out.push({ t: 'num', v: m[3] });
    else if (m[4]) out.push({ t: 'id', v: m[4], up: m[4].toUpperCase() });
    else if (m[5]) out.push({ t: 'op', v: m[5] });
  }
  return out;
}

// The SQL a metric or a field is written in, as a tree: num, str, id { parts }, call { fn,
// args, distinct, star }, cast { e, type }, case { whens: [{ when, then }], else }, bin { op,
// l, r }, isnull { e, not }, neg { e }.
function parseSql(src) {
  const toks = lexSql(src);
  let i = 0;
  const peek = () => toks[i];
  const kw = w => peek()?.t === 'id' && peek().up === w;
  const op = v => peek()?.t === 'op' && peek().v === v;
  const eat = v => ((op(v) || kw(v)) ? (i++, true) : false);
  const need = v => { if (!eat(v)) throw new Error(`expected ${v}`); };
  const LEVELS = [['OR'], ['AND'], ['=', '<>', '!=', '<', '<=', '>', '>='], ['+', '-', '||'], ['*', '/', '%']];
  function level(n) {
    if (n === LEVELS.length) return unary();
    let l = level(n + 1);
    for (;;) {
      if (n === 2 && kw('IS')) {
        i++;
        const not = eat('NOT');
        need('NULL');
        l = { k: 'isnull', e: l, not };
        continue;
      }
      const o = LEVELS[n].find(x => op(x) || kw(x));
      if (!o) return l;
      i++;
      l = { k: 'bin', op: o === '!=' ? '<>' : o, l, r: level(n + 1) };
    }
  }
  function unary() {
    if (eat('-')) return { k: 'neg', e: unary() };
    if (eat('+')) return unary();
    return primary();
  }
  function primary() {
    const t = toks[i++];
    if (!t) throw new Error('the expression ends too soon');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'op' && t.v === '(') { const e = level(0); need(')'); return e; }
    if (t.t !== 'id') throw new Error(`unexpected ${t.v}`);
    if (!t.q && t.up === 'NULL') return { k: 'null' };
    if (!t.q && (t.up === 'TRUE' || t.up === 'FALSE')) return { k: 'bool', v: t.up === 'TRUE' };
    if (!t.q && t.up === 'CASE') {
      const whens = [];
      while (eat('WHEN')) { const when = level(0); need('THEN'); whens.push({ when, then: level(0) }); }
      const otherwise = eat('ELSE') ? level(0) : null;
      need('END');
      return { k: 'case', whens, else: otherwise };
    }
    if (!t.q && t.up === 'CAST' && op('(')) {
      i++;
      const e = level(0);
      need('AS');
      const type = toks[i++]?.v?.toUpperCase();
      need(')');
      return { k: 'cast', e, type };
    }
    if (!t.q && op('(')) {
      i++;
      if (eat('*')) { need(')'); return { k: 'call', fn: t.up, args: [], star: true }; }
      const distinct = eat('DISTINCT');
      const args = [];
      if (!op(')')) do args.push(level(0)); while (eat(','));
      need(')');
      return { k: 'call', fn: t.up, args, distinct };
    }
    const parts = [t.v];
    while (op('.') && toks[i + 1]?.t === 'id') { i++; parts.push(toks[i++].v); }
    return { k: 'id', parts };
  }
  const e = level(0);
  if (i < toks.length) throw new Error(`unexpected ${toks[i].v}`);
  return e;
}

const daxTable = n => `'${String(n).replace(/'/g, "''")}'`;
const daxCol = (t, c) => `${daxTable(t)}[${String(c).replace(/]/g, ']]')}]`;
const daxStr = s => `"${String(s).replace(/"/g, '""')}"`;
const isZero = e => e?.k === 'num' && Number(e.v) === 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unCast = e => (e?.k === 'cast' && (e.type === 'DOUBLE' || e.type === 'FLOAT') ? e.e : e);

// `resolve(parts)`: the { table, column } an identifier names, or null.
function toDax(root, resolve) {
  const tables = new Set();
  const col = e => {
    const c = e?.k === 'id' ? resolve(e.parts) : null;
    if (c) tables.add(c.table);
    return c;
  };
  // The table an expression's first column is in: the one an X function iterates.
  const firstTable = e => {
    if (e?.k === 'id') return col(e)?.table;
    for (const v of Object.values(e ?? {})) {
      if (v && typeof v === 'object') {
        const t = Array.isArray(v) ? v.map(firstTable).find(Boolean) : firstTable(v);
        if (t) return t;
      }
    }
    return null;
  };
  const AGG = { SUM: ['SUM', 'SUMX'], AVG: ['AVERAGE', 'AVERAGEX'], MIN: ['MIN', 'MINX'], MAX: ['MAX', 'MAXX'] };
  function count(e) {
    if (e?.k !== 'call' || e.fn !== 'COUNT') return null;
    if (e.star) {
      const t = home();
      return `COUNTROWS(${daxTable(t)})`;
    }
    const c = col(unCast(e.args[0]));
    if (!c) throw new Error('COUNT reads one field');
    return e.distinct ? `DISTINCTCOUNTNOBLANK(${daxCol(c.table, c.column)})` : `COUNTA(${daxCol(c.table, c.column)})`;
  }
  // COUNT(*) has no column to say its table: the dataset's, or the one other columns are in.
  let home = () => { throw new Error('COUNT(*) of a model-scoped metric names no dataset'); };
  function dax(e) {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return daxStr(e.v);
      case 'neg': return `-${wrap(e.e)}`;
      case 'id': {
        const c = col(e);
        if (!c) throw new Error(`no field ${e.parts.join('.')}`);
        return daxCol(c.table, c.column);
      }
      case 'cast': {
        const to = { DOUBLE: 'DOUBLE', FLOAT: 'DOUBLE', INTEGER: 'INTEGER', INT: 'INTEGER', BIGINT: 'INTEGER', DECIMAL: 'CURRENCY', NUMERIC: 'CURRENCY' }[e.type];
        if (!to) throw new Error(`CAST to ${e.type}`);
        return `CONVERT(${dax(e.e)}, ${to})`;
      }
      case 'call': {
        if (e.fn === 'COUNT') return count(e);
        if (e.fn === 'NULLIF' && e.args.length === 2 && isZero(e.args[1])) {
          const a = e.args[0];
          const c = count(a);
          if (c) return c;
          // COUNT(DISTINCT f) + MAX(CASE WHEN f IS NULL THEN 1 ELSE 0 END): DISTINCTCOUNT.
          if (a.k === 'bin' && a.op === '+' && a.l.k === 'call' && a.l.fn === 'COUNT' && a.l.distinct
            && a.r.k === 'call' && a.r.fn === 'MAX' && a.r.args[0]?.k === 'case') {
            const w = a.r.args[0];
            const [{ when, then }] = w.whens;
            if (w.whens.length === 1 && when.k === 'isnull' && !when.not && same(when.e, a.l.args[0])
              && then.k === 'num' && Number(then.v) === 1 && isZero(w.else)) {
              const c2 = col(a.l.args[0]);
              if (c2) return `DISTINCTCOUNT(${daxCol(c2.table, c2.column)})`;
            }
          }
          return `IF(${dax(a)} = 0, BLANK(), ${dax(a)})`;
        }
        const names = AGG[e.fn];
        if (names && e.args.length === 1 && !e.distinct) {
          const arg = unCast(e.args[0]);
          const c = arg.k === 'id' ? col(arg) : null;
          if (c) return `${names[0]}(${daxCol(c.table, c.column)})`;
          const t = firstTable(arg);
          if (!t) throw new Error(`${e.fn} reads no field`);
          return `${names[1]}(${daxTable(t)}, ${dax(arg)})`;
        }
        throw new Error(`${e.fn}()`);
      }
      case 'bin': {
        // a / NULLIF(b, 0), and a / b: DIVIDE; a / 12 stays a division.
        if (e.op === '/') {
          const l = unCast(e.l);
          if (e.r.k === 'call' && e.r.fn === 'NULLIF' && e.r.args.length === 2 && isZero(e.r.args[1])) return `DIVIDE(${dax(l)}, ${dax(e.r.args[0])})`;
          if (e.r.k === 'num' && !isZero(e.r)) return `${wrap(l)} / ${e.r.v}`;
          return `DIVIDE(${dax(l)}, ${dax(e.r)})`;
        }
        const ops = { '*': '*', '+': '+', '-': '-', '||': '&', '=': '=', '<>': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=', AND: '&&', OR: '||' };
        if (!ops[e.op]) throw new Error(`the operator ${e.op}`);
        return `${wrap(e.l)} ${ops[e.op]} ${wrap(e.r)}`;
      }
      case 'case': {
        // CASE WHEN b IS NULL OR b = 0 THEN alt ELSE a / b END: DIVIDE(a, b, alt).
        const w = e.whens[0]?.when;
        const div = e.else?.k === 'bin' && e.else.op === '/' ? e.else : null;
        if (e.whens.length === 1 && div && w?.k === 'bin' && w.op === 'OR') {
          const parts = [w.l, w.r];
          const b = div.r;
          if (parts.some(p => p.k === 'isnull' && !p.not && same(p.e, b)) && parts.some(p => p.k === 'bin' && p.op === '=' && same(p.l, b) && isZero(p.r))) {
            return `DIVIDE(${dax(unCast(div.l))}, ${dax(b)}, ${dax(e.whens[0].then)})`;
          }
        }
        return `SWITCH(TRUE(), ${e.whens.map(x => `${dax(x.when)}, ${dax(x.then)}`).join(', ')}${e.else ? `, ${dax(e.else)}` : ''})`;
      }
      case 'null': return 'BLANK()';
      case 'bool': return e.v ? 'TRUE()' : 'FALSE()';
      case 'isnull': return `${e.not ? 'NOT ' : ''}ISBLANK(${dax(e.e)})`;
      default: throw new Error(e.k);
    }
  }
  const wrap = e => (e.k === 'bin' ? `(${dax(e)})` : dax(e));
  return {
    run(dataset) {
      home = () => dataset ?? firstTable(root) ?? (() => { throw new Error('COUNT(*) of a model-scoped metric names no dataset'); })();
      return { dax: dax(root), tables };
    },
  };
}

// A metric's SQL as DAX. `dataset`: the dataset it is declared on ({ name, fields }), or null
// for a model-scoped one; `datasets`: every dataset. Its home table is the dataset's, or else
// the first one it reads. Throws when the SQL is beyond this subset.
export function metricDax(sql, dataset, datasets) {
  const fieldIn = (d, name) => (d.fields ?? []).find(f => lc(f.name) === lc(name));
  const byName = new Map(datasets.map(d => [lc(d.name), d]));
  const resolve = parts => {
    if (parts.length === 1 && dataset) {
      const f = fieldIn(dataset, parts[0]);
      return f ? { table: dataset.name, column: f.name } : null;
    }
    if (parts.length === 2) {
      const d = byName.get(lc(parts[0]));
      const f = d && fieldIn(d, parts[1]);
      return f ? { table: d.name, column: f.name } : null;
    }
    return null;
  };
  const { dax, tables } = toDax(parseSql(sql), resolve).run(dataset?.name);
  return { dax, table: dataset?.name ?? [...tables][0] ?? null };
}

// A field's SQL as the DAX of a calculated column of `dataset`: its identifiers are source
// columns, each the source of one of `columns` ({ name, source }), the table's data columns.
export function fieldDax(sql, table, columns) {
  const resolve = parts => {
    if (parts.length !== 1) return null;
    const c = columns.find(x => lc(x.source) === lc(parts[0]));
    return c ? { table, column: c.name } : null;
  };
  return toDax(parseSql(sql), resolve).run(table).dax;
}

// Whether a field's SQL is a column of its source, and which: a bare or quoted identifier.
export function sourceColumnOf(sql) {
  try {
    const e = parseSql(String(sql));
    return e.k === 'id' && e.parts.length === 1 ? e.parts[0] : null;
  } catch {
    return null;
  }
}
