WITH billed AS (
  SELECT cd.cd_education_status, SUM(cs.cs_quantity) AS v
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY cd.cd_education_status),
shipped AS (
  SELECT cd.cd_education_status, SUM(cs.cs_quantity) AS v
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_ship_cdemo_sk
  GROUP BY cd.cd_education_status)
SELECT COALESCE(b.cd_education_status, s.cd_education_status), b.v, s.v
FROM billed b FULL JOIN shipped s ON s.cd_education_status IS NOT DISTINCT FROM b.cd_education_status
WHERE b.v IS NOT NULL OR s.v IS NOT NULL
