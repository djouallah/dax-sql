SELECT o.cd_demo_sk, f.ss_item_sk, SUM(f.ss_net_profit) AS v
FROM store_sales f
LEFT JOIN customer_demographics o ON f.ss_cdemo_sk = o.cd_demo_sk
GROUP BY o.cd_demo_sk, f.ss_item_sk
