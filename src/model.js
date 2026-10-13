// The semantic model: dax-sql's model object (below) read into tables, columns, measures and
// relationships, and the two questions the compiler asks of relationships:
//   expand(table)      the tables whose columns a row of `table` reaches by following
//                      relationships from the many side to the one side (DAX's expanded
//                      table), each with the path of joins that reaches it
//   reaches(from, to)  whether a filter on `from` propagates to `to`
// Both depend on which relationships are active and in which direction they filter, which
// USERELATIONSHIP and CROSSFILTER change inside a CALCULATE: a `RelState` says that.
// Names are looked up without regard to case, as in DAX.
//
// The model object is no file format: a reader turns one into it (formats/: TMSL, Apache
// Ossie). Its shape (DESIGN.md, "The model"), every property optional unless said:
//   { tables: [{ name (required), source: { schema, entity }, dax (a calculated table),
//       hidden, dataCategory,
//       columns: [{ name (required), type: string|int|double|decimal|datetime|bool|variant,
//         source (the stored column; its name by default), dax (a calculated column), key,
//         nullable, dataCategory, fieldParameter (the fields column of a field parameter) }],
//       measures: [{ name (required), dax (required), formatString }],
//       calculationGroup: { precedence, items: [{ name, ordinal, dax, formatString }],
//         multipleOrEmpty, noSelection } }],
//     relationships: [{ name, from: { table, column }, to: { table, column } (required),
//       active (true), crossFilter: single|both (single), fromCardinality: many|one (many),
//       toCardinality: many|one (one), assumeIntegrity, securityFilter: single|both|none }],
//     roles: [{ name, filters: [{ table, dax }] }] }
// A table is one of the lakehouse (`source`, else its name), calculated (`dax`: `calc` here)
// or a calculation group (`calcGroup`: its items); `roles` hold the row-level security
// filters of each role.
import { semantic } from './errors.js';

const TYPES = new Set(['string', 'int', 'double', 'decimal', 'datetime', 'bool', 'variant']);

const lc = s => String(s).toLowerCase();

export class Model {
  constructor(model) {
    if (!Array.isArray(model?.tables)) throw semantic('the model has no tables (a model object: { tables, relationships, roles })');
    this.tables = new Map();
    this.measures = new Map();
    for (const t of model.tables) this.addTable(t);
    this.relationships = (model.relationships ?? []).map((r, i) => this.relationship(r, i));
    // Calculation groups, the one with the highest precedence first (it is applied outermost).
    this.calcGroups = [...this.tables.values()].filter(t => t.calcGroup).map(t => t.calcGroup)
      .sort((a, b) => b.precedence - a.precedence);
    this.roles = (model.roles ?? []).map(r => ({
      name: r.name,
      filters: (r.filters ?? []).filter(f => f.dax?.trim()).map(f => ({ table: this.table(f.table), text: f.dax })),
    }));
    // A column is unique when it is a key, or the one side of a relationship.
    for (const r of this.relationships) {
      if (r.toCard === 'one') r.to.unique = true;
      if (r.fromCard === 'one') r.from.unique = true;
    }
    for (const t of this.tables.values()) t.key ??= t.columns.find(c => c.unique) ?? null;
    this._state = new Map();
    this._expand = new Map();
  }

  addTable(t) {
    const table = { name: t.name, columns: [], colMap: new Map(), key: null, dataCategory: t.dataCategory ?? null,
      source: { schema: t.source?.schema ?? null, entity: t.source?.entity ?? t.name }, hidden: !!t.hidden };
    if (t.dax != null) table.calc = t.dax;
    for (const c of t.columns ?? []) {
      const col = {
        table, name: c.name, id: `${lc(t.name)}[${lc(c.name)}]`,
        type: TYPES.has(c.type) ? c.type : 'variant',
        source: c.source ?? c.name,
        expr: c.dax ?? null,
        unique: !!c.key, nullable: c.nullable !== false, dataCategory: c.dataCategory ?? null,
        fieldParameter: !!c.fieldParameter,
      };
      if (c.key) table.key = col;
      table.columns.push(col);
      table.colMap.set(lc(c.name), col);
    }
    if (t.calculationGroup) table.calcGroup = calcGroupOf(t.calculationGroup, table);
    this.tables.set(lc(t.name), table);
    for (const ms of t.measures ?? []) this.addMeasure(table, ms.name, ms.dax, ms.formatString);
    return table;
  }

