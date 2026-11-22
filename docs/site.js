// The site: views, theme, and every live example. The compiler is the one on main, served next
// to this page (src/, formats/), and the model is the tests' fixture (fixtures/contoso.js).
import { createCompiler, parseQuery } from './src/index.js';
import { tmslToModel } from './formats/tmsl.js';
import { bim, setup } from './fixtures/contoso.js';
import * as ex from './examples.js';
import { formatSql, highlightDax, arrowRows, cell } from './code.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- theme and views
const themeBtn = $('#theme');
const setThemeLabel = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'; };
setThemeLabel();
themeBtn.addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* private window */ }
  setThemeLabel();
});

const views = $$('section.view');
const navLinks = $$('#nav a');
const ind = $('#nav .ind');
function moveInd() {
  const a = navLinks.find(l => l.getAttribute('aria-current') === 'page');
  if (!a) { ind.classList.add('off'); return; }
  ind.classList.remove('off');
  ind.style.width = `${a.offsetWidth}px`;
  ind.style.transform = `translateX(${a.offsetLeft - 4}px)`;
}
function show() {
  let id = (location.hash || '#problem').slice(1);
  if (id === 'limits') id = 'limitations';
  const view = views.find(v => v.id === id) ?? views.find(v => v.id === 'problem');
  for (const v of views) v.classList.toggle('on', v === view);
  for (const a of [...navLinks, ...$$('.toplinks a[href^="#"]')]) {
    if (a.getAttribute('href') === `#${view.id}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  moveInd();
  if (view.id === 'play') { loadEngine(); pgUpdate(); }
}
addEventListener('hashchange', () => { show(); scrollTo({ top: 0 }); });
addEventListener('resize', moveInd);

// A segmented toggle: <div class="seg" data-name><button data-v>...; calls back with the value.
function seg(el, value, onChange) {
  const set = v => { for (const b of $$('button', el)) b.setAttribute('aria-selected', String(b.dataset.v === v)); };
  set(value);
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset.v);
    onChange(b.dataset.v);
  });
}

// ---------------------------------------------------------------- the compiler
const compilers = new Map();
function compiler(dialect = 'duckdb', optimize = true) {
  const k = `${dialect}:${optimize}`;
  if (!compilers.has(k)) compilers.set(k, createCompiler(tmslToModel(bim), { dialect, optimize }));
  return compilers.get(k);
}
function compile(query, { dialect = 'duckdb', optimize = true } = {}) {
  try {
    return compiler(dialect, optimize).compile(query);
  } catch (e) {
    return { error: { code: e.code ?? 'ERROR', message: e.message } };
  }
}
const stats = sql => ({ lines: formatSql(sql).split('\n').length, selects: (sql.match(/\bSELECT\b/gi) ?? []).length, chars: sql.length });

// ---------------------------------------------------------------- the engine (DuckDB-WASM, on demand)
const WASM = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm';
let engine = null, engineState = 'off'; // off | loading | ready | failed
const onEngine = new Set();
const engineChanged = () => { for (const f of onEngine) f(); };
function loadEngine() {
  if (engine) return engine;
  engineState = 'loading'; engineChanged();
  engine = (async () => {
    const duckdb = await import(WASM);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const url = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(url));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(url);
    const con = await db.connect();
    for (const s of setup.split(';').map(x => x.trim()).filter(Boolean)) await con.query(s);
    return con;
  })();
  engine.then(() => { engineState = 'ready'; engineChanged(); }, e => {
    console.error(e); engine = null; engineState = 'failed'; engineChanged();
  });
  return engine;
}
let chain = Promise.resolve();
function run(sql) {
  const p = chain.catch(() => {}).then(async () => {
    const con = await loadEngine();
    const t0 = performance.now();
    const t = await con.query(sql);
    return { ...arrowRows(t), ms: performance.now() - t0 };
  });
  chain = p;
  return p;
}

// ---------------------------------------------------------------- rendering helpers
const codeBlock = (html, cls = '') => `<pre class="code ${cls}"><code>${html}</code></pre>`;
const daxBlock = q => codeBlock(highlightDax(q), 'dax');
const sqlBlock = sql => codeBlock(formatSql(sql), 'sql');
const errBlock = e => `<div class="err"><span class="chip refused"><i>&times;</i>${esc(e.code)}</span> <code>${esc(e.message.split('\n')[0])}</code></div>`;
function rowsTable({ names, rows }) {
  const num = names.map((_, i) => rows.some(r => typeof r[i] === 'number') && rows.every(r => r[i] == null || typeof r[i] === 'number'));
  return `<div class="tw"><table><thead><tr>${names.map((n, i) => `<th${num[i] ? ' class="n"' : ''}>${esc(n)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td${num[i] ? ' class="n"' : ''}>${v == null ? '<span class="muted">blank</span>' : esc(cell(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// The rows of some SQL, or a button that loads the engine.
function rowsBox(el, getSql, { dialect = () => 'duckdb', auto = false } = {}) {
  let token = 0;
  async function render() {
    const sql = getSql();
    const my = ++token;
    if (dialect() !== 'duckdb') { el.innerHTML = '<p class="sub">T-SQL runs on Fabric. This page runs DuckDB: switch to DuckDB to see the rows.</p>'; return; }
    if (!sql) { el.innerHTML = ''; return; }
    if (auto && engineState === 'off') loadEngine();
    if (engineState === 'off' || engineState === 'failed') {
      el.innerHTML = `<div class="runbox"><button class="btn run" type="button">&#9654; Run it</button>
        <span class="sub">${engineState === 'failed' ? 'DuckDB-WASM did not load. Try again?' : 'Loads DuckDB-WASM into this tab once (about 35 MB), then runs every example on this page.'}</span></div>`;
      $('button', el).onclick = () => loadEngine();
      return;
    }
    if (engineState === 'loading') { el.innerHTML = '<p class="sub"><span class="spin"></span> Loading DuckDB-WASM&hellip;</p>'; return; }
    try {
      const res = await run(sql);
      if (my !== token) return;
      el.innerHTML = `${rowsTable(res)}<p class="sub tiny">${plural(res.rows.length, 'row')} from DuckDB-WASM, in ${res.ms.toFixed(0)} ms</p>`;
    } catch (e) {
      if (my !== token) return;
      el.innerHTML = errBlock({ code: 'DuckDB', message: String(e.message ?? e) });
    }
  }
  onEngine.add(render);
  return render;
}

// ---------------------------------------------------------------- 1. the problem
{
  const steps = ex.problem;
  let i = 0, optimize = false, timer = null;
  const stepper = $('#stepper');
  stepper.innerHTML = steps.map((s, k) => `<button type="button" data-i="${k}"><b>${k + 1}</b>${esc(s.title)}</button>`).join('');
  const rows = rowsBox($('#p-rows'), () => compile(steps[i].dax, { optimize }).sql, { dialect: () => 'duckdb' });
  const chip = ([kind, text]) => `<div class="ctx ctx-${kind}"><span class="ck">${kind}</span><span>${esc(text)}</span></div>`;
  function render() {
    const s = steps[i];
    for (const b of $$('button', stepper)) {
      const k = Number(b.dataset.i);
      b.classList.toggle('done', k < i);
      if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    }
    $('#caption').textContent = s.say;
    $('#p-dax').innerHTML = daxBlock(s.dax);
    $('#p-ctx').innerHTML = s.ctx.length ? s.ctx.map(chip).join('') : '<div class="ctx ctx-empty"><span class="ck">empty</span><span>every row of Sales</span></div>';
    const c = compile(s.dax, { optimize });
    const st = stats(c.sql);
    $('#p-meta').textContent = `${plural(st.lines, 'line')} · ${plural(st.selects, 'SELECT')}`;
    $('#p-sql').innerHTML = sqlBlock(c.sql);
    for (const el of $$('#walk .rv')) { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
    rows();
  }
  const go = k => { i = Math.max(0, Math.min(steps.length - 1, k)); render(); };
  stepper.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { stop(); go(Number(b.dataset.i)); } });
  $('#p-prev').onclick = () => { stop(); go(i - 1); };
  $('#p-next').onclick = () => { stop(); go(i + 1); };
  const stop = () => { clearInterval(timer); timer = null; $('#play').textContent = 'Play'; };
  $('#play').onclick = () => {
    if (timer) { stop(); return; }
    go(0);
    $('#play').textContent = 'Stop';
    timer = setInterval(() => { if (i >= steps.length - 1) stop(); else go(i + 1); }, 6500);
  };
  seg($('#p-opt'), 'off', v => { optimize = v === 'on'; render(); });
  render();
}


// ---------------------------------------------------------------- 2. how it works
{
  $('#how-dax').innerHTML = daxBlock(ex.how);
  // The syntax tree, one node a line.
  const label = n => {
    switch (n.k) {
      case 'call': return `<b>${esc(n.fn)}</b>(&hellip;)`;
      case 'col': return n.table ? `column <code>'${esc(n.table)}'[${esc(n.name)}]</code>` : `name <code>[${esc(n.name)}]</code> <span class="muted">(a measure? not known yet)</span>`;
      case 'str': return `text <code>"${esc(n.v)}"</code>`;
      case 'num': return `number <code>${esc(n.v)}</code>`;
      default: return `<b>${esc(n.k)}</b>`;
    }
  };
  const lines = [];
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(x => walk(x, depth)); return; }
    if (n.k) { lines.push(`<div class="tn" style="--d:${depth}"><span class="tk">${esc(n.k)}</span>${label(n)}</div>`); depth++; }
    for (const [key, v] of Object.entries(n)) if (key !== 'k' && v && typeof v === 'object') walk(v, depth);
  };
  const ast = parseQuery(ex.how);
  lines.push('<div class="tn" style="--d:0"><span class="tk">query</span><b>EVALUATE</b></div>');
  walk(ast.evaluates[0].e, 1);
  for (const o of ast.evaluates[0].order) { lines.push('<div class="tn" style="--d:1"><span class="tk">order</span><b>ORDER BY</b></div>'); walk(o, 2); }
  $('#how-ast').innerHTML = lines.join('');

  // Rewrites off and on, and the same rows.
  const raw = compile(ex.how, { optimize: false }), fused = compile(ex.how, { optimize: true });
  const sr = stats(raw.sql), sf = stats(fused.sql);
  $('#how-raw').innerHTML = sqlBlock(raw.sql);
  $('#how-fused').innerHTML = sqlBlock(fused.sql);
  $('#how-raw-m').textContent = `${plural(sr.lines, 'line')} · ${plural(sr.selects, 'SELECT')}`;
  $('#how-fused-m').textContent = `${plural(sf.lines, 'line')} · ${plural(sf.selects, 'SELECT')}`;
  const agree = $('#how-agree');
  const renderAgree = async () => {
    if (engineState !== 'ready') {
      agree.innerHTML = `<button class="btn run" type="button">&#9654; Run both</button> <span class="sub">and compare their rows, as CI's <code>agree</code> job does for every conformance query.</span>`;
      $('button', agree).onclick = () => loadEngine();
      if (engineState === 'loading') agree.innerHTML = '<p class="sub"><span class="spin"></span> Loading DuckDB-WASM&hellip;</p>';
      return;
    }
    const [a, b] = await Promise.all([run(raw.sql), run(fused.sql)]);
    const same = JSON.stringify(a.rows) === JSON.stringify(b.rows);
    agree.innerHTML = `${same ? `<span class="chip match"><i>=</i>the same ${plural(a.rows.length, 'row')}</span>` : '<span class="chip differs"><i>&times;</i>the rows differ</span>'}
      <span class="sub">rewrites off: ${a.ms.toFixed(0)} ms · rewrites on: ${b.ms.toFixed(0)} ms, on 11 sales. The gap grows with the data: see the measured numbers below.</span>`;
  };
  onEngine.add(renderAgree);
  renderAgree();

  // The two dialects.
  const q = ex.problem[2].dax;
  $('#how-dialect-q').innerHTML = daxBlock(q);
  $('#how-duck').innerHTML = sqlBlock(compile(q, { dialect: 'duckdb' }).sql);
  $('#how-tsql').innerHTML = sqlBlock(compile(q, { dialect: 'tsql' }).sql);

  // The stages, stepped.
  const stages = $$('#pipe .fbox');
  const pick = k => {
    stages.forEach((s, j) => s.classList.toggle('on', j === k));
    $$('[data-stage]').forEach(p => p.classList.toggle('on', Number(p.dataset.stage) === k));
  };
  stages.forEach((s, j) => { s.tabIndex = 0; s.onclick = () => pick(j); s.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(j); } }; });
  pick(0);
}

