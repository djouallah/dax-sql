-- SUMMARIZE's extension column sees its group as a filter on store_sales' rows (the expanded
-- table): catalog_sales is filtered by the tuples of shared dimensions (date, item, promotion,
-- address, demographic) the group's store sales have; the CALCULATE's marital and state filters
-- replace those columns. Per education status (sales with no demographic: blank):
--   store revenue (status, M/S, state not TX) > 1000: catalog quantity of the matching rows
--   else their average catalog profit < 0: store profit (status, M/S, state not TX)
--   else the matching rows' catalog profit; rounded to 1 place
WITH ss AS (
  SELECT ss.*, cd.cd_education_status AS ed, cd.cd_marital_status AS ms, s.s_state
  FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
), st AS (
  SELECT ed, SUM(ss_ext_sales_price) FILTER (WHERE ms IN ('M', 'S') AND (s_state <> 'TX' OR s_state IS NULL)) AS rev,
         SUM(ss_net_profit) FILTER (WHERE ms IN ('M', 'S') AND (s_state <> 'TX' OR s_state IS NULL)) AS np
  FROM ss GROUP BY ed
), keys AS (
  SELECT DISTINCT ed, ss_sold_date_sk, ss_item_sk, ss_promo_sk, ss_addr_sk, ss_cdemo_sk FROM ss
), c AS (
  SELECT k.ed, SUM(cs.cs_quantity) AS qty, AVG(cs.cs_net_profit) AS np_avg, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs
  JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_marital_status IN ('M', 'S')
  JOIN keys k ON k.ss_sold_date_sk = cs.cs_sold_date_sk AND k.ss_item_sk = cs.cs_item_sk AND k.ss_promo_sk = cs.cs_promo_sk
             AND k.ss_addr_sk = cs.cs_bill_addr_sk AND k.ss_cdemo_sk = cs.cs_bill_cdemo_sk
  GROUP BY k.ed
)
SELECT st.ed, round(CASE WHEN st.rev > 1000 THEN c.qty WHEN c.np_avg < 0 THEN st.np ELSE c.np END, 1) AS m0
FROM st LEFT JOIN c ON c.ed IS NOT DISTINCT FROM st.ed
