SELECT ss_cdemo_sk, SUM(ss_net_profit) AS v
FROM store_sales
WHERE COALESCE(ss_ext_sales_price, 0) < 457.98 OR COALESCE(ss_customer_sk, 0) <> 7
GROUP BY ss_cdemo_sk
