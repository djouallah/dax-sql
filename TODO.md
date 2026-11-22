# To do

Nothing here blocks a release. DAX on DuckDB has nothing left; T-SQL is the last wave.

# Wave 2: T-SQL

- **3 queries past Fabric's 30 s**, not on the known list. Each holds a subquery of each group
  that the mapping does not reach yet: a time-intelligence item applied to another (PY of YTD,
  a mapping inside a mapping), `customers-returning-calc-group-all`;
  `segmentation-calc-group-name-ordinal-filter`; `segmentation-summarize-sply-quarter-band`.
- `agree.mjs` holds the rewrites to the plain SQL on DuckDB only: T-SQL's own (`bind`,
  `fuseRows`) are checked by nothing but the Fabric run, by hand.
