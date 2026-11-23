// A query plan (plan.js) drawn as a tree, one operator a line:
//
//   π  Category, Sales
//   └─ σ  Sales ≠ BLANK
//      └─ ×ᴬ Apply
//         ├─ δ  Distinct
//         │  └─ ...
//         └─ γ  SUM(Sales.Amount) → sum
//            └─ ...
//
// ▭ a table's rows · σ select · π project · δ distinct · γ aggregate · ⟕ left join · ⋈ join ·
// × cross join · ×ᴬ/⟕ᴬ apply (for each row of the first, the second) · ∪ union · ω window ·
// τ sort · ∃ a semi-join (the rows of its relation that the condition naming it reads) ·
// ▭ V1 the rows of a definition (a table VAR, a calculated table), evaluated once, drawn below.
// A column is Table.Column when it is a model table's, its name otherwise, and outer.Column
// when it is a column of a row around the operator's (an apply's, a correlated EXISTS');
// ≡ is a blank matching a blank.

export function explain(root) {
  const lines = [];
  draw(node(root), '', true, true, lines);
  // The definitions read by name (▭ V1): each drawn once, below.
  for (const d of root.defs ?? []) {
    lines.push('', `V${d.n} =`);
    draw(node(d.rel), '', true, true, lines);
  }
  return lines.join('\n');
}

function draw(n, prefix, last, root, out) {
  out.push(root ? n.label : `${prefix}${last ? '└─ ' : '├─ '}${n.label}`);
  const p = root ? '' : `${prefix}${last ? '   ' : '│  '}`;
  n.kids.forEach((k, i) => draw(k, p, i === n.kids.length - 1, false, out));
}

// { label, kids } for a relation; the EXISTS its scalars hold are kids of their own (∃1, ∃2).
function node(r) {
  const subs = [];
  const ins = r.k === 'join' ? [...r.left.cols, ...r.right.cols] : r.src ? r.src.cols : [];
  const avail = new Set(ins);
  const S = x => scalar(x, subs, avail);
  const kids = [];
  let label;
  switch (r.k) {
    case 'output': {
      const items = r.items.map(i => named(i.name, S(i.expr)));
      label = `π  ${items.join(', ')}`;
      if (r.order.length || r.limit) {
        const order = r.order.map(o => `${S(o.expr)}${o.desc ? ' DESC' : ''}`).join(', ');
        const limit = r.limit ? ` LIMIT ${r.limit.n ?? 'ALL'}${r.limit.offset ? ` OFFSET ${r.limit.offset}` : ''}` : '';
        return withSubs({ label: `τ  ${order}${limit}`, kids: [{ label, kids: [node(r.src)] }] }, subs);
      }
      kids.push(node(r.src));
      break;
    }
    case 'scan': label = `▭  ${r.table.name}`; break;
    case 'values':
      label = r.rows.length === 1 && r.cols[0]?.name === 'one' && r.cols.length === 1 ? '▭  One row'
        : `▭  Values ${r.rows.length ? `{${r.rows.map(row => (row.length === 1 ? S(row[0]) : `(${row.map(S).join(', ')})`)).join(', ')}}` : '{}'}`;
      break;
    case 'select': label = `σ  ${S(r.pred)}`; kids.push(node(r.src)); break;
    case 'project': {
      // The columns a rewrite passes through as they are: "…".
      const same = r.items.filter(i => i.expr.k === 'ref' && i.expr.col === i.col);
      const own = r.items.filter(i => !same.includes(i)).map(i => named(colName(i.col), S(i.expr)));
      label = `π  ${[...(same.length ? ['…'] : []), ...own].join(', ')}`;
      kids.push(node(r.src));
      break;
    }
    case 'distinct': label = 'δ  Distinct'; kids.push(node(r.src)); break;
    case 'aggregate': {
      const keys = r.keys.map(k => named(colName(k.col), S(k.expr)));
      const aggs = r.aggs.map(a => `${agg(a, S)} → ${a.col.name}`);
      label = `γ  ${[keys.length ? `by ${keys.join(', ')}` : '', aggs.join(', ')].filter(Boolean).join('; ')}`;
      kids.push(node(r.src));
      break;
    }
    case 'join':
      label = r.kind === 'cross' ? '×  Cross join' : `${r.kind === 'left' ? '⟕' : '⋈'}  ${S(r.on)}`;
      kids.push(node(r.left), node(r.right));
      break;
    case 'apply': label = r.outer ? '⟕ᴬ Apply (outer)' : '×ᴬ Apply'; kids.push(node(r.left), node(r.right)); break;
    case 'union': label = '∪  Union all'; kids.push(...r.srcs.map(node)); break;
    case 'window': {
      const part = r.part.length ? `PARTITION BY ${r.part.map(S).join(', ')} ` : '';
      const fns = r.fns.map(f => `${f.fn.toUpperCase()}() OVER (${part}${f.order.length ? `ORDER BY ${f.order.map(o => `${S(o.expr)}${o.desc ? ' DESC' : ''}`).join(', ')}` : ''}) → ${f.col.name}`.replace(' )', ')'));
      label = `ω  ${fns.join(', ')}`;
      kids.push(node(r.src));
      break;
    }
    case 'shared': label = `▭  V${r.def.n}`; break;
    case 'series': label = `▭  Series(${S(r.start)}, ${S(r.end)}, ${S(r.step)})`; if (r.src) kids.push(node(r.src)); break;
    case 'paths': label = '▭  Paths (recursive: each key with the keys above it)'; kids.push(node(r.src)); break;
    default: label = r.k;
  }
  return withSubs({ label, kids }, subs);
}

