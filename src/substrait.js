// The query plan as a Substrait plan (https://substrait.io, the specification on main: v0.109),
// in its JSON form: what every dialect's SQL is written from (substrait-read.js reads it back).
// Each relation and scalar is a Substrait relation or expression, each function one of
// Substrait's own extension functions (comparison, boolean, arithmetic, rounding, logarithmic,
// string, datetime, aggregate, table): no function of dax-sql's.
//
// A plan function no single standard function means (DATEDIFF, TRUNC, EDATE, a part of a text,
// FORMAT, ...) is a named lambda (Plan.named_lambdas): its body is its definition in standard
// functions, which is what it means to any consumer; its name says which plan function it is,
// so that a dialect with a function of that name writes it (T-SQL's FORMAT, every engine's
// DATEDIFF). A lambda's name is `name/argc:type`; parameters past argc are the columns its body
// reads (it is closed over its parameters, as Substrait requires).
//
// Hints, which no consumer needs for the meaning: each relation's columns are named
// (RelCommon.hint.output_names) `name#id:type` (`!` when never blank), so that a reader gets
// back the plan's columns (the same column where two relations output it); a relation Substrait
// writes as another's form (a distinct as a grouping, a series, a membership) is named so
// (hint.alias). A type the plan has and Substrait has not (a blank, a variant) is a lambda
// `typed/1:<type>` of the value.
//
// A definition read in several places is a plan relation read by a ReferenceRel (inline: true
// writes it where it is read instead, for a consumer that reads no ReferenceRel).
//
//   toSubstrait(plan, { tableName, tableSchema, inline }) -> { plan, dax: [] }
//     tableName(table)    the name a scan reads (default: its source's entity, else its name)
//     tableSchema(table)  [{ name, type }] of the table's stored columns, type a Substrait kind
//                         ('i64', 'fp64', 'string', 'bool', 'date', 'timestamp', 'decimal(19,4)');
//                         by default from the model's columns

export const VERSION = { minorNumber: 109, producer: 'dax-sql' };
export const URN = {
  comparison: 'extension:io.substrait:functions_comparison',
  boolean: 'extension:io.substrait:functions_boolean',
  arithmetic: 'extension:io.substrait:functions_arithmetic',
  rounding: 'extension:io.substrait:functions_rounding',
  logarithmic: 'extension:io.substrait:functions_logarithmic',
  string: 'extension:io.substrait:functions_string',
  datetime: 'extension:io.substrait:functions_datetime',
  aggregate: 'extension:io.substrait:functions_aggregate_generic',
  table: 'extension:io.substrait:functions_table',
};
// The plan's operators, as Substrait's functions.
export const OPS = {
  eq: ['comparison', 'equal'], ne: ['comparison', 'not_equal'], lt: ['comparison', 'lt'], le: ['comparison', 'lte'],
  gt: ['comparison', 'gt'], ge: ['comparison', 'gte'], key: ['comparison', 'is_not_distinct_from'],
  isnull: ['comparison', 'is_null'], notnull: ['comparison', 'is_not_null'], coalesce: ['comparison', 'coalesce'], nullif: ['comparison', 'nullif'],
  and: ['boolean', 'and'], or: ['boolean', 'or'], not: ['boolean', 'not'],
  add: ['arithmetic', 'add'], sub: ['arithmetic', 'subtract'], mul: ['arithmetic', 'multiply'], div: ['arithmetic', 'divide'], neg: ['arithmetic', 'negate'],
  concat: ['string', 'concat'],
};
// The plan's functions that are one of Substrait's, of the same meaning.
export const FNS = {
  abs: ['arithmetic', 'abs'], sign: ['arithmetic', 'sign'], power: ['arithmetic', 'power'], mod: ['arithmetic', 'modulus'],
  sqrt: ['arithmetic', 'sqrt'], exp: ['arithmetic', 'exp'],
  round: ['rounding', 'round'], floor: ['rounding', 'floor'], ceil: ['rounding', 'ceil'], log10: ['logarithmic', 'log10'], ln: ['logarithmic', 'ln'],
  greatest: ['comparison', 'greatest'], least: ['comparison', 'least'],
  upper: ['string', 'upper'], lower: ['string', 'lower'], replace: ['string', 'replace'], strpos: ['string', 'strpos'], substring: ['string', 'substring'],
  length: ['string', 'char_length'], left: ['string', 'left'], right: ['string', 'right'], trim: ['string', 'trim'], contains: ['string', 'contains'],
  regexp_replace: ['string', 'regexp_replace'],
};
// dax-sql's own functions: none.
export const EXTENSION = {};
export const AGGS = {
  sum: ['arithmetic', 'sum'], avg: ['arithmetic', 'avg'], min: ['arithmetic', 'min'], max: ['arithmetic', 'max'], product: ['arithmetic', 'product'],
  median: ['arithmetic', 'median'], stdev_s: ['arithmetic', 'std_dev'], stdev_p: ['arithmetic', 'std_dev'], var_s: ['arithmetic', 'variance'], var_p: ['arithmetic', 'variance'],
  count_values: ['aggregate', 'count'], count_star: ['aggregate', 'count'], count_distinct: ['aggregate', 'count'], string_agg: ['string', 'string_agg'],
};
export const WINDOWS = { row_number: ['arithmetic', 'row_number'], rank: ['arithmetic', 'rank'], dense_rank: ['arithmetic', 'dense_rank'], count: ['aggregate', 'count'] };

