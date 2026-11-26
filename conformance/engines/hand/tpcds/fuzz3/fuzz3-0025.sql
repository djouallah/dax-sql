-- MIN outside CALCULATE: no context transition, the least catalog profit on every row
SELECT sm.sm_type, q.d_qoy, (SELECT MIN(cs_net_profit) FROM catalog_sales) AS m0
FROM (SELECT DISTINCT sm_type FROM ship_mode) sm CROSS JOIN (SELECT DISTINCT d_qoy FROM date_dim) q
