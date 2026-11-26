SELECT o.d_year, SUM(f.cs_ext_sales_price) AS v
FROM catalog_sales f
LEFT JOIN date_dim o ON f.cs_sold_date_sk = o.d_date_sk_1
WHERE COALESCE(o.d_dow, 0) BETWEEN 0 AND 4
GROUP BY o.d_year
