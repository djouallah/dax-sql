-- per existing quarter number x year (and the date's blank row, when a sale's date is missing: those sales'
-- group), marital status M ("zz-none" matches none): the FILTER's SUM has no context transition, so all the item
-- prices or none: all if the group's store profit is past 1000, else 0
WITH np AS (
  SELECT d.d_qoy, d.d_year, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_marital_status IN ('zz-none', 'M')
  GROUP BY ALL
), g AS (
  SELECT DISTINCT d_qoy, d_year FROM date_dim
  UNION SELECT NULL, NULL WHERE EXISTS (FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
                             OR EXISTS (FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)
)
SELECT g.d_qoy, g.d_year, CASE WHEN np.np > 1000 THEN (SELECT COUNT(DISTINCT i_current_price) + (COUNT(*) > COUNT(i_current_price)
      OR EXISTS (FROM store_sales ANTI JOIN item ON i_item_sk = ss_item_sk)
      OR EXISTS (FROM catalog_sales ANTI JOIN item ON i_item_sk = cs_item_sk)
      OR EXISTS (FROM promotion ANTI JOIN item ON i_item_sk = p_item_sk))::INT FROM item) ELSE 0 END AS m0
FROM g
LEFT JOIN np ON np.d_qoy IS NOT DISTINCT FROM g.d_qoy AND np.d_year IS NOT DISTINCT FROM g.d_year
