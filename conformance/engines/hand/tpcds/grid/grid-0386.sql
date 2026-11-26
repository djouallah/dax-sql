SELECT o.d_qoy, SUM(f.cs_net_profit) AS v
FROM catalog_sales f
LEFT JOIN date_dim o ON f.cs_sold_date_sk = o.d_date_sk_1
WHERE COALESCE(o.d_qoy, 0) <> 3
GROUP BY o.d_qoy
