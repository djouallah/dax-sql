-- m1 ignores the demographics (the store table is not filtered by them): Fairview's store names
WITH m0 AS (
  SELECT cd.cd_marital_status AS k, MIN(cs.cs_ext_sales_price) AS v
  FROM catalog_sales cs
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type = 'REGULAR'
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY 1
), m2 AS (
  SELECT cd.cd_marital_status AS k, SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY 1
), m1 AS (
  SELECT NULLIF(COUNT(DISTINCT s_store_name) + MAX(CASE WHEN s_store_name IS NULL THEN 1 ELSE 0 END), 0) AS v
  FROM store WHERE s_city = 'Fairview'
), g AS (
  SELECT DISTINCT cd_marital_status AS k FROM customer_demographics
)
SELECT g.k, m0.v, m1.v, m2.v
FROM g CROSS JOIN m1
LEFT JOIN m0 ON m0.k IS NOT DISTINCT FROM g.k
LEFT JOIN m2 ON m2.k IS NOT DISTINCT FROM g.k
WHERE m0.v IS NOT NULL OR m1.v IS NOT NULL OR m2.v IS NOT NULL
