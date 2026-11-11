// Intermediate form -> SQL.
//
// A table becomes a Block: one SELECT being built (FROM, joins, WHERE, GROUP BY, ...) and a
// resolver that writes a column of its input row. Iterators extend the block of their table
// when they can (FILTER over a scan is a WHERE) and wrap it in a subquery when they cannot.
// An aggregate is a scalar subquery over its table's block, correlated to the rows it reads
// (DuckDB decorrelates them), except where it can be fused: aggregates of SUMMARIZECOLUMNS
// (and ROW) over the same model table under the same filters, up to the group's keys, are
// one GROUP BY in a CTE, joined to the groups.
//
// A scan's WHERE is the filter context applied to that table: every filter on a column of
// its expanded table (joined from the scan's table through the relationships, or read off
// the foreign key when the relationship relies on referential integrity), and the filters
// that reach it over bidirectional or many-to-many relationships, as semi-joins.
import * as ir from './ir.js';
import { Ctx, narrow, EMPTY_CTX as EMPTY } from './context.js';
import { semantic } from './errors.js';

const lc = s => String(s).toLowerCase();

export class Emitter {
  constructor(model, dialect, options = {}) {
    this.model = model;
    // The dialect, with this statement's aliases for what it declares itself (bind).
    this.d = Object.create(dialect, { alias: { value: p => this.alias(p) } });
    this.options = options;
    this.n = 0;
    this.ctes = [];
    this.memo = new Map();        // shared IR -> CTE name
    this.fusions = [];            // stack: the Fusion aggregates go to, or null
    this.fusedIn = new WeakMap(); // agg node -> fused group
    // Comparisons of a value with a constant as compare() writes them (nonBlank): those that
    // keep no row where the value is blank, SQL -> the value; and those that keep the blank
    // too, SQL -> { base: the comparison alone, col: the value }.
    this.rejects = new Map();
    this.nullArms = new Map();
    this.reads = new Set();       // the tables the statement reads, the blank row's check aside
    this.checks = 0;             // > 0 while writing that check (orphans, lacking)
    this.blanks = false;          // whether a table got a blank row
  }

  // Whether the statement reads one table only, and gave it a blank row: index.js compiles
  // it again without one.
  readsOneTable() { return this.blanks && this.reads.size === 1; }

  alias(p) { return `${p}${++this.n}`; }
  ident(n) { return this.d.ident(n); }
  // An ORDER BY term as DAX orders: a blank first ascending, last descending.
  orderBy(v, desc) { return desc ? this.d.order(v, 'DESC', 'LAST') : this.d.order(v, 'ASC', 'FIRST'); }

  // --- the query -------------------------------------------------------------------------

  query({ table, row, order, start = [] }) {
    const b = this.table(table, new Map());
    const inner = b.render(), names = b.names();
    const r = this.alias('q');
    const style = this.options.columnNames ?? 'short';
    const outNames = outputNames(table.cols, style);
    const cast = this.options.castOutput !== false, by = typeof this.options.castOutput === 'object' ? this.options.castOutput : null;
    const sel = table.cols.map((c, i) => {
      let s = `${r}.${this.ident(names[i])}`;
      if (by) { if (by[c.t]) s = by[c.t](s); }
      else if (cast && (c.t === 'int' || c.t === 'double' || c.t === 'decimal')) s = this.d.cast(s, c.t === 'int' ? 'int' : 'double');
      return `${s} AS ${this.ident(outNames[i])}`;
    });
    let sql = `SELECT ${sel.join(', ')} FROM (${inner}) AS ${r}`;
    if (order.length) {
      const res = new WrapRes(this, null, names.map((n, i) => ({ sql: `${r}.${this.ident(n)}`, lineage: table.cols[i].lineage })), this.model.state(null));
      const scope = new Map([[row.id, res]]);
      const keys = order.map(o => this.scalar(o.expr, scope));
      if (start.length) sql += ` WHERE ${this.startAt(keys, order, start.map(v => this.scalar(v, scope)), start)}`;
      sql += ` ORDER BY ${keys.map((k, i) => this.orderBy(k, order[i].desc)).join(', ')}`;
    }
    if (this.ctes.length) sql = `WITH ${this.ctes.join(',\n')}\n${sql}`;
    return {
      sql: this.d.finish(sql),
      ordered: order.length > 0,
      columns: table.cols.map((c, i) => ({ name: outNames[i], dax: daxName(c), type: c.t, lineage: c.lineage ? `'${c.lineage.table.name}'[${c.lineage.name}]` : null })),
    };
  }

  // START AT: the rows from the first that is at or after the values, in the order (a blank
  // comes first ascending, last descending). Each value counts within the rows equal on the
  // ones before it.
  startAt(keys, order, vals, lits) {
    const after = i => {
      const k = keys[i], v = vals[i], blank = lits[i].v === null;
      if (order[i].desc) return blank ? this.d.never : `(${k} < ${v} OR ${k} IS NULL)`;
      return blank ? `${k} IS NOT NULL` : `${k} > ${v}`;
    };
    const same = i => this.d.isNotDistinct(keys[i], vals[i]);
    const alts = vals.map((_, i) => [...vals.slice(0, i).map((__, j) => same(j)), after(i)].join(' AND '));
    alts.push(vals.map((_, i) => same(i)).join(' AND '));
    return `(${alts.map(paren).join(' OR ')})`;
  }

  // --- tables ----------------------------------------------------------------------------

  table(x, scope) {
    switch (x.k) {
      case 'scan': return this.scanBlock(x.table, x.ctx, scope);
      case 'filter': {
        const b = this.open(this.table(x.src, scope));
        b.where.push(this.rowFused(b, x.src, x.row, () => this.scalar(x.pred, withRow(scope, x.row, b.res), true)));
        return b;
      }
      case 'project': {
        const b = this.open(this.table(x.src, scope));
        const s2 = withRow(scope, x.row, b.res);
        const kept = x.keep ? b.outList() : [];
        const items = this.rowFused(b, x.src, x.row, () => x.items.map(i => ({ sql: this.scalar(i.expr, s2) })));
        b.setOut(x.cols, [...kept.map(k => k.sql), ...items.map(i => i.sql)]);
        return b;
      }
      case 'distinct': {
        let b = this.table(x.src, scope);
        if (!b.open || b.group) b = this.wrap(b);
        b.distinct = true;
        b.open = false;
        return b;
      }
      case 'group': {
        const b = this.open(this.table(x.src, scope));
        const s2 = withRow(scope, x.row, b.res);
        const keys = x.keys.map(k => this.scalar(k.expr, s2));
        const items = x.items.map(i => this.scalar(i.expr, s2));
        b.group = keys;
        b.setOut(x.cols, [...keys, ...items]);
        b.open = false;
        return b;
      }
      case 'topn': return this.topn(x, scope);
      case 'topnskip': return this.topnSkip(x, scope);
      case 'subindex': return this.subIndex(x, scope);
      case 'join': {
        // NATURALINNERJOIN, NATURALLEFTOUTERJOIN: on the common columns, a blank matching a
        // blank.
        const l = this.wrap(this.table(x.left, scope));
        const r = this.table(x.right, scope), rn = r.names(), a = this.alias('n');
        const on = x.on.map(([i, j]) => this.d.isNotDistinct(l.res.col(i), `${a}.${this.ident(rn[j])}`));
        l.from += ` ${x.outer ? 'LEFT JOIN' : 'JOIN'} (${r.render()}) AS ${a} ON ${on.join(' AND ')}`;
        const cols = [...l.res.list, ...x.rest.map(j => ({ sql: `${a}.${this.ident(rn[j])}`, lineage: x.right.cols[j].lineage }))];
        l.res = new WrapRes(this, l, cols, l.res.state);
        l.cols = x.cols;
        l._names = null;
        return l;
      }
      case 'cross': {
        const parts = x.srcs.map(s => this.wrap(this.table(s, scope)));
        return this.combine(parts, ' CROSS JOIN ', x.cols);
      }
      case 'union': {
        const parts = x.srcs.map(s => this.table(s, scope));
        return this.fromSql(`(${parts.map(p => p.render()).join(' UNION ALL ')})`, x.cols, parts[0].names());
      }
      case 'intersect': case 'except': {
        const b = this.wrap(this.table(x.srcs[0], scope));
        for (const s of x.srcs.slice(1)) {
          const r = this.table(s, scope), a = this.alias('e'), rn = r.names();
          const on = x.cols.map((_, i) => this.d.isNotDistinct(`${a}.${this.ident(rn[i])}`, b.res.col(i)));
          b.where.push(`${x.k === 'except' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM (${r.render()}) AS ${a} WHERE ${on.join(' AND ')})`);
        }
        return b;
      }
      case 'rows': return this.rowsBlock(x, scope);
      case 'series': {
        const a = this.alias('g');
        const from = `${this.d.series(this.scalar(x.start, scope), this.scalar(x.end, scope), this.scalar(x.step, scope), x.cols[0].t)} AS ${a}`;
        return this.fromSql(from, x.cols, ['v'], a);
      }
      case 'generate': {
        const l = this.wrap(this.table(x.left, scope));
        const r = this.table(x.right, withRow(scope, x.lrow, l.res));
        const a = this.alias('l'), rn = r.names();
        l.from += this.d.lateral(r.render(), a, x.outer);
        const cols = [...l.res.list, ...rn.map((n, i) => ({ sql: `${a}.${this.ident(n)}`, lineage: x.right.cols[i].lineage }))];
        l.res = new WrapRes(this, l, cols, l.res.state);
        l.cols = x.cols;
        l._names = null;
        return l;
      }
      case 'shared': {
        if (ir.freeRows(x.src).size) return this.table(x.src, scope);
        let name = this.memo.get(x);
        if (!name) {
          name = this.alias('v');
          const b = this.isolated(() => this.table(x.src, new Map()));
          this.ctes.push(`${name} AS ${this.d.materialized}(${b.render()})`);
          this.memo.set(x, name);
          this.memo.set(name, b.names());
        }
        const a = this.alias('s');
        return this.fromSql(`${name} AS ${a}`, x.cols, this.memo.get(name), a);
      }
      case 'paths': {
        const name = this.pathsSource(x), a = this.alias('h');
        return this.fromSql(`${name} AS ${a}`, x.cols, ['key', 'path'], a);
      }
      case 'sc': return this.summarizeColumns(x, scope);
      case 'window': return this.windowRows(x, scope);
      case 'withblank': {
        // VALUES, ALL: the rows, and the table's blank row when it has one.
        const b = this.table(x.src, scope), names = b.names();
        const blank = this.blankRow(x.table, x.ctx, scope, bb => {
          bb.setOut(x.cols, x.lineage.map(l => bb.res.meta(l)));
          bb._names = names;
          bb.out.forEach((o, i) => { o.name = names[i]; });
          return bb.render();
        }, null, x.unmatched !== false);
        if (!blank) return b;
        return this.fromSql(`(${b.render()} UNION ${blank})`, x.cols, names);
      }
      case 'prefix': {
        const b = this.wrap(this.table(x.src, scope));
        const vals = x.vals.map(v => this.scalar(v, scope));
        b.setOut(x.cols, [...vals, ...b.outList().map(o => o.sql)]);
        if (!(x.cond.k === 'lit' && x.cond.v === true)) b.where.push(this.scalar(x.cond, scope, true));
        b.open = false;
        return b;
      }
      case 'onerow': {
        const b = new Block(this, null, x.cols);
        b.setOut(x.cols, x.vals.map(v => this.scalar(v, scope)));
        if (!(x.cond.k === 'lit' && x.cond.v === true)) b.where.push(this.scalar(x.cond, scope, true));
        b.open = false;
        return b;
      }
      case 'currentgroup': throw semantic('CURRENTGROUP() is only valid in an aggregate inside GROUPBY');
    }
    throw new Error(`emit: table ${x.k}`);
  }

  // The rows of a model table the filter context keeps.
  // `self` ([row, columns]): the row's columns are this scan's own (a group key the scan is
  // filtered to), read off its rows.
  // `from`: another source for the table's rows (its blank row); `unmatched`: blankRow's.
  scanBlock(table, ctx, scope, excluded = null, self = null, from = null, unmatched = true) {
    const a = this.alias('t');
    const b = new Block(this, `${from ?? this.source(table)} AS ${a}`, table.columns.map(c => ({ name: c.name, lineage: c, t: c.type })));
    b.res = new ScanRes(this, b, table, a, this.model.state(ctx.mods));
    b.res.blankRow = !!from;
    b.res.unmatched = !from || unmatched;
    if (self) {
      const [row, cols] = self, res = b.res;
      scope = withRow(scope, row, { col: i => res.meta(cols[i]), meta: m => res.meta(m) });
    }
    // The same condition once: a date range on a fact and on its date table is one.
    b.where.push(...this.nonBlank([...new Set([...this.conds(table, ctx, b.res, scope, excluded), ...this.securityConds(table, b.res, scope)])]));
    return b;
  }

  // Conditions that hold together (a scan's WHERE): where one keeps no row whose value v is
  // blank (v compared with a constant the blank fails), the others need not say what a blank
  // v does: `OR v IS NULL` goes, and COALESCE(v, <a blank>) is v. What is left compares the
  // column itself, which lets the engine skip the rows it rules out.
  nonBlank(where) {
    const inner = w => (w.startsWith('(') && w.endsWith(')') ? w.slice(1, -1) : w);
    const cols = new Set(where.map(w => this.rejects.get(inner(w))).filter(Boolean));
    if (!cols.size) return where;
    const blanks = [...new Set(['int', 'double', 'decimal', 'string', 'bool', 'datetime'].map(t => this.d.blankOf(t)))];
    return where.map(w => {
      const arm = this.nullArms.get(inner(w));
      if (arm && cols.has(arm.col)) w = `(${arm.base})`;
      for (const c of cols) for (const z of blanks) w = w.split(`COALESCE(${c}, ${z})`).join(c);
      return w;
    });
  }

  // A stored column, on the row of `alias`, as the data has it: text keeps its trailing spaces,
  // which the model drops as it loads the data (by design: trimming every row of a scan costs
  // more than the difference is worth).
  stored(alias, c) {
    return `${alias}.${this.ident(c.source)}`;
  }

  source(table) {
    if (!this.checks) this.reads.add(table);
    if (table.calc) return this.calcTableSource(table);
    if (table.calcGroup) return this.calcGroupSource(table);
    if (this.options.tableSource) return this.options.tableSource(table);
    const s = table.source;
    return s.schema ? `${this.ident(s.schema)}.${this.ident(s.entity)}` : this.ident(s.entity);
  }

