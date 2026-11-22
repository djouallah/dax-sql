# To do

Nothing here blocks a release. DAX on DuckDB first; T-SQL is the last wave.

# Wave 1: DAX on DuckDB

- **Not probed against Power BI yet:** CROSSFILTER's numeric directions 3 and 4, and a
  one-to-one relationship made one-way by CROSSFILTER (`model.js` makes every one-to-one both
  ways).
- **Speed** (1.1M sales: patterns' Sales repeated 292 times):
  - SAMEPERIODLASTYEAR inside SUMMARIZE (`segmentation-summarize-sply-quarter-band`,
    `relationships-summarize-sply-product-category`): 5.8 and 7.6 s.
  - RANKX over a measure (`segmentation-rankx-growth-blank-zero-negative`, 136 scans): 4.1 s.
    It compares the measure for each pair of rows; row fusion, which computes the ranked rows'
    values once, measured slower on DuckDB as a whole (62 s to 96 s over 139 queries).

# Wave 2: T-SQL

- **3 queries past Fabric's 30 s**, not on the known list. Each holds a subquery of each group
  that the mapping does not reach yet: a time-intelligence item applied to another (PY of YTD,
  a mapping inside a mapping), `customers-returning-calc-group-all`;
  `segmentation-calc-group-name-ordinal-filter`; `segmentation-summarize-sply-quarter-band`.
- `agree.mjs` holds the rewrites to the plain SQL on DuckDB only: T-SQL's own (`bind`,
  `fuseRows`) are checked by nothing but the Fabric run, by hand.
