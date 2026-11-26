-- with no date filter a year back is every year but the last; the profit share is of all items
WITH s AS (
  SELECT i.i_current_price AS pr, SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year < (SELECT MAX(d_year) FROM date_dim)) AS ly,
    SUM(ss.ss_net_profit) AS profit
  FROM store_sales ss
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1
), r AS (
  SELECT pr, ABS((COALESCE(rev, 0) - ly) / NULLIF(ly, 0)) AS yoy,
    ABS(profit / NULLIF((SELECT SUM(ss_net_profit) FROM store_sales), 0)) AS share
  FROM s
)
SELECT pr, yoy, share, yoy FROM r WHERE yoy IS NOT NULL OR share IS NOT NULL
