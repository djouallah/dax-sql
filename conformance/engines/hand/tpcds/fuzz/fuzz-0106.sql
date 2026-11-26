-- the store does not filter catalog_sales: the education's quantity a year back (with no date filter,
-- every year but the last) for every store name; m1 is never blank (0 for none). A sale with no or an
-- unknown store or demographics makes a blank name or status: the blank status's quantity is the
-- quantity of catalog sales with no (or an unknown) bill demographics, the blank name's as any name's
WITH c AS (
  SELECT cd.cd_education_status AS e, SUM(cs.cs_quantity) AS v
  FROM catalog_sales cs
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year < (SELECT MAX(d_year) FROM date_dim)
  GROUP BY 1
), e AS (
  SELECT DISTINCT cd_education_status AS e FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
      OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
), n AS (
  SELECT DISTINCT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
)
SELECT n.s_store_name, e.e, c.v, ROUND(COALESCE(c.v, 0), 2)
FROM n CROSS JOIN e
LEFT JOIN c ON c.e IS NOT DISTINCT FROM e.e
