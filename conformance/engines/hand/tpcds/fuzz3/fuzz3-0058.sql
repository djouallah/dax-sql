-- no marital status is selected: last year's store revenue (every date a year back) over all of it; the
-- catalog quantity of three education statuses over the item count (dates do not filter items)
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
)
SELECT
  (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
   WHERE d.d_date IN (SELECT dt FROM ly))
  / NULLIF((SELECT SUM(ss_ext_sales_price) FROM store_sales), 0) AS m0,
  (SELECT SUM(cs.cs_quantity) FROM catalog_sales cs JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
   WHERE cd.cd_education_status IN ('4 yr Degree', '2 yr Degree', 'Unknown'))
  / NULLIF((SELECT COUNT(*) FROM item), 0) AS m1
