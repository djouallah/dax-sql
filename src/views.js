// Semantic views: models a SQL engine's users name in their SQL, and the statements that make,
// drop and list them. Engine-neutral: this keeps the views and turns a text into what to run;
// where a view is stored, and how its file is read, is the host's (a DuckDB extension keeps
// them in a table, an editor in its settings).
//
//   CREATE [OR REPLACE] SEMANTIC VIEW [IF NOT EXISTS] [db.][schema.]v FROM '<path>'
//   DROP SEMANTIC VIEW [IF EXISTS] v
//
// A view in a schema of its own (not 'main') is named in full as schema.v, so two models of one
// name in two schemas (two workspaces' sales) are two views. SQL names one in full, or by v alone
// while only one view is called v; a name that fits several is an error that lists them.
//   SHOW SEMANTIC VIEWS
//   SHOW SEMANTIC DIMENSIONS IN v [FOR METRIC m]
//   SHOW SEMANTIC METRICS IN v
//   DESCRIBE v
//   any other statement: each model query compiled in place (compileStatement), and each
//   (DESCRIBE v) or (SHOW SEMANTIC ...) in it replaced by its rows, so they read as subqueries
//
// createViews() (index.js) returns:
//   define(name, model, { path, db, schema, mode, tablesFrom, ...compilerOptions })
//                      'created' | 'exists'; mode 'create' (an error if it exists), 'replace',
//                      'if_not_exists'
//   drop(name, { ifExists })     true when there was one
//   get(name), list()
//   rewrite(sql)       null when nothing in the text is a view's, or one entry per statement:
//                      { create: { db, schema, name, path, mode } } — the host reads the file
//                      and calls define; { drop: { name, ifExists } } — the host forgets it and
//                      calls drop; { sql } — what to run
// Errors are DaxError: SYNTAX for a statement that does not read, CATALOG for a view that is
// missing or already there.
import { DaxError } from './errors.js';
import { nameParts } from './sql.js';

const lc = s => String(s).toLowerCase();
const str = s => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const ident = s => `"${String(s).replace(/"/g, '""')}"`;
const fail = (message, code) => new DaxError(message, { code });

// ---------------------------------------------------------------------------------------------
// Tokens: enough to split statements and read the views' own ones. Strings, quoted names, $$
// strings and comments are single tokens, so nothing inside them counts.
function tokens(sql) {
  const out = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    const at = i;
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const e = sql.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      let v = '';
      while (i < n) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) { v += c; i += 2; continue; }
          i++;
          break;
        }
        v += sql[i++];
      }
      out.push({ t: c === "'" ? 'str' : 'name', v, at, end: i });
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        const stop = e < 0 ? n : e;
        out.push({ t: 'str', v: sql.slice(i + m[0].length, stop), at, end: e < 0 ? n : e + m[0].length });
        i = e < 0 ? n : e + m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      while (i < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[i])) i++;
      out.push({ t: 'word', v: sql.slice(at, i), at, end: i });
      continue;
    }
    i++;
    out.push({ t: c === ';' ? ';' : 'sym', v: c, at, end: i });
  }
  return out;
}

// The statements of a text, each { text, toks, start } (toks' positions are in the whole text);
// the separators are dropped.
function statements(sql) {
  const toks = tokens(sql);
  const out = [];
  let start = 0, from = 0;
  for (let k = 0; k <= toks.length; k++) {
    if (k < toks.length && toks[k].t !== ';') continue;
    const end = k < toks.length ? toks[k].at : sql.length;
    const own = toks.slice(from, k);
    if (own.length) out.push({ text: sql.slice(start, end), toks: own, start });
    if (k < toks.length) start = toks[k].end;
    from = k + 1;
  }
  return out;
}

// A small reader over a statement's tokens.
function reader(toks) {
  let k = 0;
  const r = {
    done: () => k >= toks.length,
    peekWord: w => toks[k]?.t === 'word' && toks[k].v.toUpperCase() === w,
    word(w) {
      if (!r.peekWord(w)) return false;
      k++;
      return true;
    },
    words(...ws) {
      const save = k;
      for (const w of ws) if (!r.word(w)) { k = save; return false; }
      return true;
    },
    expect(...ws) {
      if (!r.words(...ws)) throw fail(`syntax error: expected ${ws.join(' ')}`, 'SYNTAX');
    },
    name() {
      const t = toks[k];
      if (t?.t !== 'word' && t?.t !== 'name') throw fail('syntax error: expected a name', 'SYNTAX');
      k++;
      return t.v;
    },
    // [db.][schema.]name, as its parts.
    qualified() {
      const parts = [r.name()];
      while (toks[k]?.t === 'sym' && toks[k].v === '.') { k++; parts.push(r.name()); }
      if (parts.length > 3) throw fail(`syntax error: too many parts in ${parts.join('.')}`, 'SYNTAX');
      return parts;
    },
    string() {
      const t = toks[k];
      if (t?.t !== 'str') throw fail('syntax error: expected a quoted path', 'SYNTAX');
      k++;
      return t.v;
    },
    end() {
      if (k < toks.length) throw fail(`syntax error at or near "${toks[k].v}"`, 'SYNTAX');
    },
  };
  return r;
}

