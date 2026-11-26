SELECT o.cd_demo_sk, SUM(f.ss_ext_sales_price) AS v
FROM store_sales f
LEFT JOIN customer_demographics o ON f.ss_cdemo_sk = o.cd_demo_sk
WHERE f.ss_sold_date_sk IN (2461024, 2460838)
GROUP BY o.cd_demo_sk
