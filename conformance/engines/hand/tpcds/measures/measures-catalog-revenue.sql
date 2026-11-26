SELECT sm.sm_type, SUM(cs.cs_ext_sales_price) AS revenue
FROM catalog_sales cs LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
GROUP BY sm.sm_type
HAVING SUM(cs.cs_ext_sales_price) IS NOT NULL
