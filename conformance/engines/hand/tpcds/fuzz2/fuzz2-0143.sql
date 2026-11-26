-- one row, item classes but accessories (a blank class kept), education Unknown: m0 ranks SUM(ss_ext_sales_price),
-- no measure, so the same for every state: 1; m1: the largest catalog profit (the same for every store state)
SELECT 1 AS m0,
  (SELECT MAX(cs.cs_net_profit)
   FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_class IS DISTINCT FROM 'accessories'
   JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_education_status IN ('zz-none', 'Unknown')) AS m1
