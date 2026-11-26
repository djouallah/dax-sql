SELECT SUM(ss_net_profit)
FROM store_sales
WHERE ss_promo_sk IS NOT NULL
