SELECT i.i_brand, COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT AS v
FROM store_sales ss
JOIN promotion p ON ss.ss_promo_sk = p.p_promo_sk
JOIN item i ON p.p_item_sk = i.i_item_sk
GROUP BY i.i_brand
