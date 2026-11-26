-- each year's YTD context holds one year: the larger of the archive's file count and 1, every year tied, and so
-- the blank year when some sale has no date
SELECT d_year, GREATEST((SELECT COUNT(*) FROM stg_tpcds_archive_log), 1) AS m0
FROM (SELECT d_year FROM date_dim
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL
          OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
        OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL
          OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim)))
