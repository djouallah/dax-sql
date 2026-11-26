-- per ship mode type, the blank row's (catalog sales with no ship mode) too: catalog quantity of items at 41.92 in
-- quarters 2 and 3; the ratio of the average sale to the average profit (AVERAGE of a fixed decimal is one, to 4
-- places); m2's date range is empty, so blank
SELECT sm.sm_type,
  ABS(SUM(cs.cs_quantity) FILTER (WHERE i.i_current_price = 41.92 AND d.d_qoy IN (3, 2))) AS m0,
  ABS(ROUND(AVG(cs.cs_ext_sales_price::DOUBLE), 4) / NULLIF(ROUND(AVG(cs.cs_net_profit::DOUBLE), 4), 0)) AS m1,
  NULL AS m2
FROM catalog_sales cs LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
GROUP BY ALL
HAVING m0 IS NOT NULL OR m1 IS NOT NULL
