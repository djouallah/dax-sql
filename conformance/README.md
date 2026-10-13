A black-box conformance suite for DAX engines: a Tabular model, its data and a DAX
query in; the engine's rows out, compared with what Power BI answers.

## Contract

- **In:** `models/<model>/` (`model.bim` and its data as CSV), and `queries/<model>/<family>/<id>.dax`.
- **Out:** the engine's adapter answers each query with `{ id, columns, rows }`, or `{ id, error }`.
- **Expected:** `golden/`, Power BI's answers, written only by the `Oracle` workflow.
- **Outcomes:** match, fail, error, unsupported, pending, invalid.

Details, and how to run it: [CONTRACT.md](CONTRACT.md).

## Known limitations

- A golden is what Power BI answered on the day the Oracle ran; a service update can change it.
- Five models: `patterns`, `contoso`, `edges`, `aac` (analytics-as-code) and `tpcds`
  (direct-lake-parquet-layout's TPC-DS store_sales), the last two on a data sample.
