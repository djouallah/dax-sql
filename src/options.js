// The public API's options, checked (DESIGN.md, Contract): a key the call does not take, or a
// value of the wrong kind, is an INPUT error naming it and what is taken. An option undefined or
// null is not checked: the call reads it as before (null, a view's tablesFrom: none).
import { DaxError } from './errors.js';

const fn = v => typeof v === 'function';
const bool = v => typeof v === 'boolean';
const str = v => typeof v === 'string';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneOf = (...xs) => Object.assign(v => xs.includes(v), { says: xs.map(x => JSON.stringify(x)).join(' or ') });

// Each option: its test, and what it says a value must be.
const KIND = new Map([[fn, 'a function'], [bool, 'true or false'], [str, 'a text'], [object, 'an object']]);
const says = test => test.says ?? KIND.get(test) ?? 'a valid value';

export const input = msg => new DaxError(msg, { code: 'INPUT' });

// `what` names the call (createCompiler, define…); `spec` maps each key it takes to its test.
export function checkOptions(what, options, spec) {
  if (options == null) return {};
  if (!object(options)) throw input(`${what}: the options are an object, not ${Array.isArray(options) ? 'an array' : typeof options}`);
  for (const [k, v] of Object.entries(options)) {
    if (v == null) continue;
    const test = spec[k];
    if (!test) throw input(`${what}: no option ${k} (it takes ${Object.keys(spec).join(', ')})`);
    if (!test(v)) throw input(`${what}: ${k} is ${says(test)}`);
  }
  return options;
}

export const COMPILER = {
  tableSource: fn,
  dialect: Object.assign(v => str(v) || (object(v) && typeof v.name === 'string'), { says: '"duckdb", "tsql", "polars", "datafusion" or a Dialect' }),
  columnNames: oneOf('short', 'dax'),
  castOutput: Object.assign(v => bool(v) || (object(v) && Object.values(v).every(fn)), { says: 'true, false or an object of functions by type' }),
  assumeIntegrity: bool,
  trailingSpaces: fn,
  orphans: fn,
  user: str,
  roles: Object.assign(v => str(v) || (Array.isArray(v) && v.every(str)), { says: 'a role name or a list of them' }),
  params: object,
  // factsCheck().read's: { orphans: { [rel.key]: bool }, trailingSpaces: { [column.key]: bool } }.
  facts: Object.assign(v => object(v) && Object.keys(v).every(k => k === 'orphans' || k === 'trailingSpaces')
    && ['orphans', 'trailingSpaces'].every(k => v[k] == null || (object(v[k]) && Object.values(v[k]).every(bool))),
  { says: '{ orphans: { key: true or false }, trailingSpaces: { key: true } }, as factsCheck().read gives it' }),
};

export const PLAN = { optimize: bool, correlated: bool, unnest: bool };
export const SUBSTRAIT = { ...PLAN, inline: bool, tableName: fn, tableSchema: fn };
export const VIEWS = {
  fullNames: bool,
  db: str,
  dialect: COMPILER.dialect,
  viewColumns: Object.assign(v => Array.isArray(v) && v.every(c => Array.isArray(c) && c.length === 2 && str(c[0]) && str(c[1])),
    { says: 'a list of [name, SQL type]' }),
};
export const DEFINE = {
  path: str, db: str, schema: str, mode: oneOf('create', 'replace', 'if_not_exists', 'restore'), tablesFrom: str,
  columns: object, error: str, ...COMPILER,
};
export const DROP = { ifExists: bool };
export const NAMES = { match: fn };