  // A calculated table: its expression, evaluated as at refresh (no filter, no security), as
  // a CTE with the model's columns (matched to the expression's by their source names).
  calcTableSource(table) {
    let name = this.memo.get(table);
    if (name) return name;
    const x = this.options.calcTable(table);
    const b = this.unsecured(() => this.isolated(() => this.table(x, new Map())));
    const inner = b.names(), a = this.alias('c');
    const strip = s => lc(String(s).replace(/^.*\[(.*)\]$/, '$1'));
    const cols = table.columns.filter(c => !c.expr);
    const sel = cols.map((c, i) => {
      let j = x.cols.findIndex(o => lc(o.name) === strip(c.source));
      if (j < 0) j = x.cols.findIndex(o => lc(o.name) === lc(c.name));
      if (j < 0 && x.cols.length === cols.length) j = i;
      if (j < 0) throw semantic(`calculated table '${table.name}': its expression has no column ${c.source}`);
      return `${a}.${this.ident(inner[j])} AS ${this.ident(c.source)}`;
    });
    name = this.alias('ct');
    this.ctes.push(`${name} AS ${this.d.materialized}(SELECT ${sel.join(', ')} FROM (${b.render()}) AS ${a})`);
    this.memo.set(table, name);
    return name;
  }

  // The paths of a parent-child hierarchy (PATH), as a CTE of (key, path): the table's rows
  // as at refresh (no filter, no security), each key and its parent, walked from the rows
  // with a blank parent down (the dialect's paths).
  pathsSource(x) {
    let name = this.memo.get(x);
    if (name) return name;
    const b = this.unsecured(() => this.isolated(() => {
      const s = this.scanBlock(x.key.table, EMPTY, new Map());
      s.setOut([{ name: 'k', lineage: null }, { name: 'p', lineage: null }], [s.res.meta(x.key), s.res.meta(x.parent)]);
      return s;
    }));
    name = this.alias('pt');
    this.ctes.push(`${name} AS ${this.d.materialized}(${this.d.paths(b.render(), x.key.type, name)})`);
    this.memo.set(x, name);
    return name;
  }

  // A calculation group: a row per item, its name and its ordinal.
  calcGroupSource(table) {
    const g = table.calcGroup;
    const cols = [g.column, g.ordinal].filter(Boolean);
    const rows = g.items.map(it => `(${this.d.str(it.name)}${g.ordinal ? `, ${this.d.num(it.ordinal)}` : ''})`);
    if (!rows.length) return `(SELECT ${cols.map(c => `NULL AS ${this.ident(c.source)}`).join(', ')} WHERE ${this.d.never})`;
    return `(SELECT * FROM (VALUES ${rows.join(', ')}) AS v(${cols.map(c => this.ident(c.source)).join(', ')}))`;
  }

  // Code that writes what is evaluated without row-level security (calculated tables and
  // columns, the security filters themselves).
  unsecured(f) {
    const was = this.insecure;
    this.insecure = true;
    try { return f(); } finally { this.insecure = was; }
  }

  // Row-level security on a scan of `table`: each role's filters, as a filter context whose
  // relationships are those security moves along (model.securityState), so they reach the
  // scan as other filters do: from its expanded table, and as semi-joins across relationships
  // that filter both ways for security and many-to-many ones. A row is kept when some role
  // keeps it.
  securityConds(table, res, scope) {
    const roles = this.options.security;
    if (!roles?.length || this.insecure) return [];
    const per = roles.map(role => this.unsecured(() => this.conds(table, role.ctx, res, scope)));
    if (per.some(c => !c.length)) return [];
    return [per.length === 1 ? per[0].join(' AND ') : `(${per.map(c => `(${c.join(' AND ')})`).join(' OR ')})`];
  }

  // A block whose input row is its output: extend it, or wrap it if it is not.
  open(b) { return b.open && b.plain ? b : this.wrap(b); }
  wrap(b) { return this.fromSql(`(${b.render()})`, b.cols, b.names()); }
  // A block over a FROM item whose columns are `names`; with `alias`, `from` names it already.
  fromSql(from, cols, names, alias = null) {
    const a = alias ?? this.alias('s');
    const nb = new Block(this, alias ? from : `${from} AS ${a}`, cols);
    nb.res = new WrapRes(this, nb, names.map((n, i) => ({ sql: `${a}.${this.ident(n)}`, lineage: cols[i]?.lineage ?? null })), this.model.state(null));
    return nb;
  }
  combine(parts, sep, cols) {
    const from = parts.map(p => p.from).join(sep);
    const nb = new Block(this, from, cols);
    nb.res = new WrapRes(this, nb, parts.flatMap(p => p.res.list), this.model.state(null));
    nb.where.push(...parts.flatMap(p => p.where));
    return nb;
  }

  topn(x, scope) {
    let b = this.open(this.table(x.src, scope));
    const s2 = withRow(scope, x.row, b.res);
    const order = x.order.map(o => ({ sql: this.scalar(o.expr, s2), desc: o.desc }));
    const n = this.scalar(x.n, scope);
    if (order.some(o => /\bSELECT\b/i.test(o.sql))) {
      // The ordering values first, as columns: a window cannot order by a subquery.
      const base = b.outList();
      const cols = [...x.src.cols, ...order.map((_, i) => ({ name: `__order${i}`, lineage: null, t: 'variant' }))];
      b.setOut(cols, [...base.map(o => o.sql), ...order.map(o => o.sql)]);
      const w = this.wrap(b);
      w.qualify = { win: `RANK() OVER (ORDER BY ${order.map((o, i) => this.orderBy(w.res.col(base.length + i), o.desc)).join(', ')})`, test: `<= ${n}` };
      w.setOut(x.cols, x.cols.map((_, i) => w.res.col(i)));
      w.open = false;
      return w;
    }
    b.qualify = { win: `RANK() OVER (ORDER BY ${order.map(o => this.orderBy(o.sql, o.desc)).join(', ')})`, test: `<= ${n}` };
    b.open = false;
    return b;
  }

  // The rows of table `src` with their place in the order (`fn`: ROW_NUMBER, DENSE_RANK), as
  // "__rn": the ordering values first, as columns (a window cannot order by a subquery), ties
  // broken by every column of the rows. -> { sql, names }
  ranked(src, row, order, scope, fn) {
    const b = this.wrap(this.table(src, scope));
    const s2 = withRow(scope, row, b.res);
    const base = b.outList();
    const os = order.map(o => this.scalar(o.expr, s2));
    b.setOut([...src.cols, ...os.map((_, i) => ({ name: `__o${i}` }))], [...base.map(o => o.sql), ...os]);
    const names = b.names(), n = this.alias('w'), q = v => `${n}.${this.ident(v)}`;
    const terms = [...order.map((o, i) => orderTerm(this.d, q(names[base.length + i]), o)), ...src.cols.map((_, i) => this.d.order(q(names[i]), 'ASC', 'FIRST'))];
    return { sql: `SELECT ${n}.*, ${fn}() OVER (${this.d.windowOrder(terms)}) AS ${this.ident('__rn')} FROM (${b.render()}) AS ${n}`, names };
  }

  // TOPNSKIP: the rows whose place is after `skip`, n of them. Rows equal in every column
  // share a place.
  topnSkip(x, scope) {
    const { sql, names } = this.ranked(x.src, x.row, x.order, scope, 'DENSE_RANK');
    const r = this.alias('x'), n = this.scalar(x.n, scope), k = `COALESCE(${this.scalar(x.skip, scope)}, 0)`;
    const sel = x.cols.map((_, i) => `${r}.${this.ident(names[i])}`).join(', ');
    return this.fromSql(`(SELECT ${sel || '1 AS one'} FROM (${sql}) AS ${r} WHERE ${r}.${this.ident('__rn')} > ${k} AND ${r}.${this.ident('__rn')} <= ${k} + ${n})`, x.cols, names.slice(0, x.cols.length));
  }

  // SUBSTITUTEWITHINDEX: the rows of the table joined to the index table's rows on the common
  // columns, a blank matching a blank, those columns replaced by the first matching row's
  // place, from 0.
  subIndex(x, scope) {
    const { sql, names } = this.ranked(x.idx, x.row, x.order, scope, 'ROW_NUMBER');
    const w = this.alias('x'), g = this.alias('n');
    const keys = x.on.map(([, j]) => `${w}.${this.ident(names[j])}`);
    const idx = `SELECT ${keys.map((k, j) => `${k} AS ${this.ident(`k${j}`)}`).join(', ')}, MIN(${w}.${this.ident('__rn')}) - 1 AS ${this.ident('i')} FROM (${sql}) AS ${w} GROUP BY ${keys.join(', ')}`;
    const b = this.wrap(this.table(x.src, scope));
    b.from += ` JOIN (${idx}) AS ${g} ON ${x.on.map(([i], j) => this.d.isNotDistinct(b.res.col(i), `${g}.${this.ident(`k${j}`)}`)).join(' AND ')}`;
    b.setOut(x.cols, [...x.rest.map(i => b.res.col(i)), `${g}.${this.ident('i')}`]);
    b.open = false;
    return b;
  }

  rowsBlock(x, scope) {
    if (x.rows.length === 1) return this.fusedRow(x, scope);
    const names = uniqNames(x.cols.map(c => c.name));
    if (!x.rows.length) {
      const b = new Block(this, null, x.cols);
      b.setOut(x.cols, x.cols.map(() => 'NULL'));
      b.where.push(this.d.never);
      b.open = false;
      return b;
    }
    const parts = x.rows.map(r => `SELECT ${r.map((v, i) => `${this.scalar(v, scope)} AS ${this.ident(names[i])}`).join(', ')}`);
    return this.fromSql(`(${parts.join(' UNION ALL ')})`, x.cols, names);
  }

  // Code that writes a CTE: it reads no row and fuses nothing.
  isolated(f) {
    this.fusions.push(null);
    try { return f(); } finally { this.fusions.pop(); }
  }

  // --- window functions -------------------------------------------------------------------

  // The relation's rows with their ordering values (__o<i>), partition values (__p<i>), and
  // their number in the partition (__rn, ties broken by every column), its size (__n), and
  // their rank (__rank, __drank).
  numbered(x, scope) {
    const b = this.wrap(this.table(x.rel, scope));
    const s2 = withRow(scope, x.row, b.res);
    const base = b.outList();
    const os = x.order.map(o => this.scalar(o.expr, s2)), ps = x.parts.map(p => this.scalar(p, s2));
    b.setOut([...x.rel.cols, ...os.map((_, i) => ({ name: `__o${i}` })), ...ps.map((_, i) => ({ name: `__p${i}` }))],
      [...base.map(o => o.sql), ...os, ...ps]);
    const names = b.names(), n = this.alias('w'), q = v => `${n}.${this.ident(v)}`;
    const part = ps.length ? `PARTITION BY ${ps.map((_, i) => q(`__p${i}`)).join(', ')} ` : '';
    const order = x.order.map((o, i) => orderTerm(this.d, q(`__o${i}`), o)).join(', ');
    const ties = x.rel.cols.map((_, i) => this.d.order(q(names[i]), 'ASC', 'FIRST')).join(', ');
    const num = `SELECT ${n}.*, ROW_NUMBER() OVER (${part}ORDER BY ${[order, ties].filter(Boolean).join(', ')}) AS ${this.ident('__rn')},
      COUNT(*) OVER (${part.trim()}) AS ${this.ident('__n')}, RANK() OVER (${part}ORDER BY ${order || ties}) AS ${this.ident('__rank')},
      DENSE_RANK() OVER (${part}ORDER BY ${order || ties}) AS ${this.ident('__drank')} FROM (${b.render()}) AS ${n}`;
    return { num, names };
  }

  // The rows of the numbered relation that are the current row: its columns hold the outer
  // values, and those with none hold a value they have in the filter context.
  currentRows(x, scope, num, names) {
    const y = this.alias('y'), q = i => `${y}.${this.ident(names[i])}`;
    const conds = x.match.map(m => this.d.isNotDistinct(q(m.i), this.scalar(m.val, scope)));
    if (x.unbound) {
      const u = this.isolated(() => this.table(x.unbound.table, scope)), un = u.names(), a = this.alias('u');
      conds.push(`EXISTS (SELECT 1 FROM (${u.render()}) AS ${a} WHERE ${x.unbound.idx.map((i, j) => this.d.isNotDistinct(`${a}.${this.ident(un[j])}`, q(i))).join(' AND ')})`);
    }
    return `SELECT * FROM (${num}) AS ${y}${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''}`;
  }

  // INDEX, OFFSET, WINDOW: the rows of the relation at the position, the offset or within the
  // window, in the current row's partition.
  windowRows(x, scope) {
    const { num, names } = this.numbered(x, scope);
    const r = this.alias('x'), c = this.alias('c');
    const xr = v => `${r}.${this.ident(v)}`, cr = v => `${c}.${this.ident(v)}`;
    const abs = v => `CASE WHEN ${v} > 0 THEN ${v} WHEN ${v} = 0 THEN 1 ELSE ${xr('__n')} + ${v} + 1 END`;
    let cond;
    if (x.fn === 'offset') cond = `${xr('__rn')} = ${cr('__rn')} + ${this.scalar(x.delta, scope)}`;
    else if (x.fn === 'index') {
      const p = this.scalar(x.pos, scope);
      cond = `${xr('__rn')} = CASE WHEN ${p} > 0 THEN ${p} WHEN ${p} < 0 THEN ${xr('__n')} + ${p} + 1 END`;
    } else {
      const f = this.scalar(x.from, scope), t = this.scalar(x.to, scope);
      cond = `${xr('__rn')} BETWEEN ${x.fromAbs ? abs(f) : `${cr('__rn')} + ${f}`} AND ${x.toAbs ? abs(t) : `${cr('__rn')} + ${t}`}`;
    }
    const sel = x.rel.cols.map((_, i) => xr(names[i])).join(', ');
    let sql;
    if (x.needCur) {
      const same = x.parts.map((_, i) => this.d.isNotDistinct(xr(`__p${i}`), cr(`__p${i}`)));
      let cur = this.currentRows(x, scope, num, names);
      // INDEX, and WINDOW with both ends absolute: once per current partition, not per row
      // of it (only the partition counts).
      if (x.fn === 'index' || x.fn === 'window' && x.fromAbs && x.toAbs) {
        const k = this.alias('k');
        cur = `SELECT DISTINCT ${x.parts.length ? x.parts.map((_, i) => `${k}.${this.ident(`__p${i}`)}`).join(', ') : '1 AS one'} FROM (${cur}) AS ${k}`;
      }
      sql = `SELECT ${sel} FROM (${num}) AS ${r} JOIN (${cur}) AS ${c} ON ${[...same, cond].join(' AND ')}`;
    } else sql = `SELECT ${sel} FROM (${num}) AS ${r} WHERE ${cond}`;
    return this.fromSql(`(${sql})`, x.rel.cols, names.slice(0, x.rel.cols.length));
  }

