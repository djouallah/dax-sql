SELECT ss_cdemo_sk, SUM(ss_net_profit) AS v
FROM store_sales
GROUP BY ss_cdemo_sk
ORDER BY v DESC NULLS LAST, ss_cdemo_sk NULLS FIRST
