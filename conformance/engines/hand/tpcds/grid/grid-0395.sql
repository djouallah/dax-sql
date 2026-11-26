SELECT o.i_size, SUM(f.cs_ext_sales_price) AS v
FROM catalog_sales f
JOIN item o ON f.cs_item_sk = o.i_item_sk
GROUP BY o.i_size
