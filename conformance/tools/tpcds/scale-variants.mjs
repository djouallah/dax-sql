// The tpcds queries with their constants swapped for values the data holds, at a TPC-DS scale
// factor (a DuckDB file tools/tpcds/scale.mjs writes): a query's filter that keeps no row there (a
// brand no item has, a DATESBETWEEN from a later date to an earlier one, a year the calendar lacks)
// is a query whose SQL any engine skips, dax-sql's and the hand-written alike, and its times say
// nothing of the SQL. Each constant a column is compared with (T[c] IN {…}, TREATAS({…}, T[c]),
// T[c] = v, DATESBETWEEN's dates) becomes one of the column's most frequent values (the dates a
// range the sales cover), in the DAX and in the hand-written SQL alike (conformance/engines/hand);
// both are run and timed, their answers compared, and dax-sql's held to its plan unnested too.
//   node tools/tpcds/scale-variants.mjs <sf.duckdb> [--timeout 120] [--grep regex] [--report out.json]
// A hand-written file that does not name a constant the DAX does (it wrote what the data makes of
// it: "AND false" for a brand no item has) is not run: the variant has no hand-written answer.
// A measure, not a gate: it exits 0.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadQueries, modelDir } from '../suite.mjs';
import { engine, value } from '../../engines/dax-sql/db.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i < 0 ? d : args.splice(i, 2)[1]; };
const timeout = Number(opt('--timeout', 120)) * 1000;
const grep = opt('--grep', null);
const report = opt('--report', null);
const [file] = args;
if (!file) throw new Error('usage: scale-variants.mjs <sf.duckdb> [--timeout 120] [--grep regex] [--report out.json]');

const root = new URL('../../../', import.meta.url);
const rootDir = root.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const e = await engine(rootDir);
const require = createRequire(new URL('package.json', root));
const { DuckDBInstance, JSDuckDBValueConverter } = require('@duckdb/node-api');
const inst = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' });
let con = await inst.connect();
const db = await e.database(join(modelDir('tpcds'), 'model.bim'), null, con);
const compiler = e.createCompiler(db.model, { columnNames: 'dax' });

// --- the constants of a query ------------------------------------------------------------------