const N = 'NULLABILITY_NULLABLE', REQ = 'NULLABILITY_REQUIRED';
// The plan's types as Substrait's; a blank or a variant (none in Substrait) is a text.
export const KIND = { int: 'i64', double: 'fp64', decimal: 'decimal(19,4)', string: 'string', bool: 'bool', datetime: 'timestamp', date: 'date', blank: 'string', variant: 'string' };
export function type(kind, nn = false) {
  const nullability = nn ? REQ : N;
  const m = /^decimal\((\d+),(\d+)\)$/.exec(kind);
  if (m) return { decimal: { precision: +m[1], scale: +m[2], nullability } };
  if (kind === 'timestamp') return { precisionTimestamp: { precision: 6, nullability } };
  return { [kind]: { nullability } };
}
const typeOf = (t, nn) => type(KIND[t] ?? 'string', nn);
// The plan type a Substrait type reads back as.
export function kindOf(ty) {
  const [k, v] = Object.entries(ty)[0];
  const t = { i64: 'int', i32: 'int', fp64: 'double', string: 'string', bool: 'bool', precisionTimestamp: 'datetime', date: 'date', decimal: 'decimal' }[k] ?? 'string';
  return { t, nn: v?.nullability === REQ };
}
// A column's name as its relation outputs it (a hint): name#id:type, ! when never blank.
export const colName = c => `${c.name}#${c.id}:${c.t}${c.nn ? '!' : ''}`;
const field = i => ({ selection: { directReference: { structField: i ? { field: i } : {} }, rootReference: {} } });
const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);
const FIRST_DAY = -719162;   // 0001-01-01, in days from 1970-01-01
const INLINE_LIMIT = 20000;
const kidsOf = r => (r.k === 'join' || r.k === 'apply' ? [r.left, r.right] : r.k === 'union' ? r.srcs : r.src ? [r.src] : []);
const ARITH = new Set(['add', 'sub', 'mul', 'div', 'neg']);

// The type the reader gives a scalar from its Substrait form, before any `typed` lambda: what a
// plan's scalar is written with when its own type differs (a blank, a variant, a CASE typed
// apart from its branches).
const REAL = new Set(['int', 'double', 'decimal', 'string', 'bool', 'datetime', 'date']);
const real = t => (REAL.has(t) ? t : 'string');
// A plan operator Substrait has as a lambda (its type in the lambda's name).
const asLambda = x => x.op === 'defined' || x.op === 'true' || x.op === 'false' || (x.op === 'call' && !FNS[x.name])
  || (ARITH.has(x.op) && x.a.some(y => KIND[readType(y)] !== KIND[x.t]));
export function readType(x) {
  switch (x.k) {
    case 'ref': return x.col.t;
    // A date and time written as a date alone: Substrait's date (the plan's datetime, a `typed`).
    case 'lit': return x.t === 'datetime' && /^\d{4}-\d\d-\d\d$/.test(String(x.v)) ? 'date' : real(x.t);
    case 'exists': return 'bool';
    case 'case': return readType(x.w[0][1]);
    case 'pop':
      if (asLambda(x)) return x.t;
      if (x.op === 'cast') return real(x.to);
      return real(x.t);
  }
  return x.t;
}

