# To do

Nothing here blocks a release. DAX on DuckDB has nothing left; T-SQL is the last wave.

# Wave 2: T-SQL

- **2 queries past Fabric's 30 s**, on the known list as slow. Each holds a subquery of each
  group that the mapping does not reach yet: `segmentation-calc-group-name-ordinal-filter` (60 s
  alone), `segmentation-summarize-sply-quarter-band` (21 s alone, past 30 s beside 7 others; its
  prior year's Low-band customer count is 8 s by itself).
- `agree.mjs` holds the rewrites to the plain SQL on DuckDB only: T-SQL's own (`bind`,
  `fuseRows`) are checked by the goldens in `tsql.yml`, not on the queries of its known list.

# Wave 3: PostgreSQL

- **3 queries past 10 min** on the CI's PostgreSQL 17, on its known list as slow: a calculation
  item over a running total (`segmentation-cumulative-calc-group`) or a segmentation
  (`segmentation-customer-bands-calc-group`), and a calculation item as a CALCULATE filter
  (`filters-calcgroup-item-as-calculate-filter`). The same kind as Fabric's: a subquery of each
  group the mapping does not reach, which PostgreSQL runs as a loop. Others take 15 s to 132 s
  (`segmentation-summarize-sply-quarter-band`); the run's summary lists them.
