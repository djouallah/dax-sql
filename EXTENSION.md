# A DuckDB extension

This is a design; nothing in it is built yet.

## The goal

Today a model can be queried only from JavaScript, through `createCompiler`. The extension
makes a model a relation in DuckDB, so that any DuckDB client can query it: the CLI, Python, R,
and BI tools that speak DuckDB SQL. A model's queries can then be mixed with the rest of the
user's SQL.

```sql
LOAD dax_sql;
ATTACH 'contoso/model.bim' AS xx (TYPE model);

SELECT Product.Color, AGG(Orders) AS orders FROM xx GROUP BY ALL;
```

## Background

Two earlier blog posts describe the idea behind this design:

- ["Modern" BI tools are missing something like PowerBI Composable SQL Generator](https://datamonkeysite.com/2021/10/03/modern-bi-tools-are-missing-something-like-powerbi-composable-sql-generator/)
  (2021): Power BI's DAX engine sends several SQL statements and assembles their results, and
  other BI tools have no SQL generator like it.
- [Why Datamart is a Big Deal](https://datamonkeysite.com/2022/06/03/why-datamart-is-a-big-deal/)
  (2022): Power BI is the DAX engine, and the engine that computes the answers can be chosen.

## What a user writes

### Attaching

`ATTACH '<path>' AS <name> (TYPE model [, option value …])` reads the model file once.

- **The file:** a `.bim` file is read as TMSL, and a `.yaml` file as Apache Ossie. Both readers
  exist already (`formats/tmsl.js`, `formats/ossie.js`).
- **Options:**
  - `SOURCE '<catalog>[.<schema>]'` is where the model's tables are read from. It can be any
    database DuckDB has attached: a DuckDB file, DuckLake, Delta, Iceberg or Postgres. Without
    it, a table is read as `schema.entity` through the session's search path.
  - `USER` and `ROLES` apply the model's row-level security.
  - `ASSUME_INTEGRITY` and `BLANK_ROWS` are the compiler's options of the same names.
- **Changing the model:** to read a changed file, DETACH and ATTACH again. The attached model is
  read-only: `INSERT`, `UPDATE` and `CREATE` in it are errors.

### Querying

A **model query** is a `SELECT` whose only `FROM` is the model, with or without an alias. It is
the SQL the compiler takes today (DESIGN.md, Reference, SQL):

- `AGG(m)` or `MEASURE(m)` is measure `m`. `SUM`, `AVG`, `MIN`, `MAX` and `COUNT` aggregate a
  column.
- The columns in the select list are the groups. They appear in `GROUP BY`, or `GROUP BY ALL`
  takes them from the select list. `ROLLUP` adds subtotals.
- `WHERE` filters on columns only, and `HAVING` filters on aggregates.
- `ORDER BY` and `LIMIT` work as usual.

The whole query is compiled together, because a measure's value depends on the groups and the
filters around it. That is why the model is not a table on its own: it has no rows until a query
chooses the groups.

These are errors, each with a message that says what to write instead:

- **`SELECT *`:** name the columns and `AGG(measures)`; `DESCRIBE xx` lists them.
- **A join in a model query:** put the model query in a CTE or a subquery, and join that.
- **Window functions and `QUALIFY` in a model query:** apply them to the result, outside it.
- **Grouping by a measure, or a bare measure without `AGG`.**

Names work as in the compiler's SQL. A bare name is enough when one table has it; otherwise write
`table.column`. A name with spaces takes double quotes. DAX's `'Table'[Column]` and `[Measure]`
are not DuckDB SQL, so they remain available only through the JavaScript API.

### Composing

Everything around a model query is DuckDB's own SQL. A model query can stand wherever DuckDB
takes a query:

- a CTE's body, or a subquery in `FROM`;
- an arm of a `UNION`, `INTERSECT` or `EXCEPT`, with no parentheses needed;
- `IN (SELECT … FROM xx …)`;
- `CREATE TABLE AS`, `COPY (…) TO` and `CREATE VIEW`.

```sql
WITH m AS (SELECT Color, AGG(Orders) AS orders FROM xx GROUP BY Color)
SELECT m.*, s.stock FROM m JOIN warehouse.stock s USING (Color)
UNION ALL
SELECT 'total', AGG(Orders), NULL FROM xx;
```

A view over a model query keeps the text the user wrote, and recompiles it each time it is
queried. So the view follows the model after a DETACH and ATTACH.

A model query reads no column of the query around it: it is not correlated. A prepared
statement's parameters (`$1`, `?`) inside it become typed values, never SQL text.

### Inspecting

Each of these returns rows, and each can be used as a subquery:
`SELECT * FROM (SHOW SEMANTIC METRICS IN xx) WHERE …`.

| Statement | Lists |
|---|---|
| `DESCRIBE xx` | Each column you can name (`table.column`, with its type) and each measure (name, type, `kind = 'measure'`) |
| `DESCRIBE SEMANTIC VIEW xx` | The model's tables, relationships, columns and measures, with their properties: DAX expression, format string, source |
| `SHOW SEMANTIC VIEWS` | The attached models, with the file path and its format (TMSL or Ossie) |
| `SHOW SEMANTIC DIMENSIONS IN xx` | The model's columns |
| `SHOW SEMANTIC METRICS IN xx` | The model's measures |
| `SHOW SEMANTIC DIMENSIONS IN xx FOR METRIC m` | The columns that filter measure `m`, those its table reaches along the relationships (`Model.reaches()`, `src/model.js`) |
| `SHOW COLUMNS IN xx` | One row for each name a query can use; an ambiguous one shows as `table.name` |

- **Vocabulary:** a dimension is a model column and a metric is a measure.
- **Hidden items:** hidden columns and measures are listed, with a `hidden` flag.
- **Output columns:** each command returns `name`, `table_name`, `data_type` and `comment`, plus
  `dax` and `format_string`.
- **DuckDB's catalog:** `duckdb_columns()` and `information_schema` list the same items, so tools
  that browse a database see them, and autocomplete offers them.

## How it works

The extension is written in C++ and has three parts.

1. **The model catalog.** ATTACH with `TYPE model` creates a read-only catalog. The catalog
   reads the file through the existing readers, builds a compiler with `createCompiler`, and
   holds both. Its entries exist only so that the model can be inspected.
2. **The rewrite.** A statement that names an attached model is rewritten before DuckDB binds
   it:
   1. DuckDB's parser parses the statement.
   2. The extension walks the parsed tree: CTEs, set operations, subqueries in `FROM` and in
      expressions, `DESCRIBE`, `SHOW`, `EXPLAIN`, `CREATE … AS` and `COPY`.
   3. Each model query is printed back to SQL and given to the compiler's `compile()`.
   4. The compiled SQL is parsed and put in the model query's place, as a subquery with the
      same alias.
   
   DuckDB then binds, optimises and runs the whole statement as one query, so filters and
   column choices push down into the compiled SQL, and the result streams. A statement that
   names no model is not touched. The compiler's errors (`SYNTAX`, `SEMANTIC`, `UNSUPPORTED`)
   become DuckDB errors that keep its message.
3. **The compiler, unchanged.** `src/` and `formats/` are bundled into one script, which is
   embedded in the extension and run by QuickJS, a small JavaScript engine written in C. The
   compiler has no runtime dependencies, so it needs nothing else. Compiling a query takes
   milliseconds. There is one compiler, so the conformance suite's goldens keep covering what
   the extension runs.

The extension lives in its own repository, made from DuckDB's extension template, with this
repository as a submodule pinned to a commit. Its CI builds it and runs its tests.

## Choices set aside

- **A view with fixed rows.** For `SELECT * FROM xx` to have rows, the model would need one
  grain: every column with every measure (often far too many rows), or one row of grand totals.
  Neither is what a query means by its groups. So `*` is an error, and the query names its groups.
- **A table function that takes the groups and measures as arguments**, as in
  `FROM model_query('xx', groups := [...], measures := [...])`. Another semantic-layer extension
  for DuckDB works this way: it defines its models with SQL DDL stored in the database, and the
  call holds the whole request, so the call can be joined directly. Here the model already
  exists as a file, and the compiler already speaks `SELECT … GROUP BY`, so the query form is
  SQL's own.
- **Rewriting after binding**, in DuckDB's binder or optimizer. `AGG(m)` does not bind, and
  rebuilding a model query from a bound plan means mapping columns back. Before binding, the
  model query is still SQL, which is what the compiler takes.
- **DuckDB's C extension API.** It is stable across DuckDB versions, but it has no hook for
  `ATTACH … (TYPE …)` and none for the parser. Both exist only in DuckDB's C++ API, so the
  extension is built for one DuckDB version at a time.
- **Porting the compiler to C++ or Rust.** There would be two compilers to keep equal, and the
  goldens would test only one of them.

## Open questions

Each one is settled by a first, small build, before the rest is written.

- **The parser hook to use.** DuckDB 2.0 has two: the parser override, whose setting
  `allow_parser_override_extension` is `DEFAULT` out of the box; and grammar extensions, which
  are turned on for each connection with `active_grammar_extensions`. Find out which one fires
  without the user setting anything, and whether it reaches connections opened before `LOAD`.
- **Printing a model query back to SQL.** Check that DuckDB's printed form of a model query
  parses with `src/sql.js` and compiles to the same SQL. Every query in `test/sql.test.js`
  checks this.
- **Views.** Check that `CREATE VIEW` can keep the user's text, not the compiled SQL.
- **The DuckDB version** to build for, and how the extension follows new releases.

## Verification

- **The extension's tests,** in DuckDB's sqllogictest format, cover:
  - ATTACH with each option, and both file formats;
  - each inspecting statement, and each one used as a subquery;
  - a model query in a CTE, in a subquery, in a UNION arm, in `IN`, and in a view;
  - the errors for `SELECT *`, a join, and a window function;
  - row-level security with `ROLES`;
  - `SOURCE` pointing at another attached database.
- **Conformance:** a second engine in `conformance/engines/` runs the suite's SQL queries
  through the extension. Its answers are checked against the same goldens, and it carries the
  same known differences as the JavaScript engine.
