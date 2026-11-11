# To do

Nothing here blocks a release. Two waves: the gaps first (what DAX does and this does not,
other than by design), then the speed of the SQL.

# Wave 1: gaps

## Not implemented

- **Object-level security**: a role that hides whole tables or columns (a model's
  `tablePermission`/`columnPermission` with `metadataPermission: none`), so that a query
  naming one fails as if it did not exist. A role that has it is refused for now. To do it:
  a conformance model with such a role and the Oracle's answers first (what a measure over a
  hidden column answers, a relationship on one, several roles together), then hide the
  objects from the names a query can use while the joins still read them.
- Anything DESIGN.md does not list under "What it does".

By design, and so not here: values are returned unformatted (a measure's format string, fixed
or dynamic, is the caller's to apply), and FORMAT is en-US with a constant pattern.

## Conformance

- 137 queries are on the known list because their golden has Power BI's blank row (the test
  data has fact keys their dimensions lack, on purpose). They verify nothing else while listed:
  give the models' dimensions every key (conformance/tools/*/data.js), run the Oracle again,
  and take them off the list; drop the queries that are only about the blank row.

# Wave 2: speed of the SQL (DuckDB, a million fact rows)

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