export function toSubstrait(plan, options = {}) {
  const tableName = options.tableName ?? (t => t.source?.entity ?? t.name);
  const tableSchema = options.tableSchema ?? (t => t.columns.filter(c => !c.expr).map(c => ({ name: c.source ?? c.name, type: KIND[c.type] ?? 'string' })));
  const urns = new Map(), fns = new Map();
  const fn = ([family, name]) => {
    if (!urns.has(family)) urns.set(family, urns.size + 1);
    const key = `${family}:${name}`;
    if (!fns.has(key)) fns.set(key, { anchor: fns.size + 1, urn: urns.get(family), name });
    return fns.get(key).anchor;
  };
  const call = (f, args, t, nn) => ({ scalarFunction: { functionReference: fn(f), arguments: args.map(value => ({ value })), outputType: typeOf(t, nn) } });
  const I = v => ({ literal: { i64: String(v) } });

  // Named lambdas, one for each name and body.
  const lambdas = [], lambdaIndex = new Map();
  const invoke = (name, paramTypes, body, args) => {
    const key = JSON.stringify([name, paramTypes, body]);
    if (!lambdaIndex.has(key)) {
      lambdaIndex.set(key, lambdas.length + 1);
      lambdas.push({ lambdaAnchor: lambdas.length + 1, name, lambda: { parameters: { types: paramTypes, nullability: REQ }, body } });
    }
    return { lambdaInvocation: { namedLambda: { lambdaReference: lambdaIndex.get(key) }, arguments: { fields: args } } };
  };
  const param = i => ({ selection: { directReference: { structField: i ? { field: i } : {} }, lambdaParameterReference: { stepsOut: 0 } } });

  // Definitions: plan relations, read by ReferenceRel (or inline).
  const defIndex = new Map();
  const relations = [];
  const D = def => {
    if (!defIndex.has(def)) { const rel = R(def.rel); defIndex.set(def, relations.length); relations.push({ rel }); }
    return defIndex.get(def);
  };

  // The rows a subquery or a lateral join's right reads (each its relation's common, anchored
  // when read): a column of one of them is an outer reference to it.
  let anchors = 0;
  const scopes = [];
  let here = null;   // the common of the relation whose expressions are being written
  const outer = c => {
    for (let k = scopes.length - 1; k >= 0; k--) {
      const i = scopes[k].cols.indexOf(c);
      if (i >= 0) {
        const at = scopes[k].common;
        at.relAnchor ??= ++anchors;
        return { selection: { directReference: { structField: i ? { field: i } : {} }, outerReference: { relReference: at.relAnchor } } };
      }
    }
    throw new Error(`substrait: column ${c.name} (${c.id}) not in the input`);
  };
  const sub = (rel, cols, common = here) => { scopes.push({ cols, common }); try { return R(rel); } finally { scopes.pop(); } };

  // A scalar over the columns `cols` (its input's record).
  const E = (x, cols) => {
    const v = E0(x, cols);
    const t = readType(x);
    return x.t !== undefined && x.t !== t && x.k !== 'ref' ? invoke(`typed/1:${x.t}`, [typeOf(t)], param(0), [v]) : v;
  };
  const E0 = (x, cols) => {
    const S = y => E(y, cols);
    switch (x.k) {
      case 'ref': { const i = cols.indexOf(x.col); return i >= 0 ? field(i) : outer(x.col); }
      case 'lit': return literal(x.v, x.t);
      case 'case': return { ifThen: { ifs: x.w.map(([c, v]) => ({ if: S(c), then: S(v) })), else: S(x.e) } };
      case 'exists': return x.member && memberOf(x.rel) ? member(x.rel, cols) : { subquery: { setPredicate: { predicateOp: 'PREDICATE_OP_EXISTS', tuples: sub(x.rel, cols) } } };
      case 'pop': return pop(x, S, cols);
    }
    throw new Error(`substrait: scalar ${x.k}`);
  };

  // A membership (lower.js's member): `v IN (SELECT col FROM src WHERE rest)`, as plan-sql.js
  // writes one: an equality of one of src's own columns to a value of the rows around, and other
  // conditions on src's own columns alone.
  const ownOnly = (e, own) => {
    const nested = y => !!y && typeof y === 'object' && (y.k === 'exists' || (y.a ?? []).some(nested) || (y.w ?? []).flat().some(nested) || nested(y.e));
    return !nested(e) && [...refs(e)].every(y => own.has(y));
  };
  function memberOf(r) {
    if (r.k !== 'select') return null;
    const own = new Set(r.src.cols);
    const terms = [], flat = c => (c?.k === 'pop' && c.op === 'and' ? c.a.forEach(flat) : terms.push(c));
    flat(r.pred);
    const at = terms.findIndex(c => c?.k === 'pop' && c.op === 'eq' && c.a[0].k === 'ref' && own.has(c.a[0].col) && ![...refs(c.a[1])].some(y => own.has(y)));
    const rest = terms.filter((_, i) => i !== at);
    return at >= 0 && rest.every(c => ownOnly(c, own)) ? { col: terms[at].a[0].col, v: terms[at].a[1], rest } : null;
  }
  const member = (r, cols) => {
    const { col, v, rest } = memberOf(r);
    const haystack = sub({ k: 'member', src: r.src, col, rest, cols: [col] }, cols);
    return { subquery: { inPredicate: { needles: [E(v, cols)], haystack } } };
  };

  const pop = (x, S, cols) => {
    if (x.op === 'defined') return definedOf(x, cols);
    switch (x.op) {
      // The plan's TRUE and FALSE (conditions, not values).
      case 'true': case 'false': return invoke(`${x.op}/0:bool`, [], { literal: { boolean: x.op === 'true' } }, []);
      case 'in': return { singularOrList: { value: S(x.a[0]), options: x.a.slice(1).map(S) } };
      case 'cast': return { cast: { type: typeOf(x.to, x.nn), input: S(x.a[0]), failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } };
      case 'call': return named(x, S);
    }
    // Arithmetic of values of other types than its own (a whole number in a sum of floating-point
    // values): a lambda of the operator, its arguments cast to its type (Substrait's arithmetic is
    // of one type: its divide of two integers is the integer quotient).
    if (asLambda(x)) {
      const ps = x.a.map(y => typeOf(readType(y)));
      const body = call(OPS[x.op], x.a.map((y, i) => (KIND[readType(y)] === KIND[x.t] ? param(i) : { cast: { type: typeOf(x.t), input: param(i), failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } })), x.t, x.nn);
      return invoke(`${x.op}/${x.a.length}:${x.t}`, ps, body, x.a.map(S));
    }
    if (OPS[x.op]) return call(OPS[x.op], x.a.map(S), x.t, x.nn);
    throw new Error(`substrait: operator ${x.op}`);
  };

  // A function defined as standard ones (plan.js defined): a lambda of its name, of its arguments
  // and the columns its body reads (the body as a function of its parameters).
  const definedOf = (x, cols) => {
    const args = x.a.slice(0, x.argc), body = x.a[x.argc];
    const free = [...refs(body)].filter(c => !args.some(a => a.k === 'ref' && a.col === c));
    const at = new Map(args.map((a, i) => [a, i]));
    free.forEach((c, j) => at.set(c, x.argc + j));
    const ps = [...args.map(a => typeOf(readType(a))), ...free.map(c => typeOf(c.t))];
    // The body over the parameters: its arguments (as written) and the columns it reads.
    const B = y => {
      if (at.has(y)) return param(at.get(y));
      if (y.k === 'ref' && at.has(y.col)) return param(at.get(y.col));
      const v = withParams(y, B);
      const t = readType(y);
      return y.t !== undefined && y.t !== t && y.k !== 'ref' ? invoke(`typed/1:${y.t}`, [typeOf(t)], param(0), [v]) : v;
    };
    return invoke(`${x.name}/${x.argc}:${x.t}`, ps, B(body), [...args.map(a => E(a, cols)), ...free.map(c => E({ k: 'ref', col: c, t: c.t }, cols))]);
  };
  // A scalar written with each of its parts by `B` (a lambda's body: no relation in it).
  const withParams = (y, B) => {
    switch (y.k) {
      case 'lit': return literal(y.v, y.t);
      case 'case': return { ifThen: { ifs: y.w.map(([c, v]) => ({ if: B(c), then: B(v) })), else: B(y.e) } };
      case 'pop': return pop(y, B, []);
      case 'ref': throw new Error(`substrait: a defined function's body reads column ${y.col.name}`);
    }
    throw new Error(`substrait: a defined function's body holds ${y.k}`);
  };

  // Substrait's datetime functions (functions_datetime): extract, with its indexing where the
  // component has one; round_calendar; add and multiply of intervals.
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
  const regexText = s => String(s).replace(/[\\^$.*+?()[\]{}|]/g, m => `\\${m}`);
  // A plan function's definition in standard functions, of its parameters p (as Substrait
  // expressions) and its arguments' plan nodes.
  const BODY = {
    extract_dow: p => extract('SUNDAY_DAY_OF_WEEK', p[0], 'ZERO'),
    add_microseconds: (p, x) => call(['datetime', 'add'], [p[0], interval(p[1], { intervalDayToSecond: { days: 0, seconds: 0, subseconds: '1', precision: 6 } })], x.t),
    // DATE(y, m, d): 0001-01-01 moved by y - 1 years, m - 1 months and d - 1 days.
    make_date: (p, x) => {
      const y = call(['datetime', 'add'], [{ literal: { date: FIRST_DAY } }, interval(ar('subtract', [p[0], I(1)]), { intervalYearToMonth: { years: 1 } })], 'datetime');
      const mo = call(['datetime', 'add'], [y, interval(ar('subtract', [p[1], I(1)]), MONTH1)], 'datetime');
      return call(['datetime', 'add'], [mo, interval(ar('subtract', [p[2], I(1)]), DAY1)], x.t);
    },
    // A number with its fraction cut: floor of one not negative, ceil of a negative.
    trunc: (p, x) => ({ ifThen: { ifs: [{ if: call(['comparison', 'gte'], [p[0], { cast: { type: typeOf(x.t), input: I(0), failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } }], 'bool'), then: call(['rounding', 'floor'], [p[0]], x.t) }], else: call(['rounding', 'ceil'], [p[0]], x.t) } }),
    // Whole-number division: Substrait's divide of two integers.
    idiv: (p, x) => call(['arithmetic', 'divide'], p.map(v => ({ cast: { type: typeOf('int'), input: v, failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } })), x.t),
    // The n-th piece of a text: the n-th match of the text between separators.
    split_part: (p, x) => {
      const d = x.a[1];
      if (d.k !== 'lit') throw new Error('substrait: the piece of a text at a separator that is not a constant');
      const sep = regexText(d.v);
      return call(['string', 'regexp_match_substring'], [p[0], { literal: { string: `(?:^|${sep})([^${sep}]*)` } }, I(1), p[2], I(1)], 'string');
    },
    substring_from: p => call(['string', 'substring'], [p[0], p[1], call(['string', 'char_length'], [p[0]], 'int')], 'string'),
    add_days: (p, x) => call(['datetime', 'add'], [p[0], interval(p[1], DAY1)], x.t),
    add_months: (p, x) => call(['datetime', 'add'], [p[0], interval(p[1], MONTH1)], x.t),
  };
  const named = (x, S) => {
    if (FNS[x.name]) return call(FNS[x.name], x.a.map(S), x.t, x.nn);
    const m = /^(extract|date_trunc|date_diff)_(\w+)$/.exec(x.name);
    let body;
    const p = x.a.map((_, i) => param(i));
    if (BODY[x.name]) body = BODY[x.name](p, x);
    else if (m?.[1] === 'extract') body = extract(m[2].toUpperCase(), p[0]);
    else if (m?.[1] === 'date_trunc') {
      const [unit, multiple] = { year: ['YEAR', 1], quarter: ['MONTH', 3], month: ['MONTH', 1] }[m[2]] ?? [m[2].toUpperCase(), 1];
      body = { scalarFunction: { functionReference: fn(['datetime', 'round_calendar']), arguments: [{ value: p[0] }, { enum: 'FLOOR' }, { enum: unit }, { enum: 'YEAR' }, { value: I(multiple) }], outputType: typeOf(x.t) } };
    } else if (m?.[1] === 'date_diff') body = ar('subtract', [count(m[2], p[1]), count(m[2], p[0])]);
    else throw new Error(`substrait: function ${x.name}`);
    return invoke(`${x.name}/${x.a.length}:${x.t}`, x.a.map(y => typeOf(readType(y))), body, x.a.map(S));
  };

  // A relation: Substrait's, whose record is the relation's columns in order (cols), named in
  // its hint.
  const R = r => {
    const common = { hint: { outputNames: r.cols.map(colName) } };
    const saved = here;
    here = common;
    try {
      const [k, body] = Object.entries(R0(r, common))[0];
      // (An outer reference to it, written in R0, anchored common.)
      body.common = { ...common, ...body.common, hint: { ...common.hint, ...(body.common?.hint ?? {}) } };
      return { [k]: body };
    } finally { here = saved; }
  };
  const emitOf = map => ({ emit: { outputMapping: map } });
  const R0 = (r, common) => {
    switch (r.k) {
      case 'scan': {
        const schema = tableSchema(r.table);
        const map = r.cols.map(c => { const i = schema.findIndex(s => s.name === (c.lineage.source ?? c.lineage.name)); if (i < 0) throw new Error(`substrait: ${r.table.name} has no stored column ${c.lineage.source}`); return i; });
        return { read: { common: { ...emitOf(map), hint: { alias: r.table.name } }, baseSchema: { names: schema.map(s => s.name), struct: { types: schema.map(s => type(s.type)), nullability: REQ } }, namedTable: { names: [tableName(r.table)] } } };
      }
      case 'values': {
        const schema = { names: r.cols.map(c => `c${c.id}`), struct: { types: r.cols.map(c => typeOf(c.t, c.nn)), nullability: REQ } };
        return { read: { baseSchema: schema, virtualTable: { expressions: r.rows.map(row => ({ fields: row.map(v => E(v, [])) })) } } };
      }
      case 'select': { const input = R(r.src); return { filter: { input, condition: E(r.pred, r.src.cols) } }; }
      case 'project': {
        const n = r.src.cols.length, input = R(r.src);
        return { project: { common: emitOf(range(n, r.items.length)), input, expressions: r.items.map(i => E(i.expr, r.src.cols)) } };
      }
      case 'distinct': {
        const input = R(r.src);
        // Of no column: one row when there is one (a count of the rows, kept when not 0).
        if (!r.src.cols.length) {
          const n = { aggregate: { input, groupings: [], measures: [{ measure: countRows() }] } };
          return { filter: { common: { ...emitOf([]), hint: { alias: 'distinct' } }, input: n, condition: call(['comparison', 'gt'], [field(0), I(0)], 'bool') } };
        }
        const g = r.src.cols.map((c, i) => field(i));
        return { aggregate: { common: { hint: { alias: 'distinct' } }, input, groupings: [{ expressionReferences: g.map((_, i) => i) }], groupingExpressions: g, measures: [] } };
      }
      case 'aggregate': {
        const input = R(r.src);
        // Of no key and no aggregate: its one row (a count of the rows, of no column).
        if (!r.keys.length && !r.aggs.length) return { aggregate: { common: emitOf([]), input, groupings: [], measures: [{ measure: countRows() }] } };
        const g = r.keys.map(k => E(k.expr, r.src.cols));
        return { aggregate: { input, groupings: g.length ? [{ expressionReferences: g.map((_, i) => i) }] : [], groupingExpressions: g, measures: r.aggs.map(a => ({ measure: measure(a, r.src.cols) })) } };
      }
      case 'join': {
        if (r.kind === 'cross') return { cross: { left: R(r.left), right: R(r.right) } };
        const left = R(r.left), right = R(r.right);
        return { join: { left, right, expression: E(r.on, [...r.left.cols, ...r.right.cols]), type: r.kind === 'left' ? 'JOIN_TYPE_LEFT' : 'JOIN_TYPE_INNER' } };
      }
      case 'union': {
        // Each branch its columns (picks), as the union's types.
        const inputs = r.srcs.map((s, k) => {
          const input = R(s);
          return { project: { common: emitOf(range(s.cols.length, r.cols.length)), input,
            expressions: r.picks[k].map((c, i) => { const v = field(s.cols.indexOf(c)); return KIND[c.t] === KIND[r.cols[i].t] ? v : { cast: { type: typeOf(r.cols[i].t), input: v, failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } }; }) } };
        });
        return { set: { inputs, op: 'SET_OP_UNION_ALL' } };
      }
      case 'window': {
        const n = r.src.cols.length, input = R(r.src);
        const part = r.part.map(p => E(p, r.src.cols));
        return { project: { input, expressions: r.fns.map(f => {
          const sorts = f.order.flatMap(o => sort(o, r.src.cols));
          const whole = f.fn === 'count' && !sorts.length;
          return { windowFunction: { functionReference: fn(WINDOWS[f.fn]), partitions: part, sorts, outputType: typeOf('int', true), phase: 'AGGREGATION_PHASE_INITIAL_TO_RESULT', invocation: 'AGGREGATION_INVOCATION_ALL',
            boundsType: 'BOUNDS_TYPE_RANGE', lowerBound: { unbounded: {} }, upperBound: whole ? { unbounded: {} } : { currentRow: {} } } };
        }), common: emitOf(range(0, n + r.fns.length)) } };
      }
      // The right evaluated for each row of the left, reading its row (outer: a row of the left
      // with none kept).
      case 'apply': {
        const left = R(r.left);
        const right = sub(r.right, r.left.cols, common);
        return { lateralJoin: { left, right, expression: { literal: { boolean: true } }, type: r.outer ? 'JOIN_TYPE_LEFT' : 'JOIN_TYPE_INNER' } };
      }
      case 'shared': {
        const d = r.def;
        const at = r.picks.map(c => d.rel.cols.indexOf(c));
        const input = options.inline ? inlined(d) : { reference: { subtreeOrdinal: D(d) } };
        return { project: { common: emitOf(range(d.rel.cols.length, at.length)), input, expressions: at.map(i => field(i)) } };
      }
      // GENERATESERIES: generate_series of the steps 0 .. n, each start + its number of steps;
      // the start, end and step beside it (not output). Bounds of the one row of src: a lateral
      // join of src to it.
      case 'series': {
        const gen = srcCols => {
          const [s, e, st] = [r.start, r.end, r.step].map(v => E(v, srcCols));
          const steps = r.t === 'datetime'
            ? call(['arithmetic', 'divide'], [call(['arithmetic', 'subtract'], [count('day', e), count('day', s)], 'int'), { cast: { type: typeOf('int'), input: st, failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } }], 'int')
            : { cast: { type: typeOf('int'), input: call(['rounding', 'floor'], [call(['arithmetic', 'divide'], [call(['arithmetic', 'subtract'], [e, s], 'double'), st], 'double')], 'double'), failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } };
          const tf = { tableFunction: { function: { functionReference: fn(['table', 'generate_series']), arguments: [{ value: I(0) }, { value: steps }, { value: I(1) }], schema: { types: [typeOf('int', true)], nullability: REQ } } } };
          const k = field(0);
          const value = r.t === 'datetime' ? call(['datetime', 'add'], [s, interval(call(['arithmetic', 'multiply'], [k, { cast: { type: typeOf('int'), input: st, failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } }], 'int'), DAY1)], r.t)
            : call(['arithmetic', 'add'], [s, call(['arithmetic', 'multiply'], [{ cast: { type: typeOf(r.t), input: k, failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } }, st], r.t)], r.t);
          return { project: { common: { ...emitOf([1]), hint: { alias: 'series', outputNames: r.cols.map(colName) } }, input: tf, expressions: [value, s, e, st] } };
        };
        if (!r.src) return gen([]);
        const left = R(r.src), at = {};
        const right = sub({ k: 'gen', gen, cols: r.cols }, r.src.cols, at);
        const n = r.src.cols.length;
        return { project: { common: { ...emitOf([n]), hint: { alias: 'series' } }, input: { lateralJoin: { common: at, left, right, expression: { literal: { boolean: true } }, type: 'JOIN_TYPE_INNER' } }, expressions: [] } };
      }
      // The series of a lateral join's right: its bounds outer references to the left's row.
      case 'gen': return r.gen([]);
      case 'member': {
        // The haystack of a membership: src's rows meeting the other conditions, its column.
        let input = R(r.src);
        if (r.rest.length) input = { filter: { common: { hint: { alias: 'member', outputNames: r.src.cols.map(colName) } }, input, condition: E(r.rest.reduce((l, x) => ({ k: 'pop', op: 'and', a: [l, x], t: 'bool', nn: true })), r.src.cols) } };
        return { project: { common: { ...emitOf([r.src.cols.length]), hint: { alias: 'member' } }, input, expressions: [field(r.src.cols.indexOf(r.col))] } };
      }
    }
    throw new Error(`substrait: relation ${r.k}`);
  };
  const countRows = () => ({ functionReference: fn(AGGS.count_star), arguments: [], outputType: typeOf('int', true), phase: 'AGGREGATION_PHASE_INITIAL_TO_RESULT', invocation: 'AGGREGATION_INVOCATION_ALL' });
  // An aggregate. An exact sum or average of floating-point values (passes/exact.js: the same in
  // any order) is of their values as decimals.
  const measure = (a, cols) => {
    const f = AGGS[a.fn];
    if (!f) throw new Error(`substrait: aggregate ${a.fn}`);
    let args = a.fn === 'count_star' ? [] : [E(a.arg, cols)];
    if (a.extra?.exact && (a.fn === 'sum' || a.fn === 'avg') && a.extra.t === 'double') args = [{ cast: { type: type('decimal(38,15)'), input: args[0], failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } }];
    if (a.fn === 'string_agg') args.push(E(a.extra.delim, cols));
    const m = { functionReference: fn(f), arguments: args.map(value => ({ value })), outputType: typeOf(a.col.t, a.col.nn), phase: 'AGGREGATION_PHASE_INITIAL_TO_RESULT',
      invocation: a.fn === 'count_distinct' ? 'AGGREGATION_INVOCATION_DISTINCT' : 'AGGREGATION_INVOCATION_ALL' };
    if (/^(stdev|var)_/.test(a.fn)) m.options = [{ name: 'distribution', preference: [a.fn.endsWith('_s') ? 'SAMPLE' : 'POPULATION'] }];
    if (a.fn === 'string_agg' && a.extra.order?.length) m.sorts = a.extra.order.map(o => ({ expr: E(o.expr, cols), direction: o.desc ? 'SORT_DIRECTION_DESC_NULLS_LAST' : 'SORT_DIRECTION_ASC_NULLS_FIRST' }));
    return m;
  };
  // A window's order term (plan-sql.js term): as SQL orders it. DAX's order of a number (a blank
  // as 0, before a 0 ascending): the number with a blank as 0, then whether it is blank.
  const sort = (o, cols) => {
    const v = E(o.expr, cols), dir = o.desc ? 'DESC' : 'ASC';
    if (o.mode === 'plain') return [{ expr: v, direction: 'SORT_DIRECTION_ASC_NULLS_FIRST' }];
    if (o.mode === 'term' && o.blanks !== 'first' && o.blanks !== 'last' && ['int', 'double', 'decimal'].includes(o.t)) {
      const zero = o.t === 'int' ? I(0) : { cast: { type: typeOf(o.t), input: I(0), failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } };
      return [{ expr: call(OPS.coalesce, [v, zero], o.t, true), direction: `SORT_DIRECTION_${dir}_NULLS_LAST` },
        { expr: call(OPS.isnull, [v], 'bool', true), direction: `SORT_DIRECTION_${o.desc ? 'ASC' : 'DESC'}_NULLS_LAST` }];
    }
    const first = o.mode === 'term' ? (o.blanks === 'first' || (o.blanks !== 'last' && !o.desc)) : !o.desc;
    return [{ expr: v, direction: `SORT_DIRECTION_${dir}_NULLS_${first ? 'FIRST' : 'LAST'}` }];
  };

  // The root: the output's values (cast as the output casts them), its order, its limit.
  const out = plan;
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
  const keysAt = {}, itemsAt = {};
  if (out.order.length) {
    here = keysAt;
    const keys = out.order.map(o => E(o.expr, cols));
    const n = cols.length;
    rel = { sort: { input: { project: { input: rel, expressions: keys, common: Object.assign(keysAt, emitOf(range(0, n + keys.length))) } },
      sorts: out.order.map((o, i) => ({ expr: field(n + i), direction: o.desc ? 'SORT_DIRECTION_DESC_NULLS_LAST' : 'SORT_DIRECTION_ASC_NULLS_FIRST' })) } };
  }
  if (out.limit) rel = { fetch: { input: rel, ...(out.limit.offset != null ? { offsetExpr: I(out.limit.offset) } : {}), ...(out.limit.n != null ? { countExpr: I(out.limit.n) } : {}) } };
  const width = cols.length + out.order.length;
  here = itemsAt;
  const items = out.items.map(i => { const v = E(i.expr, cols); return i.cast ? { cast: { type: typeOf(i.cast), input: v, failureBehavior: 'FAILURE_BEHAVIOR_THROW_EXCEPTION' } } : v; });
  rel = { project: { common: Object.assign(itemsAt, emitOf(range(width, items.length))), input: rel, expressions: items } };
  here = null;
  relations.push({ root: { input: rel, names: out.items.map(i => i.name) } });
  const substrait = {
    version: VERSION,
    extensionUrns: [...urns].map(([family, anchor]) => ({ extensionUrnAnchor: anchor, urn: URN[family] })),
    extensions: [...fns.values()].map(f => ({ extensionFunction: { extensionUrnReference: f.urn, functionAnchor: f.anchor, name: f.name } })),
    relations,
    executionBehavior: { variableEvalMode: 'VARIABLE_EVALUATION_MODE_PER_PLAN' },
    ...(lambdas.length ? { namedLambdas: lambdas } : {}),
  };
  return { plan: substrait, dax: [] };
}

