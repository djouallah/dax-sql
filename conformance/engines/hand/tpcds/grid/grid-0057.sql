SELECT ss_cdemo_sk, SUM(ss_net_profit) AS v
FROM store_sales
WHERE COALESCE(ss_promo_sk, 0) < 4 OR ss_customer_sk >= 15
GROUP BY ss_cdemo_sk
