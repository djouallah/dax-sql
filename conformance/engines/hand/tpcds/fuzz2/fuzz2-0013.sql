-- per item category (item color never in scope): the average, over the category's prices, of store net profit
-- in the calendar's last year (prices with no profit left out; a fixed decimal); the 4 highest, ties kept
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), y AS (
  SELECT i.i_category, i.i_current_price, SUM(ss.ss_net_profit) AS profit
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN w ON d.d_date BETWEEN w.y0 AND w.y1
  GROUP BY ALL
), c AS (
  SELECT i_category, ROUND(AVG(profit), 4) AS m0 FROM y GROUP BY ALL HAVING AVG(profit) IS NOT NULL
)
SELECT i_category, m0 FROM c
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 4