// ---------------------------------------------------------------- 3. the playground
// The query, the SQL the compiler emits (DuckDB's, with its rewrites, as it ships), and DuckDB's answer.
const pgIn = $('#pg-in'), pgEx = $('#pg-ex');
const pg = { compiled: null };
pgEx.innerHTML = ex.playground.map(([name], k) => `<option value="${k}">${esc(name)}</option>`).join('');
let saved = null;
try { saved = localStorage.getItem('pg'); } catch { /* none */ }
pgIn.value = saved ?? ex.playground[0][1];
const pgRows = rowsBox($('#pg-rows'), () => pg.compiled?.sql, { auto: true });
// Two tabs: the model, and the live query.
function pgTab(k) {
  for (const b of $$('#pg-tabs button')) b.setAttribute('aria-selected', String(b.dataset.k === k));
  for (const p of $$('#play [data-pane]')) p.classList.toggle('on', p.dataset.pane === k);
  try { localStorage.setItem('pgTab', k); } catch { /* none */ }
}
$('#pg-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) pgTab(b.dataset.k); });
let pgTab0 = 'model';
try { pgTab0 = localStorage.getItem('pgTab') ?? 'model'; } catch { /* none */ }
pgTab(pgTab0);
function pgUpdate() {
  const text = pgIn.value;
  try { localStorage.setItem('pg', text); } catch { /* none */ }
  pg.compiled = compile(text);
  const isSql = /^\s*(?:--[^\n]*\n\s*)*(SELECT|WITH)\b/i.test(text);
  const daxEl = $('#pg-dax');
  if (isSql) {
    try {
      const { dax } = compiler().sqlToDax(text);
      daxEl.innerHTML = `<h4>The DAX this SQL stands for</h4>${daxBlock(dax)}`;
    } catch { daxEl.innerHTML = ''; }
  } else daxEl.innerHTML = '';
  if (pg.compiled.error) {
    $('#pg-err').innerHTML = errBlock(pg.compiled.error);
    $('#pg-sql').innerHTML = ''; $('#pg-meta').textContent = ''; $('#pg-cols').innerHTML = '';
    pg.compiled = null;
  } else {
    $('#pg-err').innerHTML = '';
    const s = stats(pg.compiled.sql);
    $('#pg-meta').textContent = `${plural(s.lines, 'line')} · ${plural(s.chars, 'character')}`;
    $('#pg-sql').innerHTML = sqlBlock(pg.compiled.sql);
    $('#pg-cols').innerHTML = pg.compiled.columns.map(c => `<span class="colchip"><b>${esc(c.name)}</b> ${esc(c.type)}</span>`).join('');
  }
  pgRows();
}
let pgTimer;
pgIn.addEventListener('input', () => { clearTimeout(pgTimer); pgTimer = setTimeout(pgUpdate, 250); });
pgIn.addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); insert('  '); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); clearTimeout(pgTimer); pgUpdate(); }
});
pgEx.addEventListener('change', () => { pgIn.value = ex.playground[Number(pgEx.value)][1]; pgUpdate(); });
$('#pg-copy').onclick = async () => {
  if (!pg.compiled) return;
  try { await navigator.clipboard.writeText(pg.compiled.sql); $('#pg-copy').textContent = 'Copied'; setTimeout(() => { $('#pg-copy').textContent = 'Copy SQL'; }, 1200); } catch { /* no clipboard */ }
};
function insert(text) {
  const { selectionStart: a, selectionEnd: b, value } = pgIn;
  pgIn.value = value.slice(0, a) + text + value.slice(b);
  pgIn.selectionStart = pgIn.selectionEnd = a + text.length;
  pgIn.focus();
  clearTimeout(pgTimer); pgTimer = setTimeout(pgUpdate, 250);
}

