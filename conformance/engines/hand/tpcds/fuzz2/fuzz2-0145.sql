-- per store name, marital status and month (every one: a rank is never blank). No store quantity is over 1000, so
-- each class's value is a catalog row count, and a class's rows are among all classes' rows (the current value,
-- with no class filter): no class ranks above it, so 1. The guard fails the query should a quantity pass 1000.
SELECT n.s_store_name, m.cd_marital_status, d.d_moy,
  CASE WHEN (SELECT MAX(ss_quantity) FROM store_sales) > 1000 THEN error('a store quantity over 1000: the rank needs computing') ELSE 1 END AS m0
FROM (SELECT DISTINCT s_store_name FROM store) n
CROSS JOIN (SELECT DISTINCT cd_marital_status FROM customer_demographics) m
CROSS JOIN (SELECT DISTINCT d_moy FROM date_dim) d
