SELECT sm.sm_type, d.d_year, SUM(cs.cs_ext_sales_price) AS revenue, SUM(cs.cs_quantity) AS qty
FROM catalog_sales cs
LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
GROUP BY sm.sm_type, d.d_year
HAVING revenue IS NOT NULL OR qty IS NOT NULL
