SELECT o.d_year, SUM(f.cs_ext_sales_price) AS v
FROM catalog_sales f
LEFT JOIN date_dim o ON f.cs_sold_date_sk = o.d_date_sk_1
GROUP BY o.d_year
