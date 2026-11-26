-- every store name with every state; last year over every date: a sale whose date a year on is
-- in the calendar
WITH ly AS (
  SELECT st.s_store_name, st.s_state, SUM(ss.ss_ext_sales_price) AS r
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
  JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
)
SELECT sn.s_store_name, ss.s_state, ly.r AS m0
FROM (SELECT DISTINCT s_store_name FROM store) sn
CROSS JOIN (SELECT DISTINCT s_state FROM store) ss
LEFT JOIN ly ON ly.s_store_name IS NOT DISTINCT FROM sn.s_store_name AND ly.s_state IS NOT DISTINCT FROM ss.s_state
