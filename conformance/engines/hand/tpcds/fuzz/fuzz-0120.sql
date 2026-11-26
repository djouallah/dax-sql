-- with no date filter, a year back is every year but the last
WITH s AS (
  SELECT i.i_color AS c, i.i_current_price AS p, SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year < (SELECT MAX(d_year) FROM date_dim)) AS ly
  FROM store_sales ss
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1, 2
)
SELECT c, p, (COALESCE(rev, 0) - ly) / NULLIF(ly, 0) FROM s WHERE (COALESCE(rev, 0) - ly) / NULLIF(ly, 0) IS NOT NULL
