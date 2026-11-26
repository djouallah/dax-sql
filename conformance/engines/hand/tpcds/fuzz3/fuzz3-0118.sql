-- items other than Books (a blank category is not "Books"): their colors by every month, the
-- archive's source rows over the least store sale. Sales of no item or no date are in item's and
-- date_dim's blank rows: a blank color (category blank too) or month.
WITH s AS (
  SELECT i.i_color, d.d_moy, MIN(ss.ss_ext_sales_price) AS mn
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE COALESCE(i.i_category, '') <> 'Books'
  GROUP BY ALL
)
SELECT i_color, d_moy, (SELECT SUM(row_count) FROM stg_tpcds_archive_log) / NULLIF(mn, 0) AS m0
FROM s
WHERE m0 IS NOT NULL
