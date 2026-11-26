SELECT ss_cdemo_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
GROUP BY ss_cdemo_sk
