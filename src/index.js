// dax-sql: DAX queries, or SQL SELECTs, over a semantic model -> one SQL SELECT.
//
//   import { createCompiler } from 'dax-sql';
//   const dax = createCompiler(model, { tableSource: t => `v_${t.name}` });
//   const { sql, columns } = dax.compile('EVALUATE SUMMARIZECOLUMNS(...)');
//
// `model` is dax-sql's model object (model.js says its shape), which no file is: the readers
// in formats/ (dax-sql/formats/tmsl.js, dax-sql/formats/ossie.js) make one from a TMSL
// model.bim or an Apache Ossie model.
// Options:
//   dialect        'duckdb' (the default), 'tsql' (the Fabric SQL endpoint and Warehouse),
//                  'postgres' (PostgreSQL), or a Dialect instance (see dialects/base.js)
//   tableSource    (table) => SQL that names a model table's rows; by default its source's
//                  entity ("schema"."entity"), else its name
//   columnNames    'short' (the default: the column or the expression's name) or 'dax'
//                  ('Table'[Column], [Measure]) for the result's columns
//   castOutput     true (the default): whole numbers as BIGINT, numbers as DOUBLE; or, by
//                  the column's type, a function of its SQL ({ int: s => `CAST(${s} AS INTEGER)` })
//   assumeIntegrity  true: every relationship relies on referential integrity, so a
//                  dimension's key is read off the fact's foreign key with no join (by
//                  default only those whose assumeIntegrity says so)
//   user           the value of USERNAME() and USERPRINCIPALNAME()
//   roles          the names of the model's roles to query as: every table's rows are those
//                  some role keeps (row-level security), and what every role hides is no name
//                  (object-level security)
//   params         the values of query parameters (@name), by name
import { Model } from './model.js';
import { Compiler } from './compiler.js';
import { parseExpression } from './parser.js';
import { DuckDBDialect } from './dialects/duckdb.js';
import { TSqlDialect } from './dialects/tsql.js';
import { PostgresDialect } from './dialects/postgres.js';
import { PolarsDialect } from './dialects/polars.js';
import { DataFusionDialect } from './dialects/datafusion.js';
import { Dialect } from './dialects/base.js';
import { newRow } from './ir.js';
import { DaxError, semantic, unsupported } from './errors.js';
import { Ctx } from './context.js';
import { SqlTranslator, isSql, isSqlQuery, printDaxQuery, modelRelations, spliceStatement } from './sql.js';
import { Lowerer } from './lower.js';
import { PlanSql } from './plan-sql.js';
import { toSubstrait } from './substrait.js';
import { readSubstrait } from './substrait-read.js';
import { standard } from './passes/standard.js';
import { fuseApplies } from './passes/fuse-applies.js';
import { share } from './passes/share.js';
import { inline } from './passes/inline.js';
import { prune } from './passes/prune.js';
import { renames } from './passes/renames.js';
import { exact } from './passes/exact.js';
import { unnest } from './passes/unnest.js';
import { fuse } from './passes/fuse.js';
import { joins } from './passes/joins.js';
import { outer } from './passes/outer.js';
import { kids, scalarsOf } from './passes/decorrelate.js';
import { pipe, checked } from './check.js';
// The correlated plan: the plan before decorrelation, its scalars standard, its measures fused,
// a subtree held more than once one definition.
// A plan's size: its operators and its scalars' nodes, its definitions' once each.
function planSize(root) {
  let n = 0;
  const S = x => {
    if (!x || typeof x !== 'object') return;
    n++;
    if (x.k === 'exists') R(x.rel);
    for (const y of [...(x.a ?? []), ...(x.w ?? []).flat(), x.e]) S(y);
  };
  const R = r => { n++; kids(r).forEach(R); scalarsOf(r).forEach(S); };
  R(root.src);
  for (const d of root.defs ?? []) R(d.rel);
  return n;
}
const correlated = pipe([['fuseApplies', fuseApplies], ['standard', standard], ['exact', exact], ['share', share], ['inline', inline], ['renames', renames], ['prune', prune]]);
// The correlated plan unnested (passes/unnest.js), for an engine that does not unnest: no apply,
// no correlated EXISTS; the σ over × it leaves joins, the measures over the same rows one grouping.
const unnested = pipe([['fuseApplies', fuseApplies], ['standard', standard], ['exact', exact], ['unnest', unnest], ['joins', joins], ['fuse', fuse], ['outer', outer], ['share', share], ['inline', inline], ['renames', renames], ['prune', prune]]);
// The plan read back from Substrait, checked as any pass's (DAXSQL_CHECK).
const readBack = checked('the Substrait read back', x => x, { final: true });
import { explain as drawPlan } from './explain.js';
import { optimize } from './passes/index.js';

