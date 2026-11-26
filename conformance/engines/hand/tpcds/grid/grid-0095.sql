SELECT d.i_current_price, SUM(ss_net_profit) AS v
FROM store_sales ss LEFT JOIN item d ON ss.ss_item_sk = d.i_item_sk
WHERE COALESCE(ss.ss_cdemo_sk, 0) <> 8
GROUP BY d.i_current_price
