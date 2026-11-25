# dax-sql

Initially written by [N.S. Devaraj](https://github.com/nsdevaraj).

Compiles a DAX or SQL query over a semantic model to one SQL `SELECT`. No dependencies. `npm install dax-sql`; API, example and everything it does in [DESIGN.md](DESIGN.md); anything not there is not implemented.

| Feature | Supported |
|---|---|
| Semantic model | `.bim`, TMDL, Ossie YAML |
| Measure dialect | DAX, Ossie SQL |
| Query | DAX `SUMMARIZECOLUMNS(…)`, SQL `SELECT dim, AGG(measure) FROM model`, Ossie wide table JSON |
| Target | DuckDB, Polars, DataFusion, T-SQL (Fabric SQL endpoint and Warehouse) |

DAX is tested against Power BI's answers ([conformance/](conformance/README.md)), SQL too, Apache Ossie's compliance cases among it; blanks are DAX's in SQL too (`NULL + 1` is 1, a NULL key meets a NULL key), as Power BI answers. Errors: `SYNTAX`, `SEMANTIC`, `UNSUPPORTED`; `CATALOG` for semantic views.

## Departures from DAX, by design

- Text is compared as the engine's collation does it (`"red"` is not `"Red"` on DuckDB) and keeps its trailing spaces.
- A column mixing numbers and text comes back as text; a date minus a date as days; `IFERROR` returns its first argument. Values come back unformatted; `FORMAT` is en-US, with a constant pattern. `PATH` walks at most 32 levels: a deeper row's path is blank.
- No blank row: a dimension must hold every key its facts use; fact rows with a missing key still count in totals.
