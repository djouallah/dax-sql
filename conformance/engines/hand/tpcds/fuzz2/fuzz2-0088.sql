-- Per class, the catalog quantity over every date a year back (a month's last day also reaching the shifted month's last)
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date))
SELECT i.i_class, SUM(cs.cs_quantity) AS m0
FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
WHERE d.d_date IN (SELECT dt FROM ly)
GROUP BY 1
HAVING SUM(cs.cs_quantity) IS NOT NULL
