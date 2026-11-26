SELECT d.d_qoy, SUM(ss_net_profit) AS v
FROM store_sales ss JOIN date_dim d ON ss.ss_sold_date_sk = d.d_date_sk_1
WHERE d.d_qoy = 3
GROUP BY d.d_qoy