export { DaxError } from './errors.js';
export { Dialect } from './dialects/base.js';
export { DuckDBDialect } from './dialects/duckdb.js';
export { TSqlDialect } from './dialects/tsql.js';
export { PostgresDialect } from './dialects/postgres.js';
export { PolarsDialect } from './dialects/polars.js';
export { DataFusionDialect } from './dialects/datafusion.js';
export { parseQuery, parseExpression } from './parser.js';
export { parseSql, modelRelations } from './sql.js';

// Semantic views (views.js): models named in SQL, and CREATE / DROP / SHOW SEMANTIC VIEW.
import { makeViews } from './views.js';
export const createViews = options => makeViews(createCompiler, options);
export { Model } from './model.js';

const DIALECTS = { duckdb: () => new DuckDBDialect(), tsql: () => new TSqlDialect(), postgres: () => new PostgresDialect(), polars: () => new PolarsDialect(), datafusion: () => new DataFusionDialect() };

// A query: its text (or, `tree`, the tree a DAX query parses to); anything else, a SYNTAX error.
function query(q, tree = true) {
  if (typeof q === 'string' || (tree && q && typeof q === 'object')) return q;
  throw new DaxError(`a query is a text, not ${q === null ? 'null' : typeof q}`, { code: 'SYNTAX' });
}

