SELECT o.cd_demo_sk, SUM(f.ss_net_profit) AS v
FROM store_sales f
JOIN customer_demographics o ON f.ss_cdemo_sk = o.cd_demo_sk
WHERE o.cd_marital_status = 'S'
GROUP BY o.cd_demo_sk
