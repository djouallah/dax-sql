-- per class (ADDCOLUMNS' row context: only measures see the class): the class's store profit share when the
-- stores have one state; when the whole catalog revenue over the class's last-year catalog quantity (every date a
-- year back) is positive, distinct customers over an empty date range (blank), else the catalog's smallest sale
-- or quantity, by whether the largest store sale passes 1000. Store's blank row (sales of no store) is a blank
-- state; item's (promotions or sales of no item, or sales of no promotion: its item is blank too) a blank class.
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), q AS (
  SELECT i.i_class, SUM(cs.cs_quantity) AS sply
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_date IN (SELECT dt FROM ly)
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), p AS (
  SELECT i.i_class, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), k AS (
  SELECT (SELECT COUNT(DISTINCT s_state) + (COUNT(*) > COUNT(s_state) OR EXISTS (SELECT 1 FROM store_sales
            WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))::INT FROM store) = 1 AS one_state,
    (SELECT SUM(ss_net_profit) FROM store_sales) AS np, (SELECT MAX(ss_ext_sales_price) FROM store_sales) AS mx,
    SUM(cs_ext_sales_price) AS rev, MIN(cs_ext_sales_price) AS mn, MIN(cs_quantity) AS mq
  FROM catalog_sales
), g AS (
  SELECT DISTINCT i_class FROM item
  UNION
  SELECT NULL WHERE EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
                 OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
                 OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
)
SELECT g.i_class,
  CASE WHEN k.one_state THEN p.np / NULLIF(k.np, 0) END AS m0,
  CASE WHEN k.rev / NULLIF(q.sply, 0) > 0 THEN NULL WHEN k.mx > 1000 THEN k.mn ELSE k.mq END AS m1
FROM g CROSS JOIN k
LEFT JOIN q ON q.i_class IS NOT DISTINCT FROM g.i_class
LEFT JOIN p ON p.i_class IS NOT DISTINCT FROM g.i_class
