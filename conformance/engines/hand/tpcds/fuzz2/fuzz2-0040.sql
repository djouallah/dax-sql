-- per store state, item class and month: store sales, catalog quantity (the lowest over the education
-- statuses of a sum no status filters), catalog revenue. A sale with no or an unknown store, item or date
-- is under the blank state, class or month
WITH ss AS (
  SELECT s.s_state, i.i_class, d.d_moy, COUNT(*) AS n
  FROM store_sales ss
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), cs AS (
  SELECT i.i_class, d.d_moy, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
)
SELECT st.s_state, c.i_class, m.d_moy, ss.n AS m0,
  CASE WHEN EXISTS (SELECT 1 FROM customer_demographics) THEN cs.qty END AS m1, cs.rev AS m2
FROM (
  SELECT DISTINCT s_state FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
) st
CROSS JOIN (
  -- item's blank row: an item key of a sale or a promotion it lacks, or a promotion's blank row
  SELECT DISTINCT i_class FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
) c
CROSS JOIN (
  SELECT DISTINCT d_moy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
) m
LEFT JOIN ss ON ss.s_state IS NOT DISTINCT FROM st.s_state AND ss.i_class IS NOT DISTINCT FROM c.i_class AND ss.d_moy IS NOT DISTINCT FROM m.d_moy
LEFT JOIN cs ON cs.i_class IS NOT DISTINCT FROM c.i_class AND cs.d_moy IS NOT DISTINCT FROM m.d_moy
WHERE ss.n IS NOT NULL OR cs.qty IS NOT NULL OR cs.rev IS NOT NULL