// The semantic model as a graph, from the model itself: its tables, their columns and measures, and
// its relationships. Click a name to insert it.
{
  const tables = bim.model.tables;
  const rels = bim.model.relationships ?? [];
  // Where each related table sits (column, row); the fact spans two rows. Tables in no relationship
  // (calculated tables, calculation groups, the field parameter) go below.
  const place = { Category: [1, 1], Product: [2, 1], Sales: [3, '1 / span 2'], Customer: [4, 1], CityTarget: [4, 2], Returns: [2, 3], Date: [3, 3] };
  const related = new Set(rels.flatMap(r => [r.fromTable, r.toTable]));
  const q = t => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`);
  const kindOf = t => t.calculationGroup ? 'calculation group' : t.partitions?.[0]?.source?.type === 'calculated'
    ? (t.columns.some(c => c.extendedProperties?.some(p => p.name === 'ParameterMetadata')) ? 'field parameter' : 'calculated table') : '';
  const card = t => {
    const cols = t.columns.filter(c => !(t.calculationGroup && c.name === 'Ordinal'))
      .map(c => `<button type="button" class="ins col" data-t="${esc(`${q(t.name)}[${c.name}]`)}">${esc(c.name)}</button>`).join('');
    const ms = (t.measures ?? []).map(m => `<button type="button" class="ins ms" data-t="${esc(`[${m.name}]`)}" title="${esc(`[${m.name}] := ${m.expression}`)}">${esc(m.name)}</button>`).join('');
    const items = t.calculationGroup ? `<div class="names sub tiny" style="padding-top:0">items: ${t.calculationGroup.calculationItems.map(i => esc(i.name)).join(', ')}</div>` : '';
    const kind = kindOf(t);
    return `<div class="mt${(t.measures ?? []).length > 5 ? ' fact' : ''}" data-table="${esc(t.name)}"><header>${esc(t.name)}<span data-count>${kind}</span></header><div class="names">${cols}${ms}</div>${items}</div>`;
  };
  const graph = $('#pg-graph');
  const inGraph = tables.filter(t => related.has(t.name) && place[t.name]);
  graph.innerHTML = `<svg class="mg-lines" aria-hidden="true"></svg>${inGraph.map(t => {
    const [c, r] = place[t.name];
    return card(t).replace('<div class="mt', `<div style="grid-column:${c};grid-row:${r}" class="mt`);
  }).join('')}`;
  const others = tables.filter(t => !inGraph.includes(t));
  if (others.length) graph.insertAdjacentHTML('beforeend', `<div class="mg-others" style="grid-column:5;grid-row:1 / span 3"><h4>Also in the model</h4>${others.map(card).join('')}</div>`);
  graph.addEventListener('click', e => { const b = e.target.closest('.ins'); if (b) { pgTab('query'); insert(b.dataset.t); } });

  // The relationships: a line from card to card, clipped at their borders; 1 and * at its ends.
  const svg = $('svg', graph);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text) e.textContent = text; return e; };
  function draw() {
    if (!graph.offsetWidth) return;
    svg.replaceChildren();
    const g = graph.getBoundingClientRect();
    const box = name => { const r = graph.querySelector(`.mt[data-table="${CSS.escape(name)}"]`)?.getBoundingClientRect(); return r && { x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2, w: r.width / 2, h: r.height / 2 }; };
    const edge = (b, dx, dy) => { const t = Math.min(dx ? b.w / Math.abs(dx) : Infinity, dy ? b.h / Math.abs(dy) : Infinity); return [b.x + dx * t, b.y + dy * t]; };
    const pairs = new Map();
    for (const r of rels) { const k = [r.fromTable, r.toTable].sort().join('|'); pairs.set(k, (pairs.get(k) ?? 0) + 1); }
    const seen = new Map();
    for (const r of rels) {
      const a = box(r.fromTable), b = box(r.toTable);
      if (!a || !b) continue;
      const k = [r.fromTable, r.toTable].sort().join('|');
      const n = pairs.get(k), i = seen.get(k) ?? 0; seen.set(k, i + 1);
      let dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const off = n > 1 ? (i - (n - 1) / 2) * 44 : 0; // parallel relationships side by side
      const A = { ...a, x: a.x - dy * off, y: a.y + dx * off }, B = { ...b, x: b.x - dy * off, y: b.y + dx * off };
      const [x1, y1] = edge(A, dx, dy), [x2, y2] = edge(B, -dx, -dy);
      const m2m = r.fromCardinality === 'many' && r.toCardinality === 'many';
      const cls = m2m ? 'm2m' : r.isActive === false ? 'inactive' : '';
      svg.append(el('line', { x1, y1, x2, y2, class: cls }));
      const end = (x, y, ux, uy, t) => svg.append(el('text', { x: x + ux * 12 - uy * 8, y: y + uy * 12 + ux * 8 + 4, 'text-anchor': 'middle', class: 'card' }, t));
      end(x1, y1, dx, dy, r.fromCardinality === 'one' ? '1' : '*');
      end(x2, y2, -dx, -dy, r.toCardinality === 'many' ? '*' : '1');
      if (n > 1 || r.isActive === false || m2m) {
        const label = m2m ? `${r.fromColumn}, many-to-many` : `${r.fromColumn}${r.isActive === false ? ' (inactive)' : ''}`;
        // On the line's outer side: the way its offset moved it.
        const side = off < 0 ? -1 : 1, px = -dy * side, py = dx * side;
        svg.append(el('text', { x: (x1 + x2) / 2 + px * 8, y: (y1 + y2) / 2 + py * 8 + 4,
          'text-anchor': Math.abs(px) < 0.3 ? 'middle' : px > 0 ? 'start' : 'end' }, label));
      }
    }
  }
  new ResizeObserver(draw).observe(graph);

  // Each table's rows, once DuckDB is there.
  let counted = false;
  onEngine.add(async () => {
    if (engineState !== 'ready' || counted) return;
    counted = true;
    for (const t of inGraph) {
      try {
        const { rows } = await run(`SELECT count(*) FROM "${t.name.replace(/"/g, '""')}"`);
        const span = graph.querySelector(`.mt[data-table="${CSS.escape(t.name)}"] [data-count]`);
        span.textContent = `${rows[0][0].toLocaleString('en-US')} rows`;
      } catch { /* a table the data lacks */ }
    }
  });
}
show();
document.documentElement.classList.add('ready');
// ?run: load the engine at once, so a shared link opens with its rows.
if (new URLSearchParams(location.search).has('run')) loadEngine();
