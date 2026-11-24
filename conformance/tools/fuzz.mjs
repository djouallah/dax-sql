// Random DAX queries over a model, for Power BI to answer (oracle.yml) and dax-sql to be held to:
// queries/<model>/fuzz/fuzz-NNNN.dax. Seeded, so the same seed writes the same queries; none is
// picked by hand, and none is changed after dax-sql has run it.
//   node conformance/tools/fuzz.mjs <model> <count> <seed>
// What it draws from: the model's measures, its columns (each with values its data holds, and
// one it does not), the functions DESIGN.md says dax-sql takes, nested a few levels deep.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, modelDir, readBim } from './suite.mjs';

const [model, countArg, seedArg] = process.argv.slice(2);
const COUNT = Number(countArg ?? 100), SEED = Number(seedArg ?? 1);

// Per model: the columns to group and filter by, the date column, the fact columns to aggregate,
// the tables to remove filters from, an inactive relationship.
const CONFIG = {
  contoso: {
    dims: ['Product[Name]', 'Product[Color]', 'Product[PriceBand]', 'Product[Price]', 'Category[Category]', 'Customer[Customer]', 'Customer[City]', 'Date[Year]', 'Date[Month]', 'Date[Quarter]'],
    date: 'Date[Date]',
    facts: ['Sales[Qty]', 'Sales[Amount]', 'Returns[ReturnQty]'],
    countTables: ['Sales', 'Returns', 'Product', 'Customer'],
    tables: ['Product', 'Customer', 'Category', 'Date', 'Sales'],
    inactive: ['Sales[ShipDate]', 'Date[Date]'],
  },
  tpcds: {
    dims: ['item[i_brand]', 'item[i_category]', 'item[i_class]', 'item[i_color]', 'item[i_current_price]', 'store[s_store_name]', 'store[s_state]', 'store[s_city]', 'customer_address[ca_state]', 'customer_demographics[cd_marital_status]', 'customer_demographics[cd_education_status]', 'date_dim[d_year]', 'date_dim[d_qoy]', 'date_dim[d_moy]', 'promotion[p_promo_name]', 'ship_mode[sm_type]'],
    date: 'date_dim[d_date]',
    facts: ['store_sales[ss_quantity]', 'store_sales[ss_ext_sales_price]', 'store_sales[ss_net_profit]', 'catalog_sales[cs_quantity]', 'catalog_sales[cs_ext_sales_price]', 'catalog_sales[cs_net_profit]'],
    countTables: ['store_sales', 'catalog_sales', 'item', 'store'],
    tables: ['item', 'store', 'date_dim', 'customer_address', 'store_sales', 'catalog_sales'],
    inactive: ['catalog_sales[cs_ship_addr_sk]', 'customer_address[ca_address_sk]'],
  },
};
const cfg = CONFIG[model];
if (!cfg) throw new Error(`fuzz: no config for model ${model}`);

// mulberry32: a seeded generator.
let state = SEED >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = xs => xs[Math.floor(rand() * xs.length)];
const chance = p => rand() < p;

// The model: column types, measures, each column's values from its CSV.
const bim = readBim(model);
const types = new Map(), measures = [];
for (const t of bim.model.tables) {
  for (const c of t.columns ?? []) types.set(`${t.name}[${c.name}]`, c.dataType);
  for (const m of t.measures ?? []) measures.push(m.name);
}
function csv(table) {
  const text = readFileSync(join(modelDir(model), 'data', `${table}.csv`), 'utf8').replace(/\r\n/g, '\n').trim();
  const split = line => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const [head, ...rows] = text.split('\n');
  const cols = split(head);
  return { cols, rows: rows.map(split) };
}
const valueCache = new Map();
const parts = ref => { const m = /^(.*)\[(.*)\]$/.exec(ref); return { table: m[1], col: m[2] }; };
function values(ref) {
  if (valueCache.has(ref)) return valueCache.get(ref);
  const { table, col } = parts(ref);
  let vs = [];
  try {
    const d = csv(table), i = d.cols.indexOf(col);
    if (i >= 0) vs = [...new Set(d.rows.map(r => r[i]).filter(v => v !== ''))].sort();
  } catch { /* a calculated column: no data */ }
  valueCache.set(ref, vs);
  return vs;
}

