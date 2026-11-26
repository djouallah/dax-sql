-- the measure reaches no fact the groups filter: the item brands (a blank brand counts) or the
-- archive's source rows, the larger, for every education status x state (each with its blank row when some
-- sale's key misses the table)
WITH m AS (
  SELECT greatest((SELECT NULLIF(COUNT(DISTINCT i_brand) + MAX(CASE WHEN i_brand IS NULL THEN 1 ELSE 0 END), 0) FROM item),
                  (SELECT SUM(row_count) FROM stg_tpcds_archive_log)) AS m0
), e AS (
  SELECT DISTINCT cd_education_status FROM customer_demographics
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_bill_cdemo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk)
), s AS (
  SELECT DISTINCT s_state FROM store
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)
)
SELECT e.cd_education_status, s.s_state, m.m0
FROM e CROSS JOIN s CROSS JOIN m
WHERE m.m0 IS NOT NULL
