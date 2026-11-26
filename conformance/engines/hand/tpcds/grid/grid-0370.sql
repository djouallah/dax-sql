SELECT o.cd_marital_status, SUM(f.ss_net_profit) AS v
FROM store_sales f
LEFT JOIN customer_demographics o ON f.ss_cdemo_sk = o.cd_demo_sk
WHERE f.ss_sold_date_sk IS NOT NULL
GROUP BY o.cd_marital_status
