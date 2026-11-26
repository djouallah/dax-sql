-- one row: catalog profit + 2 x store revenue a year back from every date + the average store quantity
WITH ly AS (
  SELECT DISTINCT d.d_date_sk_1 AS sk
  FROM (SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), s AS (
  SELECT SUM(ss_ext_sales_price) FILTER (WHERE ss_sold_date_sk IN (SELECT sk FROM ly)) AS ly, AVG(ss_quantity) AS aq FROM store_sales
)
SELECT COALESCE((SELECT SUM(cs_net_profit) FROM catalog_sales), 0)
  + CASE WHEN s.ly IS NULL AND s.aq IS NULL THEN NULL ELSE COALESCE(s.ly, 0) * 2 + COALESCE(s.aq, 0) END AS m0
FROM s
