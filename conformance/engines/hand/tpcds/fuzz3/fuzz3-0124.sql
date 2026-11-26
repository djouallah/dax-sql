-- SELECTEDVALUE of the quarter over the whole calendar is blank, so not 2: the stores of the name
-- (dates do not filter stores)
WITH q AS (SELECT CASE WHEN COUNT(DISTINCT d_qoy) = 1 THEN MIN(d_qoy) END AS q FROM date_dim),
n AS (SELECT s_store_name, COUNT(*) AS n FROM store GROUP BY ALL),
cr AS (
  SELECT cd.cd_education_status, SUM(cs.cs_ext_sales_price) AS r
  FROM catalog_sales cs JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk GROUP BY ALL
)
SELECT e.cd_education_status, sn.s_store_name,
  CASE WHEN COALESCE(q.q, 0) = 2 THEN COALESCE(cr.r, 0) ELSE n.n END AS m0
FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) e
CROSS JOIN (SELECT DISTINCT s_store_name FROM store) sn
CROSS JOIN q
LEFT JOIN n ON n.s_store_name IS NOT DISTINCT FROM sn.s_store_name
LEFT JOIN cr ON cr.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
