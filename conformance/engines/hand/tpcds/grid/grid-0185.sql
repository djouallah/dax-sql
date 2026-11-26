WITH g AS (
  SELECT cs_bill_cdemo_sk, SUM(cs_net_profit) AS m
  FROM catalog_sales GROUP BY cs_bill_cdemo_sk)
-- blank * 2 is blank, blank + 1 is 1
SELECT cs_bill_cdemo_sk, m * 2, COALESCE(m, 0) + 1, COALESCE(m, 0) FROM g
