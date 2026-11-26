-- neither table filters the items: every color counted (a blank color one more value), for each pair, the blank
-- rows' too (a sale with no demographic, a catalog sale with no ship mode)
SELECT e.cd_education_status, m.sm_type, n.n
FROM (SELECT cd_education_status FROM customer_demographics
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_bill_cdemo_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk)) e
CROSS JOIN (SELECT sm_type FROM ship_mode
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk)) m
CROSS JOIN (SELECT COUNT(DISTINCT i_color) + MAX((i_color IS NULL)::INT) AS n FROM item) n