// ---------------------------------------------------------------------------------------------
// What the inspecting statements list, as a SELECT over VALUES.

const DUCK_TYPES = { int: 'BIGINT', double: 'DOUBLE', decimal: 'DOUBLE', string: 'VARCHAR', datetime: 'TIMESTAMP', bool: 'BOOLEAN', variant: 'VARCHAR' };
const duckType = t => DUCK_TYPES[t] ?? 'VARCHAR';

// Rows as a SELECT over VALUES; with none, the columns typed and no row.
function rows(columns, list) {
  const names = columns.map(([n]) => ident(n)).join(', ');
  if (!list.length) {
    const nulls = columns.map(([, t]) => `NULL::${t}`).join(', ');
    return `SELECT * FROM (VALUES (${nulls})) t(${names}) WHERE false`;
  }
  const cell = (x, t) => (x == null ? `NULL::${t}` : t === 'BOOLEAN' ? (x ? 'true' : 'false') : str(x));
  const values = list.map(r => `(${r.map((x, i) => cell(x, columns[i][1])).join(', ')})`).join(',\n  ');
  return `SELECT * FROM (VALUES\n  ${values}) t(${names})`;
}

const ITEM_COLUMNS = [['database_name', 'VARCHAR'], ['schema_name', 'VARCHAR'], ['view_name', 'VARCHAR'], ['table_name', 'VARCHAR'],
  ['name', 'VARCHAR'], ['data_type', 'VARCHAR'], ['expression', 'VARCHAR'], ['format_string', 'VARCHAR'], ['hidden', 'BOOLEAN'],
  ['comment', 'VARCHAR']];
const VIEW_COLUMNS = [['database_name', 'VARCHAR'], ['schema_name', 'VARCHAR'], ['view_name', 'VARCHAR'], ['path', 'VARCHAR'],
  ['tables_from', 'VARCHAR']];
const DESCRIBE_COLUMNS = [['column_name', 'VARCHAR'], ['column_type', 'VARCHAR'], ['null', 'VARCHAR'], ['key', 'VARCHAR'],
  ['default', 'VARCHAR'], ['extra', 'VARCHAR']];

// A measure's type, as the compiler gives it for the measure alone.
function measureType(v, m) {
  if (!v.types) v.types = new Map();
  if (!v.types.has(m.name)) {
    let t;
    try {
      t = v.compiler.compile(`EVALUATE ROW("v", [${m.name.replace(/]/g, ']]')}])`).columns[0].type;
    } catch {
      t = 'variant';
    }
    v.types.set(m.name, t);
  }
  return v.types.get(m.name);
}

function dimensions(v, only) {
  const out = [];
  for (const t of v.compiler.model.tables.values()) {
    if (only && !only(t)) continue;
    for (const c of t.columns) out.push([v.db, v.schema, v.name, t.name, c.name, duckType(c.type), c.expr, null, t.hidden, null]);
  }
  return out;
}

function metrics(v) {
  return [...v.compiler.model.measures.values()].map(m =>
    [v.db, v.schema, v.name, m.table.name, m.name, duckType(measureType(v, m)), m.text, m.formatString, false, null]);
}

function describe(v) {
  const list = [];
  for (const t of v.compiler.model.tables.values()) {
    for (const c of t.columns) list.push([`${t.name}.${c.name}`, duckType(c.type), c.nullable ? 'YES' : 'NO', c.unique ? 'PRI' : null, null, 'column']);
  }
  for (const m of v.compiler.model.measures.values()) list.push([m.name, duckType(measureType(v, m)), 'YES', null, null, 'measure']);
  return rows(DESCRIBE_COLUMNS, list);
}

// Where a statement's query starts when something comes before it (EXPLAIN, DESCRIBE,
// CREATE TABLE ... AS, INSERT INTO ...): its first SELECT or WITH outside parentheses after the
// first token; -1 when there is none.
function queryStart(toks) {
  let depth = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'sym' && t.v === '(') depth++;
    else if (t.t === 'sym' && t.v === ')') depth--;
    else if (k > 0 && depth === 0 && t.t === 'word' && /^(SELECT|WITH)$/i.test(t.v)) return k;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------