const COL = String.raw`'?([A-Za-z_][\w ]*?)'?\[([^\]]+)\]`;
const LIT = String.raw`"(?:[^"]|"")*"|-?\d+(?:\.\d+)?`;
const parseLit = s => (s.startsWith('"') ? s.slice(1, -1).replaceAll('""', '"') : Number(s));
const daxLit = v => (typeof v === 'string' ? `"${v.replaceAll('"', '""')}"` : String(v));
const sqlLit = v => (typeof v === 'string' ? `'${v.replaceAll("'", "''")}'` : String(v));
// The places a column is compared with constants: { at, len, table, col, lits, write(newLits) }.
function sites(dax) {
  const out = [];
  const list = new RegExp(String.raw`${COL}\s+IN\s*\{\s*((?:${LIT})(?:\s*,\s*(?:${LIT}))*)\s*\}`, 'g');
  for (const m of dax.matchAll(list)) {
    out.push({ at: m.index, len: m[0].length, table: m[1], col: m[2], lits: [...m[3].matchAll(new RegExp(LIT, 'g'))].map(x => parseLit(x[0])),
      write: ls => `${m[0].slice(0, m[0].indexOf('{'))}{ ${ls.map(daxLit).join(', ')} }` });
  }
  const treat = new RegExp(String.raw`TREATAS\(\s*\{\s*((?:${LIT})(?:\s*,\s*(?:${LIT}))*)\s*\}\s*,\s*${COL}\s*\)`, 'g');
  for (const m of dax.matchAll(treat)) {
    out.push({ at: m.index, len: m[0].length, table: m[2], col: m[3], lits: [...m[1].matchAll(new RegExp(LIT, 'g'))].map(x => parseLit(x[0])),
      write: ls => `TREATAS({ ${ls.map(daxLit).join(', ')} }, ${m[0].slice(m[0].lastIndexOf(',') + 1).trim()}` });
  }
  const eq = new RegExp(String.raw`${COL}\s*=\s*(${LIT})(?![\w.])`, 'g');
  for (const m of dax.matchAll(eq)) {
    out.push({ at: m.index, len: m[0].length, table: m[1], col: m[2], lits: [parseLit(m[3])], write: ls => `${m[0].slice(0, m[0].lastIndexOf('=') + 1)} ${daxLit(ls[0])}` });
  }
  const between = /DATESBETWEEN\(\s*('?[\w ]+'?\[[^\]]+\])\s*,\s*DATE\((\d+),\s*(\d+),\s*(\d+)\)\s*,\s*DATE\((\d+),\s*(\d+),\s*(\d+)\)\s*\)/g;
  for (const m of dax.matchAll(between)) {
    const d = (y, mo, da) => `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    out.push({ at: m.index, len: m[0].length, dates: [d(m[2], m[3], m[4]), d(m[5], m[6], m[7])],
      write: ([a, b]) => `DATESBETWEEN(${m[1]}, DATE(${a.split('-').map(Number).join(', ')}), DATE(${b.split('-').map(Number).join(', ')}))` });
  }
  return out.sort((a, b) => a.at - b.at).filter((s, i, xs) => !xs.slice(0, i).some(p => s.at < p.at + p.len));
}

// The values of a model column the data holds, the most frequent first.
const freq = new Map();
async function valuesOf(table, col) {
  const key = `${table}[${col}]`;
  if (freq.has(key)) return freq.get(key);
  let vals = null;
  try {
    const c = compiler.model.findColumn(table, col), t = c?.table;
    if (c && !c.expr && !t.calc) {
      const src = c.source, from = t.source.entity;
      const r = await con.runAndReadAll(`SELECT "${src}" FROM "${from}" WHERE "${src}" IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 DESC LIMIT 12`);
      vals = r.getRowsJS().map(x => (typeof x[0] === 'bigint' ? Number(x[0]) : x[0]));
    }
  } catch { vals = null; }
  freq.set(key, vals);
  return vals;
}
// The sales' dates: a range of them, the middle third.
let salesRange = null;
async function dateRange() {
  if (salesRange) return salesRange;
  const r = await con.runAndReadAll(`SELECT CAST(MIN(d_date) AS VARCHAR), CAST(MAX(d_date) AS VARCHAR) FROM date_dim WHERE d_date_sk_1 IN (SELECT ss_sold_date_sk FROM store_sales)`);
  const [lo, hi] = r.getRowsJS()[0].map(s => new Date(`${s}T00:00:00Z`).getTime());
  const day = 864e5, third = Math.round((hi - lo) / 3 / day) * day;
  salesRange = [new Date(lo + third).toISOString().slice(0, 10), new Date(lo + 2 * third).toISOString().slice(0, 10)];
  return salesRange;
}

// The query as a variant: { dax, hand, changes } or null when it has no constant to swap.
async function variant(dax, hand) {
  const ss = sites(dax);
  let out = '', last = 0, changes = [], h = hand, handOk = hand != null;
  const handSwap = (from, to) => {
    if (h == null) return;
    const re = typeof from === 'number'
      ? new RegExp(String.raw`(?<![\w.'-])${String(from).replace('.', '\\.')}(?![\w.'-])`, 'g')
      : new RegExp(sqlLit(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    if (!re.test(h)) { handOk = false; return; }
    h = h.replace(re, sqlLit(to));
  };
  for (const s of ss) {
    let text = null;
    if (s.dates) {
      const r = await dateRange();
      if (r[0] !== s.dates[0] || r[1] !== s.dates[1]) {
        text = s.write(r);
        changes.push(`dates ${s.dates.join('..')} -> ${r.join('..')}`);
        if (h != null) for (let i = 0; i < 2; i++) {
          const re = new RegExp(`DATE '${s.dates[i]}'`, 'g');
          if (!re.test(h)) handOk = false; else h = h.replace(re, `DATE '${r[i]}'`);
        }
      }
    } else if (!s.lits.some(v => v === 0 || v === '')) {
      const vals = await valuesOf(s.table, s.col);
      if (vals?.length && vals.every(v => typeof v === typeof s.lits[0])) {
        const fresh = vals.filter(v => !s.lits.includes(v));
        // A constant the data holds among its most frequent stays; another becomes one of those.
        const ls = s.lits.map(v => (vals.includes(v) ? v : fresh.shift() ?? v));
        if (ls.some((v, i) => v !== s.lits[i])) {
          text = s.write(ls);
          changes.push(`${s.table}[${s.col}] ${s.lits.map(daxLit).join(',')} -> ${ls.map(daxLit).join(',')}`);
          s.lits.forEach((v, i) => { if (v !== ls[i]) handSwap(v, ls[i]); });
        }
      }
    }
    if (text == null) continue;
    out += dax.slice(last, s.at) + text;
    last = s.at + s.len;
  }
  if (!changes.length) return null;
  return { dax: out + dax.slice(last), hand: handOk ? h : null, changes };
}

// --- running -----------------------------------------------------------------------------------

// A query's answer, timed. A result left open (interrupted, or past 100,000 rows) holds the
// connection: the next query has a new one.
async function run(sql, stream = true) {
  const timer = setTimeout(() => con.interrupt(), timeout);
  const t0 = performance.now();
  let open = true;
  try {
    let rows = [];
    if (stream) {
      const result = await con.stream(sql);
      for (let ch; (ch = await result.fetchChunk()) && ch.rowCount;) {
        const cols = ch.convertColumns(JSDuckDBValueConverter);
        for (let i = 0; i < ch.rowCount; i++) rows.push(cols.map(c => value(c[i])));
        if (rows.length > 100000) { rows = null; break; }
      }
    } else rows = (await con.runAndReadAll(sql)).getRowsJS().map(r => r.map(value));
    open = !rows;
    return { ms: Math.round(performance.now() - t0), rows };
  } catch (err) {
    const ms = performance.now() - t0;
    return { ms: Math.round(ms), error: ms >= timeout - 50 ? `timeout (${timeout / 1000} s)` : err.message.split('\n')[0] };
  } finally {
    clearTimeout(timer);
    if (open) { try { con.disconnectSync?.(); } catch {} con = await inst.connect(); }
  }
}
const norm = rows => rows.map(r => JSON.stringify(r.map(v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(9)) : v)))).sort();
const same = (a, b) => { if (!a || !b) return null; const x = norm(a), y = norm(b); return x.length === y.length && x.every((r, i) => r === y[i]); };

const handDir = join(rootDir, 'conformance/engines/hand/tpcds');
const queries = loadQueries({ model: 'tpcds' }).filter(q => !grep || new RegExp(grep).test(`${q.family}/${q.id}`));
const results = [];
for (const q of queries) {
  const id = `${q.family}/${q.id}`;
  const hf = join(handDir, `${id}.sql`);
  // A query the compiler refuses as it is (DAX's error) is no variant.
  try { compiler.compile(q.dax); } catch { continue; }
  const v = await variant(q.dax, existsSync(hf) ? readFileSync(hf, 'utf8') : null);
  if (!v) continue;
  const r = { id, changes: v.changes };
  results.push(r);
  let sql;
  try { sql = compiler.compile(v.dax).sql; } catch (err) { r.compileError = err.message.split('\n')[0]; continue; }
  const a = await run(sql);
  r.ms = a.ms;
  if (a.error) { r.error = a.error; continue; }
  r.rows = a.rows?.length ?? null;
  const u = await run(compiler.planSql(v.dax, { unnest: true }).sql);
  r.unnested = u.error ? `error: ${u.error}` : same(a.rows, u.rows) === false ? 'differs' : 'same';
  if (v.hand != null) {
    const b = await run(v.hand, false);
    r.handMs = b.ms;
    r.hand = b.error ? `error: ${b.error}` : same(a.rows, b.rows) === false ? 'differs' : 'same';
  } else r.hand = existsSync(hf) ? 'written for the data' : 'none';
  if (results.length % 50 === 0) console.log(`… ${results.length} variants`);
}

const timed = results.filter(r => r.ms != null && r.handMs != null && r.hand === 'same');
const bad = timed.filter(r => r.ms >= 5 * r.handMs && r.ms - r.handMs >= 500).sort((a, b) => b.ms / b.handMs - a.ms / a.handMs);
const wrong = results.filter(r => r.compileError || r.error || r.unnested !== 'same' || r.hand === 'differs' || r.hand?.startsWith('error'));
const esc = s => String(s ?? '').replaceAll('|', '\\|').slice(0, 160);
const line = r => `| ${r.id} | ${r.ms ?? ''} | ${r.handMs ?? ''} | ${r.ms != null && r.handMs ? (r.ms / Math.max(r.handMs, 1)).toFixed(1) : ''} | ${esc(r.compileError ?? r.error ?? r.hand)} | ${esc(r.unnested)} | ${esc(r.changes.join('; '))} |`;
const head = '| query | dax-sql ms | hand ms | × hand | hand | unnested | constants |\n|---|---|---|---|---|---|---|';
const sum = xs => (xs.reduce((s, r) => s + r, 0) / 1000).toFixed(1);
const summary = [
  `### tpcds with other constants (${file.replace(/\\/g, '/').split('/').pop()}): ${results.length} variants`, '',
  `dax-sql ${sum(timed.map(r => r.ms))} s, by hand ${sum(timed.map(r => r.handMs))} s on the ${timed.length} with a hand-written answer the same; `
    + `${results.filter(r => r.hand === 'written for the data').length} hand-written files written for the data's values. `
    + `Very bad (5× the hand's time or more, and 500 ms slower): ${bad.length}.`, '',
  ...(bad.length ? ['#### Very bad', '', head, ...bad.map(line), ''] : []),
  '#### The slowest 25', '', head, ...[...results].filter(r => r.ms != null).sort((a, b) => b.ms - a.ms).slice(0, 25).map(line), '',
  ...(wrong.length ? ['#### Errors and answers otherwise', '', head, ...wrong.map(line), ''] : []),
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (report) writeFileSync(report, JSON.stringify(results, null, 1));
