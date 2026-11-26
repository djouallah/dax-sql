SELECT ss_promo_sk, SUM(ss_net_profit)
FROM store_sales
WHERE ss_promo_sk = 4
GROUP BY ss_promo_sk
