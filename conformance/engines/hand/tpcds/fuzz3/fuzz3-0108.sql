-- the archive log is related to nothing: its files for every quarter, the blank one's too (sales with no date)
SELECT q.d_qoy, (SELECT NULLIF(COUNT(*), 0) FROM stg_tpcds_archive_log) AS m0
FROM (SELECT d_qoy FROM date_dim
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)) q
