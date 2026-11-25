// Queries broken on purpose, from well-formed ones: an argument dropped, the text cut short, two
// tokens swapped, a token doubled, a parenthesis or a comma taken out, a token put where another
// was. Seeded, so a seed always breaks the same queries the same way. For checking that the
// compiler answers any text with SQL or a DaxError, never with an exception of its own
// (test/errors.test.js, conformance/tools/agree.mjs).
//   mutations(queries, count, seed) -> [{ from, dax, how }]
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A query's tokens, with where each is: strings, names in quotes or brackets, numbers, words,
// and each other character alone.
const TOKEN = /"(?:[^"]|"")*"|'(?:[^']|'')*'|\[[^\]]*\]|\d+(?:\.\d+)?(?:E[+-]?\d+)?|[A-Za-z_][\w.]*|\S/gi;
const tokens = text => [...text.matchAll(TOKEN)].map(m => ({ t: m[0], at: m.index }));
const PUT = ['BLANK()', '0', '""', '(', ')', ',', 'TRUE()', 'Sales', '[x]', 'VAR', 'RETURN', '{', '}', '=', '&&', '-', 'ALL()', 'EVALUATE'];

export function mutations(queries, count, seed) {
  const r = rng(seed), pick = xs => xs[Math.floor(r() * xs.length)];
  const out = [];
  while (out.length < count) {
    const from = pick(queries), toks = tokens(from);
    if (toks.length < 3) continue;
    const i = Math.floor(r() * toks.length), tk = toks[i];
    const cut = (a, b, by = '') => from.slice(0, a) + by + from.slice(b);
    let dax, how;
    switch (Math.floor(r() * 7)) {
      case 0: {   // an argument dropped: from a comma to the next comma or closing parenthesis
        const commas = toks.filter(x => x.t === ',');
        if (!commas.length) continue;
        const c = pick(commas), next = toks.find(x => x.at > c.at && (x.t === ',' || x.t === ')'));
        dax = cut(c.at, next ? next.at : from.length); how = 'an argument dropped';
        break;
      }
      case 1: dax = from.slice(0, tk.at); how = 'cut short'; break;
      case 2: {
        const j = Math.min(toks.length - 1, i + 1), b = toks[j];
        if (j === i) continue;
        dax = from.slice(0, tk.at) + b.t + from.slice(tk.at + tk.t.length, b.at) + tk.t + from.slice(b.at + b.t.length); how = 'two tokens swapped';
        break;
      }
      case 3: dax = cut(tk.at, tk.at, `${tk.t} `); how = 'a token doubled'; break;
      case 4: {
        const ps = toks.filter(x => x.t === '(' || x.t === ')' || x.t === ',');
        if (!ps.length) continue;
        const p = pick(ps);
        dax = cut(p.at, p.at + 1); how = `a ${p.t} taken out`;
        break;
      }
      case 5: dax = cut(tk.at, tk.at + tk.t.length, pick(PUT)); how = 'a token replaced'; break;
      default: dax = cut(tk.at, tk.at, `${pick(PUT)} `); how = 'a token put in'; break;
    }
    out.push({ from, dax, how });
  }
  return out;
}
