-- single customers; every ship mode type by every store state (m1, the statuses left: 1, is never blank);
-- m0: store revenue of the state, every date a year back (the ship mode reaches no store sale)
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT st.s_state, SUM(ss.ss_ext_sales_price) AS rev_ly
  FROM store_sales ss
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_marital_status = 'S'
  JOIN store st ON st.s_store_sk = ss.ss_store_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date IN (SELECT ly FROM shift)
  GROUP BY ALL
), k AS (
  SELECT ROUND(NULLIF(COUNT(DISTINCT cd_marital_status) + (COUNT(*) > COUNT(cd_marital_status))::INT, 0), 2) AS n
  FROM customer_demographics WHERE cd_marital_status = 'S'
)
SELECT t.sm_type, g.s_state, s.rev_ly AS m0, k.n AS m1
FROM (SELECT DISTINCT sm_type FROM ship_mode) t CROSS JOIN (SELECT DISTINCT s_state FROM store) g CROSS JOIN k
LEFT JOIN s ON s.s_state IS NOT DISTINCT FROM g.s_state
WHERE s.rev_ly IS NOT NULL OR k.n IS NOT NULL
