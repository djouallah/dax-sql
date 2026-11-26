-- TOTALYTD over every date (twice): the calendar's last year; stores do not reach catalog_sales, so every
-- state (the blank one of store's blank row, sales of no store, too) has each promotion name's quantity
-- (catalog sales of no promotion: the blank name)
WITH c AS (
  SELECT p.p_promo_name, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year = (SELECT year(MAX(d_date)) FROM date_dim)
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
)
SELECT st.s_state, c.p_promo_name, c.q AS m0
FROM (SELECT DISTINCT s_state FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) st
CROSS JOIN c
WHERE c.q IS NOT NULL