  // --- the filter context on a scan -------------------------------------------------------

  conds(table, ctx, res, scope, excluded = null) {
    if (!ctx.filters.length) return [];
    const state = this.model.state(ctx.mods);
    const exp = this.model.expand(table, state, excluded);
    const inExp = c => exp.has(c.table.name);
    const out = [];
    this.fusions.push(null);
    try {
      for (const f of ctx.filters) {
        const D = f.cols.filter(inExp);
        if (!D.length) continue;
        if (f.kind === 'bind') {
          if (f.implied && ctx.filters.includes(f.implied)) continue;
          const sides = [res.meta(D[0]), this.scalar(f.val, scope)];
          out.push(this.d.isNotDistinct(...sides));
          if (f.guard) out.push(paren(this.scalar(f.guard, scope, true)));
        }
        else if (f.kind === 'pred' && D.length === f.cols.length) out.push(paren(this.scalar(f.pred, withRow(scope, f.row, res), true)));
        else out.push(this.relCond(f.kind === 'pred' ? narrow(f, D) : f, D, table, res, scope, state));
      }
      // Filters that arrive over bidirectional and many-to-many relationships: X's rows the
      // filter context keeps, when it filters X at all. Row-level security alone is no such
      // filter (it reaches the scan as securityConds says), so whether X is filtered is
      // decided without it; the rows that filter are X's visible ones, with its blank row
      // when the context keeps it (it is blank in the key: the scan's blank row matches it).
      // X's rows whose key the scan's side lacks belong to that side's blank row: they keep
      // it (and the rows read through it), but for a blank row that only counts the table's
      // rows (res.unmatched).
      for (const name of exp.keys()) {
        for (const e of this.model.inbound(this.model.table(name), state)) {
          const X = e.there.table;
          if (exp.has(X.name) || excluded?.has(X.name)) continue;
          const skip = new Set([...(excluded ?? []), ...exp.keys()]);
          if (!this.unsecured(() => this.scanBlock(X, ctx, scope, skip)).where.length) continue;
          this.securityTree(this.model.table(name), e.rel, state);
          const key = b => { b.setOut([{ name: 'k', lineage: null }], [b.res.meta(e.there)]); return b.render(); };
          const sub = key(this.scanBlock(X, ctx, scope, skip));
          // A many-to-many relationship matches its columns' values, a blank meeting a blank: a
          // NULL stored on one side, or a blank row, meets one on the other.
          const mm = e.rel.fromCard === 'many' && e.rel.toCard === 'many';
          const here = res.meta(e.here), side = mm || this.blankSide(table, e.here, res, state);
          const blank = side && this.blankRow(X, ctx, scope, key, skip);
          const one = e.here === e.rel.to && e.rel.fromCard === 'many' && e.rel.toCard === 'one' && !e.rel.ri;
          const lacked = side && one && res.unmatched !== false && this.hasBlankRow(e.here.table)
            ? ` OR ${here} IS NULL AND ${this.lacking(e.rel.to, `(${sub})`)}` : '';
          const a = this.alias('r');
          if (!blank) {
            if (mm) { out.push(this.member([here], [`${a}.k`], `(${sub}) AS ${a}`, true, false)); continue; }
            out.push(lacked ? `(${here} IN (${sub})${lacked})` : `${here} IN (${sub})`);
            continue;
          }
          const s = this.member([here], [`${a}.k`], `(${sub} UNION ALL ${blank}) AS ${a}`, true);
          out.push(lacked ? `(${s}${lacked})` : s);
        }
      }
    } finally { this.fusions.pop(); }
    return out;
  }

  // A filter that comes back to `table` over `rel`, which a CROSSFILTER makes filter both ways,
  // from a table that row-level security filters: when a secured table reaches `table` that
  // way and another (it filters the fact table that filters it back, say), DAX raises an
  // error, as the tables that filter a table must join as a tree (model.securityPaths). The
  // way back is only taken when the query filters the fact table, so this is decided here.
  securityTree(table, rel, state) {
    const roles = this.options.security;
    if (!roles?.length || this.insecure) return;
    for (const f of roles.flatMap(r => r.filters)) {
      const two = this.model.securityPaths(f.table, table, state, rel);
      if (!two) continue;
      const path = p => p.map(t => `'${t.name}'`).join('->');
      throw semantic(`join paths must form a tree, but '${f.table.name}' has two join paths to '${table.name}' under row-level security: ${path(two[0])} and ${path(two[1])}`);
    }
  }

  // A filter that is a table, on the columns D of the scan's expanded table.
  relCond(f, D, table, res, scope, state) {
    if (!f.base) {
      const inline = this.inlineValues(f, D, table, res, scope, state) ?? this.listedValues(f, D, res);
      if (inline) return inline;
      const b = this.table(f.src, scope), names = b.names(), a = this.alias('r');
      const sel = D.map(c => `${a}.${this.ident(names[f.idx[f.cols.indexOf(c)]])}`);
      const blanks = D.some(c => (this.blankSide(table, c, res, state) || mayHoldNull(c)) && mayBeBlank(f.src, f.idx[f.cols.indexOf(c)]));
      return this.member(D.map(c => res.meta(c)), sel, `(${b.render()}) AS ${a}`, blanks, ir.freeRows(f.src).size > 0);
    }
    // Rows of a model table, as the scan's own rows: its conditions, inline.
    const chain = filterChain(f.src);
    const full = this.model.expand(f.base, state);
    // The filter holds every column, or (an engine that runs a correlated semi-join row by row:
    // a SUMMARIZE's extension columns took minutes on Fabric) every column but those its others
    // determine: a column of a table whose key it holds, and a calculated one of a table whose
    // stored columns it holds. A column a later filter replaced (the group's year) is one, so
    // the rows that agree with the filter's on its columns are the rows its conditions keep.
    // A related table's are, too, when its relationship's column on the table's side is: the
    // one row it names is fixed.
    const has = c => f.cols.includes(c), paths = this.model.expand(f.base, state, null, true);
    const fixedBy = c => c.table !== f.base && paths.get(c.table.name)?.length > 0 && stored(paths.get(c.table.name)[0].from);
    const stored = c => has(c) || c.expr && c.table.columns.every(x => x.expr || has(x));
    const determined = c => has(c) || !this.d.correlatedSemiJoin
      && (c.table.key && c.table.key !== c && has(c.table.key) || stored(c) || fixedBy(c));
    const whole = [...full.keys()].every(n => this.model.table(n).columns.every(determined));
    if (chain && table === f.base && whole) {
      const parts = [...this.conds(table, chain.scan.ctx, res, scope)];
      for (const p of chain.preds) parts.push(paren(this.scalar(p.pred, withRow(scope, p.row, res), true)));
      return parts.length ? parts.join(' AND ') : this.d.always;
    }
    // Otherwise matched on the keys of the tables both expanded tables hold whole, and on the
    // columns of the others.
    const tables = [...new Set(D.map(c => c.table))];
    const covered = tables.filter(V => V.key && V.columns.every(c => f.cols.includes(c)));
    const minimal = covered.filter(V => !covered.some(W => W !== V && this.model.expand(W, state).has(V.name)));
    const settled = new Set(minimal.flatMap(W => [...this.model.expand(W, state).keys()]));
    const cols = [...minimal.map(V => V.key), ...D.filter(c => !settled.has(c.table.name))];
    const b = this.open(this.table(f.src, scope));
    b.setOut(cols.map(c => ({ name: c.name, lineage: c })), cols.map(c => b.res.meta(c)));
    const a = this.alias('r'), names = b.names();
    // A column read through a relationship is blank for rows that match no row of its table;
    // one that may hold a NULL can be blank on both sides.
    const blanks = cols.some(c => mayHoldNull(c) || this.blankSide(table, c, res, state) && this.blankSide(f.base, c, null, state));
    return this.member(cols.map(c => res.meta(c)), names.map(n => `${a}.${this.ident(n)}`), `(${b.render()}) AS ${a}`, blanks, ir.freeRows(f.src).size > 0);
  }

  // Values of a table's columns, unfiltered but for conditions on those columns alone
  // (FILTER(ALL(T[c]), T[c] >= x)), as a filter on columns every row of the scan holds a
  // value of (its own, or a table's reached over relationships that rely on referential
  // integrity): the row's value is one of them when the conditions hold of it (and, read
  // through a relationship, it is not blank). The conditions are written on the scan's row,
  // with no subquery. Null when the filter is not of that kind.
  inlineValues(f, D, table, res, scope, state) {
    if (this.options.security?.length && !this.insecure) return null;
    const chain = valuesChain(f.src);
    if (!chain || chain.scan.ctx.filters.length) return null;
    const T = chain.scan.table;
    if (!chain.cols.every(c => c.lineage?.table === T && D.includes(c.lineage))) return null;
    if (D.some(c => this.blankSide(table, c, res, state))) return null;
    if (!chain.preds.every(p => plainOf(p.pred, p.row))) return null;
    const parts = chain.preds.map(p => {
      const r = { col: ref => res.meta(typeof ref === 'number' ? p.row.cols[ref].lineage : ref), meta: m => res.meta(m) };
      return paren(this.scalar(p.pred, withRow(scope, p.row, r), true));
    });
    // The scan's own column holds one of its values on every row, a NULL stored in it too.
    for (const c of D) if (c.table !== table) parts.push(`${res.meta(c)} IS NOT NULL`);
    return parts.join(' AND ');
  }

  // A table of constants on one column of the scan (TREATAS({"AR", "CA"}, T[c]), each slicer
  // of a Power BI visual) as a list: c IN ('AR', 'CA'), which the engine can read as it scans,
  // where IN (SELECT ...) is a semi-join. A BLANK() among them keeps the blank. Null when the
  // filter is not of that kind, or a constant is of another type than the column's.
  listedValues(f, D, res) {
    if (D.length !== 1) return null;
    let src = f.src;
    while (src.k === 'shared' || src.k === 'distinct') src = src.src;
    if (src.k !== 'rows') return null;
    const c = D[0], i = f.idx[f.cols.indexOf(c)];
    const vals = src.rows.map(r => r[i]);
    const kind = t => (ir.isNum(t) ? 'num' : t);
    if (!vals.every(v => v?.k === 'lit' && (v.v === null || kind(v.t) === kind(c.type)))) return null;
    const listed = vals.filter(v => v.v !== null), L = res.meta(c);
    const sqls = listed.map(v => this.d.literal(v.v, v.t));
    const s = sqls.length ? `${L} IN (${sqls.join(', ')})` : this.d.never;
    return listed.length < vals.length ? `(${s} OR ${L} IS NULL)` : s;
  }

  // Whether a scan of `table` can read a blank in column c: on its blank row, or through a
  // relationship (not relying on referential integrity) for rows that match no row of c's
  // table. (A NULL stored in a column is mayHoldNull's.)
  blankSide(table, c, res, state) {
    if (res?.blankRow) return true;
    if (c.table === table) return false;
    const path = this.model.expand(table, state, null, true).get(c.table.name);
    return !path || path.some(h => !(h.rel.ri || this.options.assumeIntegrity));
  }

  // Whether the values `left` are a row of `from` (its columns `right`), a blank matching a
  // blank as in DAX. IN for one column that cannot be blank on both sides; one that can, IN or
  // else a blank in `from` (as fast as IN when `from` reads no outer row); EXISTS otherwise.
  member(left, right, from, blanks = false, correlated = true) {
    if (left.length === 1 && !blanks) return `${left[0]} IN (SELECT ${right[0]} FROM ${from})`;
    if (left.length === 1 && !correlated)
      return `(${left[0]} IN (SELECT ${right[0]} FROM ${from}) OR ${left[0]} IS NULL AND EXISTS (SELECT 1 FROM ${from} WHERE ${right[0]} IS NULL))`;
    return `EXISTS (SELECT 1 FROM ${from} WHERE ${left.map((l, i) => this.d.isNotDistinct(right[i], l)).join(' AND ')})`;
  }

  // --- scalars ---------------------------------------------------------------------------

  // A value, or with `pred` a condition. Where a condition is no value (T-SQL has no boolean
  // type), a boolean is converted to what is asked for: scalarOf writes a condition for the
  // kinds of node isCond names, and a value for the others.
  scalar(x, scope, pred = false) {
    const s = this.scalarOf(x, scope, pred);
    if (this.d.boolValues || x.t !== 'bool') return s;
    return pred === isCond(x, this) ? s : pred ? this.d.cond(s) : this.d.value(s);
  }

