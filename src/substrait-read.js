// A Substrait plan (substrait.js's, in its JSON form) read back as the query plan (plan.js),
// which a dialect's SQL is written from (plan-sql.js): every dialect's SQL is written from the
// Substrait, not from the compiler's own plan.
//
// The reader is substrait.js's inverse: its relations and expressions, its named lambdas (a
// plan function by its name: `name/argc:type`), and its hints: a relation's output names
// (`name#id:type`, `!` when never blank) are its columns, the same column wherever a name is
// the same; a scan's alias is its model table; a relation's alias says which of the plan's it
// is where Substrait writes it as another's (a distinct, a series, a membership).
//
//   readSubstrait(plan, model, { columns, castOutput }) -> the plan's output relation
//     columns     the query's columns ({ type }), for castOutput given by type (lower.js)
import * as P from './plan.js';
import { URN, OPS, FNS, AGGS, WINDOWS, kindOf } from './substrait.js';

const FAMILY = Object.fromEntries(Object.entries(URN).map(([f, u]) => [u, f]));
const key = (f, n) => `${f}:${n}`;
const INV_OPS = new Map(Object.entries(OPS).map(([op, [f, n]]) => [key(f, n), op]));
const INV_FNS = new Map(Object.entries(FNS).map(([name, [f, n]]) => [key(f, n), name]));
// The plan's functions written as lambdas, and its operators.
const CALL = /^(extract|date_trunc|date_diff)_\w+$|^(extract_dow|add_microseconds|make_date|trunc|idiv|split_part|substring_from|add_days|add_months|error|today|now|utctoday|utcnow)$/;
const ARITH = new Set(['add', 'sub', 'mul', 'div', 'neg']);
const lit = (v, t) => ({ k: 'lit', v, t, nn: v !== null });

