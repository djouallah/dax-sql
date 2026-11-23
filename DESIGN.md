# Design

Written by [N.S. Devaraj](https://github.com/nsdevaraj).

## The problem

DAX has no direct SQL equivalent. A measure is evaluated in a filter context that the query
sets: the groups of SUMMARIZECOLUMNS, CALCULATE's filters, and context transition from the
rows of an iterator. That context reaches a table only along its relationships. SQL has none
of this.

The SQL generator the analytics-as-code dashboard had before this package wrote the SQL for
the constructs its page used, case by case. This package translates DAX's rules instead, so
that a query it has not seen comes out right.

## The approach

The approach chosen is the filter context as a value at compile time, with SQL that is
correlated and then fused. Two alternatives were set aside:

- **A cost-based planner**, which splits work into formula-engine and storage-engine queries
  as VertiPaq does. It would write faster SQL, but at several times the work.
- **An interpreter in JavaScript** over rows fetched from the engine. That is not a compiler,
  and it moves the data to the browser.

The compiler walks the DAX with an environment holding:

- the filter context;
- the row contexts;
- the variables in scope;
- the columns SUMMARIZECOLUMNS groups by;
- the shadow filter context, which ALLSELECTED restores;
- the measures being expanded, and the calculation items applied to them.

Wherever DAX would change the filter context at run time, the compiler builds a new one at
compile time. Every aggregate ends up as "the rows of model table T that this filter context
keeps, aggregated".

### The filter context

A filter constrains some model columns (`context.js`) in one of three ways:

- **`bind`**: a column equals a value. Context transition and group keys produce these. The
  value can be an outer row's column, so the SQL is correlated.
- **`pred`**: a predicate on the columns, for a boolean CALCULATE filter like `T[c] > 5`. It
  is `FILTER(ALL(T[c]), …)` read on each row.
- **`rel`**: the rows of a table, matched on its columns' lineage, for a table filter
  (`TREATAS`, `VALUES`, `FILTER(…)`). Rows of a model table (`FILTER(Sales, …)`) filter its
  expanded table.

Removing filters from columns (`ALL`, or a new filter on the same column) keeps what a filter
says about its other columns (`narrow`).

Context transition on a row of a model table binds each of its columns. With a key, the
other columns' binds are `implied` by the key's: they are not written while the key's bind
is in the context, and are once something removes it (ALLEXCEPT, REMOVEFILTERS of the key).

CALCULATE (`compiler.js`, `calculateCtx`) works in four steps:

1. It evaluates the filter arguments in the outer context.
2. It turns the row contexts into binds.
3. It applies the relationship modifiers, then the removals.
4. It removes what the context said about the filters' columns (unless `KEEPFILTERS`) and
   adds the filters.

A filter on a date table's date column also clears the rest of that table. One on a
calculation group's name does not clear its ordinal: grouped by both, the row's ordinal stays
in the context, while the item applied follows the name (see calculation groups below).

SUMMARIZECOLUMNS' filter arguments on the columns of one table are one filter (auto-exist,
`autoExist`): the combinations of those columns the table holds under all of them. The
columns it groups by on that table are among them, each level of groups with its own (a
subtotal's without the ones it drops), and each group binds its values: a measure that
removes one filter leaves the others to the values they have with that group's key.
The values a table's grouping columns take are decided by those filters on its own columns
and by the context around SUMMARIZECOLUMNS (`keyFilters`), not by its filter arguments on
other tables, even ones that reach it: those only make expressions blank.

**ALLSELECTED.** The environment holds the shadow filter contexts, innermost last. Each one
covers some columns and says what values they had:

- An iterator's (`iter`) covers the columns of the table it iterates that have a lineage. Its
  values are that table's rows.
- SUMMARIZECOLUMNS' covers the columns it groups by. Its values are theirs under its filters
  on them: a filter on another column alone narrows the groups, not the shadow. One merged
  with a filter on them (auto-exist) narrows both.
  A filter marked `NONVISUAL` is not one of those: the shadow covers its columns too, and
  their values are those the other filters leave them.

`ALLSELECTED` (`allSelected`) removes the filters on each column it acts on that a shadow
covers, and adds the filter of the last shadow that covers it (`shadowFilter`):

- When the shadow's values are some columns' values under a filter context (VALUES, ALL, a
  table's rows, SUMMARIZECOLUMNS), and every filter of that context the current one lacks is
  on those columns only, the filter is those filters put back. Any row they allow has values
  in the shadow, so this is exact, and it is the SQL the query had before.
- When the shadow's values are other rows (a FILTER, say), the filter is those rows.
- Otherwise it is `VALUES` of the columns under the shadow's filter context.

Columns no shadow covers keep their filters, or lose them for `ALLSELECTED(column)`. As a
table, `ALLSELECTED(column)` starts from no filter at all, and `ALLSELECTED(table)` from the
filters on its expanded table's columns only.

### The model's features

- **Calculated tables** are compiled once each (`index.js`, `calcTable`) in an empty
  environment. The SQL writes each as a `MATERIALIZED` CTE whose columns are renamed to the
  model's, so that a scan reads it as it reads any table's rows. It is written without the
  query's filters and without row-level security.
- **Calculation groups** are applied where a measure is referenced (`applyGroups`), from the
  highest precedence. What a group's filters select is read off the filter context, from the
  filters on its name column (`itemFilters`) only. They do not meet a filter on the ordinal:
  name "PY" on a row of another item's ordinal applies PY, though `VALUES` of the group there
  is empty.
  - Filters known at compile time (a constant, a predicate on the group's column, a table of
    constants) keep the items they allow. One item replaces the measure. Several, or none,
    take the group's selection expressions, or else leave the measure alone.
  - A filter known only at run time (SUMMARIZECOLUMNS grouping by the group's column) makes
    the measure a `CASE` on the group's selected value, with a branch per item. Inside a
    branch the selection is known (`withKnown`), so the measures under it do not branch again.
  - The branches are only for the items the filter can select (`filterItems`). A bind to a
    row of a table, a predicate comparing the column with another row's column, and a table
    filter are read back to the table their values come from (`itemsOfTable`): the group's
    rows under some filters, a FILTER of them, constants. An item returning text then does not
    make the other items' numbers text where it cannot be selected.
  - The items applied are carried along (`cgApplied`), into the measures under the item and
    the measures it names. An item already applied is skipped, as DAX ignores a second
    application of the same item.
- **Row-level security.** Each role's table filters are compiled as predicates on a row of
  their table, and make up a filter context of their own. Its relationships are those
  security moves along (`securityState`): each active one from its one side to its many side,
  both ways, or not at all, as its security filtering behavior says. `securityConds` writes
  that context's conditions on every scan with the code that writes any filter context's
  (`conds`). The filters then reach the scan from its expanded table, and as semi-joins across
  relationships that filter both ways and many-to-many ones, from table to table. The
  conditions of several roles are joined with `OR`. They are not part of the query's filter
  context, so no modifier removes them. Calculated tables and the model's calculated columns,
  and the security filters themselves, are written without them (`unsecured`); a column the
  query defines is computed with the query, under them. A table filters another back over a
  relationship that filters both ways only for the query when the query filters it: that is
  decided on its scan without security, and the rows that filter are its secured ones. When
  it does, and a secured table reaches the filtered table that way and another (it filters
  the table that filters it back), that is DAX's error that join paths must form a tree
  (`securityTree`, where the filter comes back: `conds`, and a fused group's keys).
- **PATH** is not supported (`UNSUPPORTED`): walking a hierarchy of unknown depth is a
  transitive closure, which relational algebra cannot express, so no query plan holds it. The
  path is a column computed in the source, as Power BI requires in DirectQuery; the other path
  functions (PATHITEM, PATHLENGTH, …) are functions of its text.
- **Field parameters** are calculated tables with `NAMEOF` cells, which are constants.
  `expandFieldParameter` reads the table's expression to list the fields a selection stands
  for.

### The blank row

There is none (a departure from DAX). Power BI adds a row of blanks to a table on the one side
of a relationship when the other side has keys it lacks, and lists it in `VALUES`, `ALL` and
the groups of SUMMARIZECOLUMNS. Knowing whether it is there takes a scan of every such fact
table for the keys the dimension lacks, in every query that lists a dimension's values: 3,908
checks over the conformance queries, a third of their SQL. A dimension is expected to hold
every key its facts use; `VALUES` and `ALL` are its rows.

Fact rows with a key the dimension lacks are still read: they count in totals, and in no
group by the dimension's columns. Where the groups are read off the measures' own grouped rows
(fused, the joins to the one side `LEFT JOIN`s), a group's key of another table is one that
table has (`EXISTS`): fused or not, the groups are the same.

A blank in a table filter must match the fact rows that have no row of the table, and a NULL
stored in a column, so membership (`member`) is null-safe where both sides can be blank
(`blankSide`, `mayHoldNull`, `mayBeBlank`): a column read through a join that may find no
row, a column that is not a key, a constant blank. It stays a plain `IN`
elsewhere. When the table reads no outer row, the null-safe form is
`x IN (…) OR x IS NULL AND EXISTS (… IS NULL)`, as fast as `IN`; otherwise it is `EXISTS`
with `IS NOT DISTINCT FROM`. A many-to-many relationship matches its columns' values the same
way, a blank meeting a blank (`conds`, and the fused groups' join to its pairs).

### Relationships

`model.js` answers two questions under the relationship changes of the current context
(`USERELATIONSHIP`, `CROSSFILTER`):

- **`expand(T)`**: the tables reached from T through many-to-one relationships, each with its
  join path. This is DAX's expanded table.
- **`inbound(T)`**: the relationships through which a filter enters T from outside its
  expanded table. These are the one side of a bidirectional relationship and either side of a
  many-to-many relationship.

When a scan of T is written, a filter applies on the columns it shares with T's expanded
table, through joins. A filter arriving through an inbound relationship applies as a
semi-join, recursively, without returning to where it came from.

### The query plan

A query's plan is the work an engine has to do for it, as relational algebra, with no rewrite
and nothing of any engine (`explain(query)` draws it):

```
π  Category, Sales = sum
└─ σ  sum ≠ BLANK                                SUMMARIZECOLUMNS leaves out blank rows
   └─ ×ᴬ Apply                                   the measure, for each group
      ├─ δ  Distinct                             the groups: the column's values
      │  └─ π  Category.Category
      │     └─ ▭  Category
      └─ γ  SUM(Sales.Amount) → sum              [Sales Amount]
         └─ σ  ∃1 ∧ (Category.Category ≡ outer.Category)   the group's key; TREATAS
            ├─ ⟕  Category.CategoryKey = Product.CategoryKey   Sales' expanded table
            │  ├─ ⟕  Product.ProductKey = Sales.ProductKey
            │  │  ├─ ⟕  Date.Date = Sales.OrderDate
            │  │  │  ├─ ▭  Sales
            │  │  │  └─ ▭  Date
            │  │  └─ ▭  Product
            │  └─ ▭  Category
            └─ ∃1 σ  Value ≡ outer.Date.Year
               └─ ▭  Values {2024}
```

for `SUMMARIZECOLUMNS(Category[Category], TREATAS({2024}, 'Date'[Year]), "Sales", [Sales Amount])`.
The filter context is σ and semi-joins (∃) over joins along the relationships; a measure is
an apply (×ᴬ: the right side for each row of the left) of an aggregate (γ); ≡ is a blank
matching a blank, and `outer.` a column of the row an apply or a semi-join is correlated to.
The plan is made of simple operators any engine can run, and nothing else (no SQL text):

- **Relations:** scan, values, σ select, π project, δ distinct, γ aggregate, join (inner, left,
  cross), ∪ union, ω window (row number, rank, dense rank, count of the partition), series
  (GENERATESERIES), a definition read again (▭ V1), and the result's
  sort and limit.
- **Scalars:** columns, literals, CASE, and standard operators: `=` (NULL matches nothing), `≡`
  (a blank matches a blank: a join's key), `<>` `<` `≤` `>` `≥`, AND OR NOT, IN, IS NULL,
  `+` `-` `*` `/`, COALESCE, NULLIF, CAST, and standard functions (abs, round, power, upper,
  length, substring, extract_year, add_days, add_months, date_trunc_month, date_diff_day, …).
- **Aggregates:** SUM, AVG, MIN, MAX, COUNT, COUNT(*), COUNT(DISTINCT), STRING_AGG, MEDIAN.

The optimizer's last pass (`passes/standard.js`) writes DAX's operators, functions and
aggregates with those: a blank compared as 0 is a COALESCE, DIVIDE a NULLIF, a count of no rows
a NULLIF of COUNT, DISTINCTCOUNT a COUNT(DISTINCT) and a count of the blank, a fixed decimal a
round to four places. What has no standard writing yet stays DAX's, and `operators.mjs` lists
it: exact fixed-decimal division, a distinct count of several columns, the percentiles, FORMAT,
PATH's functions, a number written as text, and a few rarer functions.

The plan as it is also holds applies and EXISTS correlated to a row; optimized, it holds
neither. `conformance/engines/dax-sql/operators.mjs` checks every query of the suite against
that, in CI, and counts the operators the plans use.

A table VAR and a calculated table are definitions (▭ V1, drawn below the tree): evaluated
once, as DAX does, and read at each use.

The optimizer (`src/passes/`) rewrites the plan into one that means the same, for every engine;
`explain(query, { optimize: true })` draws it. Its first pass is decorrelation: an apply, and
an EXISTS a row reads, become joins and groupings. An aggregate whose rows match the outer row
on equal values is its rows grouped by those values, left-joined to the outer rows (the plan
above: one γ by Category, and TREATAS a γ by its value); any other is unnested in general
(Neumann & Kemper): the distinct values it reads (D) pushed down its operators, joined back.
`planSql(query)` writes the optimized plan in a dialect's SQL (`{ optimize: false }`: as it is).
The SQL `compile` writes is still `emit.js`'s, whose rewrites move onto the plan pass by pass
(TODO.md).

### The intermediate form

`ir.js` defines two kinds of node:

- **Scalars:** `lit`, `col`, `op`, `fn`, `case`, `agg`, `exists`, `insub`.
- **Tables:** `scan`, `filter`, `project`, `distinct`, `group`, `topn`, `topnskip`, `cross`,
  the set operations, `rows`, `series`, `join` (NATURALINNERJOIN and its kind), `subindex`
  (SUBSTITUTEWITHINDEX), `generate`, `sc` (SUMMARIZECOLUMNS), `shared` (a table VAR),
  `onerow`, `prefix`, and `window` (INDEX, OFFSET, WINDOW).
- **Scalars added for those:** `wrank` (RANK, ROWNUMBER).

A row is a `RowRef`; an expression names a row's column through it. `freeRows(x)` says which
rows from outside an expression or table it reads, which is the correlation of its SQL.

## SQL

`emit.js` builds each table as a `Block`: one SELECT under construction and a resolver for the
columns of its input row. A FILTER over a scan becomes a WHERE on it; anything that cannot
extend a block wraps it in a subquery.

**A scan** is the table joined to the related tables it needs, with the filter context as its
WHERE.

- A dimension key is read off the fact's foreign key when the relationship relies on
  referential integrity.
- A `rel` filter is `IN` for one column and `EXISTS` for more.

**An aggregate** is a scalar subquery over its table's block, correlated to the rows it reads.
DuckDB decorrelates these.

**Fusion.** In a SUMMARIZECOLUMNS level, or a ROW, an aggregate over a scan joins a fused
group when the scan reads no row except the group's keys. Each fused group is one CTE:

```sql
SELECT <keys>, <aggregates> FROM <table + joins> WHERE <other filters> GROUP BY <keys>
```

The CTE is `LEFT JOIN`ed to the groups. Aggregates are grouped together when they share the
same table, relationship state, keys, and other filters (the filters compared as SQL).

- **Filters of their own.** Aggregates by the same keys over the same tables whose filters
  differ only on the tables the scan joins share the scan: the filters they all have are its
  `WHERE`, each one's others its `FILTER`. The filters on the scanned table's own columns
  must be the same: they are what lets the engine skip rows. By keys, only aggregates that
  are blank over no rows join such a group (not `count0`, `dcount0`, `hasone`): the group
  has a row for a key where only another aggregate has rows, and there each of them must be
  blank, as its own group would have no row.
- **Totals from the groups.** An aggregate by some of a group's keys, or by none, over the
  same rows or fewer (filters of its own on the joined tables, as its `FILTER` in the group):
  the group's values added up by those keys, from the group's CTE, not a second scan. Sums,
  counts, minima and maxima; an average is its sum over its count. The group can be in a
  level before, so a `ROLLUPADDISSUBTOTAL` subtotal reads the detail level's group. The
  levels' CTEs are written once every level is known.
- **Blanks a scan rules out.** Where one condition of a scan compares a column with a
  constant that a blank fails (`date >= DATE '…'`), the others need not say what a blank
  does: `OR date IS NULL` and `COALESCE(date, <blank>)` go, and the engine can skip rows on
  what is left.
- **A sum of fixed decimals** (`SUMX` of a product of currencies) rounds each row to four
  places and checks the range once, on the largest (`MAX(abs(x))`), instead of row by row.
- **A table's rows grouped first.** A fused group's sums, counts, minima and maxima
  are taken by the scan's keys before its joins to the one side, then added up by the
  grouping columns; a condition on a joined table (a slicer, a role's filter on a dimension)
  is the outer query's, as each group of keys meets one row of it. An aggregate that stays a subquery of each row (last year's sales by
  month, a measure for each row an iterator reads) reads the table grouped once, in a CTE,
  by the columns its joins and its conditions on other rows read: a million rows joined to
  their dates for each month took 12 s, their groups 0.1 s. A sum of floating-point groups
  is added in the values' own order, so that a measure written twice is the same to the last
  digit.
- **Time intelligence by the group's keys** (a period's dates, its dates a year before, a year
  to date): the filter is a mapping of (key, date), a CTE over the key columns' values and the
  Date table alone, joined to the scan, which is grouped by the key in the level's GROUP BY.
  Each group otherwise had a subquery of its own over the fact table; Fabric could not plan a
  SELECT holding one correlated by a period's range beside one by shifted dates. Its keys are
  the values the level's filters keep (seven days, not the calendar). Fabric cannot plan a
  level that holds a mapping beside such a subquery the mapping does not take, or a mapping
  that holds one beside another mapping: on T-SQL that query is written with subqueries alone.
- **SUMMARIZECOLUMNS by one calculation group's column** is a level for each item, the item
  applied as it is, or one level whose measures are a CASE on the item, whichever SQL is
  smaller: a measure that sets the group's filter itself is the same for every item, and split,
  a copy for each. Two groups crossed are split.
- **RANKX's two sides** (the row's value and each ranked row's) are the same measure written
  twice: their sums of floating-point values are added as DECIMALs, the same in any order.
  DuckDB's threads add a column's values in an order of their own, and over three million
  rows a row ranked below itself, or sixth of five.

Inside a fused scan, a filter that reads a key the scan is itself filtered to reads the scan's
own column instead. Its correlation moves from the group to the row, which joins well.

**The groups of SUMMARIZECOLUMNS.** Every expression can be blank only when its fused groups
have no row (`support`). When that holds, and each of those groups' scans keeps the filters
that decide the keys' combinations (those reaching a key's table), the groups are the union of
those groups' keys. Otherwise they are the combinations of the keys' values (each table's
existing combinations, cross-joined) and the expressions are evaluated on each. `ROLLUPADDISSUBTOTAL` is a `UNION ALL` of the levels; each call is an axis,
and the levels of several are crossed.

**Text** is compared as the engine compares it (a departure from DAX, which compares without
regard to case): by case on DuckDB, by the database's collation on T-SQL. A comparison,
`IN`, a bind and a table filter's membership are plain SQL, as grouping, `DISTINCT` and the
relationships' joins are. The engine can then use its statistics and hash joins on text, and a
measure answers the same whether it is fused into a GROUP BY or stays a subquery. `SEARCH` and
`CONTAINSSTRING` are without regard to case, as they are defined.

**One value as a table.** `VALUES(c)` under a bind on `c` is `onerow(v, exists)`, not a scan.

- `EXCEPT` and `INTERSECT` of it are conditions.
- `CROSSJOIN` with another table is a `prefix`.
- As a filter, it is a bind guarded by its condition.

This keeps measures like the aac model's "days the daily table lacks"
(`EXCEPT(VALUES(dim_calendar[date]), …)` under a group's date) in fused groups. As correlated
subqueries, they took 30 s on 1.6 million rows; as fused groups they take 0.2 s.

**Window functions.** The relation is numbered within its partitions (`numbered`): its
columns, the ORDERBY and PARTITIONBY values, and `ROW_NUMBER`, `COUNT`, `RANK` and
`DENSE_RANK` over them, ties broken by all the relation's columns. The current rows are those
whose columns equal the outer values (`currentRows`); a column with no outer value matches
any of its values in the filter context, through `EXISTS`. INDEX, OFFSET and WINDOW join the
numbered rows to the current rows on position (`windowRows`); RANK and ROWNUMBER read the
current row's number, when there is one current row.

**START AT** is a `WHERE` on the ordered columns: the rows after the values, compared one
column after the other in each column's direction, or equal to them.

**FORMAT.** `format.js` reads a pattern into a description that does not depend on the
engine (sections, digit placeholders, literals; date tokens). `dialects/duckdb-format.js`
writes it:

- The value is bound once with a list comprehension (`[body FOR v IN [value]][1]`), so the
  body can use it many times without computing it again.
- A number is rounded the way Excel and VB do it: to 15 significant digits (`printf('%.14e')`),
  then half away from zero at the shown decimals, in `DECIMAL`. DuckDB's `round` on a `DOUBLE`
  gives 1.00 for 1.005.
- The integer digits are padded and grouped as text, and the fraction's optional digits are
  trimmed with a regular expression.

## Verification

What says the SQL is right is the answers, not the SQL's text:

- **DAX is held to Power BI.** The conformance suite (`conformance/`) is 1,262 queries over five
  models with their data. Power BI's own answers are its goldens, asked over XMLA by the `Oracle`
  workflow and never written by hand. On every push each query is compiled, run on DuckDB, and
  its rows compared with Power BI's. A query that differs is on the engine's known list with
  its reason, a departure by design or a Power BI quirk not copied; one off the list fails the
  run, and so does one on it that matches.
- **The rewrites change no answer.** Every query is compiled twice, with the emitter's rewrites
  (fusion, shared scans, grouping before joins, mappings) and with `optimize: false` (each
  aggregate its own subquery, as the filter context says it), and both run on one DuckDB: the
  rows must be the same, the known queries' too (`agree.mjs`).
- **SQL over the datasets is held to Apache Ossie** (`ossie-query.yml`): its query compliance
  cases, its wide table cases, and a grid of about 2,500 queries each answered by Ossie's view
  expander and by dax-sql on one DuckDB.
- **Each commit is held to the speed of the one before** (`bench.mjs`, `perf.yml`).
- **Unit tests** hold the SQL's shape, the errors, the parser, the T-SQL dialect's text and the
  SQL front end (`npm test`).

A bug found is a probe first: a query in the suite, answered by the Oracle, then the fix.

## Reference

What the README leaves out: the API, what the compiler does, and how.

### The model

`createCompiler` takes dax-sql's model object, which is no file format. Each model holds:

- `tables`: `{ name, source: { schema, entity }, dax, hidden, dataCategory, columns,
  measures, calculationGroup }`. A table has a `source` (a table of the lakehouse; its name
  by default) or `dax` (a calculated table).
  - `columns`: `{ name, type, source, dax, key, nullable, dataCategory, fieldParameter }`.
    `type` is one of `string int double decimal datetime bool variant`. `source` is the
    stored column (its name by default) and `dax` a calculated column's expression.
  - `measures`: `{ name, dax, formatString, sql }`; `sql`, optional, the SQL of the Ossie
    metric the measure was read from, whose rules a query over the datasets follows (its
    `COUNT` is 0 over no rows, `NULLIF(COUNT(..), 0)` is not).
  - `calculationGroup`: `{ precedence, items: [{ name, ordinal, dax, formatString }],
    multipleOrEmpty, noSelection }`.
- `relationships`: `{ name, from: { table, column }, to: { table, column }, active,
  crossFilter, fromCardinality, toCardinality, assumeIntegrity, securityFilter }`. The
  defaults are active, `single`, many to one, no assumption and `single`.
- `roles`: `{ name, filters: [{ table, dax }], hidden: [{ table, column }] }`; `hidden` is
  object-level security, a whole table when `column` is left out.

Only a name, a measure's `dax` and a relationship's ends are required. `src/model.js` says
the same at its top.

A file is read into a model object by a reader in `formats/`, exported as `dax-sql/formats/tmsl.js`,
`dax-sql/formats/tmdl.js` and `dax-sql/formats/ossie.js`. The compiler never imports them.

- `formats/tmsl.js`: `tmslToModel(bim)` reads a TMSL model (`model.bim`, the JSON of Power BI
  and Analysis Services).
- `formats/tmdl.js`: `tmdlToModel(text)` reads a TMDL model, through `tmdlToTmsl(text)`, which
  returns it as TMSL. `text` is one file (the whole model, inside a `createOrReplace` script or
  not, as Fabric publishes a semantic view) or a folder's files (a PBIP's `definition/`: their
  texts as an array, or `{ path: text }`). It reads tables, columns, measures and their
  annotations, partitions, calculation groups, relationships, roles (filters and object-level
  security) and expressions; lineage tags, perspectives and cultures are left out.
- `formats/ossie.js` reads an [Apache Ossie](https://github.com/apache/ossie) model and goes
  both ways between it and TMSL. `ossieToModel(doc)`, `tmslToOssie(bim)` and `ossieToTmsl(doc)`
  take parsed objects, so the YAML is the caller's to parse. A column is a field whose `sql` is
  its source column; a measure is a metric of the dataset it reads, in Ossie's portable SQL
  when it says the same there (`formats/ossie-sql.js`: SUM, AVERAGE, COUNTROWS, DIVIDE, ... over
  one table, BLANK as NULL), and in the DAX dialect when not. Where DAX rounds a fixed decimal
  to four places (`AVERAGE` of one, one divided by a number or times a decimal number), the SQL
  says so: `ROUND(AVG(x), 4)`, `ROUND(SUM(x) / 12, 4)`; back, SQL's own decimals are not rounded
  (`AVG(x)` is the average of `x` as doubles, `SUM(x) / 12` divides a double), and those
  `ROUND(.., 4)` read as DAX's fixed decimal again. A measure made only of measures
  that are such metrics, a ratio of two tables' measures say, is the model's own metric, each of
  them `AGG(dataset.metric)`. Back, a metric or a field in that
  SQL reads as DAX, so a model another tool wrote in SQL opens too. A metric or a field with no
  DAX and no SQL dax-sql reads (another engine's dialect alone, say) is left out, not the model
  refused: `ossieToTmsl(doc, { onSkip })` calls `onSkip({ kind, name, dataset, why })` for each. Such a measure keeps, in an
  `Ossie` annotation, its SQL, the DAX it read as and where it was (a dataset, or the model's
  own `metrics`): `tmslToOssie` puts it back there, as that SQL while its DAX is unchanged (SQL's
  `COUNT` is 0 over no rows, DAX's `COUNTA` blank: the DAX is close, the SQL is what was
  written). A measure changed in Power BI since is translated afresh. The `POWER_BI` extension
  (`nonportable_extensions`, its `data` an object; a file of the spec before, with
  `custom_extensions` and a JSON string, reads the same) keeps only what Ossie has no place for and something needs: what changes an answer
  (a relationship's filter direction, a date table, a calculation group, roles, ...), the
  Direct Lake expression, and what a user sees (hidden, format strings, folders, hierarchies).
  `ossieToTmsl(tmslToOssie(bim))` answers every query as the bim does; it is not the bim.
  `tmslToOssie(bim, name, { source })` takes a table's full name from the caller (a catalog's,
  such as `lakehouse.schema.table`, as Fabric's SQL endpoint names a table): it is the dataset's `source`, and the partition
  and the expression it read are not kept.

### API

```js
import { createCompiler } from 'dax-sql';
import { tmslToModel } from 'dax-sql/formats/tmsl.js';   // or formats/ossie.js for Apache Ossie

const model = tmslToModel(JSON.parse(bimText));           // a model.bim
const dax = createCompiler(model, { tableSource: t => `read_parquet('data/${t.name}.parquet')` });

const { sql, columns } = dax.compile(`
  EVALUATE
  SUMMARIZECOLUMNS('Date'[Year], "Sales", [Sales Amount])
  ORDER BY 'Date'[Year]`);
// sql: one SELECT for the engine; columns: [{ name: 'Year', type: 'int', ... }, { name: 'Sales', ... }]
```

`createCompiler(model, options)` returns:

- `compile(dax)`: one `EVALUATE` returns `{ sql, columns }`. It throws a `DaxError` when the
  query has several `EVALUATE`s.
  It also takes a SQL `SELECT` (or `WITH … SELECT`) over the model ([SQL](#sql)).
- `compileAll(dax)`: every `EVALUATE` of the query, in order. The same text is compiled once
  and then cached.
- `isDax(text)`: whether a text starts with `DEFINE` or `EVALUATE`.
- `isSql(text)`: whether a text starts with `SELECT`.
- `sqlToDax(sql)`: the DAX query a `SELECT` stands for, `{ dax, limit, offset }`.
- `compileStatement(text, name = 'model')`: any SQL of the engine in which a `SELECT` over the
  model is a relation in parentheses, `{ sql, relations: [{ text, dax, sql }] }` ([SQL](#sql)).
  `statementRelations(text, name, aliases)` is the same before they are put in place (semantic
  views put several models' in one statement).
- `fieldParameters()`: the model's field parameters, each with its fields in order.
- `expandFieldParameter(table, labels)`: the fields a selection of a field parameter stands
  for (all of them without `labels`), each `{ label, ref, order, kind, name, tableName }`.
  Power BI resolves a field parameter before it writes the query, so a caller does the same:
  it puts these columns or measures in the query where the parameter goes.
- `explain(query, { optimize })`: the query plan ([The query plan](#the-query-plan)) drawn as
  a tree, one per `EVALUATE`, as it is or optimized; `plan(query, { optimize })` is the plan
  itself (`src/plan.js` says its nodes), and `planSql(query, { optimize = true })` its SQL,
  `{ sql, columns }` as `compile` gives. Each takes a SQL `SELECT` over the model too.
- `model`: the model as read; `dialect`: the dialect it writes.

The package also exports `DaxError`, `Model`, the dialects (`Dialect`, `DuckDBDialect`,
`TSqlDialect`), the parsers (`parseQuery`, `parseExpression`, `parseSql`) and
`modelRelations` (where a statement's model queries are).

`createViews()` keeps **semantic views**: models a SQL engine's users name in their SQL, with
the statements that make, drop and list them. It is engine-neutral: where a view is stored and
how its file is read are the host's (a DuckDB extension keeps them in a table, an editor in its
settings), so every host speaks the same statements.

A view is named in full or in part: `sales` reaches `db.schema.sales` while it's the only one of that name.
`createViews({ fullNames: true })` is for a host whose names are a contract: a statement reaches a view only
by `db.schema.name`, and a shorter name goes to the engine as written.

```sql
CREATE [OR REPLACE] SEMANTIC VIEW [IF NOT EXISTS] [db.][schema.]sales FROM '<path>';
DROP SEMANTIC VIEW [IF EXISTS] sales;
SHOW SEMANTIC VIEWS;
SHOW SEMANTIC DIMENSIONS IN sales [FOR METRIC m];   -- FOR METRIC: the columns that filter m
SHOW SEMANTIC METRICS IN sales;
DESCRIBE sales;
SELECT * FROM (SHOW SEMANTIC METRICS IN sales) WHERE ...;   -- each one reads as a subquery
```

- `define(name, model, { path, db, schema, mode, tablesFrom, ...options })`: a view of a model
  (the readers in `formats/` make one), compiled with `createCompiler(model, options)`. `mode` is
  `create` (an error if the name is taken), `replace` or `if_not_exists`.
- `drop(name, { ifExists })`, `get(name)`, `list()`.
- `rewrite(sql)`: `null` when nothing in the text is a view's; otherwise one entry per statement:
  `{ create: { db, schema, name, path, mode } }` or `{ drop: { name, ifExists } }`, which the host
  carries out (it reads the file and calls `define`, or forgets the view and calls `drop`), or
  `{ sql }` to run. In `sql`, each model query is compiled in place (`compileStatement`) and each
  `SHOW SEMANTIC …` or `DESCRIBE <view>` is its rows, as a `SELECT` over `VALUES`.
- The `SHOW SEMANTIC DIMENSIONS` and `METRICS` columns are `database_name, schema_name,
  view_name, table_name, name, data_type, expression, format_string, hidden, comment`;
  `SHOW SEMANTIC VIEWS` gives `database_name, schema_name, view_name, path, tables_from`;
  `DESCRIBE` gives DuckDB's `column_name, column_type, null, key, default, extra`, with `extra`
  `column` or `measure`.
- Errors are `DaxError`: `SYNTAX` for a statement that does not read, `CATALOG` for a view that
  is missing or already there.

| Option | |
|---|---|
| `tableSource` | `(table) => SQL` naming a model table's rows. Default: its partition's entity, `"schema"."entity"`. |
| `dialect` | `'duckdb'` (default), `'tsql'` (the Fabric SQL endpoint and Warehouse; see T-SQL below), `'postgres'` (PostgreSQL; see below), or an instance of a `Dialect` subclass. |
| `columnNames` | `'short'` (default): the column's or the expression's name. `'dax'`: `Table[Column]`, `[Measure]`. |
| `castOutput` | `true` (default): whole numbers as `BIGINT`, other numbers as `DOUBLE`. Or an object, by the column's type (`int`, `double`, `decimal`, `datetime`, `string`, `bool`), of a function of its SQL: `{ int: s => \`CAST(${s} AS INTEGER)\` }`; a type it leaves out is not cast. |
| `assumeIntegrity` | `true`: every relationship relies on referential integrity, so a dimension key is read off the fact's foreign key without a join. By default only relationships whose `assumeIntegrity` is set (TMSL's `relyOnReferentialIntegrity`) are treated this way. |
| `user` | The value of `USERNAME()` and `USERPRINCIPALNAME()`. |
| `roles` | A role name, or several: row-level security, each table keeping the rows that at least one of the roles keeps; and object-level security, a table or column hidden when every role hides it. A hidden object is no name for the query (naming it, a measure that reads it, a measure of a hidden table: an error, as the model lacked it), while the model still reads it: relationships, joins, and calculated columns computed from it, which stay visible. A table result leaves its hidden columns out. Roles that hide objects together with roles that filter rows are an error, as in Power BI; one role can do both. |
| `params` | The values of the query's parameters (`@name`), by name: numbers, text, booleans, `Date`s or `null` (blank). |
| `optimize` | `false`: every aggregate its own subquery, none fused or shared. Much slower; it is for checking that the rewrites change no answer, as CI does. |

Errors are `DaxError` with a `code`:

- `SYNTAX`: the text is not DAX. The error gives the line and column.
- `SEMANTIC`: valid DAX that is wrong for this model, such as an unknown column or a column
  with no row context.
- `UNSUPPORTED`: valid DAX this compiler does not translate.
- `CATALOG`: a semantic view that is missing or already there.

It never guesses.

### What it does

**The filter context is DAX's.** The compiler carries the filter context while it compiles,
and gives each aggregate the filters that reach its table.

- **CALCULATE and CALCULATETABLE:**
  - Filter arguments are evaluated in the outer context, then context transition happens, then
    the modifiers, then the filters.
  - A filter replaces the filters on its columns, unless it is wrapped in `KEEPFILTERS`.
  - A filter on a date table's date removes the filters on the rest of that table.
  - A True/False filter (`T[c] > 5`) names the model columns of one table. It cannot use a
    measure or `CALCULATE`, nor a column of an outer row that is not one of the model's (an
    iterator's `[Value]`): DAX rejects these, and `FILTER` over a table is the way to write
    them.
- **Modifiers:** `ALL`, `ALLNOBLANKROW`, `ALLCROSSFILTERED`, `REMOVEFILTERS`, `ALLEXCEPT`,
  `ALLSELECTED`, `USERELATIONSHIP` and `CROSSFILTER`. `ALL` on a table clears its expanded
  table, so `ALL(Sales)` also clears the filters on Sales' dimensions; `ALLNOBLANKROW` is `ALL`
  (no blank row). As a table, `ALLEXCEPT(T, c)` is `ALL` of T's other columns, with no filter
  kept.
- **ALLSELECTED** works with shadow filter contexts, as SQLBI's "definitive guide" describes
  them:
  - An iterator (`SUMX`, `FILTER`, `ADDCOLUMNS`, `SUMMARIZE`, …) is a shadow on the columns it
    iterates, holding the values it iterates over. SUMMARIZECOLUMNS is one on the columns it
    groups by, holding their values under its filters on those columns (the query's and its
    filter tables'): `ALLSELECTED(Product[Product])` is every product under a filter on
    `Product[Category]`, and the products of that category among those listed when a filter
    on `Product[Product]` joins it (auto-exist).
  - `ALLSELECTED()` gives every column a shadow covers the filter of the last shadow covering
    it, and leaves the filters on other columns alone. `ALLSELECTED(table)` does the same for
    the table's columns. `ALLSELECTED(column)` gives the column its last shadow's filter, or
    none.
  - As a table, `ALLSELECTED(table)` is the table's rows in that filter context, less the
    filters on tables outside its expanded table (a filter on Product does not narrow
    `ALLSELECTED(Customer)` over a relationship that filters both ways), and
    `ALLSELECTED(column)` is the column's values under its last shadow only (all of its values
    when there is none).
- **Relationships:**
  - A filter reaches a table through many-to-one relationships, read off the expanded table.
  - It also reaches tables through bidirectional and many-to-many relationships, as
    semi-joins. A many-to-many relationship matches values, a blank meeting a blank: a NULL
    on one side meets a NULL on the other.
  - Relationships can be active or inactive. One-to-one relationships filter both ways.
  - `CROSSFILTER` takes a direction by name or number (0 None, 1 OneWay, 2 Both, 3
    OneWay_RightFiltersLeft, 4 OneWay_LeftFiltersRight). As in DAX, a one-to-one relationship
    takes only None or Both, and the many side of a many-to-one one cannot filter the one side
    alone: both are errors.
  - A table filter (`FILTER(Sales, …)`) filters its expanded table, each row with the related
    rows it reached where it was evaluated: `CALCULATETABLE(Sales, USERELATIONSHIP(...))` as a
    filter keeps a sale only where its ship date's row of Date is its order date's too.
- **Row context:**
  - Iterators create row contexts. In context transition, a date table's date replaces the
    filters on the rest of its table, as a filter argument on it does.
  - A measure is its expression under CALCULATE. Its data type is the one DAX declares for
    the measure, which can be wider than the expression's inline: a measure that is `MAXX` of
    text (or an `IF` over one) is a variant, the same `MAXX` written in the query is text.
  - Context transition turns every row context into filters, one on each column of the row.
  - `EARLIER`, `RELATED` and `RELATEDTABLE` work. `RELATED` follows a relationship whichever
    way `CROSSFILTER` makes it filter, but not one it turns off (`None`).
  - SUMMARIZE's expressions have their group as its rows of the table, a table filter (on the
    expanded table, for a model table's rows), besides its values: a filter that removes or
    replaces a grouping column's keeps the group's rows. `ALLSELECTED`, putting back the
    groups' shadow, removes them.
- **Blanks follow DAX's rules:**
  - `BLANK() + 1` is 1, `BLANK() * 2` is blank, `BLANK() = 0` is true and `BLANK() == 0` is
    false.
  - `"x" & BLANK()` is `"x"`.
  - `COUNTROWS` and `DISTINCTCOUNT` of nothing are blank, and `DISTINCTCOUNT` counts a blank
    as a value.
  - `1 / BLANK()` is infinity.
  - `MIN(a, b)` and `MAX(a, b)` compare a blank as 0 (or `""`) and return it: `MAX(-1,
    BLANK())` is blank; of a blank and a value equal to it, the value.
  - `x IN { … }` compares with `==`: a blank member matches only a blank.
  - `RANKX` compares a blank as 0 (or ""): a blank and 0 tie, and `DENSE` counts them as one
    value.
  - `PERCENTILEX.INC/EXC` and `MEDIANX` (`PERCENTILEX.INC` at 0.5) count the blanks among
    the values, first in the order: a rank on a blank is blank, and between a blank and a
    value the blank is 0. `PERCENTILE.INC/EXC` and `MEDIAN` of a column leave its blanks out.
    A `k` out of range (for EXC, outside 1/(n + 1)..n/(n + 1)) is an error.
- **Fixed decimal numbers** (currency) keep their type as DAX types them: `+` and `-` with a
  whole number or another fixed decimal; `*` by a whole or decimal number; `/` and `DIVIDE`
  by one. A product or quotient is rounded to four places, half away from zero, so an amount
  spread by shares sums the rounded shares. Divided by a whole number, the quotient rounded is
  the exact one, worked in ten-thousandths: a decimal number's quotient can fall just short of
  a half (1.0001 / 2 is 0.50005, which rounds to 0.5001, not 0.5000). Two fixed decimals
  multiplied or divided, or one plus a decimal number, are a decimal number. `AVERAGE(X)` of
  fixed decimals is one, rounded the same way. A fixed decimal past its range (a 64-bit count
  of ten-thousandths) is an error.
- **`IF` and `SWITCH` are typed by all their branches**, before anything is evaluated: a
  fixed decimal in one branch and a decimal number in another make a decimal number, also
  where the compiler knows the condition (`ISFILTERED`, `ISINSCOPE`) and keeps one branch. So
  a measure `IF([Detailed], SUMX(T, T[Price] * T[Factor]), [Daily] + 0.5)` is a decimal
  number, and `DIVIDE` of it by another number is not rounded to four places, though the
  branch it takes is a fixed decimal. A branch left out is compiled for its type only. A
  condition that is a constant (`TRUE()`, `1 = 2`: literals, and operators and functions of
  values on them, with no column, measure, variable or parameter) is settled first, as DAX
  folds it before typing: the `IF` is the branch it takes, of that branch's type, and the
  branches a constant rules out of a `SWITCH` do not type it.
- **SUMMARIZECOLUMNS:**
  - Its groups are the key combinations that exist within each table, and every combination
    across tables.
  - A filter table on another table does not limit a table's keys, even when it reaches that
    table: by `Product[Name]` under a filter on `Category[Category]`, every product is a
    group, kept when one of its expressions is not blank. Filter tables on the table's own
    columns do (auto-exist).
  - A group whose expressions are all blank is left out (`IGNORE` excludes an expression from
    that test).
  - Filter tables, `ROLLUPADDISSUBTOTAL`/`ROLLUPGROUP`, and `ISINSCOPE` are supported.
  - A filter table wrapped in `NONVISUAL` filters the groups and the expressions, but is not
    part of the selection: `ALLSELECTED` removes it.
- **No blank row** (a departure from DAX): when some rows of a fact table have a key that
  matches no row of a dimension, DAX adds a blank row to the dimension. Here `VALUES`, `ALL`,
  `ALLSELECTED` and the groups of SUMMARIZECOLUMNS are the dimension's own rows, so
  `ALLNOBLANKROW` is `ALL` and `DISTINCT` is `VALUES`. Such fact rows still count in a total,
  and in no group by the dimension's columns. A blank in a table
  filter matches a NULL stored in a column (`TREATAS({BLANK()}, Sales[CustomerKey])` keeps the
  sales with no customer key).
- **Dates as numbers:** a date plus or minus whole days is a date; plus any other number, a
  date and time (`DATE(2024, 1, 1) + 0.5` is noon). A date minus a date is the days between
  them, with the fraction a time makes (a departure from DAX, which types it a date and time
  after 1899-12-30).
- **TOPN** keeps rows tied with the last one. **ORDER BY** puts blanks first when ascending.
- `DEFINE MEASURE`, `DEFINE VAR`, `DEFINE TABLE` and `DEFINE COLUMN` are supported, as are
  several `EVALUATE`s and lazy `VAR`s. Calculated columns are evaluated per row in an empty
  filter context. A `DEFINE COLUMN` is one for the query: a column of its table while the
  query is compiled (to group by, filter, or clear with `ALL` of the table), computed as the
  model's are, but with the query, so under its row-level security.
- **`START AT`** after `ORDER BY` starts the rows at the given values, compared in the order's
  columns and directions as a whole (the first value first, then the next among ties). The
  values are constants or query parameters (`@name`, from `options.params`).

**The model's features.**

- **Calculated tables** are their expression, evaluated once in an empty filter context and
  without row-level security, as Power BI evaluates them when it refreshes the model. Their
  columns are their own: relationships to and from them work like any table's.
  `CALENDARAUTO` takes the years of the model's dates.
- **Calculation groups:**
  - The item the filter context selects replaces a measure, with `SELECTEDMEASURE()` standing
    for the measure. Several groups apply from the highest precedence, outermost.
  - When the selection is only known at run time, the measure has a branch for each item that
    can be selected there. For example, iterating `VALUES` of the group's column under a
    filter of some items has branches for those items only.
  - An item is applied once: under it, measures (those the measure refers to, and those the
    item names) do not get it again. Another item of the group selected inside it does apply
    (sideways recursion), as in a "YOY" item that computes
    `CALCULATE(SELECTEDMEASURE(), 'Time Calc'[Time Calc] = "PY")`.
  - Grouping by the group's column evaluates each item on its row.
  - Only a filter on the group's name column selects an item. One on its ordinal alone
    (grouping by the ordinal, `TREATAS` of ordinals) selects none: the measure is evaluated
    as it is (or the no-selection expression is), while `VALUES` of the group sees the filter.
  - `multipleOrEmptySelectionExpression` and `noSelectionExpression` are used when set. A
    selection of several items without them leaves the measure as it is.
  - `SELECTEDMEASURENAME`, `SELECTEDMEASUREFORMATSTRING` and `ISSELECTEDMEASURE` work.
  - A column aggregated directly (`SUM(Sales[Amount])` in a query) is not a measure, so no
    item applies to it, as in DAX.
- **Field parameters** are calculated tables of `NAMEOF`s; the table works as a table. What a
  selection of one stands for is resolved by `expandFieldParameter`, as Power BI does it
  before the query.
- **Row-level security** (`options.roles`):
  - Each role's table filters keep that table's rows, and reach other tables along
    relationships as other filters do, onward from table to table.
  - A relationship carries them as its security filtering says: from the one side to the
    many side, both ways, or not at all. A many-to-many relationship carries them too.
    Security alone does not filter back over a relationship that filters both ways only for
    the query's filters.
  - With several roles, a table keeps the rows that some role keeps.
  - `ALL` and the other modifiers do not bring back rows that security removes.
  - A `CROSSFILTER` that lets a secured table's rows reach a table a second way (Category
    secured, and Subcategory made to filter Category back) is an error, as in DAX: its join
    paths must form a tree. It is one only where the filter does come back, when the query
    filters the table it comes back from by more than the secured table (the subcategory
    grouped by, say).
  - Calculated tables and the model's calculated columns are computed without security, as at
    refresh. A `DEFINE COLUMN` is computed with the query, under security.

**Functions.**

- **Aggregates and iterators:** `SUM`, `AVERAGE(A)`, `MIN(A)`, `MAX(A)`, `COUNT(A/BLANK)`, `COUNTROWS`,
  `DISTINCTCOUNT(NOBLANK)`, `PRODUCT`, `MEDIAN`, `STDEV.S/P`, `VAR.S/P`, `PERCENTILE.INC/EXC`;
  their X forms; `CONCATENATEX` and `RANKX`.
- **Filter context:** `CALCULATE`, the modifiers above, `ISFILTERED`, `ISCROSSFILTERED`,
  `ISINSCOPE`, `HASONEVALUE`, `HASONEFILTER`, `SELECTEDVALUE`, `FILTERS`, `LOOKUPVALUE`,
  `CONTAINS`, `CONTAINSROW`, `ISEMPTY`, `IN`.
- **Window functions:** `INDEX`, `OFFSET`, `WINDOW` (`ABS` and `REL`), `RANK` (`DENSE` and
  `SKIP`) and `ROWNUMBER`, with `ORDERBY` (and its `ASC BLANKS LAST` kind of order),
  `PARTITIONBY` (columns of the relation: not a related table's, nor one a table function
  added, which DAX rejects), `MATCHBY`, and the blanks argument.
  - The current row is the row of the relation whose columns hold the outer values: those of
    a row context, or the value the filter context fixes a column to (a group, or a context
    transition). RANK finds it as the others do, by all the relation's columns (or the
    `MATCHBY` and `PARTITIONBY` ones), not by the `ORDERBY` columns alone: when more than one
    row of the relation is current, RANK is blank, even if those rows tie in the order.
  - A column with no outer value takes each of its values in the filter context, and the
    result is the union over them, as DAX does it.
  - Without a relation, the relation is `ALLSELECTED` of the `ORDERBY` and `PARTITIONBY`
    columns.
  - For the other functions, ties in `ORDERBY` are broken by the relation's other columns,
    as DAX does. `ROWNUMBER` over rows that are entirely equal numbers them in an arbitrary
    order, where DAX raises an error.
- **Visual calculations:** a `DEFINE TABLE … WITH VISUAL SHAPE` (axes of `GROUP … TOTAL`
  levels, `ORDER BY`, `DENSIFY`) and the `DEFINE COLUMN`s on it (`functions/visual.js`).
  - The table is its rows, with `DENSIFY`'s the cells its axes cross that it lacks; each
    column is added in turn, and the columns come first.
  - In a column, a window function with no relation is over the visual's rows on one axis
    (`ROWS`, `COLUMNS`, the first by default): those in the row's place on the other axes and
    at its level, in the axis's order. A reset narrows them to one parent's: `HIGHESTPARENT`
    or N, the first N groups; `LOWESTPARENT` or -N, the groups down to N above the row's.
    DAX rejects a reset with an `ORDERBY` or a `PARTITIONBY`.
  - `RUNNINGSUM`, `MOVINGAVERAGE`, `PREVIOUS`, `NEXT`, `FIRST` and `LAST` are `WINDOW`,
    `OFFSET` and `INDEX` over those rows; `COLLAPSE` and `COLLAPSEALL` are the value at the
    parent and the grand total; `ISATLEVEL`, whether the row is not a total of a column's
    group. `EXPAND` of a column is an error, as in DAX; other `EXPAND`s and `EXPANDALL` are
    not supported.
- **Tables:**
  - building and shaping: `FILTER`, `VALUES`, `DISTINCT`, `ALL…`, `SUMMARIZE`,
    `SUMMARIZECOLUMNS`, `ADDCOLUMNS`, `SELECTCOLUMNS`, `GROUPBY`/`CURRENTGROUP` (the table of
    `SUMX`, `AVERAGEX`, `MINX`, `MAXX`, `COUNTX`, `COUNTAX`, `PRODUCTX`, `STDEVX` and `VARX`
    only: not `CONCATENATEX`, say), `TOPN`,
    `TOPNSKIP`, `ADDMISSINGITEMS`; `ROLLUP`/`ROLLUPGROUP` and `ISSUBTOTAL` in `SUMMARIZE`;
  - combining: `CROSSJOIN`, `UNION`, `INTERSECT`, `EXCEPT`, `GENERATE(ALL)`, `TREATAS`,
    `NATURALINNERJOIN`, `NATURALLEFTOUTERJOIN` (on the columns of the same lineage, or of the
    same name for columns without one, a blank matching a blank; columns of the same name with
    different data types are an error; `MINX` and `MAXX` of text are text, but a measure of
    them, alone or in an `IF`, is a variant, as DAX declares it),
    `SUBSTITUTEWITHINDEX`;
  - constructing: `ROW`, `DATATABLE` (each value of its column's declared type), `{ }`,
    `GENERATESERIES`, `CALENDAR`, `CALENDARAUTO`;
  - `FIRSTNONBLANK`, `LASTNONBLANK`, over a column or a table of one column; no row when
    every value's expression is blank.
- **Time intelligence:**
  - `DATESYTD/QTD/MTD`, `TOTALYTD/QTD/MTD`, `DATESBETWEEN`, `DATESINPERIOD`;
  - `DATEADD` and `DATESINPERIOD` (from the last day of a month to the end of the moved
    month; for `DATEADD` and `SAMEPERIODLASTYEAR`, only a month end whose day before is in
    the dates too: February 28 alone moves to February 28), `SAMEPERIODLASTYEAR`,
    `PARALLELPERIOD`, `PREVIOUS/NEXT DAY/MONTH/QUARTER/YEAR`;
  - `STARTOF…`, `ENDOF…`, `FIRSTDATE`, `LASTDATE`, `OPENING/CLOSINGBALANCE…` (as `CALCULATE`
    of the period's date and the filter argument: a filter on the date table is kept);
  - a year end (`"6/30"`) on the functions of a year that take one.
- **Values:** logic (`IF`, `SWITCH`, `COALESCE`, `DIVIDE`, …), math, text, dates, `CONVERT`,
  `NAMEOF`.
- **Parent-child hierarchies:** `PATHLENGTH`, `PATHITEM`, `PATHITEMREVERSE` (`TEXT` or
  `INTEGER`) and `PATHCONTAINS`, over a path column of the source. `PATH` is not (it needs
  recursion).
- **FORMAT** writes numbers and dates as DAX does in en-US:
  - the named formats: `General Number`, `Currency`, `Fixed`, `Standard`, `Percent`,
    `Scientific`, `Yes/No`, `True/False`, `On/Off`, `General Date`, `Long Date`, `Medium
    Date`, `Short Date`, `Long Time`, `Medium Time`, `Short Time`;
  - custom number patterns: `0` and `#`, the point, thousands separators, a comma before the
    point or at the end of the integer digits dividing by 1000 (after the fraction's digits it
    is nothing), `%`, `E+ E- e+ e-`, literals (`"text"`, `\c`, also between the digits as in
    `(###) ###-####`), and up to three sections (positive; negative; zero), a negative value
    that rounds to zero showing the zero section;
  - rounding at 15 significant digits, then half away from zero (`FORMAT(1.005, "0.00")` is
    `1.01`);
  - custom date patterns: `d` to `dddddd`, `w`, `ww`, `m` to `mmmm`, `q`, `y`, `yy`, `yyyy`,
    `h`, `hh`, `n`, `nn`, `s`, `ss`, `ttttt`, `c`, `AM/PM`, `am/pm`, `A/P`, `a/p`, `AMPM`; `m`
    right after an hour is minutes;
  - a blank is `""` (so a measure that is FORMAT is never blank, and SUMMARIZECOLUMNS keeps
    every group, as in DAX); a date with a number pattern is its serial number.
  - `Percent` is `0.00%`, without thousands separators.
- **FIXED** is FORMAT with `#,##0.00` (or `0.00` with no_commas, and the given decimals, which
  are constants); a blank is 0.
- **Values as text** (`&`, `COMBINEVALUES`, the text functions) follow DAX too: `0.1 + 0.2` is
  `0.3` (15 digits), `1E+20`, `TRUE` is `TRUE`, and a date is `1/5/2024`, with its time when it
  has one.
- **Text functions and blanks:** `LEN`, `TRIM` and `PATHLENGTH` of a blank are blank (of `""`,
  0, `""` and 0). `FIND` and `SEARCH` read a blank as `""`: nothing is found in it, so they
  return the NotFoundValue.
- **Stored text keeps its trailing spaces, by design:** the model drops them as it loads the
  data (`"a "` is `"a"`, in its value, its length, filters and relationships); here a column is
  read as the data has it. Trimming every row of every scan costs more than the difference is
  worth (15-20% of a fact scan joined on a text key), as comparing text by DAX's rules does.

### SQL

A `SELECT` over the model is a DAX query (`sql.js`). The translator builds the query's syntax
tree, the one `parser.js` builds for DAX, and the compiler takes it as it takes a parsed
DAX query: one plan, two languages, as Spark's SQL and DataFrames build the same logical plan.
No DAX text is written on the way; `sqlToDax` prints the tree as DAX for a log to show, and
parsing that text gives the same tree (a test holds it).

```sql
SELECT Product.Color, AGG(Orders) AS orders
FROM model
WHERE Customer.City IN ('Paris', 'Lyon')
GROUP BY ALL
HAVING orders > 2
ORDER BY orders DESC
LIMIT 10
```

- **SELECT:** columns to group by, and expressions of aggregates: `AGG(m)` or `MEASURE(m)` is
  measure `m`; `SUM`, `AVG`, `MIN`, `MAX`, `COUNT` and `COUNT(DISTINCT …)` aggregate a column.
  An aggregate's column is named by its alias, else by its measure, else by its text. A
  constant (`'orders' AS what`, an expression of literals) is a column of every row, added to
  the result (`SELECTCOLUMNS`): it keeps no group the aggregates leave out.
- **Names:** `table.column`, a measure as `AGG(Orders)` or
  `AGG(Sales.Orders)`, a column's name alone when one table has it. A name with spaces is
  quoted with double quotes (`AGG("Sales Amount")`), or `[brackets]`; single quotes are text, so
  `AGG('Sales Amount')` is an error. DAX's `'Table'[Column]` works too. `FROM` names the model.
- **WHERE** is `CALCULATETABLE`'s filters, one per condition joined by `AND`: a True/False
  filter on one table's columns, or `FILTER` of the columns it names. It has no aggregate.
- **GROUP BY ALL** groups by the SELECT's columns; `GROUP BY` can list them (names, positions,
  or other columns). The groups are `SUMMARIZECOLUMNS`', so a group whose aggregates are all
  blank is left out. Without `GROUP BY` the result is one row (`ROW`).
- **ROLLUP:** `GROUP BY a, ROLLUP(b)` adds the subtotal rows over `b`
  (`ROLLUPADDISSUBTOTAL(b, "name")`); a level in parentheses rolls its columns up together
  (`ROLLUP((b, c))`, `ROLLUPGROUP`), and several levels are DAX's hierarchy of them. Each level
  is named by a `GROUPING(col) AS name` of the SELECT, `col` one of its columns: the subtotal
  rows' flag, a True/False as DAX has it (not SQL's 1/0).
- **HAVING** is a `FILTER` of the groups. It reads the SELECT's names and aggregates, the
  groups' columns, and measures the SELECT leaves out, on each group (context transition).
- **ORDER BY** is DAX's, by the result's columns (names, positions) or aggregates, blanks first
  ascending. **`ORDER BY ALL [ASC|DESC]`** is by every column, left to right. **LIMIT** and **OFFSET** are the SQL's, and `FETCH FIRST n ROWS ONLY` is
  `LIMIT n`. **`FETCH FIRST n ROWS WITH TIES`** is `TOPN(n, …)` on the ORDER BY's keys, which
  keeps the rows tied with the n-th.
- Conditions: comparisons, `AND`, `OR`, `NOT`, `IN`, `BETWEEN`, `IS NULL` (`ISBLANK`), `LIKE`
  (`'x'`, `'x%'`, `'%x'`, `'%x%'`), `CASE`, `CAST` (`AS DATE` drops the time), `DATE '…'`,
  `TIMESTAMP '…'`, `||` (below `+` and `-`, as in PostgreSQL), `%` (SQL's remainder, the sign of
  the dividend), `LOG(base, x)`, `TRIM` (the ends only, as SQL's); other functions are DAX's of
  the same name. Values compare as in DAX: text by case (as the engine compares it), a blank
  equal to 0 or `""`.
- A measure keeps its definition: nothing changes the filter context but `WHERE`. Over the
  model (`FROM model`), `SELECT *`, `DISTINCT`, joins, subqueries, `UNION`, window functions
  and `COUNT(*)` are not supported; over its datasets, joins and subqueries are (below).

**Over the model's datasets.** A `FROM` that names the model's tables (`emp`, or
`scott_model.emp`, each with an optional alias) instead of the model reads them as the
relations of Apache Ossie's
[Relational Query Interface](https://github.com/apache/ossie/blob/main/core-spec/relational_semantics.md):
each table's measures are columns of it, evaluated by `AGG(e.m)`. The rules are SQL's, where
they differ from a DAX query's:

- The groups are those of the rows: a group whose measures are all blank is kept. A measure
  that counts (`COUNTROWS`, `COUNT`, `DISTINCTCOUNT`, ...; an Ossie metric whose SQL is a
  `COUNT`) is 0 over no rows, not blank, in the result and inside an expression or `HAVING`
  alike; an expression of aggregates makes no group of its own.
- A comparison (`=`, `<`, `IN`, `BETWEEN`, ...) with a NULL is not true, in `WHERE`, `ON` and
  `HAVING`: DAX's blank equals blank, 0 and `""`, so a manager-less employee would join a pet
  with no owner. `NOT` of one is not true either (three-valued logic), nor is `x = NULL`,
  `x NOT IN (1, NULL)`, `x NOT LIKE 'a%'` of a NULL `x`, or `x NOT IN (SELECT …)` when the
  subquery has a NULL; `NULL + 1`, `NULL - 1`, `1 / NULL`, `NULL % 2` and `NULL || 'a'` are
  NULL; `NULLIF` and `WHERE FALSE` work as SQL's.
- Joins (`JOIN`, `LEFT`, `RIGHT`, `FULL`, `CROSS`, on any condition, a table joined to itself)
  never repeat a row of a measure: `AGG(e.m)` is `m` over the rows of `e`'s table that the
  group's joined rows come from, each once, and none for the rows an outer join pads.
- `WITH`'s queries, and subqueries in `FROM` that only pass rows through, are put in place:
  their relations join the query's, their `WHERE` is its (not supported when a later `RIGHT`
  or `FULL` join pads the subquery's rows), and a measure keeps its identity when renamed. A join to a subquery whose columns only its `ON` reads is a filter of the
  other side (a top N, a list of keys). A scalar subquery is computed once, outside the query's
  filters; `IN (SELECT ...)` too.
- `ROLLUP` needs no `GROUPING` in the `SELECT`; `NULLS FIRST` and `NULLS LAST` sort either way;
  `GROUP BY` takes expressions (`EXTRACT(YEAR FROM hiredate)`).

One table grouped by its columns is the `SUMMARIZECOLUMNS` above, with the table's rows
counted beside the measures so that the groups are its rows'. So is a star: joins along the
model's relationships from one root to their one sides (`emp JOIN dept ON e.deptno =
d.deptno`), by `INNER JOIN` or a `LEFT JOIN` that adds a one side, which repeat no row of the
root. The root's rows are the groups'; another table's measure is `CALCULATE(m, root)`, its
rows those the root's reach; an `INNER JOIN` keeps the root's rows whose key the one side
has. `one LEFT JOIN many` is one too, grouped by the one side's columns, the many side's
measures over its rows that match one (the one side's key not blank) and that the `ON`'s
other conditions keep. Anything else follows the
spec's reference strategy (Section 9), in DAX: the joined rows are a variable of the query
(`GENERATE`, `GENERATEALL` of `FILTER`s on each `ON`, each relation's columns named
`alias.column`), the groups their distinct values, and each measure a `CALCULATE` of it under
`TREATAS` of its table's primary key, as the group's rows hold it. A table in a join needs a
key: its dataset's `primary_key`. Apache Ossie's query compliance cases (`compliance/query`)
run against this in `.github/workflows/ossie-query.yml`.

**In a statement of the engine's SQL** (`compileStatement`), a `SELECT` over the model is a
relation: in parentheses, wherever the engine takes a subquery (a `WITH`'s query, `FROM`, an
arm of a `UNION`, `IN`), or an arm of a `UNION` without them (up to the `ORDER BY` of the
whole, after the last arm). Each one is compiled as above and its SQL put in its place; the
rest is the engine's SQL, passed through as written, so it can join, union, window or filter
what the model answers with its own tables. The model is not a table: a measure has no value
until the groups are chosen, so there is no view of it, and it is named only as the `FROM` of
such a `SELECT` (`JOIN model` is an error); `model.dataset` names the model too. The scanner
reads only what nesting depends on (strings, quoted names, `$$` strings, comments,
parentheses), so `FROM model` in a string or a comment is text. A `SELECT` over the model
reads no column of the statement around it. On T-SQL, which nests no `WITH`, the model
queries' CTEs are one `WITH` at the top of the statement, an ordered one takes `OFFSET 0 ROWS`,
and an arm of a `UNION` is a named subquery.

```sql
WITH m AS (SELECT Product.Color, AGG(Orders) AS orders FROM model GROUP BY ALL)
SELECT m.*, p.n FROM m JOIN (SELECT "Color", COUNT(*) AS n FROM "Product" GROUP BY ALL) p USING ("Color")
```

### How it works

`src/`, in the order a query goes through it:

| File | |
|---|---|
| `index.js` | the API: `createCompiler`, `createViews` |
| `lexer.js`, `parser.js` | DAX text into a syntax tree |
| `sql.js` | a SQL `SELECT` over the model into a DAX query; a statement's model queries |
| `views.js` | semantic views: their statements, and the models named in SQL |
| `model.js` | the model object read: tables, columns, measures, relationships; expanded tables and filter propagation |
| `compiler.js` | the tree into an intermediate form, with the filter context as a value |
| `context.js` | the filter context: its filters, and what removing columns leaves of them |
| `functions/` | the function library, by kind |
| `ir.js` | the intermediate form: scalars, tables, rows, aggregates over scans |
| `emit.js` | the intermediate form into SQL, rewritten |
| `lower.js`, `plan.js` | the intermediate form into the query plan, and the plan's nodes |
| `passes/` | the optimizer: passes over the query plan (`decorrelate.js`) |
| `plan-sql.js`, `explain.js` | the query plan as SQL; drawn as a tree |
| `format.js` | FORMAT's patterns, read into what a dialect writes |
| `dialects/` | what differs between SQL engines: `base.js` (the interface), `duckdb.js`, `duckdb-format.js`, `tsql.js`, `tsql-format.js`, `postgres.js`, `postgres-format.js` |
| `errors.js` | `DaxError` and its codes |

The SQL it writes:

- An aggregate is a scalar subquery over its table's rows under its filters, correlated to the
  rows it reads; DuckDB decorrelates those subqueries.
- The aggregates of SUMMARIZECOLUMNS and ROW are fused where they can be. Those over the same
  table under the same filters become one `GROUP BY` in a CTE, joined to the groups.
- `VALUES` of a column the context binds to one value is that value, not a scan. That turns
  per-group subqueries like the aac model's "days the daily table lacks" into fused groups.
- A filter of a column's values with conditions on that column alone, like
  `FILTER(ALL('Date'[Date]), 'Date'[Date] >= x)`, is a condition on the scan's own row when
  every row has a value of that column: the scan's own column, or one reached over
  relationships that rely on referential integrity. There is no subquery, so the engine can
  skip the rows the condition rules out.
- A total over the rows of a fused group, like `CALCULATE(x, ALLSELECTED(…))` next to `x` by
  group, is the group's values added up, not a second scan: by none of its keys or by some
  (a share within a date and time), from a level before (a subtotal), and with filters of its
  own on the joined tables. This holds for sums, counts, minima, maxima and averages.
- Aggregates by the same keys whose filters differ on the joined tables share one scan, each
  with its `FILTER`.

To add an engine, extend `Dialect` in `src/dialects/base.js` (it lists the functions and
aggregates to write) and pass an instance as `dialect`.

### T-SQL

`dialect: 'tsql'` writes T-SQL for Microsoft Fabric's SQL analytics endpoint and Warehouse,
tested on a lakehouse's SQL analytics endpoint. The DuckDB SQL is the same with or without it: the emitter asks the dialect for
what it wrote itself (conditions and boolean values, `NULLS FIRST/LAST`, `LATERAL`, `||`, a
window's `ORDER BY`), and DuckDB's answers are what the emitter wrote before.

**What it writes differently**

- **No boolean type:** a boolean value is a `BIT`, a condition is `(x = 1)`, and FALSE where
  unknown is `(CASE WHEN c THEN 1 ELSE 0 END = 1)`.
- **Text:** compared as the database's collation compares it (a lakehouse's text is binary
  UTF-8, so by case there), and exactly whatever the collation (FIND, SUBSTITUTE, EXACT) with
  `Latin1_General_100_BIN2_UTF8`. A literal with trailing spaces is cast: Fabric drops them
  otherwise, in a query over a table.
- **The rest:** `OUTER`/`CROSS APPLY` for `LATERAL`; a CASE inside an aggregate for `FILTER`;
  `OFFSET … FETCH` for `LIMIT`; typed blanks (`IN` over an untyped NULL keeps nothing on Fabric).

**Fabric runs some correlated subqueries as loops**, where DuckDB decorrelates them all. For
T-SQL the emitter avoids those shapes (a RANKX of 121 rows took over 300 s, and under 1 s so):

- `COALESCE((SELECT …), <a blank>)` is `ISNULL`, which Fabric decorrelates.
- A subquery in a CASE's branch is a row the CASE reads.
- An aggregate's argument is computed a row at a time first: T-SQL aggregates no subquery and
  no outer column beside its own.
- A table filter of a table's own rows is their conditions, when the columns it keeps
  determine the others (a related table's by its key or the foreign key; a calculated column by
  its table's stored ones): a SUMMARIZE's extension columns.
- The measures an iterator's rows take over their own values are fused into a GROUP BY joined
  to the rows, as SUMMARIZECOLUMNS' are, for a row of a few columns that reads no outer row.

**Fabric computes again what the SQL writes again**: a CTE at each name, a subquery at each
copy. DuckDB names a value once (`[… FOR x IN [v]][1]`) and reads a CTE once; for T-SQL:

- A value a function names more than once (a fixed decimal's rounding, a blank-aware sum, a
  date as text) is written once, in a row the function reads: nested, it grew the SQL at each
  level (a price change was 434 KB, 30 KB so).
- SUMMARIZECOLUMNS whose groups are one fused group's reads that group, not the group joined to
  its own keys.
- A table-reading subquery that a row's values write more than once (a measure in a column and
  again in another's DIVIDE) is a column of an `OUTER APPLY`, computed once a row.

A table filter of a table's own rows is their conditions on DuckDB too: as a semi-join it
joined the table to itself on every column (a SUMMARIZE with a measure by year and category
took 40 s over a million rows, 1 s so).

The last two are DuckDB's too (a `LATERAL` join): it plans a subquery at each copy, and a
calculation group's items, each a `CASE` over the same measures, were 344 scans of one table
(43 s on the test data, 5 s so). Values of more than 2 MB are left as written.

In both dialects, a filter table that is a VAR (as Power BI names each filter of a visual) is
read as the same table written in place: `FILTER(KEEPFILTERS(VALUES(T[c])), …)` is its
conditions on the scan, and `TREATAS({"AR", "CA"}, T[c])` is `c IN ('AR', 'CA')`, which the
engine can apply as it scans.

**By design**, where T-SQL can't do what DAX does:

- `1 / BLANK()` is blank: T-SQL has no infinity.
- A sum (and an average) of floating-point values is an exact decimal sum, the same in any
  order: Fabric adds FLOATs in an order of its own each time, so one measure written twice (a
  RANKX's row and the rows it ranks) could differ in its last digit. 0.1 + 0.2 is 0.3 here.

What T-SQL has no function for is written with what it has:

- **FORMAT** with a pattern (`tsql-format.js`): the same rules as DuckDB's, the value rounded to
  15 significant digits and then at the pattern's places as a DECIMAL; the integer digits and a
  date's parts through Fabric's `FORMAT`, with DAX's tokens as .NET's.
- **SUBSTITUTE with an instance number**: that many `CHARINDEX`es, each from just past the one
  before, and a `STUFF`. The number is a constant (T-SQL splits no text on a text), up to 64.
- **PERCENTILE.EXC, PERCENTILEX and PERCENTILE.INC with a k that is not a constant**: the values
  as a JSON array (`STRING_AGG`), read back in order by a subquery (`OPENJSON`, numbered), and
  the two around the rank interpolated. Not an ordered aggregate: Fabric takes no two of them
  with different orders in one SELECT.

`conformance/engines/dax-sql-tsql` runs the suite on a Fabric lakehouse's SQL endpoint, with its
known list (DuckDB's that T-SQL shares, the PATH queries, infinity and an exact sum), over the suite's data as the
lakehouse's own Delta tables (`lakehouse.py` writes them with delta-rs, in schema `daxconf`):
the tables a model reads, run by Fabric's distributed engine. It has its own driver, so the
package depends on nothing new. `tsql.yml` runs it on each push that changes the compiler or the
suite, signed in as the Oracle is (an OIDC federated login); a query has 30 s to answer.

### PostgreSQL

`dialect: 'postgres'` writes PostgreSQL's SQL (tested on 17). It has what DuckDB has but `QUALIFY`
(a SELECT around the window) and lists (an array, or a value bound in a subquery's row), and it
runs a correlated subquery as a loop, as Fabric does, so the emitter fuses rows, hoists repeats and
aggregates over a SELECT of a subquery as for T-SQL. Where PostgreSQL differs from DuckDB:

- A blank-safe join key is `ARRAY[CAST(a AS t)] = ARRAY[CAST(b AS t)]` (an array's `=` takes NULL
  for equal to NULL, and is hashed): `IS NOT DISTINCT FROM` it joins in a loop.
- A constant is computed when the query is planned, in a branch never taken too: `ERROR`'s
  failing cast reads its message under `random()`.
- `/` of two whole numbers is a whole number and a division by zero an error: both are written
  out (a double's division; infinity or NaN for zero, as on DuckDB).
- A NULL in a subquery's column is TEXT, which no UNION arm of a number matches: a blank where a
  column is (a subtotal's key, a measure blank at a level) is cast to the column's type.
- An aggregate belongs to the query whose columns it reads, so one over a subquery that reads an
  outer row is over a SELECT of it.
- Text is compared and sorted as the database's collation does: `C` gives DuckDB's code-point
  order.

`conformance/engines/dax-sql-postgres` runs the suite on a PostgreSQL server, the data copied in
from DuckDB's reading of the CSVs (the same values, of the same types), with its own known list
(DuckDB's, an expression of blanks only that PostgreSQL types as text, and three queries past
10 min: a subquery of each group the mapping does not reach yet, as on Fabric). `postgres.yml`
runs it on each push that changes the compiler or the suite, on a `postgres:17` service with
`--locale=C`: the answers are checked, and the slowest queries reported (a query has 5 min).

### Tests

```sh
npm install   # DuckDB for Node, for the tests only
npm test
```

`npm test` runs `test/*.test.js` and `formats/test/*.test.js`:

- `smoke.test.js`, on a small sales model (`test/fixtures/contoso.js`): representative queries
  compile and run on DuckDB, with and without roles; errors carry their codes; the SQL keeps
  its shape (a filter inline on the fact, a selected total read off the groups).
- `belowjoins.test.js`: a fact's sums and counts grouped by its keys before its joins answer
  as the joins do.
- `sql.test.js`: each SQL query answers what its DAX query answers; its errors carry their
  codes; `compileStatement`.
- `datasets.test.js`: SQL over the datasets answers what plain SQL over the same tables does
  (NULLs, joins, `IN` and `LIKE`, `CAST`, `%`, `WITH TIES`).
- `views.test.js`: semantic views' statements, run on DuckDB.
- `explain.test.js`: the query plan as drawn, and its SQL answering as the compiled SQL does.
- `tsql.test.js`: every conformance query is T-SQL with nothing Fabric lacks, or refused by
  name; the shapes Fabric needs.
- `formats/test/formats.test.js`: TMSL to Ossie and back answers every measure as the TMSL
  does, on DuckDB, for contoso and aac (`conformance/models/aac`, whose `ossie.yaml` is its
  `model.bim` as Ossie); which measures are SQL and which DAX; what the extension may hold; a
  file of the earlier shape, and one of the spec before, reads as it did; an Ossie model in SQL
  reads as DAX, `AGG`, `source.column` and `ROUND` included.

In CI:

- `conformance.yml`: the suite against Power BI's goldens (`conformance/`), and
  `conformance/engines/dax-sql/agree.mjs`: every query of the suite compiled with the emitter's
  rewrites and with `optimize: false`, run on one DuckDB: the rows must be the same, on the
  known queries too. A release waits for it. Its `plan` job runs the suite through the query
  plan's SQL, as it is (`DAXSQL_PLAN=raw`) and optimized (`DAXSQL_PLAN=1`), against the same
  known list; `postgres.yml`'s `plan` job runs it optimized on PostgreSQL, and reports.
- `perf.yml` (`conformance/engines/dax-sql/bench.mjs`): every query timed by the commit and by
  the one before, on one runner, the fastest of three rounds each: more than 10% slower in all,
  or a query 1.5 times as slow and 50 ms more, fails.
- `ossie-query.yml` (Python and Ossie's main): Ossie SQL held to Ossie as DAX is to Power BI.
  Ossie's query cases (`formats/test/ossie-query.mjs`), the wide table cases' Layer 2 queries
  (`ossie-wide.mjs`), and Ossie's view expander as an oracle (`ossie-expand.mjs`): a grid of
  about 2,500 queries over SCOTT, Ossie's retail and stores, and every model in
  `conformance/models` written as Ossie (totals, groups, `WHERE`, `HAVING`, `ROLLUP`, CTEs,
  scalar operators over `AGG`, stars, fan-outs, chasm traps, snowflakes), each answered by the
  expander's SQL and by dax-sql's on one DuckDB. Values come from the data, with a fixed seed.
  A different answer fails the run; one that is only the blank row this package does not have
  is counted apart. All three run again with `DAXSQL_OPTIMIZE=0`. A release waits for it.
- `ossie.yml` (Ossie's main, every morning too): what `formats/ossie.js` writes for every model
  here passes Ossie's own validator (`validation/validate.py`), and Ossie's portability ladder
  (`compliance/portability`) comes back from dax-sql PORTABLE, every element, as its grader
  scores it. A release waits for it.
- `pages.yml`: the site (`docs/`, https://djouallah.github.io/dax-sql/), whose every example is
  compiled by the code on main before it is published.
- `tsql.yml` (a push that changes the compiler or the suite): the suite as T-SQL on the Fabric
  lakehouse's SQL endpoint, against its own known list, with the slowest queries in its summary.
- `postgres.yml` (a push that changes the compiler or the suite): the suite on PostgreSQL 17,
  against its own known list, with the slowest queries and the plans of those past 30 s.
- `oracle.yml`, by hand: Power BI's answers for the suite's new or stale queries.
- [analytics-as-code](https://github.com/djouallah/analytics-as-code) runs its model's measures
  and its dashboard's queries through this package on every push, and compares them with its
  deployed Power BI model on request.
