-- every quarter number x promotion name (each with its blank row when some sale's key misses the table):
--   m0: RANKX over the prices of MAX(cs_quantity), which has no context transition: always 1
--   m1: DATESBETWEEN from after to before is empty: no rows, blank
--   m2: catalog quantity (a blank name also holds the sales with no promotion)
WITH q AS (
  SELECT d.d_qoy, p.p_promo_name, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
), y AS (
  SELECT DISTINCT d_qoy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)
), n AS (
  SELECT DISTINCT p_promo_name FROM promotion
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN promotion ON p_promo_sk = ss_promo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN promotion ON p_promo_sk = cs_promo_sk)
)
SELECT y.d_qoy, n.p_promo_name, 1 AS m0, NULL::DOUBLE AS m1, q.qty AS m2
FROM y CROSS JOIN n
LEFT JOIN q ON q.d_qoy IS NOT DISTINCT FROM y.d_qoy AND q.p_promo_name IS NOT DISTINCT FROM n.p_promo_name
