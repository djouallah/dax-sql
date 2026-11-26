-- MAX('catalog_sales'[...]) and COUNTROWS('store') see no row context (no CALCULATE): the totals;
-- catalog_sales is not related to store, so Catalog Net Profit is its total too. The revenue and
-- its YoY are blank together (no revenue, no revenue a year back).
WITH rev AS (
  SELECT s.s_city, SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss JOIN store s ON s.s_store_sk = ss.ss_store_sk
  GROUP BY 1
), c AS (
  SELECT ABS(MAX(cs_ext_sales_price)) AS mx, ABS(SUM(cs_net_profit)) AS np FROM catalog_sales
)
SELECT g.s_city,
  CASE WHEN rev.v IS NULL THEN 0
       WHEN (SELECT COUNT(DISTINCT cd_marital_status) FROM customer_demographics) = 1 THEN (SELECT NULLIF(COUNT(*), 0) FROM store) END,
  CASE WHEN c.mx IS NULL AND c.np IS NULL THEN NULL ELSE COALESCE(c.mx, 0) + COALESCE(c.np, 0) END
FROM (SELECT DISTINCT s_city FROM store) g
CROSS JOIN c
LEFT JOIN rev ON rev.s_city IS NOT DISTINCT FROM g.s_city
