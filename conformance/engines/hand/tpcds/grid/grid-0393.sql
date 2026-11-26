SELECT o.d_year, f.cs_ship_cdemo_sk, SUM(f.cs_quantity) AS v
FROM catalog_sales f
LEFT JOIN date_dim o ON f.cs_sold_date_sk = o.d_date_sk_1
GROUP BY o.d_year, f.cs_ship_cdemo_sk
