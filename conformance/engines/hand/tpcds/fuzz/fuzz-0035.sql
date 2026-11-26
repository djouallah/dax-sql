-- 2024 (no year -1), catalog ship modes OVERNIGHT and REGULAR; m0: the most store profit (items exist);
-- m1: twice the store revenue of 2024 to its last date (the year to date of the year's last date) plus the
-- catalog profit of the education status (the store state reaches no catalog sale); every state by every
-- status (the dimensions' values, as dax-sql has them: no blank row)
WITH s AS (
  SELECT st.s_state, cd.cd_education_status, MAX(ss.ss_net_profit) AS maxp, SUM(ss.ss_ext_sales_price) AS ytd
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year IN (2024, -1)
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), c AS (
  SELECT cd.cd_education_status, SUM(cs.cs_net_profit) AS profit
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year IN (2024, -1)
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type IN ('OVERNIGHT', 'REGULAR')
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), g AS (
  SELECT * FROM (SELECT DISTINCT s_state FROM store) CROSS JOIN (SELECT DISTINCT cd_education_status FROM customer_demographics)
), t AS (
  SELECT g.s_state, g.cd_education_status,
    CASE WHEN (SELECT COUNT(*) FROM item) = 0 THEN 0 ELSE s.maxp END AS m0,
    CASE WHEN s.ytd IS NOT NULL OR c.profit IS NOT NULL THEN COALESCE(s.ytd * 2, 0) + COALESCE(c.profit, 0) END AS m1
  FROM g
  LEFT JOIN s ON s.s_state IS NOT DISTINCT FROM g.s_state AND s.cd_education_status IS NOT DISTINCT FROM g.cd_education_status
  LEFT JOIN c ON c.cd_education_status IS NOT DISTINCT FROM g.cd_education_status
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
