# Design

## The problem

DAX has no direct SQL equivalent. A measure is evaluated in a filter context that the query
sets: the groups of SUMMARIZECOLUMNS, CALCULATE's filters, and context transition from the
rows of an iterator. That context reaches a table only along its relationships. SQL has none
of this.

The analytics-as-code dashboard's former compiler (`compiler.js`) wrote the SQL for the
constructs its page used, case by case.
This package translates DAX's rules instead, so that a query it has not seen comes out right.

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

**ALLSELECTED.** The environment holds the shadow filter contexts, innermost last. Each one
covers some columns and says what values they had:

- An iterator's (`iter`) covers the columns of the table it iterates that have a lineage. Its
  values are that table's rows.
- SUMMARIZECOLUMNS' covers the columns it groups by. Its values are theirs under its filters.
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
table, `ALLSELECTED(column)` starts from no filter at all.

### The model's features

- **Calculated tables** are compiled once each (`index.js`, `calcTable`) in an empty
  environment. The SQL writes each as a `MATERIALIZED` CTE whose columns are renamed to the
  model's, so that a scan reads it as it reads any table's rows. It is written without the
  query's filters and without row-level security.
- **Calculation groups** are applied where a measure is referenced (`applyGroups`), from the
  highest precedence. What a group's filters select is read off the filter context, from the
  filters on its name column (`itemFilters`; with none, those on its ordinal). They do not
  meet a filter on the ordinal: name "PY" on a row of another item's ordinal applies PY,
  though `VALUES` of the group there is empty.
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
  context, so no modifier removes them. Calculated tables and columns, and the security
  filters themselves, are written without them (`unsecured`). A table filters another back
  over a relationship that filters both ways only for the query when the query filters it:
  that is decided on its scan without security, and the rows that filter are its secured ones.
- **PATH** is a calculated column's value: the table's paths, over all its rows, are one
  `MATERIALIZED` CTE per pair of key and parent columns (`paths`), a recursive walk down from
  the rows with a blank parent, and PATH on a row is the path of the row's key in it. The
  other path functions are functions of the text.
- **Field parameters** are calculated tables with `NAMEOF` cells, which are constants.
  `expandFieldParameter` reads the table's expression to list the fields a selection stands
  for.

### The blank row

`VALUES`, `ALL` and `ALLSELECTED` over a table that can have a blank row (the one side of a
relationship that does not rely on referential integrity, `blankRowRels`) are `withblank`: the
rows, in a `UNION` with a row of blanks (`blankRow`).

