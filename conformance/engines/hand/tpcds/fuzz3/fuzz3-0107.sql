-- last year over every date: a sale counted when its date a year on is in the calendar
SELECT s.s_state, SUM(ss.ss_ext_sales_price) AS m0
FROM store_sales ss
JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
GROUP BY ALL
HAVING SUM(ss.ss_ext_sales_price) IS NOT NULL
