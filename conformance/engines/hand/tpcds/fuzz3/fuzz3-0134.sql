-- TOTALYTD over every date (twice): the calendar's last year; stores do not reach catalog_sales
WITH c AS (
  SELECT p.p_promo_name, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year = (SELECT year(MAX(d_date)) FROM date_dim)
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
)
SELECT st.s_state, pn.p_promo_name, c.q AS m0
FROM (SELECT DISTINCT s_state FROM store) st
CROSS JOIN (SELECT DISTINCT p_promo_name FROM promotion) pn
JOIN c ON c.p_promo_name IS NOT DISTINCT FROM pn.p_promo_name
WHERE c.q IS NOT NULL
