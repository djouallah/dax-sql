-- the store sales of the education status ("zz-none": none); ship modes do not reach store_sales: a category's share
-- of its year's profit, for each of the two modes (a sale with no date / item in the blank year / category)
WITH f AS (
  SELECT i.i_category, d.d_year, ss.ss_net_profit
  FROM store_sales ss
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_education_status = 'zz-none'
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), r AS (
  SELECT i_category, d_year, SUM(ss_net_profit) / NULLIF(SUM(SUM(ss_net_profit)) OVER (PARTITION BY d_year), 0) AS m0
  FROM f GROUP BY i_category, d_year
)
SELECT r.i_category, m.sm_type, r.d_year, r.m0
FROM r
CROSS JOIN (SELECT DISTINCT sm_type FROM ship_mode WHERE sm_type IN ('REGULAR', 'OVERNIGHT')) m
WHERE r.m0 IS NOT NULL
