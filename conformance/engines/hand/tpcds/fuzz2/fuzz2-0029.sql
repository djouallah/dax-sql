-- promotion "n st", EXPRESS ship mode (catalog only), per store city and quarter (all years):
-- m0: 1 when store revenue YoY > 1000, the quarter's dates against each a year back (d_qoy is not calendar quarters)
-- m1: when the quarter's catalog profit > 0, the average store quantity of sales with demographics; else blank
WITH ctx AS (
  SELECT d_qoy, d_date FROM date_dim
), ly AS (
  -- each quarter's dates a year back, a month's last day also reaching the 29th of February
  SELECT DISTINCT c.d_qoy, l.d_date_sk_1
  FROM ctx c
  JOIN date_dim l ON l.d_date BETWEEN CAST(c.d_date - INTERVAL 1 YEAR AS DATE)
    AND CASE WHEN c.d_date = last_day(c.d_date) AND EXISTS (SELECT 1 FROM ctx p WHERE p.d_qoy = c.d_qoy AND p.d_date = c.d_date - 1)
             THEN last_day(CAST(c.d_date - INTERVAL 1 YEAR AS DATE)) ELSE CAST(c.d_date - INTERVAL 1 YEAR AS DATE) END
), s AS (
  SELECT ss.*, st.s_city FROM store_sales ss
  JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk AND p.p_promo_name = 'n st'
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
), cur AS (
  SELECT s.s_city, d.d_qoy, SUM(s.ss_ext_sales_price) AS rev,
    AVG(s.ss_quantity) FILTER (WHERE cd.cd_demo_sk IS NOT NULL) AS avgq
  FROM s LEFT JOIN date_dim d ON d.d_date_sk_1 = s.ss_sold_date_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = s.ss_cdemo_sk
  GROUP BY ALL
), prev AS (
  SELECT s.s_city, ly.d_qoy, SUM(s.ss_ext_sales_price) AS rev
  FROM s JOIN ly ON ly.d_date_sk_1 = s.ss_sold_date_sk
  GROUP BY ALL
), cs AS (
  SELECT d.d_qoy, SUM(cs.cs_net_profit) AS profit
  FROM catalog_sales cs
  JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk AND p.p_promo_name = 'n st'
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type = 'EXPRESS'
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), v AS (
  SELECT g.s_city, g.d_qoy,
    CASE WHEN (COALESCE(g.rev, 0) - p.rev) / NULLIF(p.rev, 0) > 1000 THEN 1 END AS m0,
    CASE WHEN cs.profit > 0 THEN g.avgq END AS m1
  FROM cur g
  LEFT JOIN prev p ON p.s_city IS NOT DISTINCT FROM g.s_city AND p.d_qoy IS NOT DISTINCT FROM g.d_qoy
  LEFT JOIN cs ON cs.d_qoy IS NOT DISTINCT FROM g.d_qoy
)
SELECT * FROM v WHERE m0 IS NOT NULL OR m1 IS NOT NULL
