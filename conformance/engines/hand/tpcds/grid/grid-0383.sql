SELECT o.d_qoy, f.cache_buster, SUM(f.cs_net_profit) AS v
FROM catalog_sales f
LEFT JOIN date_dim o ON f.cs_sold_date_sk = o.d_date_sk_1
GROUP BY o.d_qoy, f.cache_buster
