-- DATESBETWEEN from a later date to an earlier one: no dates, so both are blank
WITH s AS (
  SELECT i.i_class, ROUND(AVG(ss.ss_net_profit), 4) AS av, MAX(ss.ss_quantity) AS mx
  FROM store_sales ss
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date BETWEEN DATE '2025-08-03' AND DATE '2024-08-12'
  GROUP BY 1
)
SELECT c.i_class, CASE WHEN s.av IS NULL AND s.mx IS NULL THEN NULL ELSE GREATEST(COALESCE(s.av, 0), COALESCE(s.mx, 0)) END
FROM (SELECT DISTINCT i_class FROM item) c
LEFT JOIN s ON s.i_class IS NOT DISTINCT FROM c.i_class
