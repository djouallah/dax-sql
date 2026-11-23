// The query plan as a Substrait plan (https://substrait.io), in its JSON form: the same
// relations and scalars, each a Substrait relation or expression. A column is its position in
// its input's record, a function an extension function: Substrait's own (comparison, boolean,
// arithmetic, rounding, logarithmic, string, datetime, aggregate) where one means what the plan's
// does, else one of dax-sql's (EXTENSION below: what standard SQL has no one function for, as
// to_text, format_number). A definition read in several places is a plan relation read by a
// ReferenceRel (inline: true writes it where it is read instead).
//
//   toSubstrait(plan, { tableName, tableSchema, inline }) -> { plan, dax: [dax-sql's functions it uses] }
//     tableName(table)    the name a scan reads (default: its source's entity, else its name)
//     tableSchema(table)  [{ name, type }] of the table's stored columns, type a Substrait kind
//                         ('i64', 'fp64', 'string', 'bool', 'date', 'timestamp', 'decimal(19,4)');
//                         by default from the model's columns

const URN = {
  comparison: 'extension:io.substrait:functions_comparison',
  boolean: 'extension:io.substrait:functions_boolean',
  arithmetic: 'extension:io.substrait:functions_arithmetic',
  rounding: 'extension:io.substrait:functions_rounding',
  logarithmic: 'extension:io.substrait:functions_logarithmic',
  string: 'extension:io.substrait:functions_string',
  datetime: 'extension:io.substrait:functions_datetime',
  aggregate: 'extension:io.substrait:functions_aggregate_generic',
  dax: 'extension:io.github.dax-sql:functions',
};
// The plan's operators, as Substrait's functions.
const OPS = {
  eq: ['comparison', 'equal'], ne: ['comparison', 'not_equal'], lt: ['comparison', 'lt'], le: ['comparison', 'lte'],
  gt: ['comparison', 'gt'], ge: ['comparison', 'gte'], key: ['comparison', 'is_not_distinct_from'],
  isnull: ['comparison', 'is_null'], notnull: ['comparison', 'is_not_null'], coalesce: ['comparison', 'coalesce'], nullif: ['comparison', 'nullif'],
  and: ['boolean', 'and'], or: ['boolean', 'or'], not: ['boolean', 'not'],
  add: ['arithmetic', 'add'], sub: ['arithmetic', 'subtract'], mul: ['arithmetic', 'multiply'], div: ['arithmetic', 'divide'], neg: ['arithmetic', 'negate'],
  concat: ['string', 'concat'],
};
// The plan's named functions: Substrait's, or dax-sql's (EXTENSION).
const FNS = {
  abs: ['arithmetic', 'abs'], sign: ['arithmetic', 'sign'], power: ['arithmetic', 'power'], mod: ['arithmetic', 'modulus'], idiv: ['arithmetic', 'divide'],
  round: ['rounding', 'round'], floor: ['rounding', 'floor'], ceil: ['rounding', 'ceil'], log10: ['logarithmic', 'log10'],
  greatest: ['comparison', 'greatest'], least: ['comparison', 'least'],
  upper: ['string', 'upper'], lower: ['string', 'lower'], replace: ['string', 'replace'], strpos: ['string', 'strpos'], substring: ['string', 'substring'],
  length: ['string', 'char_length'], left: ['string', 'left'], right: ['string', 'right'], trim: ['string', 'trim'], contains: ['string', 'contains'],
  regexp_replace: ['string', 'regexp_replace'],
};
// dax-sql's functions, each with its meaning (docs/substrait/functions_dax_sql.yaml).
export const EXTENSION = {
  to_text: 'a number with a fraction or a date as DAX writes it: 15 significant digits; a date M/D/YYYY, with the time when not midnight',
  format_number: 'FORMAT and FIXED of a number by a pattern (the pattern parsed, as JSON: sections, digits, separators)',
  format_date: 'FORMAT of a date by a pattern (parsed, as JSON)',
  combinevalues: 'COMBINEVALUES: the values as text joined by the separator',
  replace_nth: "SUBSTITUTE's instance number: the n-th occurrence of a text replaced",
  parse_datetime: 'text read as a date and time: ISO, or as en-US writes one (3/5/2024, March 5, 2024)',
  code_point: "a text's first character's code point (Substrait's string functions have none)",
};
const AGGS = {
  sum: ['arithmetic', 'sum'], avg: ['arithmetic', 'avg'], min: ['arithmetic', 'min'], max: ['arithmetic', 'max'], product: ['arithmetic', 'product'],
  median: ['arithmetic', 'median'], stdev_s: ['arithmetic', 'std_dev'], stdev_p: ['arithmetic', 'std_dev'], var_s: ['arithmetic', 'variance'], var_p: ['arithmetic', 'variance'],
  count_values: ['aggregate', 'count'], count_star: ['aggregate', 'count'], count_distinct: ['aggregate', 'count'], string_agg: ['string', 'string_agg'],
};
const WINDOWS = { row_number: ['arithmetic', 'row_number'], rank: ['arithmetic', 'rank'], dense_rank: ['arithmetic', 'dense_rank'], count: ['aggregate', 'count'] };

