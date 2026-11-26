SELECT o.d_year, SUM(f.cs_quantity) AS v
FROM catalog_sales f
JOIN date_dim o ON f.cs_sold_date_sk = o.d_date_sk_1
WHERE COALESCE(f.cs_ship_addr_sk, 0) <> 10
GROUP BY o.d_year
