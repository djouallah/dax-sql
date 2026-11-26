SELECT o.cd_marital_status, f.cache_buster, SUM(f.ss_net_profit) AS v
FROM store_sales f
JOIN customer_demographics o ON f.ss_cdemo_sk = o.cd_demo_sk
GROUP BY o.cd_marital_status, f.cache_buster