const N = 'NULLABILITY_NULLABLE';
const KIND = { int: 'i64', double: 'fp64', decimal: 'decimal(19,4)', string: 'string', bool: 'bool', datetime: 'timestamp', blank: 'string' };
function type(kind) {
  const m = /^decimal\((\d+),(\d+)\)$/.exec(kind);
  if (m) return { decimal: { precision: +m[1], scale: +m[2], nullability: N } };
  if (kind === 'timestamp') return { precisionTimestamp: { precision: 6, nullability: N } };
  return { [kind]: { nullability: N } };
}
const typeOf = t => type(KIND[t] ?? 'string');
const field = i => ({ selection: { directReference: { structField: i ? { field: i } : {} }, rootReference: {} } });
const emit = map => ({ emit: { outputMapping: map } });
const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);
const DAY = 86400000;
const FIRST_DAY = -719162;   // 0001-01-01, in days from 1970-01-01
const INLINE_LIMIT = 20000;
const kidsOf = r => (r.k === 'join' ? [r.left, r.right] : r.k === 'union' ? r.srcs : r.src ? [r.src] : []);

export function toSubstrait(plan, options = {}) {
  const tableName = options.tableName ?? (t => t.source?.entity ?? t.name);
  const tableSchema = options.tableSchema ?? (t => t.columns.filter(c => !c.expr).map(c => ({ name: c.source ?? c.name, type: KIND[c.type] ?? 'string' })));
  const urns = new Map(), fns = new Map(), used = { dax: new Set() };
  const fn = ([family, name]) => {
    if (family === 'dax') used.dax.add(name);
    if (!urns.has(family)) urns.set(family, urns.size + 1);
    const key = `${family}:${name}`;
    if (!fns.has(key)) fns.set(key, { anchor: fns.size + 1, urn: urns.get(family), name });
    return fns.get(key).anchor;
  };
  const call = (f, args, t) => ({ scalarFunction: { functionReference: fn(f), arguments: args.map(value => ({ value })), outputType: typeOf(t) } });

  // Definitions: plan relations, read by ReferenceRel (or inline).
  const defIndex = new Map();
  const relations = [];
  const D = def => {
    if (!defIndex.has(def)) { const rel = R(def.rel); defIndex.set(def, relations.length); relations.push({ rel }); }
    return defIndex.get(def);
  };

  // A scalar over the columns `cols` (its input's record), of type hint where it is a blank.
  const E = (x, cols, hint) => {
    const at = c => { const i = cols.indexOf(c); if (i < 0) throw new Error(`substrait: column ${c.name} (${c.id}) not in the input`); return i; };
    const S = (y, h) => E(y, cols, h);
    switch (x.k) {
      case 'ref': return field(at(x.col));
      case 'lit': return literal(x.v, x.t === 'blank' ? hint ?? 'string' : x.t);
      case 'case': {
        const h = x.t !== 'blank' ? x.t : hint;
        return { ifThen: { ifs: x.w.map(([c, v]) => ({ if: S(c), then: S(v, h) })), else: S(x.e, h) } };
      }
      case 'exists': return { subquery: { setPredicate: { predicateOp: 'PREDICATE_OP_EXISTS', tuples: R(x.rel) } } };
      case 'pop': return pop(x, S);
    }
    throw new Error(`substrait: scalar ${x.k}`);
  };
  const pop = (x, S) => {
    const [a, b] = x.a;
    // A blank argument typed as the other's, or as the result.
    const peer = i => (x.a[1 - i] && x.a[1 - i].t !== 'blank' ? x.a[1 - i].t : x.t !== 'bool' ? x.t : undefined);
    const args = () => x.a.map((y, i) => S(y, peer(i)));
    switch (x.op) {
      case 'true': return { literal: { boolean: true } };
      case 'false': return { literal: { boolean: false } };
      case 'in': return { singularOrList: { value: S(a), options: x.a.slice(1).map(y => S(y, a.t)) } };
      case 'cast': return { cast: { type: typeOf(x.to), input: S(a, x.to), failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } };
      case 'and': case 'or':
        return call(OPS[x.op], args(), 'bool');
      case 'call': return named(x, S);
    }
    if (OPS[x.op]) return call(OPS[x.op], args(), x.t);
    throw new Error(`substrait: operator ${x.op}`);
  };
  // Substrait's datetime functions (functions_datetime): extract, with its indexing where the
  // component has one; round_calendar; add and multiply of intervals.
  const I = v => ({ literal: { i64: String(v) } });
  const ar = (name, xs) => call(['arithmetic', name], xs, 'int');
  const INDEXED = new Set(['QUARTER', 'MONTH', 'DAY', 'DAY_OF_YEAR', 'MONDAY_DAY_OF_WEEK', 'SUNDAY_DAY_OF_WEEK']);
  const extract = (component, x, indexing = INDEXED.has(component) ? 'ONE' : null) => ({ scalarFunction: { functionReference: fn(['datetime', 'extract']),
    arguments: [{ enum: component }, ...(indexing ? [{ enum: indexing }] : []), { value: x }], outputType: typeOf('int') } });
  // A date's day number: 365 (y - 1) + (y - 1) / 4 - (y - 1) / 100 + (y - 1) / 400 + its day of the year.
  const dayNumber = x => {
    const y1 = ar('subtract', [extract('YEAR', x), I(1)]);
    return ar('add', [ar('add', [ar('subtract', [ar('add', [ar('multiply', [I(365), y1]), ar('divide', [y1, I(4)])]), ar('divide', [y1, I(100)])]), ar('divide', [y1, I(400)])]), extract('DAY_OF_YEAR', x)]);
  };
  // A date and time as a count of a unit: two differ by the units between them (DATEDIFF's).
  const count = (unit, x) => {
    switch (unit) {
      case 'year': return extract('YEAR', x);
      case 'quarter': return ar('add', [ar('multiply', [extract('YEAR', x), I(4)]), extract('QUARTER', x)]);
      case 'month': return ar('add', [ar('multiply', [extract('YEAR', x), I(12)]), extract('MONTH', x)]);
      case 'week': return ar('divide', [ar('subtract', [dayNumber(x), extract('SUNDAY_DAY_OF_WEEK', x, 'ZERO')]), I(7)]);
      case 'day': return dayNumber(x);
    }
    const h = ar('add', [ar('multiply', [dayNumber(x), I(24)]), extract('HOUR', x)]);
    if (unit === 'hour') return h;
    const mi = ar('add', [ar('multiply', [h, I(60)]), extract('MINUTE', x)]);
    if (unit === 'minute') return mi;
    const sec = ar('add', [ar('multiply', [mi, I(60)]), extract('SECOND', x)]);
    if (unit === 'second') return sec;
    if (unit === 'microsecond') return ar('multiply', [sec, I(1000000)]);
    throw new Error(`substrait: DATEDIFF by ${unit}`);
  };
  // n intervals of one unit (multiply: the integer first).
  const interval = (n, by) => call(['datetime', 'multiply'], [n, { literal: by }], 'int');
  const DAY1 = { intervalDayToSecond: { days: 1, seconds: 0, precision: 6 } }, MONTH1 = { intervalYearToMonth: { months: 1 } };
  const named = (x, S) => {
    const a = x.a.map(y => S(y, x.t));
    const m = /^(extract|date_trunc|date_diff)_(\w+)$/.exec(x.name);
    if (x.name === 'extract_dow') return extract('SUNDAY_DAY_OF_WEEK', a[0], 'ZERO');
    if (m?.[1] === 'extract') return extract(m[2].toUpperCase(), a[0]);
    if (m?.[1] === 'date_trunc') {
      const [unit, multiple] = { year: ['YEAR', 1], quarter: ['MONTH', 3], month: ['MONTH', 1] }[m[2]] ?? [m[2].toUpperCase(), 1];
      return { scalarFunction: { functionReference: fn(['datetime', 'round_calendar']), arguments: [{ value: a[0] }, { enum: 'FLOOR' }, { enum: unit }, { enum: 'YEAR' }, { value: I(multiple) }], outputType: typeOf(x.t) } };
    }
    if (m?.[1] === 'date_diff') return ar('subtract', [count(m[2], a[1]), count(m[2], a[0])]);
    if (x.name === 'add_days' || x.name === 'add_months') {
      const n = x.a[1];
      const by = n.k === 'lit' && Number.isInteger(n.v)
        ? { literal: x.name === 'add_days' ? { intervalDayToSecond: { days: n.v, seconds: 0, precision: 6 } } : { intervalYearToMonth: { months: n.v } } }
        : interval(a[1], x.name === 'add_days' ? DAY1 : MONTH1);
      return call(['datetime', 'add'], [a[0], by], x.t);
    }
    if (x.name === 'add_microseconds') return call(['datetime', 'add'], [a[0], interval(a[1], { intervalDayToSecond: { days: 0, seconds: 0, subseconds: '1', precision: 6 } })], x.t);
    // DATE(y, m, d): 0001-01-01 moved by y - 1 years, m - 1 months and d - 1 days.
    if (x.name === 'make_date') {
      const y = call(['datetime', 'add'], [{ literal: { date: FIRST_DAY } }, interval(ar('subtract', [a[0], I(1)]), { intervalYearToMonth: { years: 1 } })], 'datetime');
      const mo = call(['datetime', 'add'], [y, interval(ar('subtract', [a[1], I(1)]), MONTH1)], 'datetime');
      return call(['datetime', 'add'], [mo, interval(ar('subtract', [a[2], I(1)]), DAY1)], x.t);
    }
    // A number with its fraction cut: floor of one not negative, ceil of a negative.
    if (x.name === 'trunc') return { ifThen: { ifs: [{ if: call(['comparison', 'gte'], [a[0], I(0)], 'bool'), then: call(['rounding', 'floor'], [a[0]], x.t) }], else: call(['rounding', 'ceil'], [a[0]], x.t) } };
    // The n-th piece of a text: string_split's list, its element n - 1 (n a constant).
    if (x.name === 'split_part') {
      const n = x.a[2];
      if (n.k !== 'lit' || !Number.isInteger(n.v)) throw new Error('substrait: the piece of a text whose number is not a constant');
      return { selection: { directReference: { listElement: { offset: n.v - 1 } }, expression: call(['string', 'string_split'], [a[0], a[1]], 'string') } };
    }
    if (x.name === 'substring_from') return call(['string', 'substring'], [a[0], a[1], call(['string', 'char_length'], [a[0]], 'int')], 'string');
    if (FNS[x.name]) return call(FNS[x.name], a, x.t);
    if (EXTENSION[x.name]) return call(['dax', x.name], a, x.t);
    throw new Error(`substrait: function ${x.name}`);
  };

  // A relation: Substrait's, whose record is the relation's columns in order (cols).
  const R = r => {
    switch (r.k) {
      case 'scan': {
        const schema = tableSchema(r.table);
        const map = r.cols.map(c => { const i = schema.findIndex(s => s.name === (c.lineage.source ?? c.lineage.name)); if (i < 0) throw new Error(`substrait: ${r.table.name} has no stored column ${c.lineage.source}`); return i; });
        return { read: { common: emit(map), baseSchema: { names: schema.map(s => s.name), struct: { types: schema.map(s => type(s.type)), nullability: 'NULLABILITY_REQUIRED' } }, namedTable: { names: [tableName(r.table)] } } };
      }
      case 'values': {
        const schema = { names: r.cols.map(c => `c${c.id}`), struct: { types: r.cols.map(c => typeOf(c.t)), nullability: 'NULLABILITY_REQUIRED' } };
        return { read: { baseSchema: schema, virtualTable: { expressions: r.rows.map(row => ({ fields: row.map((v, i) => E(v, [], r.cols[i].t)) })) } } };
      }
      case 'select': return { filter: { input: R(r.src), condition: E(r.pred, r.src.cols) } };
      case 'project': {
        const n = r.src.cols.length;
        return { project: { common: emit(range(n, r.items.length)), input: R(r.src), expressions: r.items.map(i => E(i.expr, r.src.cols, i.col.t)) } };
      }
      case 'distinct': {
        const g = r.src.cols.map((c, i) => field(i));
        return { aggregate: { input: R(r.src), groupings: [{ expressionReferences: g.map((_, i) => i) }], groupingExpressions: g, measures: [] } };
      }
      case 'aggregate': {
        const g = r.keys.map(k => E(k.expr, r.src.cols));
        return { aggregate: { input: R(r.src), groupings: g.length ? [{ expressionReferences: g.map((_, i) => i) }] : [], groupingExpressions: g, measures: r.aggs.map(a => ({ measure: measure(a, r.src.cols) })) } };
      }
      case 'join': {
        if (r.kind === 'cross') return { cross: { left: R(r.left), right: R(r.right) } };
        return { join: { left: R(r.left), right: R(r.right), expression: E(r.on, [...r.left.cols, ...r.right.cols]), type: r.kind === 'left' ? 'JOIN_TYPE_LEFT' : 'JOIN_TYPE_INNER' } };
      }
      case 'union': {
        const inputs = r.srcs.map((s, k) => ({ project: { common: emit(range(s.cols.length, r.cols.length)), input: R(s),
          expressions: r.picks[k].map((c, i) => (c.t === 'blank' && r.cols[i].t !== 'blank' ? literal(null, r.cols[i].t) : E({ k: 'ref', col: c }, s.cols))) } }));
        return { set: { inputs, op: 'SET_OP_UNION_ALL' } };
      }
      case 'window': {
        const n = r.src.cols.length;
        const part = r.part.map(p => E(p, r.src.cols));
        return { project: { input: R(r.src), expressions: r.fns.map(f => {
          const sorts = f.order.map(o => sort(o, r.src.cols));
          const whole = f.fn === 'count' && !sorts.length;
          return { windowFunction: { functionReference: fn(WINDOWS[f.fn]), partitions: part, sorts, outputType: typeOf('int'), phase: 'AGGREGATION_PHASE_INITIAL_TO_RESULT', invocation: 'AGGREGATION_INVOCATION_ALL',
            boundsType: 'BOUNDS_TYPE_RANGE', lowerBound: { unbounded: {} }, upperBound: whole ? { unbounded: {} } : { currentRow: {} } } };
        }), common: emit(range(0, n + r.fns.length)) } };
      }
      case 'shared': {
        const d = r.def;
        const at = r.picks.map(c => d.rel.cols.indexOf(c));
        const input = options.inline ? inlined(d) : { reference: { subtreeOrdinal: D(d) } };
        return { project: { common: emit(range(d.rel.cols.length, at.length)), input, expressions: at.map(i => field(i)) } };
      }
      case 'series': {
        // Bounds that are constants: the series' rows written out.
        const [s, e, st] = [r.start, r.end, r.step];
        if (!r.src && [s, e, st].every(v => v.k === 'lit' && v.v !== null)) {
          const rows = [];
          if (r.t === 'datetime') for (let t = Date.parse(s.v), end = Date.parse(e.v); t <= end && rows.length < 100000; t += st.v * DAY) rows.push([{ k: 'lit', v: new Date(t).toISOString().slice(0, 10), t: 'datetime' }]);
          else for (let v = s.v; st.v > 0 ? v <= e.v + 1e-9 : v >= e.v - 1e-9; v += st.v) rows.push([{ k: 'lit', v, t: r.t }]);
          return R({ k: 'values', rows, cols: r.cols });
        }
        throw new Error('substrait: GENERATESERIES of bounds that are not constants');
      }
    }
    throw new Error(`substrait: relation ${r.k}`);
  };
  const measure = (a, cols) => {
    const f = AGGS[a.fn];
    if (!f) throw new Error(`substrait: aggregate ${a.fn}`);
    const args = a.fn === 'count_star' ? [] : [E(a.arg, cols)];
    if (a.fn === 'string_agg') args.push(E(a.extra.delim, cols, 'string'));
    const m = { functionReference: fn(f), arguments: args.map(value => ({ value })), outputType: typeOf(a.col.t), phase: 'AGGREGATION_PHASE_INITIAL_TO_RESULT',
      invocation: a.fn === 'count_distinct' ? 'AGGREGATION_INVOCATION_DISTINCT' : 'AGGREGATION_INVOCATION_ALL' };
    if (/^(stdev|var)_/.test(a.fn)) m.options = [{ name: 'distribution', preference: [a.fn.endsWith('_s') ? 'SAMPLE' : 'POPULATION'] }];
    if (a.fn === 'string_agg' && a.extra.order?.length) m.sorts = a.extra.order.map(o => ({ expr: E(o.expr, cols), direction: o.desc ? 'SORT_DIRECTION_DESC_NULLS_LAST' : 'SORT_DIRECTION_ASC_NULLS_FIRST' }));
    return m;
  };
  // An order term: DAX's (a blank first ascending), or a number's blank as 0 ('term').
  const sort = (o, cols) => {
    const v = E(o.expr, cols);
    if (o.mode === 'plain') return { expr: v, direction: 'SORT_DIRECTION_ASC_NULLS_FIRST' };
    const first = o.blanks === 'first' || (o.blanks !== 'last' && !o.desc);
    return { expr: v, direction: `SORT_DIRECTION_${o.desc ? 'DESC' : 'ASC'}_NULLS_${first ? 'FIRST' : 'LAST'}` };
  };

  // The root: the output's values (cast as the output casts them), its order, its limit.
  const out = plan;
  // Inline: each definition written once, and the plan refused when, written out where each is
  // read, it would hold more than INLINE_LIMIT relations (definitions read in definitions read
  // many times).
  const memo = new Map();
  const inlined = d => { if (!memo.has(d)) memo.set(d, R(d.rel)); return memo.get(d); };
  if (options.inline) {
    const sizes = new Map();
    const size = r => (r.k === 'shared' ? (sizes.has(r.def) ? sizes.get(r.def) : (sizes.set(r.def, size(r.def.rel)), sizes.get(r.def))) : 1 + kidsOf(r).reduce((n, k) => n + size(k), 0));
    const n = size(out.src);
    if (n > INLINE_LIMIT) throw Object.assign(new Error(`substrait: the plan written out where each definition is read holds ${n} relations (more than ${INLINE_LIMIT})`), { code: 'TOO_LARGE' });
  }
  for (const d of out.defs ?? []) if (!options.inline) D(d);
  let rel = R(out.src);
  const cols = out.src.cols;
  if (out.order.length) {
    const keys = out.order.map(o => E(o.expr, cols));
    const n = cols.length;
    rel = { sort: { input: { project: { input: rel, expressions: keys, common: emit(range(0, n + keys.length)) } },
      sorts: out.order.map((o, i) => ({ expr: field(n + i), direction: o.desc ? 'SORT_DIRECTION_DESC_NULLS_LAST' : 'SORT_DIRECTION_ASC_NULLS_FIRST' })) } };
  }
  if (out.limit) rel = { fetch: { input: rel, offset: String(out.limit.offset ?? 0), count: String(out.limit.n) } };
  const items = out.items.map(i => { const v = E(i.expr, cols); return i.cast ? { cast: { type: typeOf(i.cast), input: v, failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } } : v; });
  rel = { project: { common: emit(range(cols.length + (out.order.length ? out.order.length : 0), items.length)), input: rel, expressions: items } };
  relations.push({ root: { input: rel, names: out.items.map(i => i.name) } });
  const substrait = {
    version: { minorNumber: 85, producer: 'dax-sql' },
    extensionUrns: [...urns].map(([family, anchor]) => ({ extensionUrnAnchor: anchor, urn: URN[family] })),
    extensions: [...fns.values()].map(f => ({ extensionFunction: { extensionUrnReference: f.urn, functionAnchor: f.anchor, name: f.name } })),
    relations,
  };
  // Beside it: which of dax-sql's functions the plan uses.
  return { plan: substrait, dax: [...used.dax] };
}

function literal(v, t) {
  if (v === null) return { literal: { null: typeOf(t), nullable: true } };
  switch (t) {
    case 'int': return { literal: { i64: String(v) } };
    case 'double': case 'decimal': return { literal: { fp64: v } };
    case 'bool': return { literal: { boolean: v } };
    case 'datetime': {
      const s = String(v);
      if (/^\d{4}-\d\d-\d\d$/.test(s)) return { literal: { date: Math.round(Date.parse(`${s}T00:00:00Z`) / DAY) } };
      return { literal: { precisionTimestamp: { precision: 6, value: String(Date.parse(`${s.replace(' ', 'T')}Z`) * 1000) } } };
    }
  }
  return { literal: { string: String(v) } };
}