  addMeasure(table, name, expression, formatString = null) {
    this.measures.set(lc(name), { name, table, text: expression, ast: null, formatString: formatString ?? null });
  }

  relationship(r, i) {
    const from = this.column(r.from.table, r.from.column), to = this.column(r.to.table, r.to.column);
    return {
      name: r.name ?? `rel${i}`, from, to,
      active: r.active !== false,
      cross: r.crossFilter === 'both' ? 'both' : 'single',
      fromCard: r.fromCardinality ?? 'many',
      toCard: r.toCardinality ?? 'one',
      ri: !!r.assumeIntegrity,
      // Row-level security moves from the one side to the many side, and back if set so.
      security: r.securityFilter === 'both' || r.securityFilter === 'none' ? r.securityFilter : 'single',
    };
  }

  table(name) {
    const t = this.tables.get(lc(name));
    if (!t) throw semantic(`the model has no table '${name}'`);
    return t;
  }
  hasTable(name) { return this.tables.has(lc(name)); }
  column(table, name) {
    const t = typeof table === 'string' ? this.table(table) : table;
    const c = t.colMap.get(lc(name));
    if (!c) throw semantic(`the model has no column '${t.name}'[${name}]`);
    return c;
  }
  findColumn(table, name) {
    const t = this.tables.get(lc(table));
    return t?.colMap.get(lc(name)) ?? null;
  }
  measure(name) { return this.measures.get(lc(name)) ?? null; }

  // A copy for one query: DEFINE MEASURE adds to it, not to the model.
  fork() {
    const f = Object.create(Model.prototype);
    Object.assign(f, this);
    f.measures = new Map(this.measures);
    return f;
  }

  // DEFINE COLUMN: a calculated column of a table for the time of one query. The table is
  // the model's, so the column is there for everything that reads the table's columns (ALL
  // of the table, context transition, a scan) until dropQueryColumns takes it out again.
  // `query` computes it: { row, expr } once compiled.
  addQueryColumn(table, name) {
    if (table.colMap.has(lc(name))) throw semantic(`DEFINE COLUMN: '${table.name}' already has a column [${name}]`);
    const col = { table, name, id: `${lc(table.name)}[${lc(name)}]`, type: 'variant', source: name, expr: name,
      unique: false, dataCategory: null, fieldParameter: false, query: {} };
    table.columns.push(col);
    table.colMap.set(lc(name), col);
    return col;
  }
  dropQueryColumns(cols) {
    for (const col of cols) {
      const t = col.table, i = t.columns.indexOf(col);
      if (i >= 0) t.columns.splice(i, 1);
      if (t.colMap.get(lc(col.name)) === col) t.colMap.delete(lc(col.name));
    }
  }

  // The relationships as a RelState changes them: [{ rel, active, cross }], cross one of
  // 'single' (one side filters many), 'both', 'none', 'reverse' (many side filters one).
  state(mods) {
    if (mods?.security) return this.securityState();
    const key = mods ? JSON.stringify([[...mods.active], [...mods.cross]]) : '';
    let s = this._state.get(key);
    if (!s) {
      s = this.relationships.map(rel => {
        let active = rel.active, cross = rel.cross;
        if (mods?.active.has(rel.name)) active = mods.active.get(rel.name);
        if (mods?.cross.has(rel.name)) cross = mods.cross.get(rel.name);
        // A one-to-one relationship filters both ways.
        if (rel.fromCard === 'one' && rel.toCard === 'one' && cross === 'single') cross = 'both';
        return { rel, active, cross };
      });
      s.key = key;
      this._state.set(key, s);
    }
    return s;
  }

