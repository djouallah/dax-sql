-- per item class and store city: distinct store customers / the class's catalog quantity, and
-- (the class's catalog profit > 100 ? its catalog revenue : the calendar's years). A sale with no or an unknown
-- item or store is under the blank class or city (item's blank row: a promotion's unknown item, or its blank row, too)
WITH ss AS (
  SELECT i.i_class, s.s_city, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS cust
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), cs AS (
  SELECT i.i_class, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_net_profit) AS profit, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT c.i_class, t.s_city,
  ss.cust / NULLIF(cs.qty, 0),
  CASE WHEN COALESCE(cs.profit, 0) > 100 THEN cs.rev ELSE (SELECT COUNT(DISTINCT d_year) FROM date_dim) END
FROM (
  SELECT DISTINCT i_class FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
) c CROSS JOIN (
  SELECT DISTINCT s_city FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
) t
LEFT JOIN ss ON ss.i_class IS NOT DISTINCT FROM c.i_class AND ss.s_city IS NOT DISTINCT FROM t.s_city
LEFT JOIN cs ON cs.i_class IS NOT DISTINCT FROM c.i_class
