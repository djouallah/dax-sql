SELECT i.i_current_price, SUM(ss.ss_net_profit) AS m0
FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
GROUP BY 1
HAVING SUM(ss.ss_net_profit) IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) = 1
