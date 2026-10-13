- **In:** a Tabular model (`model.bim`), a DAX query, options ([DESIGN.md](DESIGN.md#api)).
- **Out:** one SQL `SELECT` and its columns.
- **Errors:** `SYNTAX`, `SEMANTIC`, `UNSUPPORTED`.

## Known limitations

- Grouping, `DISTINCT`, sorting and relationships on text are case-sensitive (comparisons,
  `IN` and table filters are not, as in DAX).
- `FORMAT` is en-US only, with a constant pattern; model format strings are not applied.
- A NULL stored in the data doesn't match a blank in a table filter (`TREATAS`, `VALUES`).
- A column that mixes numbers and text comes back as text.
- `IFERROR` returns its first argument: SQL has no error values.
- `DATEDIFF` with `WEEK` counts Sunday week boundaries.
- Not supported: object-level security, dynamic format strings, the window functions' reset
  argument, and anything not listed in [DESIGN.md](DESIGN.md#what-it-does).
