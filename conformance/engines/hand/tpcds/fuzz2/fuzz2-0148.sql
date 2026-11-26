-- per class, year and category (every one, and the item's and date's blank rows when a key misses them: m1 is the
-- store count, ship mode not in scope). m0: only with a single marital status in the table (not here), the largest
-- catalog profit from 2025-03-08 to 2025-11-22 (the year filter replaced)
WITH mx AS (
  SELECT i.i_class, i.i_category, MAX(cs.cs_net_profit) AS mx
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_date BETWEEN DATE '2025-03-08' AND DATE '2025-11-22'
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), k AS (
  SELECT DISTINCT i_class, i_category FROM item
  UNION SELECT NULL, NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
                             OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
                             OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
), y AS (
  SELECT DISTINCT d_year FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
                       OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
)
SELECT k.i_class, y.d_year, k.i_category,
  CASE WHEN (SELECT COUNT(DISTINCT cd_marital_status) + MAX(CASE WHEN cd_marital_status IS NULL THEN 1 ELSE 0 END) FROM customer_demographics) = 1
       THEN mx.mx END AS m0,
  ABS((SELECT COUNT(*) FROM store)) AS m1
FROM k CROSS JOIN y
LEFT JOIN mx ON mx.i_class IS NOT DISTINCT FROM k.i_class AND mx.i_category IS NOT DISTINCT FROM k.i_category
