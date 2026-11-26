-- the store measures do not depend on the ship mode; the store table is not filtered by the
-- groups, so DISTINCTCOUNT(s_city) is the number of cities
WITH st AS (
  SELECT cd.cd_marital_status AS m, i.i_class AS c,
    COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS dc,
    ROUND(AVG(ss.ss_ext_sales_price), 4) AS avg_price,
    SUM(ss.ss_net_profit) AS profit, MIN(ss.ss_ext_sales_price) AS min_price
  FROM store_sales ss
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY 1, 2
), cities AS (
  SELECT COUNT(DISTINCT s_city) + MAX(CASE WHEN s_city IS NULL THEN 1 ELSE 0 END) AS n FROM store
), m0 AS (
  SELECT m, c, dc / NULLIF(avg_price, 0) AS q, CASE WHEN cities.n > 1 THEN profit ELSE min_price END AS r
  FROM st CROSS JOIN cities
), cat AS (
  SELECT cd.cd_marital_status AS m, i.i_class AS c, sm.sm_type AS s, MIN(cs.cs_net_profit) AS v
  FROM catalog_sales cs
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  GROUP BY 1, 2, 3
), sm AS (SELECT DISTINCT sm_type AS s FROM ship_mode),
-- the groups are the dimensions' values (no blank row)
g AS (
  SELECT * FROM (SELECT DISTINCT cd_marital_status AS m FROM customer_demographics)
  CROSS JOIN (SELECT DISTINCT i_class AS c FROM item) CROSS JOIN sm
), r AS (
  SELECT g.m, g.c, g.s,
    CASE WHEN m0.q IS NULL AND m0.r IS NULL THEN NULL ELSE COALESCE(m0.q, 0) - COALESCE(m0.r, 0) END AS v0,
    cat.v AS v1
  FROM g
  LEFT JOIN m0 ON m0.m IS NOT DISTINCT FROM g.m AND m0.c IS NOT DISTINCT FROM g.c
  LEFT JOIN cat ON cat.m IS NOT DISTINCT FROM g.m AND cat.c IS NOT DISTINCT FROM g.c AND cat.s IS NOT DISTINCT FROM g.s
)
SELECT m, c, s, v0, v1, v1 FROM r WHERE v0 IS NOT NULL OR v1 IS NOT NULL
