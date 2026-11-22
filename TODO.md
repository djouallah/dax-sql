# To do

Nothing here blocks a release.

# Speed of the SQL (DuckDB, 1.1M sales: patterns' Sales repeated 292 times)

- **SAMEPERIODLASTYEAR inside SUMMARIZE** (`segmentation-summarize-sply-quarter-band`,
  `relationships-summarize-sply-product-category`): 5.8 and 7.6 s.
- **RANKX** over a measure (`segmentation-rankx-growth-blank-zero-negative`, 136 scans): 4.1 s.
  It compares the measure for each pair of rows; row fusion, which computes the ranked rows'
  values once, measured slower on DuckDB as a whole (62 s to 96 s over 139 queries), so it is
  T-SQL's only.

# T-SQL on lakehouse tables: 3 queries past Fabric's 30 s

Not on the known list. Each holds a subquery of each group that the mapping does not reach yet:

- a time-intelligence item applied to another (PY of YTD: a mapping inside a mapping):
  `customers-returning-calc-group-all`;
- `segmentation-calc-group-name-ordinal-filter`, `segmentation-summarize-sply-quarter-band`.

# Checks that do not cover everything

- `agree.mjs` holds the emitter's rewrites to the plain SQL on DuckDB only: T-SQL's own (`bind`,
  `fuseRows`) are compared with nothing but the Fabric run, by hand.
- Not probed against Power BI yet: CROSSFILTER's numeric directions 3 and 4, a one-to-one
  relationship made one-way by CROSSFILTER (`model.js` makes every one-to-one both ways).
