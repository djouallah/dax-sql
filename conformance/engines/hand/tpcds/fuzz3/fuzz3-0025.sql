-- MIN outside CALCULATE: no context transition, the least catalog profit on every row (every ship-mode type x
-- quarter number, each with its blank row when some sale's key misses the table)
WITH sm AS (
  SELECT DISTINCT sm_type FROM ship_mode
  UNION SELECT NULL WHERE EXISTS (FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)
), q AS (
  SELECT DISTINCT d_qoy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)
)
SELECT sm.sm_type, q.d_qoy, (SELECT MIN(cs_net_profit) FROM catalog_sales) AS m0
FROM sm CROSS JOIN q
