SELECT s.s_store_name, SUM(ss.ss_net_profit) AS profit
FROM store_sales ss LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
GROUP BY s.s_store_name
HAVING SUM(ss.ss_net_profit) IS NOT NULL
