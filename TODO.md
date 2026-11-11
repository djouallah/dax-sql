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
- **T-SQL on lakehouse tables: 13 queries fail on Fabric**, not on the known list (the suite reads
  the lakehouse's Delta tables since it read session #temp tables, which ran single-node; the
  currency, SAMEPERIODLASTYEAR-in-SUMMARIZE and ranked cumulative queries that timed out there
  answer now):
  - 10 get "Internal Query Processor Error: could not produce a query plan": calculation groups
    (`time-calc-group-items-by-year`, `segmentation-cumulative-calc-group`, …), DATEADD and
    PARALLELPERIOD (`time-parallelperiod-vs-dateadd-quarter`, `time-yoy-mixed-grain-rollup`),
    `context-summarize-sameperiodlastyear`. The cause, found by bisecting: each time-intelligence
    measure is a subquery of the group's row, filtering dates by a range bounded by the group's
    first and last date (PARALLELPERIOD, YTD, rolling windows) or by membership in its shifted
    dates (SAMEPERIODLASTYEAR, DATEADD). Fabric plans either kind alone, or two of one kind, but
    not one SELECT with both (the Time Intelligence calculation group's items mix them). Moving
    the date functions into the bounds' subqueries, the bounds to an OUTER APPLY of the group, or
    the range onto the fact's date as plain conditions does not help (the last makes tpcds' YoY +
    YTD fail too). The fix: no correlation. A mapping of (group key, date of its period), from
    the group keys and the Date table alone, joined to the fact once and grouped by the key, as
    DuckDB decorrelates them; it is the currency and orders-in-transit item above too;
  - 3 go past 30 s: `queries-calcgroup-x-field-parameter`,
    `segmentation-calc-group-name-ordinal-filter` (339 KB of SQL), and aac's
    `check-measure-*-change` (2 to 4 s on #temp tables).
