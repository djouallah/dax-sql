-- SELECTEDVALUE of the quarter over the whole calendar is blank, so not 2: the stores of the name
-- (dates do not filter stores; the blank row, a store sale with no store, has none). Both lists include the
-- blank row when some sale has no demographic, no store
WITH q AS (SELECT CASE WHEN COUNT(DISTINCT d_qoy) = 1 THEN MIN(d_qoy) END AS q FROM date_dim),
n AS (SELECT s_store_name, COUNT(*) AS n FROM store GROUP BY ALL),
cr AS (
  SELECT cd.cd_education_status, SUM(cs.cs_ext_sales_price) AS r
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk GROUP BY ALL
)
SELECT e.cd_education_status, sn.s_store_name,
  CASE WHEN COALESCE(q.q, 0) = 2 THEN COALESCE(cr.r, 0) ELSE n.n END AS m0
FROM (SELECT cd_education_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk)
    OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_bill_cdemo_sk)
    OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk)) e
CROSS JOIN (SELECT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)) sn
CROSS JOIN q
LEFT JOIN n ON n.s_store_name IS NOT DISTINCT FROM sn.s_store_name
LEFT JOIN cr ON cr.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
