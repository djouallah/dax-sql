-- m0 is never blank (COALESCE): every color, the 3 lowest (ties kept); AVERAGE of a fixed decimal
-- is one, rounded half away from zero to 4 places
WITH s AS (
  SELECT i.i_color, MIN(ss.ss_ext_sales_price) AS mn
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk GROUP BY ALL
), c AS (
  SELECT i.i_color, ROUND((SUM(cs.cs_net_profit) * 1000000)::HUGEINT // NULLIF(COUNT(cs.cs_net_profit), 0) * 0.000001, 4) AS av
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk GROUP BY ALL
)
SELECT co.i_color, COALESCE(s.mn / NULLIF(c.av, 0), 0) AS m0
FROM (SELECT DISTINCT i_color FROM item) co
LEFT JOIN s ON s.i_color IS NOT DISTINCT FROM co.i_color
LEFT JOIN c ON c.i_color IS NOT DISTINCT FROM co.i_color
QUALIFY RANK() OVER (ORDER BY m0) <= 3
