WITH f AS (
  SELECT ss_store_sk, SUM(ss_ext_sales_price) AS rev FROM store_sales GROUP BY ss_store_sk
), v AS (
  SELECT s.s_state AS state, GROUPING(s.s_state) = 1 AS t1, s.s_store_name AS store, GROUPING(s.s_store_name) = 1 AS t2, SUM(f.rev) AS rev
  FROM f LEFT JOIN store s ON s.s_store_sk = f.ss_store_sk
  GROUP BY ROLLUP (s.s_state, s.s_store_name)
  HAVING SUM(f.rev) IS NOT NULL
)
SELECT CASE WHEN t1 THEN rev WHEN t2 THEN SUM(rev) FILTER (WHERE t1) OVER () ELSE SUM(rev) FILTER (WHERE t2) OVER (PARTITION BY t1, state) END AS calc, state, t1, store, t2, rev, FALSE AS densified
FROM v

ORDER BY t1, state NULLS FIRST, t2, store NULLS FIRST
