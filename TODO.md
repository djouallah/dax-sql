# To do

Nothing here blocks a release. DAX on DuckDB has nothing left but speed; T-SQL is the last wave.

# Speed at SF10 (scale.yml, DuckDB)

Measure a change with `ab.yml` (its SQL against its base's on one runner); scale.yml's times
move by a third from one runner to the next. `variants.yml` swaps the queries' constants for
values the data holds: a filter that keeps no row at SF10 says nothing of the SQL.

- [ ] `fuzz2-0109` 10 s (hand 0.5 s; 25 s against 1 s in the variants): RANKX over ALL(price)
  under SUMMARIZECOLUMNS' auto-exist ranks each price within the outer group's classes, so one
  window is wrong (219 rows) and the per-price sums' mapping by item key is 4.9 M rows. The
  hand file's way: the sums grouped by the item's columns (colour, class, price, month), mapped
  by class: fusion by a table's columns, not its key.
- [ ] `grid-0049` 4 s (hand 60 ms), `grid-0024`: the SQL front end's TREATAS of all 16 columns
  of catalog_sales onto themselves, a DISTINCT of 14 M rows and a join on 16 columns. The rows
  of a scan joined to tables by their keys (one row or none each) are the scan's own rows.
- [ ] The fuzz3-0112, fuzz2-0043, fuzz3-0149, fuzz3-0139 group: 10–30 s, 3–4× the hand's.
- Not the SQL's (the hand file reads a fact of the data, not a constant): fuzz2-0006, fuzz2-0106,
  fuzz2-0145, fuzz2-0009, fuzz2-0013 (the calendar's last year has no sales).

# Open

- [ ] Probe Power BI: a DAX literal with a trailing space against a `trailingSpaces` column.
- [ ] Issue #9 (feature request, left open).

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
  (`DIVIDE([m], CALCULATE([m], ALLSELECTED(t)))` next to the groups), and a subtotal level: its
  aggregates scan the fact again, not read off the detail level's groups (two scans where the
  emitter wrote one; one only beside a double's AVERAGE, which a fixed decimal's no longer is).

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
