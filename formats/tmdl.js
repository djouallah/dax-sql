// A TMDL model (https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview) as TMSL,
// and so as dax-sql's model object. Not part of the package: a reader of one format.
//   import { tmdlToModel } from 'dax-sql/formats/tmdl.js';
//   createCompiler(tmdlToModel(text))
// TMDL is a TMSL model written as indented text: an object per line (`table sales`,
// `measure 'Total' = SUM(…)`), its properties one level deeper (`dataType: int64`), a `///` line
// the description of the object after it, and an expression on the object's line or on the lines
// below, one level past its properties. It takes either form Fabric and Power BI write:
//   - one file, the whole model, often inside a script (`createOrReplace`, `database <name>`,
//     `model Model`), as Fabric publishes a semantic view;
//   - a folder (a PBIP's `definition/`): its files' texts, as an array or as { path: text },
//     each holding objects at its root (`tables/Sales.tmdl`, `relationships.tmdl`, `roles/*.tmdl`).
// Read: tables (columns, measures and their annotations, partitions, hierarchies, a calculation
// group and its items), relationships, roles (a table's filter, object-level security) and
// expressions, with their properties as written. Left out: lineage tags, perspectives, cultures.

import { tmslToModel } from './tmsl.js';

// Properties that only tie an object to where it came from: nothing here reads them.
const LINEAGE = new Set(['lineageTag', 'sourceLineageTag', 'changedProperty']);
// Properties TMSL holds as numbers.
const NUMBERS = new Set(['compatibilityLevel', 'ordinal', 'precedence']);

// A line's depth, by its leading tabs (four spaces count as one, should a file use spaces).
function depthOf(line) {
  const lead = /^[\t ]*/.exec(line)[0];
  let tabs = 0, spaces = 0;
  for (const c of lead) { if (c === '\t') tabs++; else spaces++; }
  return tabs + Math.floor(spaces / 4);
}

// A property's value as TMSL has it: a quoted string unquoted, true and false as booleans.
function valueOf(v) {
  const s = String(v).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  const q = /^"((?:[^"]|"")*)"$/.exec(s);
  if (q) return q[1].replace(/""/g, '"');
  const sq = /^'((?:[^']|'')*)'$/.exec(s);
  if (sq) return sq[1].replace(/''/g, "'");
  return s;
}

// A name at the start of `s`: 'quoted' (with '' for ') or bare, up to a space or `=`. { name, rest }.
function nameAt(s) {
  if (s.startsWith("'")) {
    let i = 1, name = '';
    for (; i < s.length; i++) {
      if (s[i] === "'") { if (s[i + 1] === "'") { name += "'"; i++; continue; } break; }
      name += s[i];
    }
    return { name, rest: s.slice(i + 1).trim() };
  }
  const m = /^[^\s=]+/.exec(s);
  return { name: m ? m[0] : '', rest: s.slice(m ? m[0].length : 0).trim() };
}

/**
 * The lines of an expression that goes on below line `i`: those at `min` depth or deeper (blank lines between
 * them kept), or, after a ``` line, up to the closing ```. Their common indentation is taken off, what is past it
 * kept. { text, next }: `next` is the line after the expression.
 */
function expressionBelow(lines, i, min, fenced) {
  const body = [];
  let j = i + 1;
  if (fenced) {
    for (; j < lines.length && lines[j].trim() !== '```'; j++) body.push(lines[j]);
    j++;
  } else {
    // Up to the last line at `min` depth or deeper: blank lines after it belong to what follows.
    let last = i;
    for (; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (depthOf(lines[j]) < min) break;
      last = j;
    }
    body.push(...lines.slice(i + 1, last + 1));
    j = last + 1;
  }
  const lead = Math.min(...body.filter(l => l.trim()).map(l => /^\t*/.exec(l)[0].length));
  const text = body.map(l => (l.trim() ? l.slice(Number.isFinite(lead) ? lead : 0) : '')).join('\n');
  return { text, next: j };
}

