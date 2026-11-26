WITH f AS (
  SELECT ss_store_sk, SUM(ss_ext_sales_price) AS rev FROM store_sales GROUP BY ss_store_sk
), v AS (
  SELECT s.s_state AS state, GROUPING(s.s_state) = 1 AS t1, s.s_city AS city, GROUPING(s.s_city) = 1 AS t2,
         s.s_store_name AS store, GROUPING(s.s_store_name) = 1 AS t3, SUM(f.rev) AS rev
  FROM f LEFT JOIN store s ON s.s_store_sk = f.ss_store_sk
  GROUP BY ROLLUP (s.s_state, s.s_city, s.s_store_name)
  HAVING SUM(f.rev) IS NOT NULL
)
SELECT SUM(rev) OVER (PARTITION BY t1, t2, t3, CASE WHEN NOT t2 THEN state END, CASE WHEN NOT t3 THEN city END ORDER BY state NULLS FIRST, city NULLS FIRST, store NULLS FIRST ROWS UNBOUNDED PRECEDING) AS calc, state, t1, city, t2, store, t3, rev, FALSE AS densified
FROM v

ORDER BY t1, state NULLS FIRST, t2, city NULLS FIRST, t3, store NULLS FIRST
