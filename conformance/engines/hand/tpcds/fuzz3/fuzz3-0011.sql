-- m0: ISINSCOPE is false in ROW: the store's distinct customers (a blank customer counts)
-- m1: over the marital statuses of catalog_sales (by the bill-to demographic, blank for no
--     match), SELECTEDVALUE(i_brand) is blank: the status's store distinct customers, summed
WITH g AS (
  SELECT DISTINCT cd.cd_marital_status
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
), sdc AS (
  SELECT cd.cd_marital_status,
         COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS n
  FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
)
SELECT
  (SELECT abs(COUNT(DISTINCT ss_customer_sk) + MAX(CASE WHEN ss_customer_sk IS NULL THEN 1 ELSE 0 END)) FROM store_sales) AS m0,
  (SELECT SUM(sdc.n) FROM g JOIN sdc ON sdc.cd_marital_status IS NOT DISTINCT FROM g.cd_marital_status) AS m1
