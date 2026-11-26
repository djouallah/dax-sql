SELECT ss_cdemo_sk, CAST(SUM(ss_net_profit) AS DOUBLE) / NULLIF(SUM(ss_net_profit), 0) AS r
FROM store_sales
GROUP BY ss_cdemo_sk
