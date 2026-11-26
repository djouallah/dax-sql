SELECT etag, SUM(row_count) * 2 AS a, COALESCE(SUM(row_count), 0) + 1 AS b, COALESCE(SUM(row_count), 0) AS c
FROM stg_tpcds_archive_log
GROUP BY etag
