-- one row: store revenue YoY (all revenue against the revenue a year back from every date) over the number of
-- categories with over 100 distinct store customers (blank when none)
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), s AS (
  SELECT SUM(ss_ext_sales_price) AS rev, SUM(ss_ext_sales_price) FILTER (WHERE ss_sold_date_sk IN (SELECT sk FROM ly)) AS ly FROM store_sales
), k AS (
  SELECT COUNT(*) AS n FROM (
    SELECT i.i_category
    FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
    GROUP BY ALL
    HAVING COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) > 100)
)
SELECT ((COALESCE(s.rev, 0) - s.ly) / NULLIF(s.ly, 0)) / NULLIF(k.n, 0) AS m0
FROM s, k
