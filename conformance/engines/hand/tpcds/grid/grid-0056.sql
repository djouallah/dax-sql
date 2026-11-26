SELECT ss_cdemo_sk, SUM(ss_ext_sales_price) AS v
FROM store_sales
WHERE ss_net_profit < -75.72 AND ss_ext_list_price BETWEEN 6.7 AND 1732.3
GROUP BY ss_cdemo_sk
