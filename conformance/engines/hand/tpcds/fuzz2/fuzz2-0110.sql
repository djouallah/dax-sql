-- married buyers: per colour and ship mode, |average catalog profit / Georgia stores' revenue (all colours)|
WITH den AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_marital_status = 'M'
  JOIN store st ON st.s_store_sk = ss.ss_store_sk AND st.s_state = 'GA'
)
SELECT i.i_color, sm.sm_type, ABS(ROUND(AVG(cs.cs_net_profit), 4) / NULLIF((SELECT rev FROM den), 0)) AS m0
FROM catalog_sales cs JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_marital_status = 'M'
LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
GROUP BY ALL
HAVING m0 IS NOT NULL
