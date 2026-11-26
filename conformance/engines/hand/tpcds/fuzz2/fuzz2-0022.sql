-- per year and item color: archive source rows, which no filter reaches
SELECT y.d_year, c.i_color, a.n
FROM (SELECT DISTINCT d_year FROM date_dim) y
CROSS JOIN (SELECT DISTINCT i_color FROM item) c
CROSS JOIN (SELECT SUM(row_count) AS n FROM stg_tpcds_archive_log) a
WHERE a.n IS NOT NULL
