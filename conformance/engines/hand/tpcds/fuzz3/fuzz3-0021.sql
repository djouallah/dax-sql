-- items of the two brands; per marital status x ship-mode type:
--   status M: MAXX over the store names of MIN(ss_net_profit), which has no context transition:
--     the least store profit of the status (ship_mode filters no store sale)
--   else: TOTALYTD of catalog YoY: the last date's year to it, against those dates a year back
WITH ytd AS (
  SELECT d_date AS dt FROM date_dim WHERE d_date BETWEEN (SELECT date_trunc('year', max(d_date)) FROM date_dim) AND (SELECT max(d_date) FROM date_dim)
), ly AS (
  SELECT (dt - INTERVAL 1 YEAR)::DATE AS dt FROM ytd
  UNION SELECT last_day((dt - INTERVAL 1 YEAR)::DATE) FROM ytd WHERE dt = last_day(dt)
), it AS (
  SELECT i_item_sk FROM item WHERE i_brand IN ('scholaruniv #4', 'scholaruniv #6')
), sp AS (
  SELECT cd.cd_marital_status, MIN(ss.ss_net_profit) AS np_min
  FROM store_sales ss JOIN it ON it.i_item_sk = ss.ss_item_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), cq AS (
  SELECT cd.cd_marital_status, sm.sm_type,
         SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ytd)) AS qty,
         SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS qty_ly
  FROM catalog_sales cs JOIN it ON it.i_item_sk = cs.cs_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  GROUP BY ALL
), g AS (
  SELECT m.cd_marital_status, t.sm_type,
         CASE WHEN m.cd_marital_status = 'M' THEN (CASE WHEN EXISTS (SELECT 1 FROM store) THEN sp.np_min END)
              ELSE (COALESCE(cq.qty, 0) - cq.qty_ly) / NULLIF(cq.qty_ly, 0) END AS m0
  FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics) m
  CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode) t
  LEFT JOIN sp ON sp.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
  LEFT JOIN cq ON cq.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status AND cq.sm_type IS NOT DISTINCT FROM t.sm_type
)
SELECT * FROM g WHERE m0 IS NOT NULL
