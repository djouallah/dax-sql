-- DATESBETWEEN from 2026-07-29 back to 2024-04-14 is empty: a distinct count of nothing, blank
SELECT (SELECT SUM(ss_net_profit) FROM store_sales) AS m0, (SELECT SUM(cs_net_profit) FROM catalog_sales) AS m1,
  (SELECT NULLIF(COUNT(DISTINCT d_year), 0) FROM date_dim WHERE d_date BETWEEN DATE '2026-07-29' AND DATE '2024-04-14') AS m2
