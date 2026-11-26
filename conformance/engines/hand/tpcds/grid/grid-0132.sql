SELECT ss_store_sk, SUM(ss_net_profit)
FROM store_sales
GROUP BY ss_store_sk
HAVING SUM(ss_ext_sales_price) IS NOT NULL
