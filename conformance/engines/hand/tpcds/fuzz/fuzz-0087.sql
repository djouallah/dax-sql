-- the archive log is related to nothing: its rows for every color
SELECT c.i_color, a.n
FROM (SELECT DISTINCT i_color FROM item) c
CROSS JOIN (SELECT NULLIF(COUNT(*), 0) AS n FROM stg_tpcds_archive_log) a
WHERE a.n IS NOT NULL
