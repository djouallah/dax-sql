-- per existing quarter number x year, marital status M ("zz-none" matches none): the FILTER's
-- SUM has no context transition, so all the item prices or none: all if the group's store
-- profit is past 1000, else 0
WITH np AS (
  SELECT d.d_qoy, d.d_year, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_marital_status IN ('zz-none', 'M')
  GROUP BY ALL
)
SELECT g.d_qoy, g.d_year, CASE WHEN np.np > 1000 THEN (SELECT COUNT(DISTINCT i_current_price) + MAX(CASE WHEN i_current_price IS NULL THEN 1 ELSE 0 END) FROM item) ELSE 0 END AS m0
FROM (SELECT DISTINCT d_qoy, d_year FROM date_dim) g
LEFT JOIN np ON np.d_qoy IS NOT DISTINCT FROM g.d_qoy AND np.d_year IS NOT DISTINCT FROM g.d_year