export function readSubstrait(plan, model, options = {}) {
  const fnOf = new Map();
  const famOf = new Map((plan.extensionUrns ?? []).map(u => [u.extensionUrnAnchor, FAMILY[u.urn]]));
  for (const e of plan.extensions ?? []) {
    const f = e.extensionFunction;
    if (f) fnOf.set(f.functionAnchor, { family: famOf.get(f.extensionUrnReference), name: f.name });
  }
  const lambdas = new Map((plan.namedLambdas ?? []).map(l => [l.lambdaAnchor, l]));
  const tables = new Map([...model.tables.values()].map(t => [t.name, t]));

  // The plan's columns, by their names in the hints.
  const cols = new Map();
  const col = (name, extra = {}) => {
    let c = cols.get(name);
    if (!c) {
      const at = name.lastIndexOf('#');
      const m = /^\d+:(.*?)(!?)$/.exec(name.slice(at + 1));
      c = P.newCol(name.slice(0, at), m[1], { nn: m[2] === '!', ...extra });
      cols.set(name, c);
    }
    return c;
  };
  const namesOf = body => body.common?.hint?.outputNames ?? [];
  const aliasOf = body => body.common?.hint?.alias;
  // The rows outer references read: a relation's anchor, its input's columns.
  const anchors = new Map();
  const anchor = (body, cs) => { if (body.common?.relAnchor) anchors.set(body.common.relAnchor, cs); };
  // A lambda's parameters (the innermost last).
  const params = [];

  const defs = [];
  const rd = rel => {
    const [k, b] = Object.entries(rel)[0];
    const names = namesOf(b);
    const out = () => names.map(n => col(n));
    switch (k) {
      case 'read': {
        if (b.virtualTable) return P.values(b.virtualTable.expressions.map(r => r.fields.map(f => ex(f, []))), out());
        const table = tables.get(aliasOf(b));
        if (!table) throw new Error(`substrait-read: no table ${aliasOf(b)}`);
        const stored = table.columns.filter(c => !c.expr);
        const map = b.common?.emit?.outputMapping ?? b.baseSchema.names.map((_, i) => i);
        const cs = map.map((i, j) => {
          const s = b.baseSchema.names[i];
          const mc = stored.find(c => (c.source ?? c.name) === s);
          return col(names[j], { lineage: mc, table });
        });
        return { k: 'scan', table, cols: cs };
      }
      case 'filter': {
        if (aliasOf(b) === 'distinct') { const src = rd(b.input.aggregate.input); return P.distinct(src); }
        const src = rd(b.input);
        anchor(b, src.cols);
        return P.select(src, ex(b.condition, src.cols));
      }
      case 'project': {
        if (aliasOf(b) === 'series') return series(b, out());
        const input = b.input;
        if (input.reference) {
          const d = defs[input.reference.subtreeOrdinal];
          return { k: 'shared', def: d, picks: b.expressions.map(e => d.rel.cols[fieldOf(e)]), cols: out() };
        }
        const src = rd(input);
        anchor(b, src.cols);
        if (b.expressions.length && b.expressions.every(e => e.windowFunction)) return window(b, src, out());
        return P.projectAs(src, b.expressions.map((e, i) => ({ col: col(names[i]), expr: ex(e, src.cols) })));
      }
      case 'aggregate': {
        const src = rd(b.input);
        if (aliasOf(b) === 'distinct') return P.distinct(src);
        anchor(b, src.cols);
        if (b.common?.emit?.outputMapping?.length === 0) return { k: 'aggregate', src, keys: [], aggs: [], cols: [] };
        const cs = out();
        const keys = (b.groupingExpressions ?? []).map((e, i) => ({ col: cs[i], expr: ex(e, src.cols) }));
        const aggs = (b.measures ?? []).map((m, j) => ({ col: cs[keys.length + j], ...measure(m.measure, src.cols) }));
        return { k: 'aggregate', src, keys, aggs, cols: cs };
      }
      case 'join': {
        const left = rd(b.left), right = rd(b.right);
        const all = [...left.cols, ...right.cols];
        anchor(b, all);
        return P.join(b.type === 'JOIN_TYPE_LEFT' ? 'left' : 'inner', left, right, ex(b.expression, all));
      }
      case 'cross': return P.join('cross', rd(b.left), rd(b.right), null);
      case 'lateralJoin': {
        const left = rd(b.left);
        anchor(b, left.cols);
        return P.apply(left, rd(b.right), b.type === 'JOIN_TYPE_LEFT');
      }
      case 'set': {
        const srcs = [], picks = [];
        for (const inp of b.inputs) {
          const s = rd(inp.project.input);
          srcs.push(s);
          picks.push(inp.project.expressions.map(e => s.cols[fieldOf(e.cast ? e.cast.input : e)]));
        }
        return { k: 'union', srcs, picks, cols: out() };
      }
    }
    throw new Error(`substrait-read: relation ${k}`);
  };
  const fieldOf = e => e.selection.directReference.structField.field ?? 0;

  // GENERATESERIES (substrait.js's series): the start, end and step beside its value; bounds of
  // the one row of a lateral join's left.
  const series = (b, cs) => {
    const lat = b.input.lateralJoin;
    let src = null, gen = b;
    if (lat) {
      src = rd(lat.left);
      anchor(lat, src.cols);
      gen = lat.right.project;
    }
    const [s, e, st] = gen.expressions.slice(1).map(x => ex(x, []));
    return { k: 'series', src, start: s, end: e, step: st, t: cs[0].t, cols: cs };
  };

  const window = (b, src, cs) => {
    const n = src.cols.length;
    const part = (b.expressions[0].windowFunction.partitions ?? []).map(p => ex(p, src.cols));
    const fns = b.expressions.map((e, i) => {
      const w = e.windowFunction;
      const name = Object.entries(WINDOWS).find(([, [f, nm]]) => { const g = fnOf.get(w.functionReference); return g.family === f && g.name === nm; })[0];
      return { col: cs[n + i], fn: name, order: sorts(w.sorts ?? [], src.cols) };
    });
    return { k: 'window', src, part, fns, cols: cs };
  };
  // Order terms (substrait.js's sort): a number's DAX order its two sort fields.
  const sorts = (ss, cs) => {
    const out = [];
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i], m = /^SORT_DIRECTION_(ASC|DESC)_NULLS_(FIRST|LAST)$/.exec(s.direction);
      const next = ss[i + 1];
      const f = s.expr.scalarFunction && fnOf.get(s.expr.scalarFunction.functionReference);
      const g = next?.expr.scalarFunction && fnOf.get(next.expr.scalarFunction.functionReference);
      if (f?.name === 'coalesce' && g?.name === 'is_null' && JSON.stringify(s.expr.scalarFunction.arguments[0]) === JSON.stringify(next.expr.scalarFunction.arguments[0])) {
        const v = ex(s.expr.scalarFunction.arguments[0].value, cs);
        out.push({ expr: v, desc: m[1] === 'DESC', mode: 'term', blanks: 'default', t: v.t });
        i++;
        continue;
      }
      const v = ex(s.expr, cs);
      out.push({ expr: v, desc: m[1] === 'DESC', mode: 'term', blanks: m[2].toLowerCase(), t: v.t });
    }
    return out;
  };

  const measure = (m, cs) => {
    const f = fnOf.get(m.functionReference);
    const args = (m.arguments ?? []).map(a => a.value);
    let fn = Object.entries(AGGS).find(([, [fam, nm]]) => fam === f.family && nm === f.name)?.[0];
    if (f.name === 'count') fn = !args.length ? 'count_star' : m.invocation === 'AGGREGATION_INVOCATION_DISTINCT' ? 'count_distinct' : 'count_values';
    if (f.name === 'std_dev' || f.name === 'variance') fn = `${f.name === 'std_dev' ? 'stdev' : 'var'}_${m.options?.[0]?.preference?.[0] === 'SAMPLE' ? 's' : 'p'}`;
    let exact = false, a0 = args[0];
    if ((fn === 'sum' || fn === 'avg') && a0?.cast?.type?.decimal?.precision === 38) { exact = true; a0 = a0.cast.input; }
    const arg = a0 && fn !== 'count_star' ? ex(a0, cs) : null;
    if (fn === 'count_star' || fn === 'count_values' || fn === 'count_distinct') return { fn, arg, extra: {} };
    const extra = { t: arg?.t, ...(exact ? { exact: true } : {}) };
    if (fn === 'string_agg') {
      extra.delim = ex(args[1], cs);
      extra.order = (m.sorts ?? []).map(s => ({ expr: ex(s.expr, cs), desc: /DESC/.test(s.direction) }));
      extra.text = arg.t;
    }
    return { fn, arg, extra };
  };

  // An expression over the columns cs (its input's record).
  const ex = (e, cs) => {
    if (e.selection) {
      const r = e.selection, i = r.directReference.structField.field ?? 0;
      if (r.lambdaParameterReference) return params.at(-1 - (r.lambdaParameterReference.stepsOut ?? 0))[i];
      const c = r.outerReference ? anchors.get(r.outerReference.relReference)[i] : cs[i];
      return P.ref(c);
    }
    if (e.literal) return literalOf(e.literal);
    if (e.scalarFunction) {
      const s = e.scalarFunction, f = fnOf.get(s.functionReference);
      const a = (s.arguments ?? []).map(x => ex(x.value, cs));
      const { t, nn } = kindOf(s.outputType);
      const op = INV_OPS.get(key(f.family, f.name));
      if (op) return { k: 'pop', op, a, t, nn };
      const name = INV_FNS.get(key(f.family, f.name));
      if (name) return { k: 'pop', op: 'call', name, a, t, nn };
      throw new Error(`substrait-read: function ${f.family}:${f.name}`);
    }
    if (e.ifThen) {
      const w = e.ifThen.ifs.map(c => [ex(c.if, cs), ex(c.then, cs)]);
      return { k: 'case', w, e: ex(e.ifThen.else, cs), t: w[0][1].t, nn: false };
    }
    if (e.cast) { const { t, nn } = kindOf(e.cast.type); return { k: 'pop', op: 'cast', to: t, a: [ex(e.cast.input, cs)], t, nn }; }
    if (e.singularOrList) return { k: 'pop', op: 'in', a: [ex(e.singularOrList.value, cs), ...e.singularOrList.options.map(o => ex(o, cs))], t: 'bool', nn: true };
    if (e.subquery) {
      const q = e.subquery;
      if (q.setPredicate) return P.exists(rd(q.setPredicate.tuples));
      if (q.inPredicate) {
        // A membership (substrait.js's member): src's column equal to the value, src's other
        // conditions.
        const v = ex(q.inPredicate.needles[0], cs), h = q.inPredicate.haystack.project;
        let src, rest = [];
        if (h.input.filter && aliasOf(h.input.filter) === 'member') {
          src = rd(h.input.filter.input);
          const flat = c => (c.k === 'pop' && c.op === 'and' ? c.a.forEach(flat) : rest.push(c));
          flat(ex(h.input.filter.condition, src.cols));
        } else src = rd(h.input);
        const c = src.cols[fieldOf(h.expressions[0])];
        return { ...P.exists(P.select(src, P.and([P.eq(P.ref(c), v), ...rest]))), member: true };
      }
    }
    if (e.lambdaInvocation) {
      const l = lambdas.get(e.lambdaInvocation.namedLambda.lambdaReference);
      const m = /^(.*)\/(\d+):(.*)$/.exec(l.name);
      const [name, argc, t] = [m[1], +m[2], m[3]];
      const args = (e.lambdaInvocation.arguments.fields ?? []).map(x => ex(x, cs));
      if (name === 'typed') return { ...args[0], t };
      if (name === 'true' || name === 'false') return { k: 'pop', op: name, a: [], t: 'bool', nn: true };
      // Arithmetic of mixed types: whether it can be NULL is its body's (substrait.js writes x.nn there).
      if (ARITH.has(name)) return { k: 'pop', op: name, a: args, t, nn: !!(l.lambda.body.scalarFunction && kindOf(l.lambda.body.scalarFunction.outputType).nn) };
      if (CALL.test(name)) return { k: 'pop', op: 'call', name, a: args, t, nn: false };
      // A function defined as standard ones: its arguments, and its body over them.
      params.push(args);
      let body;
      try { body = ex(l.lambda.body, []); } finally { params.pop(); }
      return { k: 'pop', op: 'defined', name, argc, a: [...args.slice(0, argc), body], t, nn: !!body.nn };
    }
    throw new Error(`substrait-read: expression ${Object.keys(e)[0]}`);
  };

  // The plan's definitions, then its root.
  const rels = plan.relations;
  for (let i = 0; i < rels.length - 1; i++) defs.push(P.definition(null, i + 1));
  for (let i = 0; i < rels.length - 1; i++) defs[i].rel = rd(rels[i].rel);
  const root = rels.at(-1).root;
  const top = root.input.project;
  let inner = top.input, limit = null, keysOf = null;
  if (inner.fetch) {
    const f = inner.fetch;
    limit = { n: f.countExpr ? Number(f.countExpr.literal.i64) : null, offset: f.offsetExpr ? Number(f.offsetExpr.literal.i64) : null };
    inner = f.input;
  }
  if (inner.sort) { keysOf = inner.sort; inner = inner.sort.input.project.input; }
  const src = rd(inner);
  let order = [];
  if (keysOf) {
    const kp = keysOf.sort ? keysOf.sort.input.project : keysOf.input.project;
    anchor(kp, src.cols);
    order = kp.expressions.map((e, i) => ({ expr: ex(e, src.cols), desc: /DESC/.test(keysOf.sorts[i].direction) }));
  }
  anchor(top, src.cols);
  const by = typeof options.castOutput === 'object' ? options.castOutput : null;
  const items = top.expressions.map((e, i) => {
    const name = root.names[i];
    if (by) return { name, expr: ex(e, src.cols), by: by[options.columns?.[i]?.type] ?? null, cast: null };
    if (e.cast) return { name, expr: ex(e.cast.input, src.cols), by: null, cast: kindOf(e.cast.type).t };
    return { name, expr: ex(e, src.cols), by: null, cast: null };
  });
  const out = P.output(src, items, order, defs);
  out.limit = limit;
  return out;
}

