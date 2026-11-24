// Polars SQL (pl.SQLContext, tested on 2.1): PostgreSQL's SQL, as Polars reads it, over the
// query plan unnested (planSql { unnest: true }): Polars runs no correlated subquery and no
// LATERAL, so the plan with neither is the one it takes. What it writes differently from
// PostgreSQL's:
// - WITH has no MATERIALIZED (a CTE is a lazy frame, computed once where it is read).
// - A blank-safe key is IS NOT DISTINCT FROM (no ARRAY = ARRAY, no ROW()::record).
import { PostgresDialect } from './postgres.js';

export class PolarsDialect extends PostgresDialect {
  name = 'polars';
  session = [];
  materialized = '';

  isNotDistinct(a, b) { return `(${a} IS NOT DISTINCT FROM ${b})`; }
  keysTogether = null;
}