  scalarOf(x, scope, pred) {
    if (x.shared && !this.inCte && !ir.freeRows(x).size) return this.sharedScalar(x);
    switch (x.k) {
      case 'lit': return this.d.literal(x.v, x.t);
      case 'col': {
        const res = scope.get(x.row.id);
        if (!res) throw new Error(`emit: no row ${x.row.id} in scope`);
        return res.col(x.ref);
      }
      case 'op': return this.op(x, scope, pred);
      case 'fn': {
        // Values of different kinds together (a number or a text): as text.
        const as = x.t === 'variant' && ['coalesce', 'greatest', 'least'].includes(x.name) ? v => this.variant(v, scope) : v => this.scalar(v, scope);
        return this.d.fn(x.name, x.a.map(as), x.a);
      }
      case 'case': {
        const val = v => (x.t === 'variant' ? this.variant(v, scope) : this.scalar(v, scope));
        // In this order, which numbers their aliases.
        const conds = [], vals = [];
        for (const [c, v] of x.w) { conds.push(this.scalar(c, scope, true)); vals.push(val(v)); }
        if (!(x.e.k === 'lit' && x.e.v === null)) vals.push(val(x.e));
        // An engine that leaves a subquery in a branch correlated (Fabric: a RANKX took 24 s,
        // and 0.5 s so): the branches' values are a row of their own, which the CASE reads.
        let from = '';
        if (!this.d.subqueryInCase && vals.some(isQuery)) {
          const h = this.alias('h'), hoisted = vals.map((v, i) => (isQuery(v) ? i : -1)).filter(i => i >= 0);
          from = ` FROM (SELECT ${hoisted.map(i => `${vals[i]} AS ${this.ident(`v${i}`)}`).join(', ')}) AS ${h}`;
          for (const i of hoisted) vals[i] = `${h}.${this.ident(`v${i}`)}`;
        }
        const w = conds.map((c, i) => `WHEN ${c} THEN ${vals[i]}`).join(' ');
        const e = vals.length > conds.length ? ` ELSE ${vals.at(-1)}` : '';
        return from ? `(SELECT CASE ${w}${e} END${from})` : `CASE ${w}${e} END`;
      }
      case 'agg': return this.agg(x, scope);
      case 'exists': return `EXISTS (${this.isolated(() => this.table(x.src, scope).render())})`;
      case 'wrank': {
        const { num, names } = this.numbered(x, scope);
        const cur = this.currentRows(x, scope, num, names);
        // One current row, its rank; several (rows that differ, or ROWNUMBER's equal rows)
        // give no value, even when they tie in the order.
        const c = this.alias('c'), col = x.fn === 'rownumber' ? '__rn' : x.dense ? '__drank' : '__rank';
        const cols = [...names.slice(0, x.rel.cols.length), col].map(n => `${c}.${this.ident(n)}`).join(', ');
        const d = this.alias('d');
        return `(SELECT CASE WHEN COUNT(*) = 1 THEN MIN(${d}.${col}) END FROM (SELECT DISTINCT ${cols} FROM (${cur}) AS ${c}) AS ${d})`;
      }
      case 'blankexists': {
        const sql = this.blankRow(x.table, x.ctx, scope, b => { b.setOut([{ name: 'one', lineage: null }], ['1']); return b.render(); }, null, x.unmatched !== false);
        return sql ? `EXISTS (${sql})` : this.d.never;
      }
      case 'insub': {
        const b = this.isolated(() => this.table(x.src, scope)), names = b.names(), a = this.alias('i');
        const blanks = x.e.some((e, j) => !e.nn && mayBeBlank(x.src, j));
        const s = this.member(x.e.map(e => this.scalar(e, scope)), names.map(n => `${a}.${this.ident(n)}`), `(${b.render()}) AS ${a}`, blanks, ir.freeRows(x.src).size > 0);
        return pred ? `(${s})` : this.d.orFalse(s);
      }
    }
    throw new Error(`emit: scalar ${x.k}`);
  }

