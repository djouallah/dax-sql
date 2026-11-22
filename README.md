# dax-sql

A compiler for semantic models (Power BI / Tabular, Apache Ossie) that supports two languages
alike: a DAX query or an Ossie SQL query in, one SQL `SELECT` out, each with its own semantics. No dependencies.

Initially written by [N.S. Devaraj](https://github.com/nsdevaraj).

```sh
npm install dax-sql
```

```js
import { createCompiler } from 'dax-sql';
import { tmslToModel } from 'dax-sql/formats/tmsl.js';   // or formats/ossie.js for Apache Ossie

const model = tmslToModel(JSON.parse(bimText));           // a model.bim
const dax = createCompiler(model, { tableSource: t => `read_parquet('data/${t.name}.parquet')` });

const { sql, columns } = dax.compile(`
  EVALUATE
  SUMMARIZECOLUMNS('Date'[Year], "Sales", [Sales Amount])
  ORDER BY 'Date'[Year]`);
// sql: one SELECT for the engine; columns: [{ name: 'Year', type: 'int', ... }, { name: 'Sales', ... }]
```

- **In:** a semantic model as dax-sql's model object ([DESIGN.md](DESIGN.md#the-model); `formats/` reads one from a TMSL `model.bim` or an [Apache Ossie](https://github.com/apache/ossie) model whose metrics are DAX or SQL), a DAX query or a SQL `SELECT` over the model (or over its tables as relations, joined in any way, as Apache Ossie's [Relational Query Interface](https://github.com/apache/ossie/blob/main/core-spec/relational_semantics.md) answers), options
  ([DESIGN.md](DESIGN.md#api)); or any SQL with `SELECT`s over the model as relations in it.
- **Out:** one SQL `SELECT` and its columns; for a statement, its SQL with each of them compiled in place.
- **SQL:** DuckDB's by default; `dialect: 'tsql'` writes T-SQL for Microsoft Fabric's SQL analytics endpoint and Warehouse (tested on a lakehouse's endpoint), with what it can't do listed in [DESIGN.md](DESIGN.md#t-sql).
- **Errors:** `SYNTAX`, `SEMANTIC`, `UNSUPPORTED`; `CATALOG` for semantic views.
- **Tested:** DAX against Power BI's own answers ([conformance/](conformance/README.md)); Ossie SQL against Apache Ossie's compliance cases and its view expander (`.github/workflows/ossie-query.yml`). Both block a release.

## Not implemented

- Anything not listed in [DESIGN.md](DESIGN.md#what-it-does).

## Departures from DAX, by design

- Text is compared, grouped and sorted as the engine does it (DuckDB, T-SQL: by its
  collation), not by DAX's rules: on DuckDB `"red"` is not `"Red"`.
- Text keeps its trailing spaces (Power BI drops them on load): `"a "` and `"a"` are two
  values, in grouping, filters, relationships and `LEN`. Trim them in the data if they matter.
- A column that mixes numbers and text comes back as text; a date minus a date as days (DAX: a date and time).
- `IFERROR` returns its first argument: SQL has no error values.
- Values come back unformatted, as a DAX query's do: a measure's format string, fixed or
  dynamic, is the caller's to apply. `FORMAT` is en-US, with a constant pattern.
- No blank row: a dimension is expected to hold every key its facts use. `VALUES` and `ALL`
  list its own rows; fact rows with a key it lacks still count in totals.
