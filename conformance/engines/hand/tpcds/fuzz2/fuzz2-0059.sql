-- m1: TOTALYTD over the date table's last year; MINX over its months of a SUM (no context transition) is the
-- year's catalog quantity; the archive is not filtered by dates. m2: the item table holds more than one brand.
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
q AS (
  SELECT SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk, y
  WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx),
a AS (SELECT SUM(row_count) AS r FROM stg_tpcds_archive_log)
SELECT (SELECT NULLIF(COUNT(DISTINCT i_current_price) + (COUNT(*) > COUNT(i_current_price))::INT, 0) FROM item) AS m0,
  GREATEST(q.q, a.r) AS m1,
  NULL::DOUBLE AS m2
FROM q, a
