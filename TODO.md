# To do

Nothing here blocks a release. DAX on DuckDB has nothing left; T-SQL is the last wave.

# DAX not supported yet (on the known lists, with their queries)

- [ ] SUMMARIZE's group filter on a many-to-many column: Power BI filters by the tuple of the
  groups, the plan by each column alone (edges `fuzz3-0063`, `fuzz3-0098`).
- [ ] An inline IF of a fixed decimal and a decimal number, multiplied: Power BI keeps the branch's
  fixed decimal (rounded to four places); a measure's IF is a decimal number. More probes first
  (`iterators-if-fixed-decimal-branch-times-double`, edges `fuzz3-0119`).
- [ ] SUMMARIZE's group filter under LASTNONBLANK of a CALCULATE: Power BI takes each product's
  last date with inventory in any year (`context-summarize-year-lastnonblank-inventory`,
  patterns `fuzz3-0007`).
- [ ] A value of two kinds typed per row (DuckDB's VARIANT), not text: Power BI keeps each row's
  number a number (the 4 variant-as-text queries).
- [ ] A value of two kinds compared with a number (contoso `fuzz3-0104`).

# Wave 2: T-SQL

- **The unnested plan on Fabric** (`tsql.yml`'s second step): the queries the compiled SQL takes
  past 30 s answer through it (`known-compile.json`), and the suite adds up to half the time.
  Left: `segmentation-bands-matrix-two-totals` near 30 s (26 s alone; the compiled SQL 10 s),
  a measure's grouping read 8 times, which Fabric computes at each read.

# Wave 3: Polars

- Polars 2.2.0 (pip), the suite in `polars.yml` through the unnested plan; the correlated plan
  beside it waits on pola-rs/polars#31059 and #31067 (an outer row read in a derived table).

# The query plan

- What the old emitter read off a level's groups the plan scans again: a total over what is selected
  (`DIVIDE([m], CALCULATE([m], ALLSELECTED(t)))` next to the groups), and a subtotal level beside a
  measure with a filter of its own (two scans of the fact where the emitter wrote one).

`DAX → query plan → optimizer (every engine) → Substrait → engine passes (only what one needs) → SQL`.

Done: Substrait (main) is the plan every dialect's SQL is written from (`planSql`: the plan
written as Substrait, read back), `compile()` for every dialect included; DataFusion gets SQL
as every engine does. DAX's runtime errors are in the plan (an `error` lambda in Substrait).

1. Done: the plan, as it is (`lower.js`, `plan-sql.js`, `explain.js`); every query of the
   suite answers through `planSql` on DuckDB as it does through `compile`.
2. Done: **decorrelation**, the correlated plan unnested top down (`unnest.js`,
   `{ unnest: true }`): no apply left on the suite; D read from the base rows, not the levels
   below (Fabric computes a CTE at each read). Its answers on DuckDB, Fabric, Polars
   and DataFusion in CI.
3. **The emitter's rewrites as passes**, one at a time, each checked against the plan as it
   is: fusion, filters on the scan, grouping below joins, sharing.
4. Done: `compile()` through the plan as Substrait on every dialect; `emit.js`, the writer before
   the plan, deleted (none of its rewrites was reached any more). Left: **Fabric's own pass** (a
   CTE computed again at each name).
