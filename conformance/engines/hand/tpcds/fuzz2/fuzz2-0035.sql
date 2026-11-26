-- per item price: store net profit; the 4 highest, ties kept
SELECT i.i_current_price, SUM(ss.ss_net_profit) AS m0
FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
GROUP BY i.i_current_price
HAVING m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 4
