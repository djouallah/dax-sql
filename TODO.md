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
- **T-SQL on lakehouse tables: 9 queries fail on Fabric**, not on the known list. Time intelligence by
  the group's keys is a mapping (key, date) joined to the fused GROUP BY now (Fusion.mapping), which
  took five of them; the others still hold a subquery of each group the mapping does not reach:
  - an aggregate over VALUES (MAX of the visible dates in a calculation item; Fusion.add takes a
    scan only): `filters-calcgroup-item-as-calculate-filter`, `context-calc-group-in-iterator`;
  - an aggregate inside an iterator over rows of more than four columns, or under a table filter
    of a table's rows (SUMMARIZE's extension columns): `context-summarize-sameperiodlastyear`,
    `segmentation-customer-bands-calc-group`, `segmentation-cumulative-calc-group`;
  - dates that reach the scan over a many-to-many relationship (Budget by YearMonth):
    `relationships-budget-calc-group-py`;
  - past 30 s: `queries-calcgroup-x-field-parameter`, `segmentation-calc-group-name-ordinal-filter`
    (339 KB of SQL), `segmentation-summarize-sply-quarter-band`.
  Fabric cannot plan one SELECT holding a subquery correlated by a period's range and another by
  shifted dates; each one the mapping takes out is one less.