const q = name => `'${name.replace(/'/g, "''")}'`;
const col = ref => { const { table, col: c } = parts(ref); return `${q(table)}[${c}]`; };
const tbl = name => q(name);
const isText = ref => types.get(ref) === 'string';
const isNum = ref => ['int64', 'double', 'decimal'].includes(types.get(ref));
function lit(ref, v) {
  const t = types.get(ref);
  if (t === 'string') return `"${String(v).replace(/"/g, '""')}"`;
  if (t === 'dateTime') { const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); return `DATE(${y}, ${m}, ${d})`; }
  return String(Number(v));
}
// A value of the column: one its data holds, now and then one it does not.
function value(ref) {
  const vs = values(ref);
  if (!vs.length || chance(0.08)) return isText(ref) ? '"zz-none"' : isNum(ref) ? '-1' : 'DATE(1999, 1, 1)';
  return lit(ref, pick(vs));
}
const someValues = (ref, n) => [...new Set(Array.from({ length: n }, () => value(ref)))];

// --- filters (CALCULATE's arguments) ---
function filter() {
  const d = pick(cfg.dims), c = col(d);
  const k = int(0, 13);
  switch (k) {
    case 0: return `${c} = ${value(d)}`;
    case 1: return `${c} <> ${value(d)}`;
    case 2: return `${c} IN { ${someValues(d, int(1, 3)).join(', ')} }`;
    case 3: return isNum(d) ? `${c} > ${value(d)}` : `${c} >= ${value(d)}`;
    case 4: return `ALL(${c})`;
    case 5: return `REMOVEFILTERS(${tbl(pick(cfg.tables))})`;
    case 6: return `KEEPFILTERS(${c} = ${value(d)})`;
    case 7: return `FILTER(ALL(${c}), ${c} <> ${value(d)})`;
    case 8: return `TREATAS({ ${someValues(d, int(1, 3)).join(', ')} }, ${c})`;
    case 9: return `USERELATIONSHIP(${col(cfg.inactive[0])}, ${col(cfg.inactive[1])})`;
    case 10: return pick([`SAMEPERIODLASTYEAR(${col(cfg.date)})`, `DATESYTD(${col(cfg.date)})`, `DATEADD(${col(cfg.date)}, -1, ${pick(['MONTH', 'QUARTER', 'YEAR'])})`, `PREVIOUSMONTH(${col(cfg.date)})`]);
    case 11: return `KEEPFILTERS(${c} IN { ${someValues(d, int(1, 3)).join(', ')} })`;
    case 12: return `FILTER(VALUES(${c}), ${scalar(1)} > ${pick([0, 10, 100, 1000])})`;
    default: { const { table } = parts(d); return `ALLEXCEPT(${tbl(table)}, ${c})`; }
  }
}

