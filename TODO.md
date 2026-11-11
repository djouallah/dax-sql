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

Done: time intelligence by the group's keys is a mapping (key, date) joined once; a fact is
grouped by its keys before its joins under a slicer or a role too; an iterator's aggregate a
mapping takes is fused on DuckDB; SUMMARIZECOLUMNS by a calculation group's column is a level
for each item (28 MB of SQL for two crossed groups, 8.8 KB now); T-SQL shares a scan between
aggregates by the same keys and groups a fact before its joins.

Left, measured at 1.1M sales on DuckDB:

- **Currency conversion by country** (`relationships-currency-usd-by-country`) is past 30 s, and
  **closing vs average rate** 17 s: the rate's LASTNONBLANK reads the group's year through MAX of
  the date (the rate's own date filter replaces it, but the MAX's does not), so its mapping would
  read the group.
- **SAMEPERIODLASTYEAR inside SUMMARIZE** (`segmentation-summarize-sply-quarter-band`,
  `relationships-summarize-sply-product-category`): 16 to 20 s.
- **RANKX** over a measure (`segmentation-rankx-growth-blank-zero-negative`, 136 scans): 9.5 s.
  It compares the measure for each pair of rows; row fusion, which computes the ranked rows'
  values once, measured slower on DuckDB as a whole (62 s to 96 s over 139 queries), so it is
  T-SQL's only.
- Visual calculations are a window inside a subquery of each of the visual's rows: 0.35 s at
  most, the fact's aggregation most of it. Not worth a rewrite.

# T-SQL on lakehouse tables: 9 queries fail on Fabric

Not on the known list. Each holds a subquery of each group that the mapping does not reach yet;
Fabric cannot plan one SELECT holding a subquery correlated by a period's range beside one by
shifted dates, and each one the mapping takes out is one less:

- a time-intelligence item applied to another (PY of YTD: a mapping inside a mapping):
  `filters-calcgroup-item-as-calculate-filter`, `context-calc-group-in-iterator`,
  `customers-returning-calc-group-all`;
- an aggregate inside an iterator over rows of more than four columns, or under a table filter
  of a table's rows (SUMMARIZE's extension columns): `context-summarize-sameperiodlastyear`,
  `segmentation-customer-bands-calc-group`;
- dates that reach the scan over a many-to-many relationship (Budget by YearMonth):
  `relationships-budget-calc-group-py`;
- past 30 s: `segmentation-calc-group-name-ordinal-filter`,
  `segmentation-calc-group-name-filter-ordinal-grouped`, `segmentation-summarize-sply-quarter-band`.