- The row is there when some row of a many side has a key the table lacks, or a many-side
  table has a blank row itself (`orphans`, recursively: a snowflake's dimensions).
- The filter context applies to it as to any row. Its calculated columns are blank, as are
  those read through a join that found no row.
- Under a bind, `VALUES` is `onerow`, whose condition gains "or the value is blank and the
  row is there" (`blankexists`).
- `DISTINCT`, `ALLNOBLANKROW`, the table's name and `COUNTROWS` of the table do not add it.

A blank in a table filter must match the blank row and the fact rows that have none, so
membership (`member`) is null-safe where both sides can be blank (`blankSide`, `mayBeBlank`):
a blank row, a column read through a join that may find no row, a constant blank. It stays a
plain `IN` elsewhere, a NULL stored in a column aside. When the table reads no outer row, the
null-safe form is `x IN (…) OR x IS NULL AND EXISTS (… IS NULL)`, as fast as `IN`; otherwise
it is `EXISTS` with `IS NOT DISTINCT FROM`.

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

### The intermediate form

`ir.js` defines two kinds of node:

- **Scalars:** `lit`, `col`, `op`, `fn`, `case`, `agg`, `exists`, `insub`.
- **Tables:** `scan`, `filter`, `project`, `distinct`, `group`, `topn`, `cross`, the set
  operations, `rows`, `series`, `generate`, `sc` (SUMMARIZECOLUMNS), `shared` (a table VAR),
  `onerow`, `prefix`, `withblank` (a table and its blank row) and `window` (INDEX, OFFSET,
  WINDOW).
- **Scalars added for those:** `blankexists`, and `wrank` (RANK, ROWNUMBER).

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

Inside a fused scan, a filter that reads a key the scan is itself filtered to reads the scan's
own column instead. Its correlation moves from the group to the row, which joins well.

**The groups of SUMMARIZECOLUMNS.** Every expression can be blank only when its fused groups
have no row (`support`). When that holds, and each of those groups' scans keeps the filters
that decide the keys' combinations (those reaching a key's table), the groups are the union of
those groups' keys. Otherwise they are the combinations of the keys' values (each table's
existing combinations, cross-joined, plus a dimension's blank row) and the expressions are
evaluated on each. `ROLLUPADDISSUBTOTAL` is a `UNION ALL` of the levels; each call is an axis,
and the levels of several are crossed.

**Text** compares without regard to case, as in DAX: a comparison, `IN`, a bind and a table
filter's membership on text columns are written with the dialect's `nocase` (DuckDB's
`NOCASE` collation, `lower` on both sides elsewhere).

**One value as a table.** `VALUES(c)` under a bind on `c` is `onerow(v, exists)`, not a scan.

- `EXCEPT` and `INTERSECT` of it are conditions.
- `CROSSJOIN` with another table is a `prefix`.
- As a filter, it is a bind guarded by its condition.

This keeps measures like this model's "days the daily table lacks"
(`EXCEPT(VALUES(dim_calendar[date]), …)` under a group's date) in fused groups. As correlated
subqueries, they took 30 s on 1.6 million rows; as fused groups they take 0.2 s.

**Window functions.** The relation is numbered within its partitions (`numbered`): its
columns, the ORDERBY and PARTITIONBY values, and `ROW_NUMBER`, `COUNT`, `RANK` and
`DENSE_RANK` over them, ties broken by all the relation's columns. The current rows are those
whose columns equal the outer values (`currentRows`); a column with no outer value matches
any of its values in the filter context, through `EXISTS`. INDEX, OFFSET and WINDOW join the
numbered rows to the current rows on position (`windowRows`); RANK and ROWNUMBER read the
current row's number.

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

- 81 tests: hand-worked expectations on a small model (78, of which 24 for calculated tables,
  calculation groups, field parameters, row-level security, ALLSELECTED, `START AT`, the
  window functions, the blank row, context transition and FORMAT), this model's measures
  checked against SQL written by hand, and every page query compared with `compiler.js`. The
  differences are listed with their DAX reason.
- An adversarial review by a second agent ran about 620 more queries. Its findings were fixed
  and added as tests.
- A second review of the six features, by two agents, ran about 500 queries. Its findings were
  fixed and added as tests too: among them RLS across bidirectional and many-to-many
  relationships, ALLSELECTED's per-column shadows, blank matching in table filters, and
  context transition on every column.

**Speed.** On made-up data of this model's shape (1.6 million 5-minute rows across 400 units,
plus a year of daily rows):

- The page's 104 queries take about 6.3 s here against about 2.7 s for `compiler.js`, on the
  same machine. No query takes over 0.85 s, and the slowest one takes 0.55 s in `compiler.js`.
- The difference is mostly the "days the daily table lacks" terms. This package evaluates
  them; `compiler.js` assumes they are empty. The blank row's checks add a little.

## Reference

What the README leaves out: the API, what the compiler does, and how.

### API

`createCompiler(bim, options)` returns:

- `compile(dax)`: one `EVALUATE` returns `{ sql, columns }`. It throws a `DaxError` when the
  query has several `EVALUATE`s.
- `compileAll(dax)`: every `EVALUATE` of the query, in order. The same text is compiled once
  and then cached.
- `isDax(text)`: whether a text starts with `DEFINE` or `EVALUATE`.
- `fieldParameters()`: the model's field parameters, each with its fields in order.
- `expandFieldParameter(table, labels)`: the fields a selection of a field parameter stands
  for (all of them without `labels`), each `{ label, ref, order, kind, name, tableName }`.
  Power BI resolves a field parameter before it writes the query, so a caller does the same:
  it puts these columns or measures in the query where the parameter goes.
- `model`: the model as read.

| Option | |
|---|---|
| `tableSource` | `(table) => SQL` naming a model table's rows. Default: its partition's entity, `"schema"."entity"`. |
| `dialect` | `'duckdb'` (default), or an instance of a `Dialect` subclass. |
| `columnNames` | `'short'` (default): the column's or the expression's name. `'dax'`: `Table[Column]`, `[Measure]`. |
| `castOutput` | `true` (default): whole numbers as `BIGINT`, other numbers as `DOUBLE`. Or an object, by the column's type (`int`, `double`, `decimal`, `datetime`, `string`, `bool`), of a function of its SQL: `{ int: s => \`CAST(${s} AS INTEGER)\` }`; a type it leaves out is not cast. |
| `assumeIntegrity` | `true`: every relationship relies on referential integrity, so a dimension key is read off the fact's foreign key without a join. By default only relationships whose `relyOnReferentialIntegrity` is set are treated this way. |
| `blankRows` | `false`: no blank row for dimensions (see below), which saves a check per dimension. |
| `user` | The value of `USERNAME()` and `USERPRINCIPALNAME()`. |
| `roles` | A role name, or several: row-level security. Each table keeps the rows that at least one of the roles keeps. |
| `params` | The values of the query's parameters (`@name`), by name: numbers, text, booleans, `Date`s or `null` (blank). |

Errors are `DaxError` with a `code`:

- `SYNTAX`: the text is not DAX. The error gives the line and column.
- `SEMANTIC`: valid DAX that is wrong for this model, such as an unknown column or a column
  with no row context.
- `UNSUPPORTED`: valid DAX this compiler does not translate.

It never guesses.

### What it does

**The filter context is DAX's.** The compiler carries the filter context while it compiles,
and gives each aggregate the filters that reach its table.

- **CALCULATE and CALCULATETABLE:**
  - Filter arguments are evaluated in the outer context, then context transition happens, then
    the modifiers, then the filters.
  - A filter replaces the filters on its columns, unless it is wrapped in `KEEPFILTERS`.
  - A filter on a date table's date removes the filters on the rest of that table.
- **Modifiers:** `ALL`, `ALLNOBLANKROW`, `REMOVEFILTERS`, `ALLEXCEPT`, `ALLSELECTED`,
  `USERELATIONSHIP` and `CROSSFILTER`. `ALL` on a table clears its expanded table, so
  `ALL(Sales)` also clears the filters on Sales' dimensions.
- **ALLSELECTED** works with shadow filter contexts, as SQLBI's "definitive guide" describes
  them:
  - An iterator (`SUMX`, `FILTER`, `ADDCOLUMNS`, `SUMMARIZE`, …) is a shadow on the columns it
    iterates, holding the values it iterates over. SUMMARIZECOLUMNS is one on the columns it
    groups by, holding their values under its filters (the query's and its filter tables').
  - `ALLSELECTED()` gives every column a shadow covers the filter of the last shadow covering
    it, and leaves the filters on other columns alone. `ALLSELECTED(table)` does the same for
    the table's columns. `ALLSELECTED(column)` gives the column its last shadow's filter, or
    none.
  - As a table, `ALLSELECTED(table)` is the table's rows in that filter context, and
    `ALLSELECTED(column)` is the column's values under its last shadow only (all of its values
    when there is none).
