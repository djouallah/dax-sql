# To do

Nothing here blocks a release. Two waves: the gaps first (what DAX does and this does not,
other than by design), done; then the speed of the SQL.

# Wave 1: gaps

Done. What DAX does and this does not is by design, in the README: values are returned
unformatted (a measure's format string, fixed or dynamic, is the caller's to apply), FORMAT is
en-US with a constant pattern, and the rest of its "Departures" list. The edges model keeps fact
keys that are NULL, "" or unknown, on purpose: its queries that list a dimension's values are
on the known lists, by design (no blank row).

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
  with `CASE` (DuckDB's `FILTER`); a table grouped before its joins.
- **T-SQL: six `patterns` queries go past Fabric's 30 s on 3,768 sales** (under 2.5 s on
  DuckDB), not on the known list:
  - `relationships-currency-usd-by-country`, `relationships-currency-usd-at-delivery`: the
    exchange rate (a LASTNONBLANK lookup) is a subquery for each date and currency of each group;
  - `relationships-summarize-sply-product-category`: SAMEPERIODLASTYEAR inside SUMMARIZE;
  - `queries-calcgroup-x-field-parameter`: a calculation group crossed with a field parameter;
  - `segmentation-calc-group-name-ordinal-filter`: 339 KB of SQL, which Fabric cannot plan;
  - `segmentation-cumulative-ranked-products`: a ranked cumulative total.

  Fabric runs a correlated subquery once per outer row. It turns one into a join only when it is
  correlated by `=`, and it does not do that through an EXISTS or a nested aggregate. Check first
  whether the suite's `#temp` tables, which run single-node, are part of it: real lakehouse tables
  run in the distributed engine (`CREATE TABLE … WITH (DISTRIBUTION = ROUND_ROBIN)` makes a
  distributed temp table).
