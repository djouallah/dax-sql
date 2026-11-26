-- per item price (no ISINSCOPE in ADDCOLUMNS; the SUMX sums the whole store quantity, no context transition):
-- the store revenue of the price (the measure's context transition) of every date a year back
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT i.i_current_price, SUM(ss.ss_ext_sales_price) AS rev_ly
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date IN (SELECT ly FROM shift)
  GROUP BY ALL
), q AS (
  SELECT ROUND(SUM(ss_quantity), 1) AS qty FROM store_sales
)
SELECT p.i_current_price, CASE WHEN q.qty IS NULL THEN 0 ELSE s.rev_ly END AS m0
FROM (SELECT DISTINCT i_current_price FROM item) p CROSS JOIN q
LEFT JOIN s ON s.i_current_price IS NOT DISTINCT FROM p.i_current_price
