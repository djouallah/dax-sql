-- per item price with one category: 0 when no store sale in the calendar's last year (no profit to max),
-- else blank (the promotions are never one name)
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), p AS (
  SELECT i_current_price, COUNT(DISTINCT i_category) + MAX(CASE WHEN i_category IS NULL THEN 1 ELSE 0 END) AS ncat
  FROM item GROUP BY ALL
), y AS (
  SELECT i.i_current_price, MAX(ss.ss_net_profit) AS top
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN w ON d.d_date BETWEEN w.y0 AND w.y1
  GROUP BY ALL
)
SELECT p.i_current_price, 0 AS m0
FROM p LEFT JOIN y ON y.i_current_price IS NOT DISTINCT FROM p.i_current_price
WHERE p.ncat = 1 AND y.top IS NULL AND (SELECT COUNT(DISTINCT p_promo_name) FROM promotion) <> 1
