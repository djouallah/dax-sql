// How the suite compares an answer's rows with another's (runner/run.mjs: with Power BI's;
// agree.mjs: one plan's with another's): as a multiset unless the query has an ORDER BY, numbers
// equal within 1e-9 of their size.
export const close = (a, b) => {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return false;
};
// (A blank sorts apart from an empty text: a column holding both was matched by the order its
// rows came in.)
export const sortRows = rows => {
  const key = r => JSON.stringify(r.map(v => (v === null ? [0] : typeof v === 'number' ? Number(v.toPrecision(12)) : v)));
  return rows.map(r => [key(r), r]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => r);
};
export const sameRows = (got, want, ordered) => {
  if (got.length !== want.length) return false;
  const g = ordered ? got : sortRows(got), w = ordered ? want : sortRows(want);
  return g.every((r, i) => r.length === w[i].length && r.every((v, j) => close(v, w[i][j])));
};
export const ordered = dax => /\bORDER\s+BY\b/i.test(dax.replace(/\/\/.*$/gm, ''));
