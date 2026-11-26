SELECT ss_promo_sk, SUM(ss_net_profit) AS v
FROM store_sales
GROUP BY ss_promo_sk
HAVING SUM(ss_ext_sales_price) > 0
