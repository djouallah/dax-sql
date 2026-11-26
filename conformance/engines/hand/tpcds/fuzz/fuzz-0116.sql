-- RANKX of a MAX no color row changes: 1. YTD: the last year. m2: the ship modes (the store and
-- the dates do not filter them) over the archive rows (related to nothing).
WITH ytd AS (
  SELECT SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_year = (SELECT MAX(d_year) FROM date_dim)
)
SELECT 1 / NULLIF(ytd.v, 0), ytd.v,
  (SELECT NULLIF(COUNT(DISTINCT sm_type) + MAX(CASE WHEN sm_type IS NULL THEN 1 ELSE 0 END), 0) FROM ship_mode)
    / NULLIF((SELECT SUM(row_count) FROM stg_tpcds_archive_log), 0)
FROM ytd
