-- per store name, marital status and month (every one, and each dimension's blank row when a sale's key misses it:
-- a rank is never blank). No store quantity is over 1000, so each class's value is a catalog row count, and a
-- class's rows are among all classes' rows (the current value, with no class filter): no class ranks above it, so
-- 1. The guard fails the query should a quantity pass 1000.
WITH n AS (
  SELECT DISTINCT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
), m AS (
  SELECT DISTINCT cd_marital_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
                       OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_ship_cdemo_sk IS NULL
                                    OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
                                    OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
), d AS (
  SELECT DISTINCT d_moy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
                       OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
)
SELECT n.s_store_name, m.cd_marital_status, d.d_moy,
  CASE WHEN (SELECT MAX(ss_quantity) FROM store_sales) > 1000 THEN error('a store quantity over 1000: the rank needs computing') ELSE 1 END AS m0
FROM n CROSS JOIN m CROSS JOIN d