function withSubs(n, subs) {
  for (const [i, rel] of subs.entries()) {
    const k = node(rel);
    n.kids.push({ label: `∃${i + 1} ${k.label}`, kids: k.kids });
  }
  return n;
}

const named = (name, expr) => (expr === name || expr.endsWith(`.${name}`) ? expr : `${name} = ${expr}`);
const colName = c => (c.table ? `${c.table.name}.${c.name}` : c.name);

const AGG = { avg: 'AVERAGE', countrows: 'COUNTROWS', dcount: 'DISTINCTCOUNT', dcountnb: 'DISTINCTCOUNTNOBLANK', count0: 'COUNT', dcount0: 'DISTINCTCOUNT', concat: 'CONCATENATEX',
  count_values: 'COUNT', string_agg: 'STRING_AGG' };
function agg(a, S) {
  if (a.fn === 'count_star') return 'COUNT(*)';
  if (a.fn === 'count_distinct') return `COUNT(DISTINCT ${S(a.arg)})`;
  const name = AGG[a.fn] ?? a.fn.toUpperCase();
  const args = [a.arg ? S(a.arg) : null, a.extra?.delim ? S(a.extra.delim) : null, a.extra?.k ? S(a.extra.k) : null].filter(x => x != null);
  return `${name}(${args.join(', ')})`;
}

const OPS = { add: '+', sub: '-', mul: '*', div: '/', pow: '^', eq: '=', ne: '<>', lt: '<', le: '≤', gt: '>', ge: '≥', eqs: '≡', and: '∧', or: '∨', concat: '&' };

function scalar(x, subs, avail) {
  const S = y => scalar(y, subs, avail);
  switch (x.k) {
    case 'ref': return avail.has(x.col) ? colName(x.col) : `outer.${colName(x.col)}`;
    case 'lit':
      if (x.v === null) return 'BLANK';
      if (x.t === 'datetime' || x.t === 'date') return `dt"${x.v}"`;
      if (typeof x.v === 'string') return `"${x.v.replace(/"/g, '""')}"`;
      if (typeof x.v === 'boolean') return x.v ? 'TRUE' : 'FALSE';
      return String(x.v);
    case 'op':
      if (x.op === 'not') return `¬${S(x.a[0])}`;
      if (x.op === 'neg') return `-${S(x.a[0])}`;
      if (x.op === 'bool') return S(x.a[0]);
      if (x.op === 'in') return `${S(x.a[0])} IN {${x.a.slice(1).map(S).join(', ')}}`;
      return x.a.map(a => (a.k === 'op' && OPS[a.op] && a.op !== x.op ? `(${S(a)})` : S(a))).join(` ${OPS[x.op] ?? x.op} `);
    case 'fn': return `${x.name.toUpperCase()}(${x.a.map(S).join(', ')})`;
    case 'case': return `CASE ${x.w.map(([c, v]) => `WHEN ${S(c)} THEN ${S(v)}`).join(' ')}${x.e.k === 'lit' && x.e.v === null ? '' : ` ELSE ${S(x.e)}`} END`;
    case 'exists': subs.push(x.rel); return `∃${subs.length}`;
    case 'pop': {
      // An argument that is itself an operation, in parentheses.
      const A = x.a.map(y => (y.k === 'pop' && INFIX[y.op] && x.op !== 'call' && x.op !== 'coalesce' && x.op !== 'cast' ? `(${S(y)})` : S(y)));
      const [a, b] = A;
      if (INFIX[x.op]) return `${a} ${INFIX[x.op]} ${b}`;
      return {
        isnull: `${a} = BLANK`, notnull: `${a} ≠ BLANK`, not: `¬${a}`, neg: `-${a}`, in: `${a} IN {${A.slice(1).join(', ')}}`,
        coalesce: `COALESCE(${A.join(', ')})`, nullif: `NULLIF(${a}, ${b})`, cast: `CAST(${a} AS ${x.to})`,
        call: `${x.name}(${A.join(', ')})`, true: 'TRUE', false: 'FALSE',
      }[x.op] ?? `${x.op}(${A.join(', ')})`;
    }
  }
  return x.k;
}

const INFIX = { eq: '=', ne: '<>', key: '≡', lt: '<', le: '≤', gt: '>', ge: '≥', and: '∧', or: '∨', add: '+', sub: '-', mul: '*', div: '/', concat: '||' };