  // The subqueries of a row's values (`sqls`, changed in place) that read a table and are
  // written more than once, as the same SQL up to the aliases they declare (a measure in a
  // column and again in another's DIVIDE): each one once, a column of a row the values read,
  // returned as the APPLY that is that row. One that reads an alias the value declares around
  // it stays.
  hoistRepeats(sqls) {
    // Values written out in megabytes (calculation groups crossed, each item's CASE holding
    // the others') are left as they are: finding their subqueries costs more than it saves.
    if (sqls.reduce((n, s) => n + s.length, 0) > HOIST_LIMIT) return '';
    const count = new Map();
    for (const s of sqls) {
      const all = subqueries(s);
      for (const q of all) if (hoistable(s, q, all)) count.set(q.key, (count.get(q.key) ?? 0) + 1);
    }
    const keys = [...count].filter(([key, n]) => n > 1 && /\bFROM "/.test(key)).map(([key]) => key);
    if (!keys.length) return '';
    // The longest first: one inside another goes with it.
    keys.sort((a, b) => b.length - a.length);
    const u = this.alias('u'), cols = [];
    for (const key of keys) {
      let first = null;
      for (let i = 0; i < sqls.length; i++) {
        const all = subqueries(sqls[i]), qs = all.filter(q => q.key === key && hoistable(sqls[i], q, all));
        if (!qs.length) continue;
        first ??= qs[0].sql;
        let s = sqls[i];
        for (const q of qs.reverse()) s = `${s.slice(0, q.start)}${u}.${this.ident(`m${cols.length}`)}${s.slice(q.end)}`;
        sqls[i] = s;
      }
      if (first) cols.push(`${first} AS ${this.ident(`m${cols.length}`)}`);
    }
    return this.d.lateral(`SELECT ${cols.join(', ')}`, u, true);
  }

  // A value among values of other kinds, as text.
  variant(v, scope) {
    const s = this.scalar(v, scope);
    return v.t === 'string' || v.t === 'blank' ? s : this.d.text(s, v.t);
  }

  // A value in arithmetic: a whole-number constant as a 64-bit one, as DAX computes, and a
  // whole-number column too (stored as 32 bits, a product of two would overflow).
  num(v, scope) {
    if (v.k === 'lit' && v.t === 'int') return this.d.bigint(v.v);
    return v.k === 'col' && v.t === 'int' ? this.d.cast(this.scalar(v, scope), 'int') : this.scalar(v, scope);
  }

  // A variable that reads nothing outside itself: one CTE, read where it is named. It is a
  // ROW of one value, so its aggregates are fused as ROW's are.
  sharedScalar(x) {
    let name = this.memo.get(x);
    if (!name) {
      name = this.alias('v');
      this.inCte = true;
      const fusion = new Fusion(this, null, [], []);
      this.fusions.push(fusion);
      let sql;
      try { sql = this.scalar({ ...x, shared: false }, new Map()); } finally { this.fusions.pop(); this.inCte = false; }
      const mark = this.ctes.length;
      const groups = fusion.finish();
      const from = groups.length ? ` FROM ${groups.map(g => g.alias).join(' CROSS JOIN ')}` : '';
      const body = `(SELECT ${sql} AS v${from})`;
      // The same value (its CTEs and its SELECT, up to their names) named again elsewhere in
      // the query, through another measure: the CTE already written.
      const own = new Map(groups.map((g, i) => [g.alias, `g${i}`]));
      const key = `shared|${canonical(renameAliases([...this.ctes.slice(mark), body].join('; '), own))}`;
      const same = this.memo.get(key);
      if (same) {
        this.ctes.length = mark;
        name = same;
      } else {
        this.ctes.push(`${name} AS ${this.d.materialized}${body}`);
        this.memo.set(key, name);
      }
      this.memo.set(x, name);
    }
    return `(SELECT v FROM ${name})`;
  }

  op(x, scope, pred) {
    const [l, r] = x.a;
    const S = (v, p = false) => this.scalar(v, scope, p);
    const d = this.d;
    switch (x.op) {
      case 'add': case 'sub': {
        const sub = x.op === 'sub';
        const date = t => t === 'datetime' || t === 'date';
        if (date(l.t) && ir.isNum(r.t)) return d.fn('add_interval', [S(l), sub ? `-(${S(r)})` : S(r), "'day'"]);
        if (!sub && ir.isNum(l.t) && date(r.t)) return d.fn('add_interval', [S(r), S(l), "'day'"]);
        if (sub && date(l.t) && date(r.t)) return d.fn('datediff', [S(r), S(l), "'day'"]);
        if (date(l.t) && date(r.t)) return d.fn('add_datetimes', [S(l), S(r)]);
        const N = v => this.num(v, scope);
        if (l.nn && r.nn) return `(${N(l)} ${sub ? '-' : '+'} ${N(r)})`;
        if (l.nn) return `(${N(l)} ${sub ? '-' : '+'} COALESCE(${S(r)}, 0))`;
        if (r.nn) return `(COALESCE(${S(l)}, 0) ${sub ? '-' : '+'} ${N(r)})`;
        return d.blankAdd(S(l), S(r), sub);
      }
      case 'mul': return `(${this.num(l, scope)} * ${this.num(r, scope)})`;
      // x / BLANK() is x / 0: infinity (or NaN), not blank; BLANK() / x is blank.
      case 'div': return d.div(S(l), r.nn ? S(r) : `COALESCE(${S(r)}, 0)`);
      case 'pow': return d.fn('power', [S(l), S(r)]);
      case 'neg': return `(-${this.num(l, scope)})`;
      case 'eq': case 'ne': case 'lt': case 'le': case 'gt': case 'ge': return this.compare(x.op, l, r, scope, pred);
      case 'eqs': return `(${d.isNotDistinct(S(l), S(r))})`;
      case 'and': return `(${this.bool(l, scope, pred)} AND ${this.bool(r, scope, pred)})`;
      case 'or': return `(${this.bool(l, scope, pred)} OR ${this.bool(r, scope, pred)})`;
      case 'not': return `(NOT ${this.bool(l, scope, false)})`;
      case 'bool': return this.bool(l, scope, pred);
      case 'concat': {
        const t = v => (v.nn ? d.text(S(v), v.t) : `COALESCE(${d.text(S(v), v.t)}, '')`);
        return d.concat(t(l), t(r));
      }
      case 'in': {
        const vals = x.a.slice(1), blank = vals.some(v => v.k === 'lit' && v.v === null);
        const listed = vals.filter(v => !(v.k === 'lit' && v.v === null));
        const L = S(l), list = listed.map(v => S(v));
        let s = list.length ? `${L} IN (${list.join(', ')})` : d.never;
        if (blank) s = `(${s} OR ${L} IS NULL)`;
        return pred || blank ? `(${s})` : d.orFalse(s);
      }
    }
    throw new Error(`emit: op ${x.op}`);
  }

  // A value as a condition: blank is FALSE, a number is its being other than 0.
  bool(v, scope, pred) {
    // Where a condition is no value: the condition, FALSE where it is unknown.
    if (v.t === 'bool' && !this.d.boolValues) {
      const c = this.scalar(v, scope, true);
      return v.nn || pred ? c : this.d.orFalse(c);
    }
    const s = this.scalar(v, scope, pred);
    if (v.t === 'bool' || v.t === 'blank') return v.nn || pred ? s : this.d.orFalse(s);
    if (ir.isNum(v.t)) return `(COALESCE(${s}, 0) <> 0)`;
    if (v.t === 'variant') return v.nn || pred ? s : this.d.orFalse(s);
    throw semantic(`a ${v.t} cannot be used as TRUE/FALSE`);
  }

  // DAX compares a blank as the other side's default (0, "", FALSE); a comparison is never
  // blank. Text is compared as the engine compares it (by case). Against a constant, the column
  // is compared as it is and the blank case added.
  compare(o, l, r, scope, pred) {
    const sym = { eq: '=', ne: '<>', lt: '<', le: '<=', gt: '>', ge: '>=' }[o];
    const t = [l.t, r.t].find(x => x !== 'blank' && x !== 'variant') ?? 'int';
    const L = this.scalar(l, scope), R = this.scalar(r, scope);
    if (l.nn && r.nn) return `(${L} ${sym} ${R})`;
    const constant = (v, side) => v.k === 'lit' && v.v !== null ? side : null;
    const litSide = constant(r, 'r') ?? constant(l, 'l');
    if (litSide) {
      const [lit, col, colSql, litSql] = litSide === 'r' ? [r, l, L, R] : [l, r, R, L];
      const blankHolds = compareJs(o, ...(litSide === 'r' ? [blankOf(t), lit.v] : [lit.v, blankOf(t)]));
      const c = litSide === 'r' ? `${colSql} ${sym} ${litSql}` : `${litSql} ${sym} ${colSql}`;
      if (blankHolds) {
        const s = `(${c} OR ${colSql} IS NULL)`;
        this.nullArms.set(s, { base: `(${c})`, col: colSql });
        return s;
      }
      if (!pred) return this.d.orFalse(c);
      this.rejects.set(`(${c})`, colSql);
      return `(${c})`;
    }
    const z = this.d.blankOf(t);
    const side = (v, s) => (v.nn ? s : v.k === 'lit' && v.v === null ? z : `COALESCE(${s}, ${z})`);
    return `(${side(l, L)} ${sym} ${side(r, R)})`;
  }

  // --- aggregates --------------------------------------------------------------------------

  agg(x, scope) {
    const fusion = this.fusions.at(-1);
    if (fusion) {
      const s = fusion.add(x, scope);
      if (s) return s;
    }
    if (x.src.k === 'currentgroup') return this.aggExpr(x, scope);
    // A subquery: what it holds is not fused (SQL would read an aggregate of a column of the
    // outer query as the outer query's aggregate).
    const sql = this.isolated(() => {
      const b = this.open(this.table(x.src, scope));
      const s2 = withRow(scope, x.row, b.res);
      if (x.fn === 'single') {
        b.setOut([{ name: 'v', lineage: null }], [this.scalar(x.arg, s2)]);
        return b.render();
      }
      const p = this.rowFused(b, x.src, x.row, () => this.aggParts(x, s2));
      const grouped = ir.freeRows(x).size ? this.groupedFirst(b, p, x.src.base ?? null) : null;
      if (grouped) {
        b.setOut([{ name: 'v', lineage: null }], [grouped]);
        return b.render();
      }
      // T-SQL takes neither a subquery in an aggregate, nor a column of the outer query beside
      // its own: anything but a column is computed a row at a time first.
      if (this.d.aggOverSubquery || !partsQuery(p) && [p.arg, ...(p.keys ?? []).map(k => k.sql)].every(plainCol)) {
        b.setOut([{ name: 'v', lineage: null }], [this.d.agg(p.fn, p.arg, p.extra)]);
        return b.render();
      }
      // An engine that aggregates no subquery (T-SQL): the argument a column of the rows, and
      // the aggregate over a SELECT of them.
      const cols = [p.arg ?? '1', ...(p.keys ?? []).map(k => k.sql)];
      b.setOut(cols.map((_, i) => ({ name: `x${i}`, lineage: null })), cols);
      const w = this.wrap(b);
      w.setOut([{ name: 'v', lineage: null }], [this.d.agg(p.fn, p.arg == null ? null : w.res.col(0), aroundExtra(this, p, i => w.res.col(i)))]);
      return w.render();
    });
    return ir.freeRows(x).size ? `(${sql})` : this.once(sql);
  }

  // What f writes for each row of block b (row `row`, of table `src`): on an engine that leaves a correlated
  // subquery a loop (Fabric's optimizer gives up on a few RANKX: 0.5 s with two, 20 s with
  // three), the aggregates a row's expressions take over its own values (a measure in a context
  // transition) are fused as SUMMARIZECOLUMNS' are, one GROUP BY each, joined to the rows.
  // Only rows that read no outer row: their GROUP BY is then written once, where one inside a
  // correlated subquery is written again for each outer row (a CTE is not kept).
  rowFused(b, src, row, f) {
    // A row of a few columns (VALUES, ALL, SUMMARIZE of some): a whole fact row is a GROUP BY by
    // every column, slower than the loop (8 s, and over a minute so).
    if (!this.d.fuseRows || !row?.cols.length || row.cols.length > 4 || row.cols.some(c => !c.lineage) || ir.freeRows(src).size) return f();
    const keyCols = row.cols.map(c => c.lineage);
    const fusion = new Fusion(this, row, keyCols.map((_, i) => i), keyCols);
    fusion.ofRows = true;
    this.fusions.push(fusion);
    let out;
    try { out = f(); } finally { this.fusions.pop(); }
    for (const g of fusion.finish()) {
      const on = g.keys.map((ki, j) => this.d.isNotDistinct(`${g.alias}.g${j}`, b.res.col(ki)));
      b.joins.push(`LEFT JOIN ${g.alias} ON ${on.length ? on.join(' AND ') : this.d.always}`);
    }
    return out;
  }

  // An aggregate that reads the row around it (block b, parts p), over a table's rows grouped
  // first, or null to write it as it is. Each outer row otherwise reads the table's every row:
  // last year's sales by month is the fact joined to its dates for each month (12 s over a
  // million rows; 0.1 s so). The table is grouped once, in a CTE, by the columns of its own that
  // the joins and the conditions on other rows read (its date key), under the conditions on its
  // own columns alone; the aggregate then adds up those groups (Fusion.belowJoins, for a
  // group's CTE). For sums, counts, minima and maxima of the table's own columns, over joins
  // to the one side, by three columns at most.
  groupedFirst(b, p, table) {
    const base = isQuery(b.from) ? null : / AS (\w+)$/.exec(b.from ?? '')?.[1];
    if (!this.d.aggBelowJoins || !base || !OVER[p.fn] || partsQuery(p) || p.keys?.length || p.extra?.filter) return null;
    if (b.group || b.distinct || b.qualify || !b.joins.every(j => b.hops?.has(j))) return null;
    const aliases = sql => sql.split(/('(?:[^']|'')*')/).flatMap((part, i) => (i % 2 ? [] : [...part.matchAll(/\b([a-z]\d+)\./g)].map(m => m[1])));
    const ownOnly = sql => !isQuery(sql) && aliases(sql).every(a => a === base);
    if (p.arg != null && !ownOnly(p.arg)) return null;
    const outer = b.where.filter(c => !ownOnly(c)), around = [...b.joins, ...outer];
    const own = new RegExp(`\\b${base}\\.(?:"(?:[^"]|"")*"|\\[(?:[^\\]]|\\]\\])*\\])`, 'g');
    const cols = [...new Set(around.flatMap(sql => sql.match(own) ?? []))];
    if (!cols.length || cols.length > 3 || around.some(sql => aliases(sql.replace(own, '')).includes(base))) return null;
    // By more than one column only where a condition is a set of values (the dates of last
    // year): rows that each name one value of every column (a customer and a day) find their
    // few rows faster in the table itself (0.6 s; 7 s in its groups).
    if (cols.length > 1 && !outer.some(isQuery)) return null;
    // Not by a column that names one row (the table's key, the one side of a relationship): its
    // groups are its rows.
    const unique = table ? [table.key, ...this.model.oneSides(table).map(o => o.one)].filter(Boolean).map(c => `${base}.${this.ident(c.source)}`) : [];
    if (cols.some(c => unique.includes(c))) return null;
    const v = this.ident('dax_a'), inner = b.where.filter(ownOnly);
    const sql = `SELECT ${cols.join(', ')}, ${this.d.agg(p.fn, p.arg, p.extra)} AS ${v} FROM ${b.from}${inner.length ? ` WHERE ${inner.join(' AND ')}` : ''} GROUP BY ${cols.join(', ')}`;
    const key = `grouped|${canonical(sql)}`;
    let name = this.memo.get(key);
    if (!name) {
      name = this.alias('p');
      this.ctes.push(`${name} AS ${this.d.materialized}(${sql})`);
      this.memo.set(key, name);
    }
    b.from = `${name} AS ${base}`;
    b.where = outer;
    // A sum of floating-point groups in their own order: the same to the last digit wherever
    // the measure is written again (a RANKX's row and the rows it ranks), whatever order the
    // engine's threads read the groups in.
    const exact = p.fn === 'sum' && p.extra?.t !== 'int' && p.extra?.t !== 'decimal';
    return exact ? `SUM(${base}.${v} ORDER BY ${base}.${v})` : OVER[p.fn](`${base}.${v}`);
  }

  // A subquery that reads nothing of the query around it, written once: the same SQL (up to
  // its aliases) anywhere in the query is one CTE.
  once(sql) {
    const key = `once|${canonical(sql)}`;
    let name = this.memo.get(key);
    if (!name) {
      name = this.alias('o');
      this.ctes.push(`${name} AS ${this.d.materialized}(${sql})`);
      this.memo.set(key, name);
    }
    return `(SELECT v FROM ${name})`;
  }

  aggExpr(x, scope) {
    const p = this.aggParts(x, scope);
    return this.d.agg(p.fn, p.arg, p.extra);
  }

  // What an aggregate is written from: its function, its argument and the rest, as SQL.
  aggParts(x, scope) {
    // A sum of fixed decimals: the range checked on the largest, not on every row.
    if (x.fn === 'sum' && x.arg?.k === 'fn' && x.arg.name === 'currency' && this.d.sumCurrency)
      return { fn: 'sum_currency', arg: this.scalar(x.arg.a[0], scope), extra: {} };
    const arg = x.arg ? this.scalar(x.arg, scope) : null;
    // `t`, its argument's type: an engine adds up floating-point values its own way (tsql.js).
    const extra = { t: x.arg?.t };
    if (x.fn === 'concat') {
      extra.delim = this.scalar(x.a[0], scope);
      const keys = (x.order ?? []).map(o => ({ sql: this.scalar(o.expr, scope), desc: o.desc }));
      extra.order = keys.map(k => this.orderBy(k.sql, k.desc));
      return { fn: 'concat', arg: this.d.text(arg, x.arg.t), extra, keys };
    }
    if (/^pctx?_/.test(x.fn)) extra.k = this.scalar(x.a[0], scope);
    return { fn: x.fn, arg, extra };
  }

  // --- SUMMARIZECOLUMNS ----------------------------------------------------------------

  summarizeColumns(x, scope) {
    const keyNames = uniqNames(x.keyCols.map(c => c.name));
    const flagNames = x.rolls.map(r => r.flag), itemNames = x.levels[0].items.map(i => i.name);
    const names = uniqNames([...keyNames, ...flagNames, ...itemNames]);
    // The levels' fused groups are written once every level is known: a subtotal level reads
    // the groups of the levels before it (Fusion.over) and can add aggregates to them.
    const fusions = [];
    const levels = x.levels.map(L => this.level(x, L, scope, names, keyNames, fusions));
    for (const f of fusions) f.finish();
    return this.fromSql(levels.length === 1 ? `(${levels[0]})` : `(${levels.join(' UNION ALL ')})`, x.cols, names);
  }

  // One level of SUMMARIZECOLUMNS. `fusions`: those of the levels before it; this level's is
  // added, for the caller to finish.
  level(x, L, scope, names, keyNames, fusions) {
    const k = this.alias('k');
    const active = L.active.map(c => x.keyCols.indexOf(c));
    const keyRes = new WrapRes(this, null, x.keyCols.map((c, i) => ({ sql: `${k}.${this.ident(keyNames[i])}`, lineage: c })), this.model.state(x.ctx0.mods));
    // The filters that decide which combinations of the keys there are (keyFilters).
    const keyTables = new Set(L.active.map(c => c.table));
    const domain = [...new Set([...keyTables].flatMap(t => this.keyFilters(x, t).map(f => f.of)))];
    const fusion = new Fusion(this, x.keyRow, active, x.keyCols, domain, [...fusions]);
    fusions.push(fusion);
    this.fusions.push(fusion);
    let items;
    try { items = L.items.map(i => this.scalar(i.expr, withRow(scope, x.keyRow, keyRes))); } finally { this.fusions.pop(); }
    const groupsSql = fusion.groups;

    // The groups: from the fused aggregates when every expression is blank without their
    // rows, and those rows are under all the filters that decide the combinations (an
    // expression that removed one, REMOVEFILTERS in a CALCULATE, has rows of groups that
    // SUMMARIZECOLUMNS does not have); else every combination of the keys' values.
    const counted = L.items.filter(i => !i.ignore);
    let keys, from = null;
    const supports = counted.map(i => support(i.expr, this.fusedIn));
    const full = g => g.keys.length === active.length && !g.outside;
    if (active.length && counted.length && supports.every(s => s && [...s].every(full))) {
      const gs = [...new Set(supports.flatMap(s => [...s]))];
      const cols = g => active.map(ki => `${g.alias}.g${g.keys.indexOf(ki)} AS ${this.ident(keyNames[ki])}`).join(', ');
      keys = gs.length
        ? gs.map(g => `SELECT ${cols(g)} FROM ${g.alias}`).join(' UNION ')
        : `SELECT ${active.map(ki => `NULL AS ${this.ident(keyNames[ki])}`).join(', ')} WHERE ${this.d.never}`;
      // One group, whose keys are distinct (its GROUP BY): its rows are the groups, read once
      // where the engine reads a CTE again at each name (T-SQL), not joined to themselves.
      if (gs.length === 1 && this.d.repeats) from = { g: gs[0], sql: `${gs[0].alias}${this.d.lateral(`SELECT ${cols(gs[0])}`, k, false)}` };
    } else if (active.length) {
      keys = this.keyCombinations(x, L, keyNames, scope);
    } else keys = 'SELECT 1 AS one';

    const apply = this.d.repeats ? this.hoistRepeats(items) : '';
    const sel = [
      ...x.keyCols.map((_, i) => `${active.includes(i) ? `${k}.${this.ident(keyNames[i])}` : 'NULL'} AS ${this.ident(names[i])}`),
      ...L.flags.map((f, i) => `${this.d.bool(f)} AS ${this.ident(names[x.keyCols.length + i])}`),
      ...items.map((s, i) => `${s} AS ${this.ident(names[x.keyCols.length + L.flags.length + i])}`),
    ];
    const joins = groupsSql.filter(g => g !== from?.g).map(g => ` LEFT JOIN ${g.alias} ON ${g.on(k, keyNames)}`).join('');
    let sql = `SELECT ${sel.join(', ')} FROM ${from ? from.sql : `(${keys}) AS ${k}`}${joins}${apply}`;
    if (counted.length) {
      const z = this.alias('z');
      const test = L.items.map((it, i) => it.ignore ? null : `${z}.${this.ident(names[x.keyCols.length + L.flags.length + i])} IS NOT NULL`).filter(Boolean);
      sql = `SELECT * FROM (${sql}) AS ${z} WHERE ${test.join(' OR ')}`;
    }
    return sql;
  }

  // The filters that decide which values the grouping columns of table t take: those that
  // SUMMARIZECOLUMNS' filter arguments put on t's own columns (auto-exist), and those of the
  // context around it that reach t. An argument's filter on another table does not, even
  // when it reaches t: grouped by Product[Name] under a filter on Category[Category], every
  // product is a group, and one goes only when its expressions are all blank. Each is { f, of }: the
  // filter, narrowed to t's columns when it is on others' too, and the filter it comes from.
  keyFilters(x, t) {
    const state = this.model.state(x.ctx0.mods), out = [];
    for (const f of x.ctx0.filters) {
      if (x.outer.includes(f)) {
        if (f.cols.some(c => this.model.reaches(c.table, t, state))) out.push({ f, of: f });
      } else if (f.kind === 'rel' && f.base) {
        if (f.base === t) out.push({ f, of: f });
      } else {
        const own = f.cols.filter(c => c.table === t);
        if (own.length) out.push({ f: own.length === f.cols.length ? f : narrow(f, own), of: f });
      }
    }
    return out;
  }

  // Every combination of the grouping columns' values: within a table those it holds, under
  // the filters on it (keyFilters); across tables, all.
  keyCombinations(x, L, keyNames, scope) {
    const byTable = new Map();
    for (const c of L.active) {
      if (!byTable.has(c.table)) byTable.set(c.table, []);
      byTable.get(c.table).push(c);
    }
    const parts = [...byTable].map(([t, cols]) => {
      const out = b => {
        b.setOut(cols.map(c => ({ name: keyNames[x.keyCols.indexOf(c)], lineage: c })), cols.map(c => b.res.meta(c)));
        b.distinct = true;
        return b.render();
      };
      const ctx = new Ctx(this.keyFilters(x, t).map(k => k.f), x.ctx0.mods);
      const rows = out(this.isolated(() => this.scanBlock(t, ctx, scope)));
      const blank = this.blankRow(t, ctx, scope, out);
      return blank ? `${rows} UNION ${blank}` : rows;
    });
    if (parts.length === 1) return parts[0];
    return `SELECT * FROM ${parts.map(p => `(${p}) AS ${this.alias('c')}`).join(' CROSS JOIN ')}`;
  }

  // The blank row DAX adds to a table on the one side of a relationship when rows of the
  // many side match none of its rows: with the filters on it (it is blank in every column),
  // when there are such rows. None where the relationship relies on referential integrity.
  // `excluded`: as scanBlock's. `unmatched`: whether a filter that comes back from a many side
  // keeps the row when the many side's rows it keeps have keys the table lacks (VALUES), or
  // never (DISTINCTCOUNT: those rows filter the table's rows by their keys, and the blank
  // row's is none of them).
  blankRow(table, ctx, scope, out, excluded = null, unmatched = true) {
    if (!this.hasBlankRow(table)) return null;
    const nulls = table.columns.filter(c => !c.expr).map(c => `${c.type === 'variant' ? 'NULL' : this.d.cast('NULL', c.type)} AS ${this.ident(c.source)}`);
    const b = this.isolated(() => this.scanBlock(table, ctx, scope, excluded, null, `(SELECT ${nulls.join(', ')})`, unmatched));
    b.where.push(`(${this.orphans(table, this.model.state(ctx.mods))})`);
    this.blanks = true;
    return out(b);
  }

  // Whether a table can have a blank row: it is the one side of a relationship that does not
  // rely on referential integrity (model.oneSides).
  hasBlankRow(table) {
    if (this.options.blankRows === false || this.options.assumeIntegrity) return false;
    return this.model.oneSides(table).length > 0;
  }

  // Whether some of `keys` (SQL of rows with the column k) is a key that `one` (the one side of
  // a relationship) lacks: those rows belong to its table's blank row.
  lacking(one, keys) {
    const f = this.alias('o'), d = this.alias('o'), k = this.stored(d, one);
    this.checks++;
    try {
      return `EXISTS (SELECT 1 FROM ${keys} AS ${f} LEFT JOIN ${this.source(one.table)} AS ${d} ON ${k} = ${f}.k WHERE ${d}.${this.ident(one.source)} IS NULL)`;
    } finally { this.checks--; }
  }

  // Whether the table has a blank row: some row on the other side of a relationship it is the
  // one side of has a key it lacks, or that table has a blank row itself (whose key matches
  // nothing: a sale of an unknown product is in the blank category too). Whether the row is
  // there is the model's, as at refresh: row-level security, which filters the rows, does not
  // remove it. But over a relationship that filters the table back from that side (`state`:
  // both ways, CROSSFILTER), the row is reached through that side's rows, so there the rows
  // are those security keeps: a row it removes puts no blank row in the table.
  orphans(table, state, seen = new Set()) {
    this.checks++;
    try { return this.orphanChecks(table, state, seen); } finally { this.checks--; }
  }

  orphanChecks(table, state, seen) {
    seen.add(table);
    const parts = [];
    const back = rel => state.some(s => s.rel === rel && s.active && (s.cross === 'both' || s.cross === 'reverse'));
    for (const { rel, one, many } of this.model.oneSides(table)) {
      const o = this.alias('o');
      let keys = `(SELECT ${this.stored(o, many)} AS k FROM ${this.source(many.table)} AS ${o})`;
      if (this.options.security?.length && !this.insecure && back(rel)) {
        const b = this.isolated(() => this.scanBlock(many.table, EMPTY, new Map()));
        b.setOut([{ name: 'k', lineage: null }], [b.res.meta(many)]);
        keys = `(${b.render()})`;
      }
      parts.push(this.lacking(one, keys));
      if (!seen.has(many.table)) {
        const inner = this.orphanChecks(many.table, state, seen);
        if (inner) parts.push(inner);
      }
    }
    return parts.join(' OR ');
  }

  // ROW(...): one row, its aggregates fused where they can be.
  fusedRow(x, scope) {
    const fusion = new Fusion(this, null, [], []);
    this.fusions.push(fusion);
    let vals;
    try { vals = x.rows[0].map(v => this.scalar(v, scope)); } finally { this.fusions.pop(); }
    const groups = fusion.finish();
    const names = uniqNames(x.cols.map(c => c.name));
    const b = new Block(this, groups.length ? groups.map(g => g.alias).join(' CROSS JOIN ') : null, x.cols);
    b.setOut(x.cols, vals);
    b.open = false;
    b._names = names;
    return b;
  }
}

// --- fusion --------------------------------------------------------------------------------

// The aggregates of one SUMMARIZECOLUMNS level (or ROW) that can share a GROUP BY: over a
// scan, reading no row but the group's keys, which they filter by. A group is one CTE: the
// scan's table and its other filters (compared as SQL), and the keys that filter it.
// `prior`: the fusions of the levels of the same SUMMARIZECOLUMNS before this one, whose
// groups this one's can be added up from (over).
class Fusion {
  constructor(em, keyRow, active, keyCols, domain = [], prior = []) {
    this.em = em;
    this.domain = domain;
    this.keyRow = keyRow;
    this.active = active;
    this.keyCols = keyCols;
    this.prior = prior;
    this.groups = [];
  }

