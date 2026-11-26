SELECT SUM(f.ss_ext_sales_price) AS v
FROM store_sales f
JOIN customer_demographics o ON f.ss_cdemo_sk = o.cd_demo_sk
