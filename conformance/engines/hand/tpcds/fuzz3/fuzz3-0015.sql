-- per category x education status (all of each: VALUES ignores the row context): the item prices
-- whose catalog profit (that category, bill-to education status, the price) from 2026-09-08 to
-- 2026-10-07 is past 1; the store city filter reaches no catalog sale and USERELATIONSHIP to an
-- unfiltered customer_address changes nothing
WITH np AS (
  SELECT i.i_category, cd.cd_education_status, i.i_current_price, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  WHERE d.d_date > DATE '2026-10-07' - INTERVAL 1 MONTH AND d.d_date <= DATE '2026-10-07'
  GROUP BY ALL
  HAVING SUM(cs.cs_net_profit) > 1
), n AS (
  SELECT i_category, cd_education_status, COUNT(*) AS n FROM np GROUP BY ALL
)
SELECT c.i_category, e.cd_education_status, n.n AS m0
FROM (SELECT DISTINCT i_category FROM item) c CROSS JOIN (SELECT DISTINCT cd_education_status FROM customer_demographics) e
LEFT JOIN n ON n.i_category IS NOT DISTINCT FROM c.i_category AND n.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
