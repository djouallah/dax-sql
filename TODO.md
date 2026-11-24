# To do

Nothing here blocks a release. DAX on DuckDB has nothing left; T-SQL is the last wave.

# Wave 2: T-SQL

- **The unnested plan on Fabric** (`tsql.yml`'s second step): the queries the compiled SQL takes
  past 30 s answer through it (`known-compile.json`), and the suite adds up to half the time.
  Left: `segmentation-bands-matrix-two-totals` near 30 s (26 s alone; the compiled SQL 10 s),
  a measure's grouping read 8 times, which Fabric computes at each read.
- `agree.mjs` holds the rewrites to the plain SQL on DuckDB only: T-SQL's own (`bind`,
  `fuseRows`) are checked by the goldens in `tsql.yml`, not on the queries of its known list.

# Wave 3: PostgreSQL

- The optimized and unnested plans answer the 3 queries the compiled SQL takes past 10 min
  (`known-compile.json`).

# Wave 4: Polars

- Polars built from its main branch (`polars-main.yml`, daily when main has moved), the suite in
  `polars.yml`: 1215 of 1286 match, the rest on DuckDB's known lists but one, ordered by a float
  its rows tie at (flaky).

# The query plan

`DAX → query plan → optimizer (every engine) → Substrait → engine passes (only what one needs) → SQL`.

Done: Substrait (main) is the plan every dialect's SQL is written from (`planSql`: the plan
written as Substrait, read back), `compile()` for every dialect included; DataFusion gets SQL
as every engine does. DAX's runtime errors are in the plan (an `error` lambda in Substrait).

1. Done: the plan, as it is (`lower.js`, `plan-sql.js`, `explain.js`); every query of the
   suite answers through `planSql` on DuckDB as it does through `compile`.
2. Done: **decorrelation**, the correlated plan unnested top down (`unnest.js`,
   `{ unnest: true }`): no apply left on the suite; D read from the base rows, not the levels
   below (Fabric computes a CTE at each read). Its answers on DuckDB, PostgreSQL, Fabric, Polars
   and DataFusion in CI.
3. **The emitter's rewrites as passes**, one at a time, each checked against the plan as it
   is: fusion, filters on the scan, grouping below joins, sharing.
4. Done: `compile()` through the plan as Substrait on every dialect, held to `emit.js`'s SQL by
   `perf.yml` on DuckDB. Left: **Fabric's own pass** (`mapAlone`, a CTE computed again at each
   name); `emit.js` deleted once nothing checks against it.
