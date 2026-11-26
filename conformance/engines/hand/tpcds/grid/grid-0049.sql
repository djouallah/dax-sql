SELECT i.i_current_price, SUM(cs.cs_net_profit) AS v
FROM catalog_sales cs
JOIN promotion p ON cs.cs_promo_sk = p.p_promo_sk
JOIN item i ON p.p_item_sk = i.i_item_sk
GROUP BY i.i_current_price