// A Substrait literal as the plan's.
function literalOf(l) {
  if ('null' in l) return lit(null, kindOf(l.null).t);
  if ('i64' in l) return lit(Number(l.i64), 'int');
  if ('fp64' in l) return lit(l.fp64, 'double');
  if ('boolean' in l) return lit(l.boolean, 'bool');
  if ('string' in l) return lit(l.string, 'string');
  if ('date' in l) return lit(new Date(l.date * 86400000).toISOString().slice(0, 10), 'date');
  if ('precisionTimestamp' in l) {
    // (A date alone is a date literal: this one has its time.)
    const us = BigInt(l.precisionTimestamp.value), ms = us / 1000n, frac = Number(((us % 1000000n) + 1000000n) % 1000000n);
    const iso = new Date(Number(ms)).toISOString();
    return lit(`${iso.slice(0, 10)} ${iso.slice(11, 19)}${frac ? `.${String(frac).padStart(6, '0').replace(/0+$/, '')}` : ''}`, 'datetime');
  }
  if ('decimal' in l) {
    const bytes = Uint8Array.from(atob(l.decimal.value), ch => ch.charCodeAt(0));
    let n = 0n;
    for (let i = 15; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
    if (n >= 1n << 127n) n -= 1n << 128n;
    return lit(Number(n) / 10 ** l.decimal.scale, 'decimal');
  }
  throw new Error(`substrait-read: literal ${Object.keys(l)[0]}`);
}
