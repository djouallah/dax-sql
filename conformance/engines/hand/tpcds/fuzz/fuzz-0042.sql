-- every promotion name (m1 is never blank; sales of no promotion are in the blank name); m1: no store city in scope: the archive row count once per item
-- class (the promotion reaches no item: that relationship is inactive)
WITH c AS (
  SELECT p.p_promo_name, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
), k AS (
  SELECT (SELECT COUNT(DISTINCT i_class) + (COUNT(*) > COUNT(i_class))::INT FROM item)
    * (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS m1
)
SELECT p.p_promo_name, c.qty AS m0, k.m1
FROM (SELECT DISTINCT p_promo_name FROM promotion) p CROSS JOIN k
LEFT JOIN c ON c.p_promo_name IS NOT DISTINCT FROM p.p_promo_name
WHERE c.qty IS NOT NULL OR k.m1 IS NOT NULL
