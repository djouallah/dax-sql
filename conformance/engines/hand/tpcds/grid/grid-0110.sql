SELECT ss_promo_sk, SUM(ss_net_profit) AS v
FROM store_sales
GROUP BY ss_promo_sk
ORDER BY v DESC NULLS LAST, ss_promo_sk NULLS FIRST