// The file as a tree of objects: { type, name, value, description, props, kids }, the root's type '(root)'.
function parseTree(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const root = { type: '(root)', props: {}, kids: [] };
  const stack = [{ node: root, depth: -1 }];
  let description = [];
  const nextDepth = i => {
    for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) return depthOf(lines[k]);
    return -1;
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const s = line.trim();
    if (!s) { i++; continue; }
    const d = depthOf(line);
    if (s.startsWith('///')) { description.push(s.slice(3).replace(/^ /, '')); i++; continue; }
    if (s.startsWith('//')) { i++; continue; }
    while (stack[stack.length - 1].depth >= d) stack.pop();
    const parent = stack[stack.length - 1].node;
    // A value on its line, or written below it (an expression, on the lines at `deeper` depth or past it). A
    // property's is unquoted; an object's is its expression, kept as written ("x" is a DAX string).
    const below = (deeper, v, asProperty = true) => {
      const fenced = v === '```';
      if (v && !fenced) return { value: asProperty ? valueOf(v) : v, next: i + 1 };
      const e = expressionBelow(lines, i, deeper, fenced);
      return { value: e.text, next: e.next };
    };
    // key: value — a property of the object it is under.
    const prop = /^([A-Za-z_]\w*)\s*:\s*(.*)$/.exec(s);
    if (prop) {
      const { value, next } = below(d + 1, prop[2].trim());
      parent.props[prop[1]] = NUMBERS.has(prop[1]) && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
      i = next;
      continue;
    }
    const word = /^([A-Za-z_]\w*)\s*/.exec(s);
    if (!word) { i++; continue; }
    const rest = s.slice(word[0].length);
    // key = expression — a property written as an expression (a partition's `source = …`).
    if (rest.startsWith('=')) {
      const { value, next } = below(d + 1, rest.slice(1).trim(), false);
      parent.props[word[1]] = value;
      i = next;
      continue;
    }
    // A word alone: an object when lines go on below it (`source`, `createOrReplace`), else a flag that is set.
    if (!rest) {
      if (nextDepth(i) > d) {
        const node = { type: word[1], name: null, value: null, description: description.join('\n') || null, props: {}, kids: [] };
        parent.kids.push(node);
        stack.push({ node, depth: d });
      } else parent.props[word[1]] = true;
      description = [];
      i++;
      continue;
    }
    // type name [= value]: an object, its value (its expression, a partition's kind) on its line or below it.
    const { name, rest: after } = nameAt(rest);
    let value = null, next = i + 1;
    if (after.startsWith('=')) ({ value, next } = below(d + 2, after.slice(1).trim(), false));
    const node = { type: word[1], name, value, description: description.join('\n') || null, props: {}, kids: [] };
    description = [];
    parent.kids.push(node);
    stack.push({ node, depth: d });
    i = next;
  }
  return root;
}

const kidsOf = (n, type) => n.kids.filter(k => k.type === type);
function findNode(n, type) {
  for (const k of n.kids) {
    if (k.type === type) return k;
    const found = findNode(k, type);
    if (found) return found;
  }
  return null;
}
// An object's own properties as TMSL's, lineage left out, and its description.
function propsOf(n, skip = []) {
  const out = {};
  for (const [k, v] of Object.entries(n.props)) if (!LINEAGE.has(k) && !skip.includes(k)) out[k] = v;
  if (n.description) out.description = n.description;
  return out;
}
const some = list => (list.length ? list : undefined);

// 'Table name'.'column' or table.column: { table, column }.
function columnRef(ref) {
  const s = String(ref).trim();
  // A bare table name ends at the dot; a quoted one may hold dots.
  const { name: table, rest } = s.startsWith("'") ? nameAt(s) : { name: s.split('.')[0], rest: s.slice(s.split('.')[0].length) };
  return { table, column: rest.startsWith('.') ? nameAt(rest.slice(1)).name : '' };
}

