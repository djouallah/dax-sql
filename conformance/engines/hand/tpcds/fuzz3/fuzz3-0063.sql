-- per quarter past 3 and promotion: the catalog's largest profit over the average store sale outside GA
-- (blank state included; AVERAGE of a fixed decimal is one, to 4 places), minus the one quarter in context: never blank
WITH c AS (
  SELECT d.d_qoy AS q, p.p_promo_name AS pn, MAX(cs.cs_net_profit) AS mx
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_qoy > 3
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
), s AS (
  SELECT d.d_qoy AS q, p.p_promo_name AS pn, ROUND(AVG(ss.ss_ext_sales_price::DOUBLE), 4) AS av
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_qoy > 3
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  WHERE COALESCE(st.s_state, '') <> 'GA'
  GROUP BY ALL
)
SELECT g.d_qoy, g.p_promo_name, COALESCE(c.mx / NULLIF(s.av, 0), 0) - 1 AS m0
FROM (SELECT DISTINCT d_qoy FROM date_dim WHERE d_qoy > 3) gq
CROSS JOIN (SELECT DISTINCT p_promo_name FROM promotion) gp
CROSS JOIN LATERAL (SELECT gq.d_qoy, gp.p_promo_name) g
LEFT JOIN c ON c.q = g.d_qoy AND c.pn IS NOT DISTINCT FROM g.p_promo_name
LEFT JOIN s ON s.q = g.d_qoy AND s.pn IS NOT DISTINCT FROM g.p_promo_name