  add(x, scope) {
    const em = this.em, S = x.src;
    if (S.k !== 'scan' || x.fn === 'single') return null;
    const kid = this.keyRow?.id;
    for (const id of ir.freeRows(x)) if (id !== kid) return null;
    for (const part of [x.arg, ...x.a, ...(x.order ?? []).map(o => o.expr)]) {
      if (!part) continue;
      for (const id of ir.freeRows(part)) if (id !== x.row.id) return null;
    }
    const state = em.model.state(S.ctx.mods);
    const exp = em.model.expand(S.table, state);
    const keys = new Set(), rest = [], guards = [], via = [];
    for (const f of S.ctx.filters) {
      if (f.kind === 'bind' && f.val.k === 'col' && f.val.row === this.keyRow) {
        const c = f.cols[0];
        // A scan's row names a column by the model's (rowFused), a group's by its place.
        const ref = typeof f.val.ref === 'number' ? f.val.ref : this.keyRow.cols.findIndex(k => k.lineage === f.val.ref);
        if (ref < 0) return null;
        if (exp.has(c.table.name)) keys.add(ref);
        // A key on a table whose filter reaches the scan over a relationship that filters
        // back (both ways, many-to-many): kept for the mapping below.
        else if (em.model.reaches(c.table, S.table, state)) via.push({ ref, col: c });
        else continue;
        // A guarded key (a value of the group, when a condition on the group holds): the
        // condition is the group's, read where the group is.
        if (f.guard && !guards.includes(f.guard)) guards.push(f.guard);
        continue;
      }
      rest.push(f);
    }
    // Keys that reach the scan over a relationship that filters back: the scan is joined to
    // the pairs (key, value of the relationship's column) that the filter context keeps on the
    // keys' table, and grouped by the key. A row of the scan is in a key's group when its
    // column is one of that key's values, as the filter's IN says, once per key.
    let edge = null;
    if (via.length) {
      const X = via[0].col.table;
      if (via.some(v => v.col.table !== X)) return null;
      for (const name of exp.keys()) {
        for (const e of em.model.inbound(em.model.table(name), state)) if (e.there.table === X) edge ??= e;
      }
      if (!edge) return null;
      em.securityTree(edge.here.table, edge.rel, state);
    }
    // The other filters read no row, or only keys the scan is filtered to: those are its own
    // columns, row by row.
    let readsKeys = false;
    for (const f of rest) {
      const free = ir.freeRows({ k: 'scan', ctx: new Ctx([f]) });
      for (const id of free) if (id !== kid) return null;
      if (free.size) {
        for (const i of ir.rowRefs(f, kid)) if (!keys.has(i)) return null;
        readsKeys = true;
      }
    }
    const block = em.isolated(() => em.scanBlock(S.table, new Ctx(rest, S.ctx.mods), new Map(), null, readsKeys ? [this.keyRow, this.keyCols] : null));
    const keyExpr = new Map();
    if (edge) {
      const m = em.isolated(() => em.scanBlock(edge.there.table, new Ctx(rest, S.ctx.mods), new Map(), new Set(exp.keys())));
      m.setOut([...via.map((_, j) => ({ name: `g${j}` })), { name: 'y' }], [...via.map(v => m.res.meta(v.col)), m.res.meta(edge.there)]);
      m._names = [...via.map((_, j) => `g${j}`), 'y'];
      m.distinct = true;
      const ma = em.alias('m');
      // Across a many-to-many relationship a blank meets a blank (conds): the pairs include the
      // blank row, and the join is null-safe.
      const mm = edge.rel.fromCard === 'many' && edge.rel.toCard === 'many';
      let pairs = m.render();
      if (mm) {
        const blank = em.blankRow(edge.there.table, new Ctx(rest, S.ctx.mods), new Map(), b => {
          b.setOut([...via.map((_, j) => ({ name: `g${j}` })), { name: 'y' }], [...via.map(v => b.res.meta(v.col)), b.res.meta(edge.there)]);
          return b.render();
        }, new Set(exp.keys()));
        if (blank) pairs = `${pairs} UNION ${blank}`;
      }
      const on = mm ? em.d.isNotDistinct(block.res.meta(edge.here), `${ma}.y`) : `${block.res.meta(edge.here)} = ${ma}.y`;
      block.joins.push(`JOIN (${pairs}) AS ${ma} ON ${on}`);
      via.forEach((v, j) => { keys.add(v.ref); keyExpr.set(v.ref, `${ma}.g${j}`); });
    }
    const keyList = [...keys].sort((a, b) => a - b);
    const body = canonical(`${block.from} ${block.joins.join(' ')} ${block.where.join(' AND ')}`);
    const sig = `${S.table.name}|${state.key}|${keyList.join(',')}|${body}`, rows = `${S.table.name}|${state.key}|${body}`;
    const keyed = keyList.length > 0, nullEmpty = NULL_EMPTY.has(x.fn);
    // A group whose aggregates differ in their conditions (FILTER) has the rows of any of
    // them: an aggregate that is not blank over no rows does not join it.
    let g = this.groups.find(y => y.sig === sig && !(y.mixed && !nullEmpty)), conds = null, parts = null;
    // An aggregate over the rows of a group of the same scan by more keys, of this level or
    // of a level before it: that group's aggregates added up by these keys (by none: one
    // row), with no second scan. By some keys, only an aggregate blank over no rows: the
    // group can have rows for keys this one has none of (it is mixed).
    // Its scan can also keep fewer rows than the group's, by conditions on the tables it
    // joins: those are the aggregate's FILTER in the group.
    if (!g && !readsKeys && !edge && !guards.length && (OVER[x.fn] || x.fn === 'avg') && (!keyed || nullEmpty)) {
      for (const h of [...this.groups, ...this.prior.flatMap(f => f.groups)]) {
        if (h.over || h.edge || h.readsKeys || h.tables !== `${S.table.name}|${state.key}`) continue;
        if (h.keys.length <= keyList.length || !keyList.every(i => h.keys.includes(i))) continue;
        const conds = h.rows === rows ? [...h.block.where] : this.condsOn(h, S, rest);
        if (conds) return this.over(x, h, keyList, S, conds);
      }
    }
    if (!g && !readsKeys && !edge && em.d.aggFilter && (!keyed || nullEmpty)) {
      // An aggregate over another scan of the same tables by the same keys is that scan's,
      // over the rows its own conditions on the joined tables keep: one scan for both, its
      // conditions (written on the group's rows, which join what they need) the group's or
      // its FILTER. With no keys there is one row each; by keys, the group has the rows of
      // either, and an aggregate is blank for a key its own conditions keep no row of, as its
      // own group would have no row for it: so only aggregates blank over no rows.
      const into = `${S.table.name}|${state.key}|${keyList.join(',')}`;
      for (const y of this.groups) {
        if (y.merge !== into || (keyed && !y.nullEmpty)) continue;
        const c = this.condsOn(y, S, rest, false);
        if (!c) continue;
        g = y;
        conds = c;
        parts = em.isolated(() => em.aggParts(x, withRow(new Map(), x.row, g.block.res)));
        if (keyed && [...c].sort().join(' AND ') !== [...g.block.where].sort().join(' AND ')) g.mixed = true;
        break;
      }
    }
    if (!g) {
      g = { sig, rows, tables: `${S.table.name}|${state.key}`, edge: !!edge, readsKeys, alias: em.alias('f'), block, keys: keyList, aggs: [], nullEmpty: true,
        merge: !readsKeys && !edge ? `${S.table.name}|${state.key}|${keyList.join(',')}` : null };
      // An iterator's row (rowFused) can bind a column its scan does not reach (a key of the
      // other side of a relationship): that aggregate is not fused.
      try { g.keyExprs = keyList.map(i => keyExpr.get(i) ?? block.res.meta(this.keyCols[i])); } catch (e) {
        if (this.ofRows && e.code === 'SEMANTIC') return null;
        throw e;
      }
      g.on = onKeys(em, g, keyList);
      this.groups.push(g);
    }
    if (!nullEmpty) g.nullEmpty = false;
    // Each aggregate keeps the conditions of its own scan; finish() writes the ones the
    // others of its group lack as its FILTER.
    if (!conds) {
      parts = g.block === block && parts ? parts : em.isolated(() => em.aggParts(x, withRow(new Map(), x.row, g.block.res)));
      conds = [...g.block.where];
    }
    // A group with an aggregate whose scan lacks one of the filters that decide the
    // combinations of the keys can hold keys that are not one of them.
    if (!this.domain.every(f => S.ctx.filters.includes(f))) g.outside = true;
    const p = parts;
    const make = filter => em.d.agg(p.fn, p.arg, filter ? { ...p.extra, filter } : p.extra);
    const key = `${make(null)}|${[...conds].sort().join(' AND ')}`;
    let i = g.aggs.findIndex(a => a.key === key);
    if (i < 0) { g.aggs.push({ key, conds, make, parts: p }); i = g.aggs.length - 1; }
    em.fusedIn.set(x, g);
    if (!guards.length) return `${g.alias}.a${i}`;
    const when = em.isolated(() => guards.map(c => paren(em.scalar(c, scope, true))).join(' AND '));
    return `CASE WHEN ${when} THEN ${g.alias}.a${i}${x.fn === 'count0' || x.fn === 'dcount0' ? ' ELSE 0' : ''} END`;
  }

  // Aggregate x over the rows of keyed group h, by `keys`, some of h's (or none): h's
  // aggregate of it (added to h if h lacks it), added up over h's groups by those keys in a
  // group of its own that reads h. Every row of the scan is in exactly one of h's groups (its
  // keys are columns of the scan's expanded table, a blank key a group too), so the sum of
  // the groups' sums is the sum, and so on. h can be a group of a level before this one.
  // `conds`: the conditions of x's rows, h's and any more (its FILTER in h). An average is
  // its sum over its count.
  over(x, h, keys, S, conds) {
    const em = this.em;
    const parts = em.isolated(() => em.aggParts(x, withRow(new Map(), x.row, h.block.res)));
    const add = fn => {
      const make = filter => em.d.agg(fn, parts.arg, filter ? { ...parts.extra, filter } : parts.extra);
      const key = `${make(null)}|${[...conds].sort().join(' AND ')}`;
      let i = h.aggs.findIndex(a => a.key === key);
      if (i < 0) { h.aggs.push({ key, conds, make, parts: { ...parts, fn } }); i = h.aggs.length - 1; }
      return `${h.alias}.a${i}`;
    };
    const sql = x.fn === 'avg' ? `(CAST(SUM(${add('sum')}) AS ${em.d.type('double')}) / SUM(${add('count0')}))` : OVER[x.fn](add(parts.fn));
    if (!NULL_EMPTY.has(x.fn)) h.nullEmpty = false;
    h.reread = true;
    let d = this.groups.find(y => y.over === h && y.keys.join(',') === keys.join(','));
    if (!d) {
      d = { sig: `over|${h.sig}|${keys.join(',')}`, over: h, alias: em.alias('f'), keys, aggs: [], merge: null,
        keyExprs: keys.map(ki => `${h.alias}.g${h.keys.indexOf(ki)}`),
        // Its keys are h's: outside the combinations of the keys when h's are, or when x's
        // scan lacks a filter that decides them.
        get outside() { return this.own || !!h.outside; } };
      d.on = onKeys(em, d, keys);
      this.groups.push(d);
    }
    if (!this.domain.every(f => S.ctx.filters.includes(f))) d.own = true;
    let j = d.aggs.indexOf(sql);
    if (j < 0) { d.aggs.push(sql); j = d.aggs.length - 1; }
    em.fusedIn.set(x, d);
    return `${d.alias}.a${j}`;
  }

