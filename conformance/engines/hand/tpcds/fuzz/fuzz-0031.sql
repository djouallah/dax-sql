WITH t AS (
  SELECT CASE WHEN COALESCE((SELECT MAX(cs_net_profit) FROM catalog_sales), 0) > 1000 THEN SUM(ss_net_profit)
    ELSE NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) END AS m0
  FROM store_sales
)
SELECT * FROM t WHERE m0 IS NOT NULL
