-- nothing filters the items: HASONEVALUE of the price holds only if all items share one, and
-- stores do not reach catalog_sales (Catalog Sales YoY over every date)
WITH one AS (SELECT COUNT(DISTINCT i_current_price) + MAX((i_current_price IS NULL)::INT) = 1 AS one FROM item),
c AS (
  SELECT SUM(cs.cs_quantity) AS cur, SUM(cs.cs_quantity) FILTER (WHERE n.d_date IS NOT NULL) AS ly
  FROM catalog_sales cs
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
)
SELECT st.s_state, ci.s_city, CASE WHEN one.one THEN (COALESCE(c.cur, 0) - c.ly) / NULLIF(c.ly, 0) END AS m0
FROM (SELECT DISTINCT s_state FROM store) st CROSS JOIN (SELECT DISTINCT s_city FROM store) ci CROSS JOIN one CROSS JOIN c
