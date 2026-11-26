-- every color x marital status (m0 is never blank):
--   m0: catalog profit (bill-to), or 0
--   m1: store revenue on every date a year back
--   m2: catalog profit over RANKX of COUNTROWS(store_sales), with no context transition: rank 1
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), c AS (
  SELECT i.i_color, cd.cd_marital_status, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), s AS (
  SELECT i.i_color, cd.cd_marital_status, SUM(ss.ss_ext_sales_price) AS rev_ly
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN ly ON ly.dt = d.d_date
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
)
SELECT g.i_color, m.cd_marital_status, COALESCE(c.np, 0) AS m0, s.rev_ly AS m1, c.np AS m2
FROM (SELECT DISTINCT i_color FROM item) g CROSS JOIN (SELECT DISTINCT cd_marital_status FROM customer_demographics) m
LEFT JOIN c ON c.i_color IS NOT DISTINCT FROM g.i_color AND c.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
LEFT JOIN s ON s.i_color IS NOT DISTINCT FROM g.i_color AND s.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
