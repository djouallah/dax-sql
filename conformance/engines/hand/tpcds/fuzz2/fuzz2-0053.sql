-- HASONEVALUE(s_store_name) holds only when the store table has a single name; then COUNTROWS(item) of the price
WITH one AS (SELECT COUNT(DISTINCT s_store_name) = 1 AS b FROM store),
g AS (
  SELECT i.i_current_price AS p, ABS(MIN(ss.ss_net_profit)) AS a
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY i.i_current_price),
n AS (SELECT i_current_price AS p, COUNT(*) AS c FROM item GROUP BY 1),
t AS (
  SELECT g.p, GREATEST(g.a, CASE WHEN one.b THEN n.c END) AS m0
  FROM g CROSS JOIN one LEFT JOIN n ON n.p IS NOT DISTINCT FROM g.p)
SELECT p, m0 FROM t WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) = 1