// A part of a view's name as SQL writes it: bare when it can be, quoted when it must.
const part = s => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : ident(s));

export function makeViews(createCompiler) {
  // The views, by their full name, lower-cased: `name`, or `schema.name` for a view defined in
  // a schema of its own (one other than 'main') — two models of one name are two views, as
  // long as their schemas differ. Each { db, schema, name, parts, sqlName, path, tablesFrom,
  // compiler }; `sqlName` is how SQL names it in full.
  const views = new Map();
  const partsOf = (name, schema) => (schema && lc(schema) !== 'main' ? [String(schema), String(name)] : [String(name)]);
  const keyOf = parts => parts.map(lc).join('\u0000');

  // The view a name means, written whole (`ws.model`) or in part (`model`): null when none,
  // and an error when the part fits more than one, naming them.
  function resolve(name) {
    const ref = nameParts(name).map(lc);
    const exact = views.get(ref.join('\u0000'));
    if (exact) return exact;
    const fits = [...views.values()].filter(v => {
      const full = [lc(v.db ?? ''), ...v.parts.map(lc)];
      return ref.length <= full.length && ref.every((p, i) => p === full[full.length - ref.length + i]);
    });
    if (fits.length > 1) {
      throw fail(`semantic view ${ref.join('.')} is ambiguous: name it in full — ${fits.map(v => v.sqlName).join(', ')}`, 'CATALOG');
    }
    return fits[0] ?? null;
  }

  function view(name) {
    const v = resolve(name);
    if (!v) throw fail(`semantic view ${nameParts(name).join('.')} does not exist`, 'CATALOG');
    return v;
  }

  function define(name, model, { path = null, db = 'memory', schema = 'main', mode = 'create', tablesFrom = 'search path', ...options } = {}) {
    const parts = partsOf(name, schema);
    const key = keyOf(parts);
    const old = views.get(key);
    if (old && mode === 'create') throw fail(`semantic view ${old.sqlName} already exists`, 'CATALOG');
    if (old && mode === 'if_not_exists') return 'exists';
    const compiler = createCompiler(model, options);
    views.set(key, { db, schema, name, parts, sqlName: parts.map(part).join('.'), path, tablesFrom, compiler });
    return 'created';
  }

  function drop(name, { ifExists = false } = {}) {
    const v = resolve(name);
    if (!v) {
      if (ifExists) return false;
      throw fail(`semantic view ${nameParts(name).join('.')} does not exist`, 'CATALOG');
    }
    views.delete(keyOf(v.parts));
    return true;
  }

  // The views' own statements, or null for any other.
  function ownStatement(toks) {
    const r = reader(toks);
    if (r.word('CREATE')) {
      const replace = r.words('OR', 'REPLACE');
      if (!r.words('SEMANTIC', 'VIEW')) return null;
      const ifNotExists = r.words('IF', 'NOT', 'EXISTS');
      const parts = r.qualified();
      r.expect('FROM');
      const path = r.string();
      r.end();
      const name = parts[parts.length - 1];
      const schema = parts.length > 1 ? parts[parts.length - 2] : null;
      const mode = replace ? 'replace' : ifNotExists ? 'if_not_exists' : 'create';
      const old = views.get(keyOf(partsOf(name, schema)));
      if (mode === 'create' && old) throw fail(`semantic view ${old.sqlName} already exists`, 'CATALOG');
      return { create: { db: parts.length === 3 ? parts[0] : null, schema, name, path, mode } };
    }
    if (r.word('DROP')) {
      if (!r.words('SEMANTIC', 'VIEW')) return null;
      const ifExists = r.words('IF', 'EXISTS');
      const parts = r.qualified();
      r.end();
      const v = resolve(parts);
      if (!v && !ifExists) throw fail(`semantic view ${parts.join('.')} does not exist`, 'CATALOG');
      // The name in full, so the host drops this view and no other of its name.
      return { drop: { name: v ? v.sqlName : parts.map(part).join('.'), ifExists } };
    }
    if (r.word('SHOW')) {
      if (!r.word('SEMANTIC')) return null;
      if (r.word('VIEWS')) {
        r.end();
        return { sql: rows(VIEW_COLUMNS, [...views.values()].map(v => [v.db, v.schema, v.name, v.path, v.tablesFrom])) };
      }
      const dims = r.word('DIMENSIONS');
      if (!dims) r.expect('METRICS');
      r.expect('IN');
      const v = view(r.qualified());
      if (!dims) {
        r.end();
        return { sql: rows(ITEM_COLUMNS, metrics(v)) };
      }
      if (r.words('FOR', 'METRIC')) {
        const name = r.name();
        r.end();
        const m = v.compiler.model.measures.get(lc(name));
        if (!m) throw fail(`semantic view ${v.name} has no metric ${name}`, 'CATALOG');
        const model = v.compiler.model, state = model.state();
        return { sql: rows(ITEM_COLUMNS, dimensions(v, t => model.reaches(t, m.table, state))) };
      }
      r.end();
      return { sql: rows(ITEM_COLUMNS, dimensions(v)) };
    }
    if (r.word('DESCRIBE') || r.word('DESC')) {
      if (r.done()) return null;
      let parts;
      try {
        parts = r.qualified();
        r.end();
      } catch {
        return null;
      }
      const v = resolve(parts);
      if (!v) return null;
      return { sql: describe(v) };
    }
    return null;
  }

  // A query's text, its model queries compiled in place; the same text when it names no view.
  // A view is named after FROM or JOIN, in full or in part (`ws.model`, `model`); each way it
  // is written is compiled as written, so the compiled text matches the query's own.
  function compiled(text, toks) {
    const named = new Map();   // the name as written (lower-cased) -> [view, its parts]
    const isName = t => t?.t === 'word' || t?.t === 'name';
    const isDot = t => t?.t === 'sym' && t.v === '.';
    for (let k = 0; k < toks.length; k++) {
      if (toks[k].t !== 'word' || !/^(FROM|JOIN)$/i.test(toks[k].v) || !isName(toks[k + 1])) continue;
      const parts = [toks[k + 1].v];
      let e = k + 1;
      while (isDot(toks[e + 1]) && isName(toks[e + 2])) { parts.push(toks[e + 2].v); e += 2; }
      if (parts.length > 3) continue;
      const v = resolve(parts);
      if (v) named.set(parts.map(lc).join('\u0000'), [v, parts]);
    }
    let out = text;
    for (const [v, parts] of named.values()) out = v.compiler.compileStatement(out, parts).sql;
    return out;
  }

  // A statement's text with each (DESCRIBE v) and (SHOW SEMANTIC ...) in it replaced by the rows
  // it lists, so they can be read as subqueries.
  function nested(s) {
    const { toks } = s;
    const found = [];
    for (let k = 0; k < toks.length; k++) {
      const w = toks[k + 1];
      if (toks[k].t !== 'sym' || toks[k].v !== '(' || w?.t !== 'word' || !/^(DESCRIBE|DESC|SHOW|EXPLAIN)$/i.test(w.v)) continue;
      let depth = 0, e = k;
      for (; e < toks.length; e++) {
        if (toks[e].t !== 'sym') continue;
        if (toks[e].v === '(') depth++;
        else if (toks[e].v === ')' && --depth === 0) break;
      }
      if (e >= toks.length) break;
      const inner = toks.slice(k + 1, e);
      const start = toks[k].end - s.start, end = toks[e].at - s.start;
      const own = ownStatement(inner);
      if (own?.sql) found.push({ start, end, sql: own.sql });
      // (DESCRIBE SELECT ...), (EXPLAIN SELECT ...): the query after the prefix compiled.
      else if (!own) found.push({ start, end, sql: statementSql({ text: s.text.slice(start, end), toks: inner, start: toks[k].end }) });
      k = e;
    }
    let out = s.text;
    for (const f of found.reverse()) out = `${out.slice(0, f.start)}${f.sql}${out.slice(f.end)}`;
    return out;
  }

  // A statement that is not the views' own, as the engine runs it: the query after any prefix
  // compiled as a statement of its own, so that a model query can follow EXPLAIN or AS.
  function statementSql(s) {
    const first = s.toks[0];
    const k = first?.t === 'word' && !/^(SELECT|WITH)$/i.test(first.v) ? queryStart(s.toks) : -1;
    if (k < 0) return compiled(nested(s), s.toks);
    const at = s.toks[k].at;
    const head = { text: s.text.slice(0, at - s.start), toks: s.toks.slice(0, k), start: s.start };
    const tail = { text: s.text.slice(at - s.start), toks: s.toks.slice(k), start: at };
    return nested(head) + compiled(nested(tail), tail.toks);
  }

  // One entry per statement, or null when nothing in the text is a view's.
  function rewrite(sql) {
    let changed = false;
    const out = [];
    for (const s of statements(String(sql))) {
      const own = ownStatement(s.toks);
      if (own) {
        changed = true;
        out.push(own);
        continue;
      }
      const c = statementSql(s);
      if (c !== s.text) changed = true;
      out.push({ sql: c });
    }
    return changed ? out : null;
  }

  return {
    define,
    drop,
    // A view by its name, in full or in part (an error when the part fits more than one).
    get: name => resolve(name),
    list: () => [...views.values()],
    rewrite,
  };
}
