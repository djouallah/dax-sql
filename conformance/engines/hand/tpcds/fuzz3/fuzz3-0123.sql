-- nothing filters the items: HASONEVALUE of the class holds only if all items share one. The states include the
-- blank row when some store sale has no store
WITH one AS (SELECT COUNT(DISTINCT i_class) + MAX((i_class IS NULL)::INT) = 1 AS one FROM item),
s AS (
  SELECT st.s_state, COUNT(DISTINCT ss.ss_customer_sk) + MAX((ss.ss_customer_sk IS NULL)::INT) AS dc, MAX(ss.ss_ext_sales_price) AS mx
  FROM store_sales ss LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk GROUP BY ALL
)
SELECT g.s_state, CASE WHEN one.one THEN s.dc / NULLIF(s.mx, 0) END AS m0
FROM (SELECT s_state FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)) g CROSS JOIN one
LEFT JOIN s ON s.s_state IS NOT DISTINCT FROM g.s_state
