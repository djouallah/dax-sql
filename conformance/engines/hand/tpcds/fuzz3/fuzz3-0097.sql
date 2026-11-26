-- per store name and brand: the archive's file count when the brand's average catalog profit (a fixed decimal, to
-- 4 places; stores filter no catalog sale) passes 1, else blank
WITH b AS (
  SELECT i.i_brand, ROUND(AVG(cs.cs_net_profit::DOUBLE), 4) AS av
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT gs.s_store_name, gb.i_brand,
  CASE WHEN b.av > 1 THEN (SELECT COUNT(*) FROM stg_tpcds_archive_log) / 1 END AS m0
FROM (SELECT DISTINCT s_store_name FROM store) gs
CROSS JOIN (SELECT DISTINCT i_brand FROM item) gb
LEFT JOIN b ON b.i_brand IS NOT DISTINCT FROM gb.i_brand
