-- one row. m0: HASONEVALUE of the city over every store. m1: FILTER's condition has no measure,
-- so no context transition: the whole item table's brand count against 10 keeps every city or
-- none (SELECTEDVALUE of the quarter is blank, not 1); then the store sales of those cities
WITH one AS (SELECT COUNT(DISTINCT s_city) + MAX((s_city IS NULL)::INT) = 1 AS one FROM store),
q AS (SELECT CASE WHEN COUNT(DISTINCT d_qoy) = 1 THEN MIN(d_qoy) END AS q FROM date_dim),
k AS (
  SELECT CASE WHEN COALESCE(q.q, 0) = 1 THEN (SELECT AVG(ss_net_profit) FROM store_sales)
    ELSE (SELECT COUNT(DISTINCT i_brand) + MAX((i_brand IS NULL)::INT) FROM item) END > 10 AS keep
  FROM q
), dc AS (
  SELECT NULLIF(COUNT(DISTINCT ss.ss_customer_sk) + COALESCE(MAX((ss.ss_customer_sk IS NULL)::INT), 0), 0) AS n
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk, k
  WHERE k.keep
)
SELECT CASE WHEN one.one THEN (SELECT COUNT(*) FROM store) END AS m0,
  CASE WHEN dc.n IS NULL AND c.mx IS NULL THEN NULL ELSE COALESCE(dc.n * 2, 0) + COALESCE(c.mx, 0) END AS m1,
  (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m2
FROM one, dc, (SELECT MAX(cs_ext_sales_price) AS mx FROM catalog_sales) c