export function createCompiler(input, options = {}) {
  const model = input instanceof Model ? input : new Model(input);
  const dialect = options.dialect instanceof Dialect ? options.dialect : DIALECTS[options.dialect ?? 'duckdb']?.();
  if (!dialect) throw new DaxError(`unknown dialect ${options.dialect}`);
  const base = new Compiler(model, options);

  // A calculated column: its expression on a row of its table, in an empty filter context.
  const calc = new Map();
  const calcColumn = col => {
    // One the query defines (DEFINE COLUMN) was compiled with the query.
    if (col.query) return col.query;
    let c = calc.get(col);
    if (!c) {
      const row = newRow(col.table.columns.filter(x => !x.query).map(x => ({ name: x.name, lineage: x, t: x.type })), 'scan', { base: col.table });
      calc.set(col, { busy: true });
      let ast;
      try { ast = parseExpression(col.expr); } catch (e) {
        calc.delete(col);
        if (e instanceof DaxError) e.message = `calculated column '${col.table.name}'[${col.name}]: ${e.message}`;
        throw e;
      }
      c = { row, expr: base.scalar(ast, base.env({ rows: [row] })) };
      calc.set(col, c);
    }
    if (c.busy) throw new DaxError(`calculated column '${col.table.name}'[${col.name}] refers to itself`);
    return c;
  };

  // A calculated table: its expression in an empty filter context.
  const tables = new Map();
  const calcTable = table => {
    let t = tables.get(table);
    if (t === 'busy') throw new DaxError(`calculated table '${table.name}' refers to itself`);
    if (!t) {
      tables.set(table, 'busy');
      try { t = base.table(parseExpression(table.calc), base.env()); } catch (e) {
        tables.delete(table);
        if (e instanceof DaxError) e.message = `calculated table '${table.name}': ${e.message}`;
        throw e;
      }
      tables.set(table, t);
    }
    return t;
  };

  // Row-level security: each role's table filters, as predicates on a row of their table.
  const roleNames = options.roles == null ? [] : [options.roles].flat();
  const security = roleNames.map(name => {
    const role = model.roles.find(r => r.name.toLowerCase() === String(name).toLowerCase());
    if (!role) throw semantic(`the model has no role ${name}`);
    return {
      name: role.name,
      filters: role.filters.map(f => {
        const row = newRow(f.table.columns.map(x => ({ name: x.name, lineage: x, t: x.type })), 'scan', { base: f.table });
        let ast;
        try { ast = parseExpression(f.text); } catch (e) {
          if (e instanceof DaxError) e.message = `role ${role.name}, '${f.table.name}': ${e.message}`;
          throw e;
        }
        return { table: f.table, row, pred: base.scalar(ast, base.env({ rows: [row] })) };
      }),
    };
  }).map(role => ({
    ...role,
    // As a filter context: each table filter a predicate on its table's columns, moving along
    // the relationships as security does.
    ctx: new Ctx(role.filters.map(f => ({ kind: 'pred', cols: f.table.columns, row: f.row, pred: f.pred })),
      { security: true, active: new Map(), cross: new Map() }),
  }));

  // Object-level security: what every role hides (one shows what another hides), as the names a
  // query writes see it (Model.fork). Roles that hide objects together with others that filter
  // rows are an error in Power BI; one role can do both.
  const roles = roleNames.map(name => model.roles.find(r => r.name.toLowerCase() === String(name).toLowerCase()));
  // The error is a query's, as in Power BI: the compiler is made, each query refused.
  const rolesError = roles.length > 1 && roles.some(r => r.hidden.length) && roles.some(r => r.filters.length)
    ? 'The combination of active roles results in a dynamic security configuration that is currently not supported' : null;
  if (roles.length && roles.every(r => r.hidden.length)) {
    const hides = (r, t, c) => r.hidden.some(h => h.table === t || (c && h.column === c));
    base.hidden = {
      tables: new Set([...model.tables.values()].filter(t => roles.every(r => hides(r, t)))),
      columns: new Set([...model.tables.values()].flatMap(t => t.columns).filter(c => roles.every(r => hides(r, c.table, c)))),
    };
  }

  const cache = new Map();
  // Every dialect's SQL is the query plan's (lower.js), written from it as Substrait (substrait.js)
  // read back (substrait-read.js): nothing reaches the SQL that the Substrait does not carry.
  // DuckDB is given the plan correlated (it unnests it itself), every other engine the plan
  // unnested (passes/unnest.js). There is no other way to SQL.
  const pipeline = dialect.name === 'duckdb' ? correlated : unnested;
  // The engine's pass, after the Substrait is read: a function the plan defines that the dialect
  // writes as its own (DuckDB's FORMAT) its arguments alone, and what only its definition read
  // pruned. (In place: the plan is the one just read.)
  const engine = plan => {
    const own = dialect.nativeFns;
    if (!own?.size) return plan;
    const seen = new Set();
    let found = false;
    const walk = x => {
      if (!x || typeof x !== 'object' || seen.has(x)) return;
      seen.add(x);
      if (x.k === 'pop' && x.op === 'defined' && own.has(x.name)) { x.a[x.argc] = { k: 'lit', v: null, t: x.t, nn: false }; found = true; }
      for (const [k, v] of Object.entries(x)) if (k !== 'lineage' && k !== 'table' && k !== 'base') walk(v);
    };
    walk(plan);
    return found ? prune(plan) : plan;
  };
  const planned = opts => statements => statements.map(s => {
    const o = { ...opts, calcColumn, calcTable, security };
    const p = new Lowerer(model, o).query(s);
    const passed = pipeline(p.plan);
    const plan = readBack(engine(readSubstrait(JSON.parse(JSON.stringify(toSubstrait(passed).plan)), model, { columns: p.columns, castOutput: options.castOutput })));
    const ps = new PlanSql(model, dialect, o);
    const sql = ps.query({ ...p, plan });
    // Its size (the smaller of a calculation group's two forms is kept): the plan's, after the passes.
    return { sql, ctes: ps.parts.ctes, body: ps.parts.body, aliases: ps.n, ordered: p.ordered, columns: p.columns, size: planSize(passed) };
  });
  // `dax`: the query's text, or its tree (keyed by `key`, the text it was built from).
  // `extra`: options of this compilation only (aliasStart).
  function compileAll(dax, key = dax, extra = null) {
    query(dax);
    if (rolesError) throw semantic(rolesError);
    const opts = extra ? { ...options, ...extra } : options;
    if (extra) key = `${key}\u0000${JSON.stringify(extra)}`;
    let out = cache.get(key);
    if (out) return out;
    const make = planned(opts);
    out = base.query(dax, make);
    if (base.splitOne && dialect.splitOneGroup === 'smaller') {
      // The smaller: the plan's size (as plans keeps), else the SQL's.
      const size = o => o.reduce((n, x) => n + (x.size ?? (x.sql ?? '').length), 0);
      base.noSplit = true;
      try {
        const whole = base.query(dax, make);
        if (size(whole) < size(out)) out = whole;
      } finally { base.noSplit = false; }
    }
    if (cache.size >= 500) cache.clear();
    cache.set(key, out);
    return out;
  }
  // A SELECT over the model: the DAX query's tree it builds, compiled as DAX's is (no DAX text
  // between them), with its LIMIT and OFFSET.
  const sqlTranslator = new SqlTranslator(model);
  function translateSql(text, extra = null) {
    const t = sqlTranslator.translate(text);
    const [out] = compileAll(t.query, `SQL ${text}`, extra);
    if (t.limit == null && t.offset == null) return { ...t, out };
    const limit = dialect.limit(t.limit, t.offset, out.ordered);
    return { ...t, out: { ...out, sql: out.sql + limit, body: out.body + limit, limited: true } };
  }
  const compileSql = text => translateSql(text).out;
  // Any SQL with SELECTs over the model in it: each one's SQL in its place, the rest as written.
  // The model queries of a statement, each compiled, where they are in it: { whole, relations:
  // [{ start, end, arm, text, dax, sql, ctes, body, ordered }], aliases }. Aliases are numbered
  // from `aliases` on, so that queries of several models can share one WITH.
  function statementRelations(text, name = 'model', aliases = 0) {
    query(text, false);
    if (/^\s*(DEFINE|EVALUATE)\b/i.test(text)) throw new DaxError('SQL: a DAX query is not SQL', { code: 'UNSUPPORTED' });
    const relation = t => {
      const { query, out } = translateSql(t, dialect.nestedWith ? null : { aliasStart: aliases });
      aliases = out.aliases;
      return { text: t, dax: printDaxQuery(query), sql: out.sql, ctes: out.ctes, body: out.body, ordered: out.ordered && !out.limited };
    };
    const found = modelRelations(text, name);
    if (found.whole) return { whole: relation(text), relations: [], aliases };
    const relations = found.relations.map(r => ({ ...r, ...relation(r.text) }));
    return { whole: null, relations, aliases };
  }
  // Any SQL with SELECTs over the model in it: each one's SQL in its place, the rest as written.
  function compileStatement(text, name = 'model') {
    const { whole, relations } = statementRelations(text, name);
    const out = whole ? [whole] : relations;
    return { sql: whole ? whole.sql : spliceStatement(text, relations, dialect), relations: out.map(({ text: t, dax, sql }) => ({ text: t, dax, sql })) };
  }
  // The query plan: what an engine has to do for the query, as relational algebra (lower.js),
  // with no rewrite; one per EVALUATE. -> [{ plan, columns, ordered }]
  function plans(text) {
    query(text);
    if (rolesError) throw semantic(rolesError);
    const opts = { ...options, calcColumn, calcTable, security };
    const lower1 = q => base.query(q, statements => statements.map(s => new Lowerer(model, opts).query(s)));
    // SUMMARIZECOLUMNS by one calculation group's column: a level for each item, or one for all
    // of them; the smaller plan, as compileAll keeps the smaller SQL.
    const lower = q => {
      const out = lower1(q);
      if (!base.splitOne) return out;
      base.noSplit = true;
      try {
        const whole = lower1(q);
        const size = ps => ps.reduce((n, p) => n + planSize(p.plan), 0);
        return size(whole) < size(out) ? whole : out;
      } finally { base.noSplit = false; }
    };
    if (!isSqlQuery(text)) return lower(text);
    const t = sqlTranslator.translate(text);
    const [p] = lower(t.query);
    if (t.limit != null || t.offset != null) p.plan.limit = { n: t.limit, offset: t.offset };
    return [p];
  }
  // The plan a call asks for: { unnest }, { correlated }, { optimize: false } (as lowered), or optimized.
  const pick = (plan, o) => (o.unnest ? unnested(plan) : o.correlated ? correlated(plan) : o.optimize === false ? plan : optimize(plan));
  const onePlan = text => {
    const out = plans(text);
    if (out.length !== 1) throw new DaxError(`the query has ${out.length} EVALUATE statements`);
    return out[0];
  };
  return {
    model,
    dialect,
    // One EVALUATE, or a SELECT over the model -> its query plan (plan.js, made by lower.js and
    // the passes/). { optimize: false }: before the passes (the reference CI checks them with).
    plan: (text, o = {}) => pick(onePlan(text).plan, o),
    // The query plan drawn as a tree, one per EVALUATE.
    explain: (text, o = {}) => plans(text).map(p => drawPlan(pick(p.plan, o))).join('\n\n'),
    // The query plan's SQL: { sql, columns }, as compile gives.
    // correlated: the plan before decorrelation, its scalars standard (its applies LATERAL or
    // scalar subqueries, its EXISTS EXISTS: for an engine that unnests them, as DuckDB does).
    // Its SQL is written from the plan as Substrait (substrait.js), read back (substrait-read.js):
    // nothing reaches the SQL that the Substrait does not carry (the plan as lowered, which
    // holds DAX's own functions, has no SQL).
    planSql(text, o = {}) {
      if (o.optimize === false) throw new DaxError('planSql: the plan as lowered (DAX functions in it) has no Substrait, and so no SQL', { code: 'UNSUPPORTED' });
      const p = onePlan(text);
      const plan = readBack(engine(readSubstrait(JSON.parse(JSON.stringify(toSubstrait(pick(p.plan, o)).plan)), model, { columns: p.columns, castOutput: options.castOutput })));
      return { sql: new PlanSql(model, dialect, options).query({ ...p, plan }), columns: p.columns };
    },
    // The query plan as a Substrait plan (substrait.js): { plan (its JSON form), dax (dax-sql's
    // functions it uses), columns }. o: optimize, inline, tableName, tableSchema.
    substrait(text, o = {}) {
      const p = onePlan(text);
      // unnest, correlated, or optimized: the plan planSql writes its SQL from.
      if (o.optimize === false) throw new DaxError('substrait: the plan as lowered (DAX functions in it) has no Substrait', { code: 'UNSUPPORTED' });
      return { ...toSubstrait(pick(p.plan, o), o), columns: p.columns };
    },
    // One EVALUATE, or a SELECT over the model -> { sql, columns: [{ name, dax, type, lineage }] }.
    compile(dax) {
      query(dax);
      if (isSqlQuery(dax)) return compileSql(dax);
      const out = compileAll(dax);
      if (out.length !== 1) throw new DaxError(`the query has ${out.length} EVALUATE statements; use compileAll`);
      return out[0];
    },
    compileAll,
    // Any SQL in which a SELECT over the model (FROM `name`, 'model' by default) is a relation in
    // parentheses -> { sql, relations: [{ text, dax, sql }] }: each SELECT's SQL in its place, the
    // rest as written. A text that is one SELECT over the model is compiled whole.
    compileStatement,
    statementRelations,
    // Whether a text is a DAX query (it starts with DEFINE or EVALUATE).
    isDax: text => /^\s*(DEFINE|EVALUATE)\b/i.test(text),
    // Whether a text is a SELECT over the model, and the DAX query it stands for, with its
    // LIMIT and OFFSET ({ dax, limit, offset }).
    isSql,
    sqlToDax: text => {
      const { query, limit, offset } = sqlTranslator.translate(text);
      return { dax: printDaxQuery(query), limit, offset };
    },
    fieldParameters: () => fieldParameters(model),
    // The fields a field parameter's selection stands for (all of them without `labels`), in
    // its order: what Power BI puts in a visual's query in the parameter's place.
    expandFieldParameter(table, labels = null) {
      const p = fieldParameters(model).find(x => x.table.toLowerCase() === String(table).toLowerCase());
      if (!p) throw semantic(`'${table}' is not a field parameter`);
      const keep = labels && new Set([labels].flat().map(l => String(l).toLowerCase()));
      return p.fields.filter(f => !keep || keep.has(String(f.label).toLowerCase()));
    },
  };
}

