SELECT sm.sm_type, MIN(cs.cs_ext_sales_price) AS v
FROM catalog_sales cs
JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_date BETWEEN DATE '1999-01-01' AND DATE '2026-07-30'
LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
GROUP BY 1
HAVING MIN(cs.cs_ext_sales_price) IS NOT NULL
QUALIFY RANK() OVER (ORDER BY MIN(cs.cs_ext_sales_price) DESC) <= 2