- **Relationships:**
  - A filter reaches a table through many-to-one relationships, read off the expanded table.
  - It also reaches tables through bidirectional and many-to-many relationships, as
    semi-joins. A blank row the filter keeps reaches the other table's blank row.
  - Relationships can be active or inactive. One-to-one relationships filter both ways.
  - A table filter (`FILTER(Sales, …)`) filters its expanded table.
- **Row context:**
  - Iterators create row contexts. In context transition, a date table's date replaces the
    filters on the rest of its table, as a filter argument on it does.
  - A measure is its expression under CALCULATE.
  - Context transition turns every row context into filters, one on each column of the row.
  - `EARLIER`, `RELATED` and `RELATEDTABLE` work.
- **Blanks follow DAX's rules:**
  - `BLANK() + 1` is 1, `BLANK() * 2` is blank, `BLANK() = 0` is true and `BLANK() == 0` is
    false.
  - `"x" & BLANK()` is `"x"`.
  - `COUNTROWS` and `DISTINCTCOUNT` of nothing are blank, and `DISTINCTCOUNT` counts a blank
    as a value.
  - `1 / BLANK()` is infinity.
- **SUMMARIZECOLUMNS:**
  - Its groups are the key combinations that exist within each table, and every combination
    across tables.
  - A group whose expressions are all blank is left out (`IGNORE` excludes an expression from
    that test).
  - Filter tables, `ROLLUPADDISSUBTOTAL`/`ROLLUPGROUP`, and `ISINSCOPE` are supported.
  - A filter table wrapped in `NONVISUAL` filters the groups and the expressions, but is not
    part of the selection: `ALLSELECTED` removes it.