  // The relationships as row-level security moves along them: the active ones, from the one
  // side to the many side, or both ways when their security filtering says so (none: not at
  // all). CROSSFILTER and USERELATIONSHIP do not change them.
  securityState() {
    if (!this._security) {
      const s = this.relationships.map(rel => {
        let cross = rel.security === 'both' ? 'both' : rel.security === 'none' ? 'none' : 'single';
        if (rel.fromCard === 'one' && rel.toCard === 'one' && cross === 'single') cross = 'both';
        return { rel, active: rel.active, cross };
      });
      s.key = 'security';
      this._security = s;
    }
    return this._security;
  }

  // Two join paths along which the rows a role keeps of table `from` reach table `to`, when
  // one of them crosses relationship `only`, which `state` (a CROSSFILTER) makes filter from its
  // many side to its one side for the query only; null otherwise. Security moves along the
  // relationships as securityState says, and the secured rows of that many side filter its
  // one side. DAX joins the tables that filter a table as a tree, so a second path is an
  // error: a secured table that filters a fact table is filtered back by it, say. Each path
  // is the list of its tables.
  securityPaths(from, to, state, only) {
    const edges = [];
    for (const { rel, active, cross } of this.securityState()) {
      if (!active || rel.security === 'none') continue;
      edges.push({ a: rel.to.table, b: rel.from.table, query: false });
      if (cross === 'both') edges.push({ a: rel.from.table, b: rel.to.table, query: false });
    }
    for (const { rel, active, cross } of state) {
      if (rel !== only || !active || rel.fromCard !== 'many' || rel.toCard !== 'one' || rel.cross !== 'single') continue;
      if (rel.security === 'both' || cross !== 'both' && cross !== 'reverse') continue;
      edges.push({ a: rel.from.table, b: rel.to.table, query: true });
    }
    if (!edges.some(e => e.query)) return null;
    const paths = from === to ? [{ path: [from], query: false }] : [];
    const walk = (t, path, query) => {
      for (const e of edges) {
        if (e.a !== t) continue;
        if (e.b === to) paths.push({ path: [...path, to], query: query || e.query });
        else if (!path.includes(e.b)) walk(e.b, [...path, e.b], query || e.query);
      }
    };
    walk(from, [from], false);
    const q = paths.find(p => p.query);
    return q && paths.length > 1 ? [paths.find(p => p !== q).path, q.path] : null;
  }

  // The expanded table of `table`: Map(table name -> [hops]) where a hop is
  // { rel, from: column on this side, to: column on the far side }. `exclude` names tables
  // the walk does not enter. For filters, a relationship CROSSFILTER turned off (or turned
  // to filter the other way) is not followed; for `lookup` (RELATED, reading a related
  // column) every active one is.
  // With `security`, the relationships row-level security moves along: all but those whose
  // securityFilteringBehavior is none, whatever CROSSFILTER says.
  expand(table, state, exclude = null, lookup = false, security = false) {
    const key = `${table.name}|${state.key}|${exclude ? [...exclude].sort().join(',') : ''}|${lookup}|${security}`;
    let out = this._expand.get(key);
    if (out) return out;
    out = new Map([[table.name, []]]);
    const queue = [table];
    while (queue.length) {
      const t = queue.shift(), path = out.get(t.name);
      for (const { rel, active, cross } of state) {
        if (!active || rel.fromCard === 'many' && rel.toCard === 'many') continue;
        if (security) { if (rel.security === 'none') continue; }
        else if (!lookup && (cross === 'none' || cross === 'reverse')) continue;
        // Many side to one side; a one-to-one relationship expands both ways.
        let hop = null;
        if (rel.from.table === t) hop = { rel, from: rel.from, to: rel.to };
        else if (rel.to.table === t && rel.fromCard === 'one') hop = { rel, from: rel.to, to: rel.from };
        if (!hop) continue;
        const next = hop.to.table;
        if (out.has(next.name) || exclude?.has(next.name)) continue;
        out.set(next.name, [...path, hop]);
        queue.push(next);
      }
    }
    this._expand.set(key, out);
    return out;
  }