  // The conditions of a scan of S's table under filters `rest`, written on the rows of group
  // h (joining to h's scan what they need), when they differ from h's only on the tables it
  // joins (`superset`: and have all of h's: x's rows are then h's that the others keep).
  // Else null, and h as it was.
  condsOn(h, S, rest, superset = true) {
    const em = this.em, res = h.block.res, joins = h.block.joins.length, aliases = new Map(res.joinAlias);
    const theirs = new Map(h.block.where.map(c => [canonical(c), c]));
    const conds = em.nonBlank(em.isolated(() => [...new Set([...em.conds(S.table, new Ctx(rest, S.ctx.mods), res, new Map()),
      ...em.securityConds(S.table, res, new Map())])])).map(c => theirs.get(canonical(c)) ?? c);
    const base = scanAlias(h);
    if (base && (!superset || h.block.where.every(c => conds.includes(c))) && ownConds(conds, base) === ownConds(h.block.where, base)) return conds;
    h.block.joins.length = joins;
    res.joinAlias = aliases;
    return null;
  }

  // Group g's SQL with its scan's rows aggregated before the joins, or null to write it as it is: the
  // scan grouped by the columns of its own the keys and the joins read, those groups joined to the
  // other tables, and aggregated again by the keys. An engine that joins every row before a GROUP BY
  // above the join (DuckDB cannot know the other side's key is unique; the model can) joined 592
  // million rows to a 265-row table in 10 s, where their 265 groups take 0.5 s. Only for sums,
  // counts, mins and maxes of the scan's own columns, under conditions on its own columns, over
  // joins to the one side of its expanded table (Res.join): each row then meets at most one row of
  // each, so it is counted once, and a row that meets none is in the blank group as before.
  belowJoins(g, owns) {
    const em = this.em, b = g.block, base = scanAlias(g);
    if (!em.d.aggBelowJoins || !base || g.edge || g.readsKeys || !g.keyExprs.length || !b.joins.length) return null;
    if (!b.joins.every(j => b.hops?.has(j)) || owns.some(Boolean)) return null;
    if (!g.aggs.every(a => OVER[a.parts.fn] && !partsQuery(a.parts) && !a.parts.keys?.length)) return null;
    if ([...g.keyExprs, ...b.joins, ...b.where].some(isQuery)) return null;
    const joined = [...b.joins.join(' ').matchAll(/\bAS (\w+) ON\b/g)].map(m => m[1]);
    const readsJoined = s => joined.some(a => new RegExp(`\\b${a}\\.`).test(s ?? ''));
    if (b.where.some(readsJoined) || g.aggs.some(a => readsJoined(a.parts.arg))) return null;
    // The scan's columns the keys and the joins read: the inner GROUP BY.
    const own = new RegExp(`\\b${base}\\.(?:"(?:[^"]|"")*"|\\[(?:[^\\]]|\\]\\])*\\])`, 'g');
    const cols = [...new Set([...g.keyExprs, ...b.joins].flatMap(s => s.match(own) ?? []))];
    if (!cols.length) return null;
    const p = em.alias('p'), id = n => em.ident(n);
    const swap = s => s.replace(own, m => `${p}.${id(`c${cols.indexOf(m)}`)}`);
    const keys = g.keyExprs.map(swap), joins = b.joins.map(swap);
    // Anything else of the scan's row they read (a calculated column's expression): written as it is.
    if ([...keys, ...joins].some(s => new RegExp(`\\b${base}\\.`).test(s))) return null;
    const inner = `SELECT ${[...cols.map((c, i) => `${c} AS ${id(`c${i}`)}`), ...g.aggs.map((a, i) => `${a.make(null)} AS ${id(`a${i}`)}`)].join(', ')}`
      + ` FROM ${b.from}${b.where.length ? ` WHERE ${b.where.join(' AND ')}` : ''} GROUP BY ${cols.join(', ')}`;
    const out = [...keys.map((k, j) => `${k} AS ${id(`g${j}`)}`), ...g.aggs.map((a, i) => `${OVER[a.parts.fn](`${p}.${id(`a${i}`)}`)} AS ${id(`a${i}`)}`)];
    return `SELECT ${out.join(', ')} FROM (${inner}) AS ${p} ${joins.join(' ')} GROUP BY ${keys.join(', ')}`;
  }

  // The CTEs, written once every aggregate is known (a level's after those of the levels
  // before it, whose groups it can read).
  finish() {
    for (const g of this.groups) {
      if (g.over) {
        const sel = [...g.keyExprs.map((k, j) => `${k} AS g${j}`), ...g.aggs.map((a, j) => `${a} AS a${j}`)];
        this.em.ctes.push(`${g.alias} AS (SELECT ${sel.join(', ')} FROM ${g.over.alias}${g.keyExprs.length ? ` GROUP BY ${g.keyExprs.join(', ')}` : ''})`);
        continue;
      }
      const b = g.block;
      // The scan keeps the conditions every aggregate has; an aggregate's others are its FILTER.
      const common = b.where.filter(c => g.aggs.every(a => a.conds.includes(c)));
      b.where = common;
      const owns = g.aggs.map(a => a.conds.filter(c => !common.includes(c)).map(paren).join(' AND ') || null);
      const names = [...g.keyExprs.map((_, j) => `g${j}`), ...g.aggs.map((_, i) => `a${i}`)];
      // Read again by a group over it: written once.
      const cte = sql => this.em.ctes.push(`${g.alias} AS ${g.reread ? this.em.d.materialized : ''}(${sql})`);
      const below = this.belowJoins(g, owns);
      if (below) { cte(below); continue; }
      if (this.em.d.aggOverSubquery || ![...g.keyExprs, ...owns].some(isQuery) && !g.aggs.some(a => partsQuery(a.parts))) {
        const aggs = g.aggs.map((a, i) => a.make(owns[i]));
        b.setOut(names.map(name => ({ name })), [...g.keyExprs, ...aggs]);
        b._names = names;
        if (g.keyExprs.length) b.group = g.keyExprs;
        cte(b.render());
        continue;
      }
      // An engine that aggregates no subquery, nor groups by one (T-SQL): the keys, each
      // argument and each condition columns of the rows, and the GROUP BY over a SELECT of them.
      const em = this.em, cols = [...g.keyExprs], at = [];
      g.aggs.forEach((a, i) => {
        const p = a.parts, start = cols.length;
        cols.push(p.arg ?? '1', ...(p.keys ?? []).map(k => k.sql));
        if (owns[i]) cols.push(em.d.value(owns[i]));
        at.push({ start, keys: (p.keys ?? []).length });
      });
      b.setOut(cols.map((_, i) => ({ name: `c${i}` })), cols);
      const w = em.wrap(b), col = i => w.res.col(i);
      const aggs = g.aggs.map((a, i) => {
        const p = a.parts, { start, keys } = at[i];
        const extra = aroundExtra(em, p, j => col(start + j));
        if (owns[i]) extra.filter = em.d.cond(col(start + 1 + keys));
        return em.d.agg(p.fn, p.arg == null ? null : col(start), extra);
      });
      const keyCols = g.keyExprs.map((_, j) => col(j));
      w.setOut(names.map(name => ({ name })), [...keyCols, ...aggs]);
      w._names = names;
      if (keyCols.length) w.group = keyCols;
      cte(w.render());
    }
    return this.groups;
  }
}

// The scalar subqueries of SQL, outermost first, that do not overlap: { start, end, sql, key },
// key the same for two that are the same up to the aliases they declare. Not one that varies
// between copies (NEWID).
const HOIST_LIMIT = 2e6;
function subqueries(sql) {
  const out = [];
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') { i = sql.indexOf(c, i + 1); if (i < 0) break; continue; }
    if (c !== '(' || !/^\(SELECT\b/.test(sql.slice(i, i + 8))) continue;
    let depth = 0, j = i;
    for (; j < sql.length; j++) {
      const d = sql[j];
      if (d === "'" || d === '"') { j = sql.indexOf(d, j + 1); if (j < 0) return out; } else if (d === '(') depth++;
      else if (d === ')' && !--depth) break;
    }
    const q = sql.slice(i, j + 1);
    if (!/\bNEWID\(/.test(q)) out.push({ start: i, end: j + 1, sql: q, key: canonical(q) });
    // The ones inside it too, as later entries: overlapping, they are taken when it is not.
    out.push(...subqueries(q.slice(1, -1)).map(x => ({ ...x, start: x.start + i + 1, end: x.end + i + 1 })));
    i = j;
  }
  return out;
}
// Whether subquery q of SQL s (whose subqueries are `all`) is a value (not a table: after FROM,
// JOIN, IN, EXISTS, …) of the row itself: inside no subquery but the rows that bind() and a
// CASE's branches read (… FROM (SELECT x AS "v0") AS b1), and reading no alias s declares
// around it. One inside a measure's conditions stays there: Fabric decorrelates it with them,
// and loops on it as a column of the row (a rolling 30 days went from 0.5 s to 15 s).
function hoistable(s, q, all) {
  // Innermost first, each is such a row, or the subquery that reads the row just inside it.
  const row = e => /^\s*AS [bh]\d+\)/.exec(s.slice(e.end))?.[0].length;
  const outer = all.filter(e => e.start < q.start && e.end > q.end).sort((a, b) => a.sql.length - b.sql.length);
  if (!outer.every((e, i) => row(e) || i > 0 && row(outer[i - 1]) && e.end === outer[i - 1].end + row(outer[i - 1]))) return false;
  if (/\b(?:FROM|JOIN|APPLY|IN|EXISTS|ANY|ALL|SOME|UNION|INTERSECT|EXCEPT)\s*$/i.test(s.slice(0, q.start))
    || /^\s*(?:UNION|INTERSECT|EXCEPT)\b/i.test(s.slice(q.end))) return false;
  const own = new Set([...q.sql.matchAll(/\bAS ([a-z]\d+)\b/g)].map(m => m[1]));
  const declared = new Set([...(s.slice(0, q.start) + s.slice(q.end)).matchAll(/\bAS ([a-z]\d+)\b/g)].map(m => m[1]));
  return [...q.sql.matchAll(/\b([a-z]\d+)\./g)].every(m => own.has(m[1]) || !declared.has(m[1]));
}

// Whether SQL holds a subquery; whether an aggregate's parts do (aggParts).
const isQuery = s => /\bSELECT\b/i.test(s ?? '');
const partsQuery = p => isQuery(p.arg) || (p.keys ?? []).some(k => isQuery(k.sql));
// SQL that is no more than a column of a row (t1."Amount"), or none.
const plainCol = s => s == null || /^\w+\."(?:[^"]|"")*"$/.test(s);
// An aggregate's extra parts over the columns of a SELECT around its rows: column i (from 1) is
// its i-th ORDER BY key.
function aroundExtra(em, p, col) {
  const extra = { ...p.extra };
  if (p.keys?.length) extra.order = p.keys.map((k, i) => em.orderBy(col(i + 1), k.desc));
  return extra;
}