- **The blank row:** when some rows of a fact table have a key that matches no row of a
  dimension, DAX adds a blank row to the dimension, and those fact rows belong to it.
  - `VALUES`, `ALL` and `ALLSELECTED` over the dimension list it, and SUMMARIZECOLUMNS groups
    by it. `DISTINCT`, `ALLNOBLANKROW` and the table itself do not. `HASONEVALUE` and
    `SELECTEDVALUE` count it.
  - A filter on the dimension's columns leaves it out, unless the filter keeps blanks: a blank
    in a table filter (`TREATAS({BLANK()}, …)`, or a filter on the fact table that keeps the
    fact rows without a dimension row) keeps it.
  - Its calculated columns are blank too.
  - A table on the one side of a relationship to such a dimension has a blank row as well,
    since the dimension's blank row matches none of its rows. A sale of an unknown product
    belongs to the blank category.
  - The compiler adds a check for such fact rows wherever a dimension's values are listed. A
    relationship that relies on referential integrity, the `assumeIntegrity` option, or
    `blankRows: false` means there are none, and the check is left out.
- **TOPN** keeps rows tied with the last one. **ORDER BY** puts blanks first when ascending.
- `DEFINE MEASURE`, `DEFINE VAR`, `DEFINE TABLE` and `DEFINE COLUMN` are supported, as are
  several `EVALUATE`s and lazy `VAR`s. Calculated columns are evaluated per row in an empty
  filter context. A `DEFINE COLUMN` is one for the query: a column of its table while the
  query is compiled (to group by, filter, or clear with `ALL` of the table), computed as the
  model's are, without row-level security.
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
  - Calculated tables and calculated columns are computed without security, as at refresh.

**Functions.**

- **Aggregates and iterators:** `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT(A/BLANK)`, `COUNTROWS`,
  `DISTINCTCOUNT(NOBLANK)`, `PRODUCT`, `MEDIAN`, `STDEV.S/P`, `VAR.S/P`, `PERCENTILE.INC/EXC`;
  their X forms; `CONCATENATEX` and `RANKX`.
- **Filter context:** `CALCULATE`, the modifiers above, `ISFILTERED`, `ISCROSSFILTERED`,
  `ISINSCOPE`, `HASONEVALUE`, `HASONEFILTER`, `SELECTEDVALUE`, `FILTERS`, `LOOKUPVALUE`,
  `CONTAINS`, `CONTAINSROW`, `ISEMPTY`, `IN`.
