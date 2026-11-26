SELECT d.d_qoy, MIN(cs.cs_quantity) AS m0
FROM catalog_sales cs
JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_category IN ('Men', 'Music')
LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
GROUP BY d.d_qoy
HAVING m0 IS NOT NULL