// --- scalars (a number) ---
function leaf() {
  if (chance(0.55) && measures.length) return `[${pick(measures)}]`;
  const f = pick(cfg.facts);
  switch (int(0, 5)) {
    case 0: return `SUM(${col(f)})`;
    case 1: return `AVERAGE(${col(f)})`;
    case 2: return `MIN(${col(f)})`;
    case 3: return `MAX(${col(f)})`;
    case 4: return `COUNTROWS(${tbl(pick(cfg.countTables))})`;
    default: return `DISTINCTCOUNT(${col(pick(cfg.dims))})`;
  }
}
function scalar(depth) {
  if (depth <= 0 || chance(0.25)) return leaf();
  const e = () => scalar(depth - 1), d = pick(cfg.dims), c = col(d), k = pick([0, 1, 10, 100, 1000]);
  switch (int(0, 19)) {
    case 0: case 1: case 2: return `CALCULATE(${e()}, ${Array.from({ length: int(1, 2) }, filter).join(', ')})`;
    case 3: return `DIVIDE(${e()}, ${e()})`;
    case 4: return `(${e()} ${pick(['+', '-', '*'])} ${e()})`;
    case 5: return `IF(${e()} > ${k}, ${e()}, ${e()})`;
    case 6: return `IF(ISBLANK(${e()}), 0, ${e()})`;
    case 7: return `COALESCE(${e()}, 0)`;
    case 8: return `ROUND(${e()}, ${int(0, 2)})`;
    case 9: return `${pick(['SUMX', 'AVERAGEX', 'MAXX', 'MINX'])}(VALUES(${c}), ${e()})`;
    case 10: return `COUNTROWS(FILTER(VALUES(${c}), ${e()} > ${k}))`;
    case 11: return `RANKX(ALL(${c}), ${e()}${chance(0.3) ? ', , DESC, Dense' : ''})`;
    case 12: return `VAR v = ${e()} RETURN v * 2 + ${e()}`;
    case 13: return `IF(HASONEVALUE(${c}), ${e()})`;
    case 14: return `TOTALYTD(${e()}, ${col(cfg.date)})`;
    case 15: return `DIVIDE(${e()}, CALCULATE(${e()}, ALL(${c})))`;
    case 16: return `CALCULATE(${e()}, DATESBETWEEN(${col(cfg.date)}, ${value(cfg.date)}, ${value(cfg.date)}))`;
    case 17: return `ABS(${e()})`;
    case 18: return `IF(ISINSCOPE(${c}), ${e()}, ${e()})`;
    default: return `MAX(${e()}, ${e()})`;
  }
}

// --- queries ---
const dimsOf = n => [...new Set(Array.from({ length: n }, () => pick(cfg.dims)))];
function tableFilter() {
  const d = pick(cfg.dims), c = col(d);
  switch (int(0, 3)) {
    case 0: return `TREATAS({ ${someValues(d, int(1, 3)).join(', ')} }, ${c})`;
    case 1: return `FILTER(ALL(${c}), ${c} <> ${value(d)})`;
    case 2: return `KEEPFILTERS(TREATAS({ ${someValues(d, int(1, 3)).join(', ')} }, ${c}))`;
    default: return `FILTER(VALUES(${c}), ${c} IN { ${someValues(d, 2).join(', ')} })`;
  }
}
function query() {
  const depth = int(1, 3);
  const named = n => Array.from({ length: n }, (_, i) => `"m${i}", ${scalar(depth)}`).join(', ');
  const sc = (g, f, m) => `SUMMARIZECOLUMNS(${[...dimsOf(g).map(col), ...Array.from({ length: f }, tableFilter), named(m)].join(', ')})`;
  switch (int(0, 6)) {
    case 0: case 1: case 2: return `EVALUATE ${sc(int(0, 3), chance(0.4) ? int(1, 2) : 0, int(1, 3))}`;
    case 3: return `EVALUATE ROW(${named(int(1, 3))})`;
    case 4: { const d = pick(cfg.dims); return `EVALUATE ADDCOLUMNS(VALUES(${col(d)}), ${named(int(1, 2))})`; }
    case 5: return `EVALUATE CALCULATETABLE(${sc(int(1, 2), 0, int(1, 2))}, ${filter()})`;
    default: return `EVALUATE TOPN(${int(1, 4)}, ${sc(1, 0, 1)}, [m0], ${pick(['DESC', 'ASC'])})`;
  }
}

const dir = join(ROOT, 'queries', model, 'fuzz');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (let i = 1; i <= COUNT; i++) {
  const id = `fuzz-${String(i).padStart(4, '0')}`;
  writeFileSync(join(dir, `${id}.dax`), `// note: a random query (conformance/tools/fuzz.mjs ${model} ${COUNT} ${SEED}, number ${i})\n${query()}\n`);
}
console.log(`${COUNT} queries in ${dir}`);
