SELECT o.d_year, SUM(f.cs_quantity) AS v
FROM catalog_sales f
LEFT JOIN date_dim o ON f.cs_sold_date_sk = o.d_date_sk_1
WHERE f.cs_bill_addr_sk BETWEEN 1 AND 6
GROUP BY o.d_year
