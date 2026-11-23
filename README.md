# dax-sql

Initially written by [N.S. Devaraj](https://github.com/nsdevaraj).

Compiles a DAX or SQL query over a semantic model to one SQL `SELECT`. No dependencies. `npm install dax-sql`; API and an example in [DESIGN.md](DESIGN.md#api).

| | DuckDB (default) | T-SQL: Fabric SQL endpoint, Warehouse (`dialect: 'tsql'`) |
|---|---|---|
| Model: TMSL `model.bim` · TMDL (one file or a PBIP folder) · Apache Ossie, metrics in DAX or SQL | yes | yes |
| Query: DAX (tested against Power BI's answers, [conformance/](conformance/README.md)) | yes | yes, limits in [DESIGN.md](DESIGN.md#t-sql) |
| Query: SQL `SELECT` over the model (tested against Apache Ossie's compliance cases) | yes | yes |

Errors: `SYNTAX`, `SEMANTIC`, `UNSUPPORTED`; `CATALOG` for semantic views. Anything not in [DESIGN.md](DESIGN.md#what-it-does) is not implemented.

## Departures from DAX, by design

- Text is compared as the engine's collation does it (`"red"` is not `"Red"` on DuckDB) and keeps its trailing spaces.
- A column mixing numbers and text comes back as text; a date minus a date as days.
- `IFERROR` returns its first argument. Values come back unformatted; `FORMAT` is en-US, with a constant pattern.
- No blank row: a dimension must hold every key its facts use; fact rows with a missing key still count in totals.
