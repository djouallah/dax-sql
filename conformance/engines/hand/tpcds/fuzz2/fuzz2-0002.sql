-- per month: distinct store customers, the store count (no date filter reaches store), catalog profit of non-plum items
WITH ss AS (
  SELECT d.d_moy, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS cust
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY d.d_moy
), cs AS (
  SELECT d.d_moy, SUM(cs.cs_net_profit) AS profit
  FROM catalog_sales cs
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  WHERE COALESCE(i.i_color, '') <> 'plum'
  GROUP BY d.d_moy
), g AS (
  -- the months of the calendar (the store count is never blank: the dimension's values make the groups), and
  -- the blank month when a sale has no or an unknown date
  SELECT DISTINCT d_moy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
)
SELECT g.d_moy, ROUND(ss.cust, 2), (SELECT COUNT(*) FROM store), cs.profit
FROM g LEFT JOIN ss ON ss.d_moy IS NOT DISTINCT FROM g.d_moy LEFT JOIN cs ON cs.d_moy IS NOT DISTINCT FROM g.d_moy