// The columns a scalar reads (its subqueries' too).
function refs(x, out = new Set()) {
  if (!x || typeof x !== 'object') return out;
  if (x.k === 'ref') { out.add(x.col); return out; }
  for (const y of x.a ?? []) refs(y, out);
  for (const [c, v] of x.w ?? []) { refs(c, out); refs(v, out); }
  if (x.e) refs(x.e, out);
  return out;
}

export function literal(v, t) {
  if (v === null) return { literal: { null: typeOf(t), nullable: true } };
  switch (t) {
    case 'int': return { literal: { i64: String(v) } };
    case 'double': return { literal: { fp64: v } };
    case 'decimal': return { literal: { decimal: decimalOf(v), nullable: false } };
    case 'bool': return { literal: { boolean: v } };
    case 'date': return { literal: { date: Math.round(Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`) / 86400000) } };
    case 'datetime': {
      const s = String(v);
      if (/^\d{4}-\d\d-\d\d$/.test(s)) return literal(s, 'date');
      // A date and time, as the plan's datetime is (a date alone at midnight). Its text as
      // written is kept beside it (a date alone, a time): the value's own form.
      const at = /^\d{4}-\d\d-\d\d$/.test(s) ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`;
      return { literal: { precisionTimestamp: { precision: 6, value: String(Date.parse(at) * 1000) } } };
    }
  }
  return { literal: { string: String(v) } };
}
// A decimal(19,4) literal: its unscaled value, 16 bytes little-endian two's complement, base64.
function decimalOf(v) {
  let n = BigInt(Math.round(Number(v) * 10000));
  if (n < 0n) n += 1n << 128n;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) { bytes[i] = Number(n & 0xffn); n >>= 8n; }
  return { value: btoa(String.fromCharCode(...bytes)), precision: 19, scale: 4 };
}
