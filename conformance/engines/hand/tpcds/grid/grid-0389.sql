SELECT SUM(f.cs_quantity) AS v
FROM catalog_sales f
JOIN item o ON f.cs_item_sk = o.i_item_sk
