-- the archive is filtered by nothing; RANKX's expression has no measure (no context transition), so every month
-- ties and the status ranks 1. The statuses include the blank row when some sale has no demographic
SELECT cd_education_status, (SELECT COUNT(*) FROM stg_tpcds_archive_log) AS m0, 1 AS m1
FROM (SELECT cd_education_status FROM customer_demographics
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_bill_cdemo_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk))
