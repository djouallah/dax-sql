-- per item class and color:
-- m0: no REGULAR catalog sale ? 0 : the quarters with more than one promotion of more than one distinct store customer
-- m1: the rank, among the education statuses, of the rank among the promotions of store net profit in the
--     calendar's last year (each status's inner rank against the one over every status)
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), g AS (
  SELECT DISTINCT i_class, i_color FROM item
), reg AS (
  SELECT DISTINCT i.i_class, i.i_color
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type = 'REGULAR'
  WHERE cs.cs_quantity IS NOT NULL
), dc AS (
  SELECT i.i_class, i.i_color, d.d_qoy, p.p_promo_name,
    COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS cust
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  GROUP BY ALL
), qs AS (
  SELECT i_class, i_color, COUNT(*) AS n FROM (
    SELECT i_class, i_color, d_qoy FROM dc WHERE cust > 1 GROUP BY ALL HAVING COUNT(*) > 1
  ) GROUP BY ALL
), y AS (
  -- last-year store profit per class, color, status (es = 1: every status) and promotion (ps = 1: every promotion)
  SELECT i.i_class, i.i_color, cd.cd_education_status AS e, p.p_promo_name AS p,
    GROUPING(cd.cd_education_status) AS es, GROUPING(p.p_promo_name) AS ps, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN w ON d.d_date BETWEEN w.y0 AND w.y1
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  GROUP BY GROUPING SETS ((i.i_class, i.i_color, cd.cd_education_status, p.p_promo_name), (i.i_class, i.i_color, cd.cd_education_status),
                          (i.i_class, i.i_color, p.p_promo_name), (i.i_class, i.i_color))
), es AS (
  SELECT DISTINCT cd_education_status AS e, 0 AS es FROM customer_demographics UNION ALL SELECT NULL, 1
), inner_rank AS (
  -- per class, color and status (or every status): 1 + the promotions whose profit beats the one over every promotion
  SELECT g.i_class, g.i_color, es.e, es.es,
    1 + (SELECT COUNT(*) FROM (SELECT DISTINCT p_promo_name FROM promotion) pp
         LEFT JOIN y yp ON yp.ps = 0 AND yp.es = es.es AND yp.e IS NOT DISTINCT FROM es.e AND yp.p IS NOT DISTINCT FROM pp.p_promo_name
           AND yp.i_class IS NOT DISTINCT FROM g.i_class AND yp.i_color IS NOT DISTINCT FROM g.i_color
         WHERE COALESCE(yp.np, 0) > COALESCE(ya.np, 0)) AS r
  FROM g CROSS JOIN es
  LEFT JOIN y ya ON ya.ps = 1 AND ya.es = es.es AND ya.e IS NOT DISTINCT FROM es.e
    AND ya.i_class IS NOT DISTINCT FROM g.i_class AND ya.i_color IS NOT DISTINCT FROM g.i_color
)
SELECT g.i_class, g.i_color,
  CASE WHEN NOT EXISTS (SELECT 1 FROM reg r WHERE r.i_class IS NOT DISTINCT FROM g.i_class AND r.i_color IS NOT DISTINCT FROM g.i_color) THEN 0
       ELSE qs.n END AS m0,
  1 + (SELECT COUNT(*) FROM inner_rank x WHERE x.es = 0 AND x.i_class IS NOT DISTINCT FROM g.i_class AND x.i_color IS NOT DISTINCT FROM g.i_color AND x.r > a.r) AS m1
FROM g
LEFT JOIN qs ON qs.i_class IS NOT DISTINCT FROM g.i_class AND qs.i_color IS NOT DISTINCT FROM g.i_color
JOIN inner_rank a ON a.es = 1 AND a.i_class IS NOT DISTINCT FROM g.i_class AND a.i_color IS NOT DISTINCT FROM g.i_color
