# dax-sql

DAX to SQL for Tabular semantic models: a model and a DAX query in, one SQL query out, with
DAX's semantics (filter context, context transition, relationships, blanks). Tested on DuckDB.
Written by [N.S. Devaraj](https://github.com/nsdevaraj).

## Contract

- **In:** a Tabular model (TMSL, the `model.bim` JSON), one DAX query (`EVALUATE ...`), and
  options: table names in SQL, dialect, roles, parameters ([DESIGN.md](DESIGN.md#api)).
- **Out:** one SQL `SELECT`, and the result's columns (name, type, lineage).
- **Or a `DaxError`:** `SYNTAX` (not DAX), `SEMANTIC` (wrong for this model), `UNSUPPORTED`
  (DAX it does not translate). It never guesses.
- **Not its job:** writing DAX, running the SQL, fetching data.

```js
import { createCompiler } from './src/index.js';

const { sql, columns } = createCompiler(bim).compile(
  'EVALUATE SUMMARIZECOLUMNS(Product[Color], "Sales", [Sales Amount])');
```

No runtime dependencies; ES modules, browser and Node 18+. `npm test` runs the tests on DuckDB.

## Known limitations

- Grouping, `DISTINCT`, sorting and relationships on text are case-sensitive (comparisons,
  `IN` and table filters are not, as in DAX).
- `FORMAT` is en-US only, with a constant pattern; model format strings are not applied.
- A NULL stored in the data doesn't match a blank in a table filter (`TREATAS`, `VALUES`).
- A column that mixes numbers and text comes back as text.
- `IFERROR` returns its first argument: SQL has no error values.
- `LOOKUPVALUE` respects the filters on its table, its search columns replacing theirs.
- `DATEDIFF` with `WEEK` counts Sunday week boundaries.
- Not supported: object-level security, dynamic format strings, `DEFINE COLUMN`, `NONVISUAL`,
  the window functions' reset argument, and anything not listed in
  [DESIGN.md](DESIGN.md#what-it-does).
