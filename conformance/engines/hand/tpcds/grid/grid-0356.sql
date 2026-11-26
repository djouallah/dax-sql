SELECT o.cd_marital_status, SUM(f.ss_ext_sales_price) AS v
FROM store_sales f
JOIN customer_demographics o ON f.ss_cdemo_sk = o.cd_demo_sk
WHERE f.ss_customer_sk = 39
GROUP BY o.cd_marital_status
