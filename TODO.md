# To do

Nothing here blocks a release: tests and both conformance runs are green on `main`.

## Correctness

- **RANKX on a floating-point measure** can rank a row below itself when DuckDB adds the same
  values in two orders (several threads, millions of rows). Fixed where the measure reads a
  table grouped first; elsewhere RANKX should compute each value once.
- **Text as a date** (`YEAR("2024-03-05")`, `EOMONTH("2024-03-05", 0)`) is a DuckDB binder
  error. Text in arithmetic is done.
- **To probe on Power BI first** (new conformance queries, an Oracle run):
  - `ROUNDDOWN(0.29, 2)`, `TRUNC`, `ROUNDUP`, `FLOOR(0.3, 0.1)`, `CEILING`, `MROUND` scale in
    binary floating point here (0.28, 0.2); no query covers them.
  - `TIME` with minutes or seconds that carry past a day; text in arithmetic (`"3" * 2`).
- **T-SQL, not yet:** `PERCENTILE.EXC` and `PERCENTILEX`, `FORMAT` with a pattern, `SUBSTITUTE`
  with an instance number (conformance/engines/dax-sql-tsql/known.json).

## Speed of the SQL (DuckDB, a million fact rows)

- **RANKX** compares two measures for each pair of rows: one grouped CTE of the values, ranked.
- **Currency conversion** (`SUMX(SUMMARIZE(Sales, Date[Date], Currency[Code]), [Sales] * [Rate])`)
  and **orders in transit** (a range of dates against each day) stay subqueries of each row:
  60 to 140 s.
- **A fused group with a slicer or a role on a joined table** is not grouped before its joins
  (`Fusion.belowJoins` bails on a condition that reads a joined table).
- **Visual calculations** (`RUNNINGSUM`, `PREVIOUS`, `RANK`) are a window inside a subquery of
  each row; a plain window over the visual's rows.
- **Calculation groups crossed** write megabytes of SQL (28 MB for two of them), where the
  repeated subqueries are no longer written once.
- **T-SQL:** aggregates by the same keys with different filters on joined tables as one scan
  with `CASE` (DuckDB's `FILTER`); a table grouped before its joins; five `patterns` queries
  time out on Fabric (calculation groups, currency conversion, a ranked cumulative total).

## Not implemented

- **Object-level security**: a role that hides whole tables or columns (a model's
  `tablePermission`/`columnPermission` with `metadataPermission: none`), so that a query
  naming one fails as if it did not exist. Row-level security is done; this is not read.
- **Dynamic format strings** (a measure's `formatStringDefinition`), and model format strings:
  not applied to the values returned.
- **The window functions' reset argument** (`RUNNINGSUM(…, …, reset)` and the like).
- **FORMAT** is en-US only, with a constant pattern.
- **DATEDIFF with WEEK** counts Sunday week boundaries, whatever the model's first day.
- Anything DESIGN.md does not list under "What it does".

## Conformance

- 137 queries are on the known list because their golden has Power BI's blank row (the test
  data has fact keys their dimensions lack, on purpose). They verify nothing else while listed:
  give the models' dimensions every key (conformance/tools/*/data.js), run the Oracle again,
  and take them off the list; drop the queries that are only about the blank row.

## Code

- The dialects' differences are flags read through `emit.js`; they could be steps that rewrite
  the intermediate form before it is written, one per flag.
