SELECT SUM(f.cs_net_profit) AS v
FROM catalog_sales f
JOIN date_dim o ON f.cs_sold_date_sk = o.d_date_sk_1
