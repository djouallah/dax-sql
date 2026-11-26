-- one row: store profit, catalog quantity over the archive's rows, and (no brand in scope) catalog revenue
SELECT (SELECT SUM(ss_net_profit) FROM store_sales) AS m0,
  (SELECT SUM(cs_quantity) FROM catalog_sales) / NULLIF((SELECT SUM(row_count) FROM stg_tpcds_archive_log), 0) AS m1,
  (SELECT SUM(cs_ext_sales_price) FROM catalog_sales) AS m2
