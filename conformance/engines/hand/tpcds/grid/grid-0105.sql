-- a blank compares as 0
SELECT ss_promo_sk, SUM(ss_net_profit)
FROM store_sales
WHERE ss_item_sk BETWEEN 1 AND 7 OR COALESCE(cache_buster, 0) BETWEEN 0 AND 3
GROUP BY ss_promo_sk
