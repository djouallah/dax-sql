-- per education status and item category (every pair: m2 is 0 since ship_mode is never one type):
-- store revenue in the calendar's last year rounded to a tenth, the lowest catalog profit, 0
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), ss AS (
  SELECT cd.cd_education_status, i.i_category, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN w ON d.d_date BETWEEN w.y0 AND w.y1
  GROUP BY ALL
), cs AS (
  SELECT cd.cd_education_status, i.i_category, MIN(cs.cs_net_profit) AS lo
  FROM catalog_sales cs JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT e.cd_education_status, c.i_category, ROUND(ss.rev, 1) AS m0, cs.lo AS m1, 0 AS m2
FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) e
CROSS JOIN (SELECT DISTINCT i_category FROM item) c
LEFT JOIN ss ON ss.cd_education_status IS NOT DISTINCT FROM e.cd_education_status AND ss.i_category IS NOT DISTINCT FROM c.i_category
LEFT JOIN cs ON cs.cd_education_status IS NOT DISTINCT FROM e.cd_education_status AND cs.i_category IS NOT DISTINCT FROM c.i_category
