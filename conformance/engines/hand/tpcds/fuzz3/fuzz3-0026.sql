-- PARALLELPERIOD(+1 month) of every date: the whole months from the first date's month + 1 to the
-- last date's month + 1, as far as the dates go. Every price x quarter number of those dates
-- (COUNTROWS(item) is never blank): store distinct customers (a blank customer counts) and items
WITH per AS (
  SELECT d_date_sk_1, d_qoy FROM date_dim
  WHERE d_date >= (SELECT date_trunc('month', min(d_date)) + INTERVAL 1 MONTH FROM date_dim)
    AND d_date <= (SELECT last_day((max(d_date) + INTERVAL 1 MONTH)::DATE) FROM date_dim)
), c AS (
  SELECT i.i_current_price, p.d_qoy,
         COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS n
  FROM store_sales ss JOIN per p ON p.d_date_sk_1 = ss.ss_sold_date_sk LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
)
SELECT pr.i_current_price, q.d_qoy, c.n AS m0, pr.items AS m1
FROM (SELECT i_current_price, COUNT(*) AS items FROM item GROUP BY ALL) pr
CROSS JOIN (SELECT DISTINCT d_qoy FROM per) q
LEFT JOIN c ON c.i_current_price IS NOT DISTINCT FROM pr.i_current_price AND c.d_qoy = q.d_qoy
