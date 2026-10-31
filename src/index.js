// dax-sql: DAX queries over a Tabular semantic model -> SQL.
//
//   import { createCompiler } from 'dax-sql';
//   const dax = createCompiler(model, { tableSource: t => `v_${t.name}` });
//   const { sql, columns } = dax.compile('EVALUATE SUMMARIZECOLUMNS(...)');
//
// `model` is dax-sql's model object (model.js says its shape), which no file is: the readers
// in formats/ (dax-sql/formats/tmsl.js, dax-sql/formats/ossie.js) make one from a TMSL
// model.bim or an Apache Ossie model.
// Options:
//   dialect        'duckdb' (the default) or a Dialect instance (see dialects/base.js)
//   tableSource    (table) => SQL that names a model table's rows; by default its source's
//                  entity ("schema"."entity"), else its name
//   columnNames    'short' (the default: the column or the expression's name) or 'dax'
//                  ('Table'[Column], [Measure]) for the result's columns
//   castOutput     true (the default): whole numbers as BIGINT, numbers as DOUBLE; or, by
//                  the column's type, a function of its SQL ({ int: s => `CAST(${s} AS INTEGER)` })
//   assumeIntegrity  true: every relationship relies on referential integrity, so a
//                  dimension's key is read off the fact's foreign key with no join (by
//                  default only those whose assumeIntegrity says so)
//   blankRows      false: no blank row for a dimension whose keys some fact rows miss (VALUES,
//                  ALL and SUMMARIZECOLUMNS list it otherwise; this saves a check per table)
//   user           the value of USERNAME() and USERPRINCIPALNAME()
//   roles          the names of the model's roles to query as (row-level security): every
//                  table's rows are those some role keeps
//   params         the values of query parameters (@name), by name
import { Model } from './model.js';
import { Compiler } from './compiler.js';
import { Emitter } from './emit.js';
import { parseExpression } from './parser.js';
import { DuckDBDialect } from './dialects/duckdb.js';
import { Dialect } from './dialects/base.js';
import { newRow } from './ir.js';
import { DaxError, semantic } from './errors.js';
import { Ctx } from './context.js';
import { SqlTranslator, isSql, printDaxQuery, modelRelations } from './sql.js';

export { DaxError } from './errors.js';
export { Dialect } from './dialects/base.js';
export { DuckDBDialect } from './dialects/duckdb.js';
export { parseQuery, parseExpression } from './parser.js';
export { parseSql, modelRelations } from './sql.js';

// Semantic views (views.js): models named in SQL, and CREATE / DROP / SHOW SEMANTIC VIEW.
import { makeViews } from './views.js';
export const createViews = options => makeViews(createCompiler, options);
export { Model } from './model.js';

const DIALECTS = { duckdb: () => new DuckDBDialect() };

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

  const cache = new Map();
  // `dax`: the query's text, or its tree (keyed by `key`, the text it was built from).
  function compileAll(dax, key = dax) {
    let out = cache.get(key);
    if (out) return out;
    out = base.query(dax, statements => statements.map(s => new Emitter(model, dialect, { ...options, calcColumn, calcTable, security }).query(s)));
    if (cache.size >= 500) cache.clear();
    cache.set(key, out);
    return out;
  }
  // A SELECT over the model: the DAX query's tree it builds, compiled as DAX's is (no DAX text
  // between them), with its LIMIT and OFFSET.
  const sqlTranslator = new SqlTranslator(model);
  function translateSql(text) {
    const t = sqlTranslator.translate(text);
    const [out] = compileAll(t.query, `SQL ${text}`);
    return { ...t, out: t.limit == null && t.offset == null ? out : { ...out, sql: out.sql + dialect.limit(t.limit, t.offset) } };
  }
  const compileSql = text => translateSql(text).out;
  // Any SQL with SELECTs over the model in it: each one's SQL in its place, the rest as written.
  function compileStatement(text, name = 'model') {
    if (/^\s*(DEFINE|EVALUATE)\b/i.test(text)) throw new DaxError('SQL: a DAX query is not SQL', { code: 'UNSUPPORTED' });
    const relation = t => {
      const { query, out } = translateSql(t);
      return { text: t, dax: printDaxQuery(query), sql: out.sql };
    };
    const { whole, relations } = modelRelations(text, name);
    if (whole) {
      const r = relation(text);
      return { sql: r.sql, relations: [r] };
    }
    let sql = text;
    const out = relations.map(r => ({ ...r, ...relation(r.text) }));
    for (const r of [...out].reverse()) sql = `${sql.slice(0, r.start)}\n${r.sql}\n${sql.slice(r.end)}`;
    return { sql, relations: out.map(({ text: t, dax, sql: s }) => ({ text: t, dax, sql: s })) };
  }
  return {
    model,
    dialect,
    // One EVALUATE, or a SELECT over the model -> { sql, columns: [{ name, dax, type, lineage }] }.
    compile(dax) {
      if (isSql(dax)) return compileSql(dax);
      const out = compileAll(dax);
      if (out.length !== 1) throw new DaxError(`the query has ${out.length} EVALUATE statements; use compileAll`);
      return out[0];
    },
    compileAll,
    // Any SQL in which a SELECT over the model (FROM `name`, 'model' by default) is a relation in
    // parentheses -> { sql, relations: [{ text, dax, sql }] }: each SELECT's SQL in its place, the
    // rest as written. A text that is one SELECT over the model is compiled whole.
    compileStatement,
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
