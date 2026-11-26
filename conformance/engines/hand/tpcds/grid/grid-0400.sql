SELECT o.i_current_price, SUM(f.cs_quantity) AS v
FROM catalog_sales f
LEFT JOIN item o ON f.cs_item_sk = o.i_item_sk
GROUP BY o.i_current_price