function column(n) {
  const ext = kidsOf(n, 'extendedProperty').map(p => ({ name: p.name, value: p.value }));
  return { name: n.name, ...(n.value != null ? { type: 'calculated', expression: n.value } : {}), ...propsOf(n),
           extendedProperties: some(ext) };
}
function measure(n) {
  const notes = kidsOf(n, 'annotation').map(a => ({ name: a.name, value: a.value ?? '' }));
  return { name: n.name, expression: n.value ?? '', ...propsOf(n), annotations: some(notes) };
}
function partition(n) {
  const kind = n.value || 'm';
  const holder = kidsOf(n, 'source')[0];
  const source = holder ? { type: kind, ...propsOf(holder) }
    : { type: kind, ...(n.props.source != null ? { expression: n.props.source } : {}) };
  return { name: n.name, ...propsOf(n, ['source']), source };
}
function hierarchy(n) {
  return { name: n.name, ...propsOf(n), levels: kidsOf(n, 'level').map(l => ({ name: l.name, ...propsOf(l) })) };
}
function calculationGroup(n) {
  return { ...propsOf(n), calculationItems: kidsOf(n, 'calculationItem').map(it => ({ name: it.name, expression: it.value ?? '', ...propsOf(it) })) };
}
function table(n) {
  const group = kidsOf(n, 'calculationGroup')[0];
  return {
    name: n.name, ...propsOf(n),
    columns: kidsOf(n, 'column').map(column),
    measures: some(kidsOf(n, 'measure').map(measure)),
    hierarchies: some(kidsOf(n, 'hierarchy').map(hierarchy)),
    partitions: some(kidsOf(n, 'partition').map(partition)),
    calculationGroup: group ? calculationGroup(group) : undefined,
  };
}
function relationship(n) {
  const from = columnRef(n.props.fromColumn ?? ''), to = columnRef(n.props.toColumn ?? '');
  return { name: n.name, ...propsOf(n, ['fromColumn', 'toColumn']),
           fromTable: from.table, fromColumn: from.column, toTable: to.table, toColumn: to.column };
}
function expression(n) {
  return { name: n.name, kind: 'm', ...propsOf(n), expression: n.value ?? '' };
}
const defined = o => JSON.parse(JSON.stringify(o));   // undefined fields gone, as a TMSL file has none
// A role: its tables' filters (`tablePermission Sales = [Region] = "West"`) and what it hides
// (`metadataPermission: none` on a tablePermission or on a columnPermission under one).
function role(n) {
  return { name: n.name, ...propsOf(n), tablePermissions: kidsOf(n, 'tablePermission').map(p => ({
    name: p.name, ...propsOf(p, ['filterExpression']),
    ...(p.value != null || p.props.filterExpression != null ? { filterExpression: p.value ?? p.props.filterExpression } : {}),
    columnPermissions: some(kidsOf(p, 'columnPermission').map(c => ({ name: c.name, ...propsOf(c) }))),
  })) };
}

// The objects of `type` in a file, at its root or inside its script, database and model.
const HOLDERS = new Set(['createOrReplace', 'createOrReplaceScript', 'database', 'model']);
function collect(n, type) {
  return n.kids.flatMap(k => (k.type === type ? [k] : HOLDERS.has(k.type) ? collect(k, type) : []));
}
const filesOf = t => (typeof t === 'string' ? [t] : Array.isArray(t) ? t : Object.values(t ?? {}));

/**
 * A TMDL model as TMSL: { name, compatibilityLevel?, model }. `text` is one file's text, or a
 * folder's files' texts (an array, or { path: text }). A text with no model and no table throws.
 */
export function tmdlToTmsl(text) {
  const roots = filesOf(text).map(parseTree);
  const all = type => roots.flatMap(r => collect(r, type));
  const [db] = all('database'), [model] = all('model');
  const tables = all('table');
  if (!model && !tables.length) throw new Error('this TMDL has no model in it');
  return defined({
    name: (db && db.name) || (model && model.name) || 'Model',
    compatibilityLevel: db ? db.props.compatibilityLevel : undefined,
    model: {
      ...(model ? propsOf(model) : {}),
      tables: tables.map(table),
      relationships: some(all('relationship').map(relationship)),
      roles: some(all('role').map(role)),
      expressions: some(all('expression').map(expression)),
    },
  });
}

// A TMDL model as dax-sql's model object: tmslToModel(tmdlToTmsl(text)).
export const tmdlToModel = text => tmslToModel(tmdlToTmsl(text));
