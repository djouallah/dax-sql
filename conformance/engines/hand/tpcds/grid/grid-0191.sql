SELECT s_store_name, SUM(ss_net_profit)
FROM store_sales JOIN store ON s_store_sk = ss_store_sk
WHERE ss_customer_sk >= 7
GROUP BY s_store_name
