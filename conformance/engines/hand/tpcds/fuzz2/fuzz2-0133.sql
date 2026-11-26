-- June and September; per category and colour (every pair: m2, the archive's rows, filters on no date). m0: the
-- quarter numbers of those months with catalog revenue over 0; m1: no date in 1999 (blank)
WITH r AS (
  SELECT i.i_category, i.i_color, d.d_qoy, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_moy IN (6, 9)
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), q AS (
  SELECT i_category, i_color, COUNT(*) AS n FROM r WHERE rev > 0 GROUP BY ALL
)
SELECT k.i_category, k.i_color, q.n AS m0, NULL::DOUBLE AS m1, (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS m2
FROM (SELECT DISTINCT i_category, i_color FROM item) k
LEFT JOIN q ON q.i_category IS NOT DISTINCT FROM k.i_category AND q.i_color IS NOT DISTINCT FROM k.i_color
