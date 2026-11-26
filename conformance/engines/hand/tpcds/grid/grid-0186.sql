WITH g AS (
  SELECT cs_bill_cdemo_sk, SUM(cs_ext_sales_price) AS n, SUM(cs_net_profit) AS d
  FROM catalog_sales GROUP BY cs_bill_cdemo_sk)
SELECT cs_bill_cdemo_sk, n::DOUBLE / CASE WHEN d = 0 THEN NULL ELSE d END FROM g
