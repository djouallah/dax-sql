-- the store does not filter catalog_sales: the education's quantity a year back (with no date filter,
-- every year but the last) for every store name; m1 is never blank (0 for none)
WITH c AS (
  SELECT cd.cd_education_status AS e, SUM(cs.cs_quantity) AS v
  FROM catalog_sales cs
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year < (SELECT MAX(d_year) FROM date_dim)
  GROUP BY 1
), e AS (SELECT DISTINCT cd_education_status AS e FROM customer_demographics)
SELECT n.s_store_name, e.e, c.v, ROUND(COALESCE(c.v, 0), 2)
FROM (SELECT DISTINCT s_store_name FROM store) n CROSS JOIN e
LEFT JOIN c ON c.e IS NOT DISTINCT FROM e.e