// The field parameters of the model: calculated tables like
//   { ("Sales", NAMEOF('Sales'[Sales Amount]), 0), ... }
// whose fields column Power BI marks (ParameterMetadata). Each field: its label, its DAX
// reference, its order, and whether it names a column or a measure.
function fieldParameters(model) {
  const out = [];
  for (const t of model.tables.values()) {
    const fieldsCol = t.columns.find(c => c.fieldParameter);
    if (!t.calc || !fieldsCol) continue;
    const ast = parseExpression(t.calc);
    if (ast.k !== 'table') continue;
    const at = c => Number(/Value(\d+)\]?$/i.exec(c.source)?.[1] ?? 0) - 1;
    const iField = at(fieldsCol);
    const labelCol = t.columns.find(c => at(c) === (iField === 0 ? 1 : 0));
    const orderCol = t.columns.find(c => c !== fieldsCol && c !== labelCol && at(c) >= 0);
    const cell = x => {
      if (x.k === 'str' || x.k === 'num') return x.k === 'num' ? Number(x.v) : x.v;
      if (x.k === 'call' && x.fn === 'NAMEOF' && x.args[0]?.k === 'col') return model.nameOf(x.args[0]);
      return null;
    };
    const fields = ast.rows.map(r => {
      const ref = cell(r[iField]);
      const m = /^'(.*)'\[(.*)\]$/.exec(ref ?? '');
      const isMeasure = m && model.measure(m[2]) && !model.findColumn(m[1], m[2]);
      return { label: labelCol ? cell(r[at(labelCol)]) : ref, ref, order: orderCol ? cell(r[at(orderCol)]) : null,
        kind: isMeasure ? 'measure' : 'column', name: m?.[2] ?? null, tableName: m?.[1] ?? null };
    }).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    out.push({ table: t.name, label: labelCol?.name ?? null, fields: fieldsCol.name, order: orderCol?.name ?? null, fields_: fields });
  }
  return out.map(p => ({ table: p.table, labelColumn: p.label, fieldsColumn: p.fields, orderColumn: p.order, fields: p.fields_ }));
}
