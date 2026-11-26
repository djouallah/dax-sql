SELECT ss_cdemo_sk, SUM(ss_net_profit) AS a, SUM(ss_net_profit) AS b
FROM store_sales
GROUP BY ss_cdemo_sk
