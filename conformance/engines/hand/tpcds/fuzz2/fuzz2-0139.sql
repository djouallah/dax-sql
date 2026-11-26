-- per item price (ADDCOLUMNS: AVERAGE and MIN without CALCULATE see every row): the average store quantity + the
-- price's catalog profit, and the smallest catalog sale
WITH c AS (
  SELECT i.i_current_price, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), a AS (
  SELECT AVG(ss_quantity) AS aq FROM store_sales
)
SELECT p.i_current_price,
  CASE WHEN a.aq IS NULL AND c.np IS NULL THEN NULL ELSE COALESCE(a.aq, 0) + COALESCE(c.np, 0) END AS m0,
  (SELECT MIN(cs_ext_sales_price) FROM catalog_sales) AS m1
FROM (SELECT DISTINCT i_current_price FROM item) p CROSS JOIN a
LEFT JOIN c ON c.i_current_price IS NOT DISTINCT FROM p.i_current_price
