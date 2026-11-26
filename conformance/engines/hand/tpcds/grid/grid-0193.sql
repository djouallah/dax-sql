SELECT SUM(ss_net_profit)
FROM store_sales JOIN store ON s_store_sk = ss_store_sk