// The alias of a group's scanned table, and its conditions on that table's own columns (as
// text, the aliases inside them numbered): what lets the engine skip its rows, so two scans
// that share a group must agree on those.
const scanAlias = g => / AS (\w+)$/.exec(g.block.from)?.[1];
const ownConds = (cs, base) => cs.filter(c => c.split(/('(?:[^']|'')*')/).some((part, i) => i % 2 === 0 && part.includes(`${base}.`)))
  .map(canonical).sort().join(' AND ');

// How a fused group's CTE is joined to the groups of the level: on its keys, a blank
// matching a blank (none: its one row).
function onKeys(em, g, keys) {
  return (k, keyNames) => keys.length
    ? keys.map((ki, j) => em.d.isNotDistinct(`${g.alias}.g${j}`, `${k}.${em.ident(keyNames[ki])}`)).join(' AND ')
    : em.d.always;
}

// The aggregates that are blank over no rows (the dialect's NULL): fused by keys with others
// whose conditions differ, a key their own conditions keep no row of reads as blank, as a
// group of their own would have no row for it.
const NULL_EMPTY = new Set(['sum', 'avg', 'min', 'max', 'count', 'countrows', 'dcount', 'dcountnb', 'countblank', 'median', 'stdev_s', 'stdev_p', 'var_s', 'var_p']);

// The aggregates whose value over all rows is their values over a partition of the rows,
// added up: how, from the column of the parts.
const OVER = {
  sum: a => `SUM(${a})`, min: a => `MIN(${a})`, max: a => `MAX(${a})`,
  count: a => `SUM(${a})`, countrows: a => `SUM(${a})`, count0: a => `COALESCE(SUM(${a}), 0)`,
};

// The fused groups without whose rows an expression is blank, or null if it can be
// non-blank without any: whether SUMMARIZECOLUMNS can take its groups from them.
function support(x, fusedIn) {
  const all = xs => {
    const out = new Set();
    for (const v of xs) {
      const s = support(v, fusedIn);
      if (!s) return null;
      s.forEach(g => out.add(g));
    }
    return out;
  };
  switch (x.k) {
    case 'lit': return x.v === null ? new Set() : null;
    case 'agg': {
      const g = fusedIn.get(x);
      return g && !['count0', 'dcount0', 'hasone'].includes(x.fn) ? new Set([g]) : null;
    }
    case 'op':
      if (x.op === 'add' || x.op === 'sub') return all(x.a);
      // BLANK() * x and BLANK() / x are blank; x / BLANK() is not (it is infinity).
      if (x.op === 'mul') return support(x.a[0], fusedIn) ?? support(x.a[1], fusedIn);
      if (x.op === 'div') return support(x.a[0], fusedIn);
      if (x.op === 'neg') return support(x.a[0], fusedIn);
      return null;
    case 'fn':
      if (x.name === 'divide' || x.name === 'cydivide') return x.a.length === 2 || (x.a[2].k === 'lit' && x.a[2].v === null)
        ? support(x.a[0], fusedIn) ?? support(x.a[1], fusedIn) : null;
      if (x.name === 'coalesce') return all(x.a);
      if (x.strict || x.name === 'cast') return support(x.a[0], fusedIn);
      return null;
    case 'case': return all([...x.w.map(w => w[1]), x.e]);
    default: return null;
  }
}

// --- blocks and resolvers ----------------------------------------------------------------

class Block {
  constructor(em, from, cols) {
    this.em = em;
    this.from = from;
    this.cols = cols;
    this.joins = [];
    this.where = [];
    this.group = null;
    this.distinct = false;
    this.qualify = null;
    this.out = null;       // [{ name, sql }], or null: the input row's columns
    this.open = true;      // WHERE and the select list can still be written over the input row
    this.plain = true;     // the output is the input row
    this._names = null;
  }
  names() { return this._names ??= uniqNames(this.cols.map(c => c.name)); }
  outList() {
    if (this.out) return this.out;
    const names = this.names();
    return this.cols.map((_, i) => ({ name: names[i], sql: this.res.col(i) }));
  }
  setOut(cols, sqls) {
    this.cols = cols;
    this._names = uniqNames(cols.map(c => c.name));
    this.out = sqls.map((sql, i) => ({ name: this._names[i], sql }));
    this.plain = false;
  }
  render() {
    const id = n => this.em.ident(n);
    const list = this.outList();
    const out = list.map(o => (o.sql.endsWith(`.${id(o.name)}`) ? o.sql : `${o.sql} AS ${id(o.name)}`));
    // Without QUALIFY, the window is a column, and a SELECT around it keeps the rows it passes.
    const q = this.qualify, wrapped = !!q && !this.em.d.supportsQualify;
    if (wrapped) out.push(`${q.win} AS ${id('__q')}`);
    const parts = [`SELECT ${this.distinct ? 'DISTINCT ' : ''}${out.length ? out.join(', ') : '1 AS one'}`];
    if (this.from) parts.push(`FROM ${this.from}${this.joins.length ? ' ' + this.joins.join(' ') : ''}`);
    if (this.where.length) parts.push(`WHERE ${this.where.join(' AND ')}`);
    if (this.group?.length) parts.push(`GROUP BY ${this.group.join(', ')}`);
    if (q && !wrapped) parts.push(`QUALIFY ${q.win} ${q.test}`);
    if (!wrapped) return parts.join(' ');
    const a = this.em.alias('q'), names = list.length ? list.map(o => o.name) : ['one'];
    return `SELECT ${names.map(n => `${a}.${id(n)}`).join(', ')} FROM (${parts.join(' ')}) AS ${a} WHERE ${a}.${id('__q')} ${q.test}`;
  }
}

// Writes the columns of a row, and joins related tables into its block to reach theirs.
class Res {
  constructor(em, block, state) {
    this.em = em;
    this.block = block;
    this.state = state;
    this.joinAlias = new Map();
  }
  meta(m) {
    const own = this.own(m);
    if (own != null) return own;
    for (const t of this.anchors()) {
      const path = this.em.model.expand(t, this.state, null, true).get(m.table.name);
      if (path?.length && this.own(path[0].from) != null) return this.via(path, m);
    }
    throw semantic(`'${m.table.name}'[${m.name}] cannot be reached from this row`);
  }
  // Through the joins of `path` to column m of its last table; a foreign key stands for the
  // key it references when the relationship relies on referential integrity.
  via(path, m) {
    const last = path.at(-1);
    if (last.to === m && (last.rel.ri || this.em.options.assumeIntegrity) && last.rel.to === m)
      return path.length === 1 ? this.own(last.from) : this.via(path.slice(0, -1), last.from);
    return this.physical(this.join(path), m);
  }
  join(path) {
    const key = path.map(h => `${h.rel.name}${h.from === h.rel.from ? '>' : '<'}`).join('/');
    let a = this.joinAlias.get(key);
    if (a) return a;
    const from = path.length === 1 ? this.own(path[0].from) : this.physical(this.join(path.slice(0, -1)), path.at(-1).from);
    const hop = path.at(-1);
    a = this.em.alias('j');
    if (!this.block) throw semantic(`'${hop.to.table.name}' cannot be joined here`);
    const sql = `LEFT JOIN ${this.em.source(hop.to.table)} AS ${a} ON ${this.em.stored(a, hop.to)} = ${from}`;
    this.block.joins.push(sql);
    // A join to the one side of the row's table's expanded table: at most one row each (Fusion.belowJoins).
    (this.block.hops ??= new Set()).add(sql);
    this.joinAlias.set(key, a);
    (this.joinKey ??= new Map()).set(a, `${a}.${this.em.ident(hop.to.source)}`);
    return a;
  }
  physical(alias, m) {
    if (!m.expr) return this.em.stored(alias, m);
    // A calculated column: its expression on this row, in an empty filter context and without
    // row-level security, as computed at refresh. A column the query defines is computed when
    // the query runs, under the roles' security. Blank on the blank row (a join that found no
    // row, or the blank row itself).
    if (alias === this.alias && this.blankRow) return this.em.d.cast('NULL', m.type);
    const { row, expr } = this.em.options.calcColumn(m);
    const res = new ScanRes(this.em, this.block, m.table, alias, this.state);
    // One that needs its own values (a window function over its own table) cannot be written.
    const busy = (this.em.calcBusy ??= new Set());
    if (busy.has(m)) throw semantic(`calculated column '${m.table.name}'[${m.name}] depends on itself`);
    busy.add(m);
    let sql;
    const value = () => this.em.isolated(() => this.em.scalar(expr, new Map([[row.id, res]])));
    try { sql = `(${m.query ? value() : this.em.unsecured(value)})`; } finally { busy.delete(m); }
    const key = this.joinKey?.get(alias);
    return key ? `CASE WHEN ${key} IS NULL THEN NULL ELSE ${sql} END` : sql;
  }
}

class ScanRes extends Res {
  constructor(em, block, table, alias, state) {
    super(em, block, state);
    this.table = table;
    this.alias = alias;
  }
  own(m) { return m.table === this.table ? this.physical(this.alias, m) : null; }
  anchors() { return [this.table]; }
  col(ref) { return this.meta(typeof ref === 'number' ? this.table.columns[ref] : ref); }
}

class WrapRes extends Res {
  constructor(em, block, list, state) {
    super(em, block, state);
    this.list = list;   // [{ sql, lineage }]
  }
  own(m) { return this.list.find(c => c.lineage === m)?.sql ?? null; }
  anchors() { return [...new Set(this.list.filter(c => c.lineage).map(c => c.lineage.table))]; }
  col(ref) {
    if (typeof ref === 'number') {
      if (!this.list[ref]) throw new Error(`emit: no column ${ref}`);
      return this.list[ref].sql;
    }
    return this.meta(ref);
  }
}

// --- helpers -------------------------------------------------------------------------------

function withRow(scope, row, res) {
  const s = new Map(scope);
  s.set(row.id, res);
  return s;
}
const paren = s => `(${s})`;

// An ORDER BY term with DAX's blanks: DEFAULT puts a numeric blank between the negative
// numbers and zero, and a text blank before every text; FIRST and LAST say.
function orderTerm(d, v, o) {
  const dir = o.desc ? 'DESC' : 'ASC';
  if (o.blanks === 'first') return d.order(v, dir, 'FIRST');
  if (o.blanks === 'last') return d.order(v, dir, 'LAST');
  if (ir.isNum(o.t)) return `COALESCE(${v}, 0) ${dir}, ${d.value(`(${v} IS NULL)`)} ${o.desc ? 'ASC' : 'DESC'}`;
  return d.order(v, dir, o.desc ? 'LAST' : 'FIRST');
}

// Whether scalarOf writes node x as a condition, not a value (scalar): a comparison, a test,
// EXISTS. A variable is read as the value its CTE holds.
const COND_OPS = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'eqs', 'and', 'or', 'not', 'bool', 'in']);
const COND_FNS = new Set(['isblank', 'iseven', 'isodd', 'exact', 'containsstring', 'containsstringexact', 'pathcontains']);
function isCond(x, em) {
  if (x.shared && !em.inCte && !ir.freeRows(x).size) return false;
  if (x.k === 'op') return COND_OPS.has(x.op);
  if (x.k === 'fn') return COND_FNS.has(x.name);
  return x.k === 'exists' || x.k === 'insub' || x.k === 'blankexists';
}

// Whether a model column may hold a NULL, a blank that a blank in a table filter matches: any
// but a key (a column marked as one, or the one side of a relationship) and one the model
// says is not nullable.
const mayHoldNull = c => !c.unique && c.nullable !== false;

// Whether a table can hold the blank row (and so a key matched against it can be blank).
// Whether column i of table x can hold a blank, as far as the compiler can tell: a constant
// is one or not; a model table's own column is not (a NULL stored in it aside); the blank row
// is; anything else may be.
function mayBeBlank(x, i) {
  if (i == null || i < 0) return true;
  const lit = v => v?.k === 'lit' && v.v !== null;
  switch (x.k) {
    case 'rows': return x.rows.some(r => !lit(r[i]));
    case 'onerow': return !lit(x.vals[i]) && !x.vals[i]?.nn;
    case 'distinct': case 'shared': case 'filter': case 'topn': case 'topnskip': return mayBeBlank(x.src, i);
    case 'project': {
      if (x.keep && i < x.src.cols.length) return mayBeBlank(x.src, i);
      const e = x.items[x.keep ? i - x.src.cols.length : i]?.expr;
      if (e?.k === 'col' && e.row === x.row) return mayBeBlank(x.src, typeof e.ref === 'number' ? e.ref : x.src.cols.findIndex(c => c.lineage === e.ref));
      return !e?.nn;
    }
    case 'scan': return !(x.cols[i]?.lineage?.table === x.table);
    case 'union': case 'intersect': case 'except': return x.srcs.some(s => mayBeBlank(s, i));
  }
  return true;
}

// A filter's table as FILTER(..FILTER(scan)..), through table VARs: the scan and the predicates.
function filterChain(x) {
  const preds = [];
  while (x.k === 'filter' || x.k === 'distinct' || x.k === 'shared') {
    if (x.k === 'filter') preds.push({ pred: x.pred, row: x.row });
    x = x.src;
  }
  return x.k === 'scan' ? { scan: x, preds } : null;
}

// A filter's table as FILTER(..DISTINCT(SELECTCOLUMNS(scan, its own columns))..), through table
// VARs (Power BI names each filter table of a visual): the scan, the predicates on the columns
// kept, and those columns; or null.
function valuesChain(x) {
  const preds = [];
  for (;;) {
    if (x.k === 'filter') { preds.push({ pred: x.pred, row: x.row }); x = x.src; } else if (x.k === 'distinct' || x.k === 'shared') x = x.src;
    else break;
  }
  if (x.k !== 'project' || x.keep || x.src.k !== 'scan' || !x.items.every(i => i.expr.k === 'col' && i.expr.row === x.row)) return null;
  return { scan: x.src, preds, cols: x.cols };
}

// Whether an expression reads nothing but constants and the columns of `row`: no
// aggregate, no subquery, no other row.
function plainOf(x, row) {
  switch (x.k) {
    case 'lit': return true;
    case 'col': return x.row === row;
    case 'op': case 'fn': return x.a.every(y => plainOf(y, row));
    case 'case': return x.w.every(([c, v]) => plainOf(c, row) && plainOf(v, row)) && plainOf(x.e, row);
  }
  return false;
}

// Names unique without regard to case, as SQL compares them.
function uniqNames(names) {
  const seen = new Set();
  return names.map(n => {
    let name = String(n || 'col'), i = 1;
    while (seen.has(lc(name))) name = `${n}_${++i}`;
    seen.add(lc(name));
    return name;
  });
}

function daxName(c) {
  const q = c.lineage ? null : ir.qualifiedName(c.name);
  return c.lineage ? `'${c.lineage.table.name}'[${c.lineage.name}]` : q ? `'${q.table}'[${q.name}]` : `[${c.name}]`;
}
function outputNames(cols, style) {
  const named = c => { const q = c.lineage ? null : ir.qualifiedName(c.name); return q ? `${q.table}[${q.name}]` : `[${c.name}]`; };
  if (style === 'dax') return uniqNames(cols.map(c => (c.lineage ? `${c.lineage.table.name}[${c.lineage.name}]` : named(c))));
  // Short names; where two collide, the later ones say their table.
  const seen = new Set();
  return uniqNames(cols.map(c => {
    let n = c.name;
    if (seen.has(lc(n)) && c.lineage) n = `${c.lineage.table.name}[${c.name}]`;
    seen.add(lc(n));
    return n;
  }));
}

// SQL with its aliases renamed, outside its string literals.
function renameAliases(sql, map) {
  return sql.split(/('(?:[^']|'')*')/).map((part, i) => i % 2 ? part
    : part.replace(/\b[a-z]\d+\b/g, m => map.get(m) ?? m)).join('');
}

// SQL with the aliases it declares (AS t3) numbered in order of appearance, so that two
// writings of the same SQL compare equal. A name it only refers to (a CTE) is kept: two
// subqueries over different CTEs are different.
function canonical(sql) {
  // Outside string literals and quoted names: 's3' is a value, "m0" a column, not an alias.
  const parts = sql.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/);
  const declared = new Set(parts.flatMap((part, i) => i % 2 ? [] : [...part.matchAll(/\bAS ([a-z]\d+)\b/g)].map(m => m[1])));
  const map = new Map();
  return parts.map((part, i) => i % 2 ? part : part.replace(/\b[a-z]\d+\b/g, (m) => {
    if (!declared.has(m)) return m;
    if (!map.has(m)) map.set(m, `@${map.size}`);
    return map.get(m);
  })).join('');
}

const blankOf = t => (t === 'string' ? '' : t === 'bool' ? false : t === 'datetime' || t === 'date' ? '1899-12-30' : 0);
function compareJs(o, a, b) {
  switch (o) {
    case 'eq': return a === b;
    case 'ne': return !compareJs('eq', a, b);
    case 'lt': return a < b;
    case 'le': return a <= b;
    case 'gt': return a > b;
    case 'ge': return a >= b;
  }
  return false;
}
