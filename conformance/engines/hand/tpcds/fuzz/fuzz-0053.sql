-- single customers; every ship mode type by every store state (m1, the statuses left: 1, is never blank);
-- m0: store revenue of the state, every date a year back (the ship mode reaches no store sale). The blank ship
-- mode / store state are rows too when some sale has none (the blank state's store sales: those of no store).
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT st.s_state, SUM(ss.ss_ext_sales_price) AS rev_ly
  FROM store_sales ss
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_marital_status = 'S'
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date IN (SELECT ly FROM shift)
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), k AS (
  SELECT ROUND(NULLIF(COUNT(DISTINCT cd_marital_status) + (COUNT(*) > COUNT(cd_marital_status))::INT, 0), 2) AS n
  FROM customer_demographics WHERE cd_marital_status = 'S'
)
SELECT t.sm_type, g.s_state, s.rev_ly AS m0, k.n AS m1
FROM (SELECT sm_type FROM ship_mode UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales WHERE cs_ship_mode_sk IS NULL OR cs_ship_mode_sk NOT IN (SELECT sm_ship_mode_sk FROM ship_mode))) t
CROSS JOIN (SELECT s_state FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) g
CROSS JOIN k
LEFT JOIN s ON s.s_state IS NOT DISTINCT FROM g.s_state
WHERE s.rev_ly IS NOT NULL OR k.n IS NOT NULL
