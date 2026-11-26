-- items other than Books (a blank category is not "Books"): their colors by every month, the
-- archive's source rows over the least store sale
WITH it AS (SELECT * FROM item WHERE COALESCE(i_category, '') <> 'Books'),
s AS (
  SELECT it.i_color, d.d_moy, MIN(ss.ss_ext_sales_price) AS mn
  FROM store_sales ss JOIN it ON it.i_item_sk = ss.ss_item_sk JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
)
SELECT co.i_color, m.d_moy, (SELECT SUM(row_count) FROM stg_tpcds_archive_log) / NULLIF(s.mn, 0) AS m0
FROM (SELECT DISTINCT i_color FROM it) co
CROSS JOIN (SELECT DISTINCT d_moy FROM date_dim) m
JOIN s ON s.i_color IS NOT DISTINCT FROM co.i_color AND s.d_moy = m.d_moy
WHERE m0 IS NOT NULL