  // The edges along which a filter moves into `table` from a table that is not in its
  // expanded table: the one side of a bidirectional relationship from its many side, and
  // either side of a many-to-many relationship. [{ rel, here: column of `table`, there }].
  inbound(table, state) {
    const out = [];
    for (const { rel, active, cross } of state) {
      if (!active || cross === 'none') continue;
      const mm = rel.fromCard === 'many' && rel.toCard === 'many';
      if (rel.to.table === table && rel.fromCard === 'many' && (cross === 'both' || cross === 'reverse' || mm && cross !== 'single'))
        out.push({ rel, here: rel.to, there: rel.from });
      if (mm && rel.from.table === table && cross !== 'reverse') out.push({ rel, here: rel.from, there: rel.to });
    }
    return out;
  }

  // The relationships `table` is a one side of, whose other side may hold keys it lacks (they
  // do not rely on referential integrity): the one side of a many-to-one relationship, and
  // either side of a one-to-one relationship. [{ rel, one: column of `table`, many: the other
  // side's }]. The rows of the other side whose key `table` lacks belong to its blank row.
  oneSides(table) {
    const out = [];
    for (const r of this.relationships) {
      if (r.ri || r.toCard !== 'one') continue;
      if (r.to.table === table) out.push({ rel: r, one: r.to, many: r.from });
      if (r.fromCard === 'one' && r.from.table === table) out.push({ rel: r, one: r.from, many: r.to });
    }
    return out;
  }

  // Whether a filter on table `from` reaches table `to`.
  reaches(from, to, state) {
    if (from === to) return true;
    const seen = new Set([from.name]), queue = [from];
    while (queue.length) {
      const t = queue.shift();
      for (const { rel, active, cross } of state) {
        if (!active || cross === 'none') continue;
        const mm = rel.fromCard === 'many' && rel.toCard === 'many';
        const steps = [];
        // One side to many side, unless the direction is reversed.
        if (rel.to.table === t && cross !== 'reverse') steps.push(rel.from.table);
        if (rel.from.table === t && (cross === 'both' || cross === 'reverse' || rel.fromCard === 'one' || mm && cross !== 'single')) steps.push(rel.to.table);
        for (const n of steps) {
          if (n === to) return true;
          if (!seen.has(n.name)) { seen.add(n.name); queue.push(n); }
        }
      }
    }
    return false;
  }

  // NAMEOF: 'Table'[Name] of a column, or of a measure under its home table.
  nameOf(ref) {
    const m = !ref.table || !this.findColumn(ref.table, ref.name) ? this.measure(ref.name) : null;
    if (m) return `'${m.table.name}'[${m.name}]`;
    const c = this.column(ref.table, ref.name);
    return `'${c.table.name}'[${c.name}]`;
  }

  // The relationship between two columns, either way round.
  relationshipOf(a, b) {
    return this.relationships.find(r => r.from === a && r.to === b || r.from === b && r.to === a) ?? null;
  }
}

// A calculation group: its items, the column that names them (and the one that orders them),
// its precedence, and what it does when the filter context selects none or several of them.
function calcGroupOf(g, table) {
  const named = table.columns.find(c => lc(c.source) === 'name') ?? table.columns.find(c => c.type === 'string');
  const ordinal = table.columns.find(c => lc(c.source) === 'ordinal') ?? null;
  const expr = e => (e?.trim() ? e : null);
  return {
    table, column: named, ordinal, precedence: g.precedence ?? 0,
    items: (g.items ?? []).map((it, i) => ({ name: it.name, ordinal: it.ordinal ?? i, text: it.dax, ast: null,
      formatString: expr(it.formatString) })),
    multipleOrEmpty: expr(g.multipleOrEmpty),
    noSelection: expr(g.noSelection),
  };
}

// Whether a date column is the one filtered as a date table's: a column of a table marked
// as a date table (dataCategory Time) that is its key, or the date-typed one side of a
// relationship. A filter on it removes the filters on the rest of its table.
export function isDateKey(model, col) {
  if (col.type !== 'datetime') return false;
  if (col.table.dataCategory === 'Time' && (col.unique || col.table.key === col)) return true;
  return model.relationships.some(r => r.to === col && r.active);
}
