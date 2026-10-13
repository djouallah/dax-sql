# The contract, in full

A black-box conformance suite for DAX engines. A test is a Tabular model, its data and a DAX
query. The expected rows are what **Power BI** answers for that query, on that model and
data. No one works them out by hand.

An engine takes the test through an **adapter**: the suite hands the adapter the model, the
data and the query, and compares the rows that come back. Nothing here knows how any engine
works, and the queries are written without looking at one.

## The contract

**A model** is a folder `models/<model>/`:

- `model.bim`: the Tabular model, as TMSL (the JSON Power BI and Analysis Services use).
  Tables that hold data have one partition, of type `entity`, whose `entityName` names its
  file.
- `data/<entityName>.csv`: the table's rows, in this format:
  - a header line of the source column names;
  - every text value quoted, `""` inside a quoted value standing for one `"`;
  - a blank as an empty, unquoted field;
  - dates as `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM:SS` when they have a time;
  - booleans as `true`/`false`;
  - numbers as JavaScript writes them.

**A query** is a file `queries/<model>/<family>/<id>.dax`: one `EVALUATE` query (with
`DEFINE` if it needs one). It can open with header comments:

```dax
// note: what the query tests
// roles: France, Bikes
EVALUATE ...
```

`roles` runs the query as a member of those roles of the model (row-level security).
`expect: error` says the query tests a rule of DAX that makes Power BI reject it: the engine
must reject it too.

**An answer** is the query's result: its columns, in order, and its rows, each a list of
values in the columns' order:

- numbers as numbers;
- text as text;
- booleans as `true`/`false`;
- a blank as `null`;
- dates as text, in the same form as the data.

### The adapter protocol

The adapter is a command. The runner calls it once, with the path of a request file:

```
<adapter command> <request.json>
```

```json
{ "version": 1,
  "queries": [{ "id": "patterns/time/time-ytd", "model": "/abs/models/patterns/model.bim",
                "data": "/abs/models/patterns/data", "dax": "EVALUATE ...", "roles": null }] }
```

It writes one JSON object per line to stdout, one for each query, in any order:

```json
{ "id": "patterns/time/time-ytd", "columns": ["'Date'[Year]", "[Sales]"], "rows": [[2024, 1234.5]] }
{ "id": "patterns/gaps/gaps-path", "error": "PATH is not supported", "unsupported": true }
```

Column names are informative. Answers are compared by position.

### How answers are compared

- **Values:** numbers are equal within a relative 1e-9. Everything else must be exactly
  equal.
- **Order:** rows are compared in order when the query has `ORDER BY`, and as a multiset
  otherwise.
- **Errors:** when Power BI rejects a query, any error from the engine counts as a match.
  Rows are a `fail` when the query says `expect: error`. Otherwise the query is `invalid`
  and has to be fixed.

Each query ends up with one outcome:

| Outcome | Meaning |
|---|---|
| `match` | the engine's rows are Power BI's |
| `fail` | other rows |
| `error` | the engine failed where Power BI answered |
| `unsupported` | the engine says it does not handle the query |
| `pending` | no golden yet, or a stale one: the query, its model or a measure it uses changed since Power BI was asked |
| `invalid` | Power BI rejected the query |

## Running it

```sh
node runner/run.mjs --adapter "<command>" [--known known.json] [--model m] [--family f] [--grep regex] [--report report.json]
```

It prints a scoreboard per family. `--known` takes a list `[{ id, reason }]` of queries the
engine is known to get wrong. The exit code is 1 in two cases:

- a query fails, errs or is unsupported without being on that list;
- a query on the list matches. The list only shrinks.

The engines tested here are under `engines/`, each with its known list. The `Conformance`
workflow (in the repo root) runs them on every push.

| Engine | Adapter |
|---|---|
| dax-sql (this repo) | `engines/dax-sql/adapter.mjs <repo root>`: compiles each query with that checkout and runs the SQL on DuckDB |

## Power BI, the oracle

`golden/<model>/<family>.json` holds Power BI's answers, by query id:
`{ hash, columns, rows }`, or `{ hash, error }`. The hash covers everything the answer
depends on:

- the query and its roles;
- the model's structure and data;
- the measures the query reaches.

A golden whose hash differs is stale.

The `Oracle` workflow (manual, since it costs capacity) does the rest:

1. It publishes each model to a Fabric workspace as an Import model with its rows inside, as
   M `#table` literals, so it needs no data source (`oracle/export.mjs`).
2. It refreshes the model, and asks it over XMLA every query whose golden is missing, stale or an error
   (`oracle/oracle.py`).
3. It commits the goldens.

Goldens are never written by hand.

**Setup** for the workflow:

- repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `WS_ID`;
- a federated credential on that app registration for
  `repo:djouallah/dax-sql:ref:refs/heads/main`;
- the app able to create items in the workspace. The published model makes it a member of every
  role, since Power BI applies a query's roles over XMLA only to a member of them;
- XMLA reads enabled on the workspace's capacity.

## Writing queries

- **Valid DAX for Power BI.** A query Power BI rejects comes back `invalid`.
- **No expected values.** Power BI gives them.
- **Deterministic:** no `NOW`, `TODAY`, `UTCNOW` or `RAND`. With `ORDER BY`, order on columns
  that make the order total.
- **Text:** Power BI compares text without regard to case. Rely on that only in a query that
  tests it.
- **Hard DAX.** Write what real models' measures and Power BI's visuals ask, whether or not
  any engine handles it today:
  - nested iterators and context transition;
  - filter interactions;
  - relationships;
  - time intelligence;
  - the query shapes visuals write.
- **One idea per query**, said in `note`. Ids are `<family>-<short-kebab-name>`, and unique
  across the suite.
- **Small results:** at most a few hundred rows.

## Models

- **`patterns`**: a sales model in the manner of SQLBI's DAX Patterns, about 9,000 rows.
  `tools/patterns/build.mjs` writes it from a seeded generator, and measures go in
  `tools/patterns/measures/<family>.js`. It has:
  - three years of dates with fiscal and ISO-week columns;
  - a product snowflake;
  - customers with cohorts;
  - sales with an inactive delivery-date relationship;
  - a budget at category × month (many-to-many to Date);
  - month-end inventory snapshots;
  - a parent-child employee hierarchy;
  - a customer/account bridge;
  - daily exchange rates;
  - a disconnected segments table;
  - a calculation group, a field parameter and two roles;
  - fact rows whose product or customer is missing.
