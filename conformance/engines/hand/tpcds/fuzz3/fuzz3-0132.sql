-- every store name with every state; last year over every date: a sale whose date a year on is
-- in the calendar. Names and states include the blank row when some store sale has no store (its sales there)
WITH b AS (SELECT 1 WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)),
ly AS (
  SELECT st.s_store_name, st.s_state, SUM(ss.ss_ext_sales_price) AS r
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
)
SELECT sn.s_store_name, ss.s_state, ly.r AS m0
FROM (SELECT s_store_name FROM store UNION SELECT NULL FROM b) sn
CROSS JOIN (SELECT s_state FROM store UNION SELECT NULL FROM b) ss
LEFT JOIN ly ON ly.s_store_name IS NOT DISTINCT FROM sn.s_store_name AND ly.s_state IS NOT DISTINCT FROM ss.s_state
