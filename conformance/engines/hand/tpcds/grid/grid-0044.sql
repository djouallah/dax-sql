SELECT d.d_dow, SUM(ss_net_profit) AS v
FROM store_sales ss LEFT JOIN date_dim d ON ss.ss_sold_date_sk = d.d_date_sk_1
GROUP BY d.d_dow