- **Window functions:** `INDEX`, `OFFSET`, `WINDOW` (`ABS` and `REL`), `RANK` (`DENSE` and
  `SKIP`) and `ROWNUMBER`, with `ORDERBY` (and its `ASC BLANKS LAST` kind of order),
  `PARTITIONBY` (also a related table's column), `MATCHBY`, and the blanks argument.
  - The current row is the row of the relation whose columns hold the outer values: those of
    a row context, or the value the filter context fixes a column to (a group, or a context
    transition). For RANK, only the `ORDERBY` and `PARTITIONBY` columns need one, and the
    rows tied on them share the rank.
  - A column with no outer value takes each of its values in the filter context, and the
    result is the union over them, as DAX does it.
  - Without a relation, the relation is `ALLSELECTED` of the `ORDERBY` and `PARTITIONBY`
    columns.
  - For the other functions, ties in `ORDERBY` are broken by the relation's other columns,
    as DAX does. `ROWNUMBER` over rows that are entirely equal numbers them in an arbitrary
    order, where DAX raises an error.
- **Tables:**
  - building and shaping: `FILTER`, `VALUES`, `DISTINCT`, `ALL…`, `SUMMARIZE`,
    `SUMMARIZECOLUMNS`, `ADDCOLUMNS`, `SELECTCOLUMNS`, `GROUPBY`/`CURRENTGROUP`, `TOPN`,
    `TOPNSKIP`, `ADDMISSINGITEMS`; `ROLLUP`/`ROLLUPGROUP` and `ISSUBTOTAL` in `SUMMARIZE`;
  - combining: `CROSSJOIN`, `UNION`, `INTERSECT`, `EXCEPT`, `GENERATE(ALL)`, `TREATAS`,
    `NATURALINNERJOIN`, `NATURALLEFTOUTERJOIN` (on the columns of the same lineage, or of the
    same name for columns without one, a blank matching a blank), `SUBSTITUTEWITHINDEX`;
  - constructing: `ROW`, `DATATABLE`, `{ }`, `GENERATESERIES`, `CALENDAR`, `CALENDARAUTO`;
  - `FIRSTNONBLANK`, `LASTNONBLANK`, over a column or a table of one column.
- **Time intelligence:**
  - `DATESYTD/QTD/MTD`, `TOTALYTD/QTD/MTD`, `DATESBETWEEN`, `DATESINPERIOD`;
  - `DATEADD` and `DATESINPERIOD` (from the last day of a month to the end of the moved
    month), `SAMEPERIODLASTYEAR`, `PARALLELPERIOD`, `PREVIOUS/NEXT DAY/MONTH/QUARTER/YEAR`;
  - `STARTOF…`, `ENDOF…`, `FIRSTDATE`, `LASTDATE`, `OPENING/CLOSINGBALANCE…`;
  - a year end (`"6/30"`) on the functions of a year that take one.
- **Values:** logic (`IF`, `SWITCH`, `COALESCE`, `DIVIDE`, …), math, text, dates, `CONVERT`,
  `NAMEOF`.
- **Parent-child hierarchies:** `PATH`, computed over all the table's rows as a calculated
  column is (a recursive CTE, once per pair of columns, read on the row by its key);
  `PATHLENGTH`, `PATHITEM`, `PATHITEMREVERSE` (`TEXT` or `INTEGER`) and `PATHCONTAINS`. A row
  whose parents never reach a blank one (an error in DAX) has a blank path.
- **FORMAT** writes numbers and dates as DAX does in en-US:
  - the named formats: `General Number`, `Currency`, `Fixed`, `Standard`, `Percent`,
    `Scientific`, `Yes/No`, `True/False`, `On/Off`, `General Date`, `Long Date`, `Medium
    Date`, `Short Date`, `Long Time`, `Medium Time`, `Short Time`;
  - custom number patterns: `0` and `#`, the point, thousands separators, a comma before the
    point or at the end dividing by 1000, `%`, `E+ E- e+ e-`, literals (`"text"`, `\c`, also
    between the digits as in `(###) ###-####`), and up to three sections (positive; negative;
    zero), a negative value that rounds to zero showing the zero section;
  - rounding at 15 significant digits, then half away from zero (`FORMAT(1.005, "0.00")` is
    `1.01`);
  - custom date patterns: `d` to `dddddd`, `w`, `ww`, `m` to `mmmm`, `q`, `y`, `yy`, `yyyy`,
    `h`, `hh`, `n`, `nn`, `s`, `ss`, `ttttt`, `c`, `AM/PM`, `am/pm`, `A/P`, `a/p`, `AMPM`; `m`
    right after an hour is minutes;
  - a blank is `""` (so a measure that is FORMAT is never blank, and SUMMARIZECOLUMNS keeps
    every group, as in DAX); a date with a number pattern is its serial number.
- **Values as text** (`&`, the text functions) follow DAX too: `0.1 + 0.2` is `0.3` (15
  digits), `1E+20`, `TRUE` is `True`, and a date is `1/5/2024`, with its time when it has one.

### How it works

`src/`, in the order a query goes through it:

| File | |
|---|---|
| `lexer.js`, `parser.js` | DAX text into a syntax tree |
| `model.js` | the TMSL model: tables, columns, measures, relationships; expanded tables and filter propagation |
| `compiler.js` | the tree into an intermediate form, with the filter context as a value (`context.js`) |
| `functions/` | the function library, by kind |
| `ir.js` | the intermediate form: scalars, tables, rows, aggregates over scans |
| `emit.js` | the intermediate form into SQL |
| `format.js` | FORMAT's patterns, read into what a dialect writes |
| `dialects/` | what differs between SQL engines: `base.js` (the interface), `duckdb.js`, `duckdb-format.js` |

The SQL it writes:

- An aggregate is a scalar subquery over its table's rows under its filters, correlated to the
  rows it reads; DuckDB decorrelates those subqueries.
- The aggregates of SUMMARIZECOLUMNS and ROW are fused where they can be. Those over the same
  table under the same filters become one `GROUP BY` in a CTE, joined to the groups.
- `VALUES` of a column the context binds to one value is that value, not a scan. That turns
  per-group subqueries like this model's "days the daily table lacks" into fused groups.
- A filter of a column's values with conditions on that column alone, like
  `FILTER(ALL('Date'[Date]), 'Date'[Date] >= x)`, is a condition on the scan's own row when
  every row has a value of that column: the scan's own column, or one reached over
  relationships that rely on referential integrity. There is no subquery, so the engine can
  skip the rows the condition rules out.
- A total over the rows of a fused group, like `CALCULATE(x, ALLSELECTED(…))` next to `x` by
  group, is the group's values added up, not a second scan. This holds for sums, counts,
  minima and maxima.

To add an engine, extend `Dialect` in `src/dialects/base.js` (it lists the functions and
aggregates to write) and pass an instance as `dialect`.

### Tests

```sh
npm install   # DuckDB for Node, for the tests only
npm test
```

- `test/semantics.test.js` has 56 tests on a small sales model (`test/fixtures/contoso.js`).
  The model has 11 sales, so every expected result was worked out by hand.
- `test/features.test.js` has 24 more on the same model: calculated tables, calculation
  groups, field parameters, row-level security, ALLSELECTED, `START AT`, the window
  functions, the blank row, context transition and FORMAT.
- [analytics-as-code](https://github.com/djouallah/analytics-as-code) runs its model's measures
  and its dashboard's queries through this package on every push, and compares them with its
  deployed Power BI model on request.

### Review

Two separate review agents tried about 500 queries against the six new features (calculated
tables, calculation groups, field parameters and row-level security; ALLSELECTED; `START AT`;
the window functions; the blank row; FORMAT). These are the fixes that matter most:

- **Security leaks:** row-level security didn't pass through relationships set to filter both
  ways for security, or through many-to-many ones. Users could see rows their role should
  hide.
- **A crash** whenever a calculation group's "no selection" or "several selected" expression
  used `SELECTEDMEASURE()`.
- **Iterating a table row:** `ALLEXCEPT` and `REMOVEFILTERS` on the key gave wrong numbers,
  because only the key column was filtered rather than the whole row.
- **An older bug:** `PREVIOUSMONTH` and similar functions ignored the current row of the date
  table.

Each fix has a test. What still differs from DAX is listed under
the README's known limitations.
