SELECT ss_cdemo_sk, ss_store_sk, SUM(ss_net_profit) AS v
FROM store_sales
GROUP BY ss_cdemo_sk, ss_store_sk
