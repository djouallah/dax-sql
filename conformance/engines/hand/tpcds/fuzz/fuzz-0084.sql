SELECT (SELECT ROUND(AVG(ss_net_profit), 4) FROM store_sales), (SELECT ABS(SUM(row_count)) FROM stg_tpcds_archive_log)
