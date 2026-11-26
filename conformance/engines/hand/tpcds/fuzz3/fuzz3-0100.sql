-- per store city and name: store revenue over every date a year back (SAMEPERIODLASTYEAR of all dates, a month's
-- last day also reaching Feb 29), rounded; the catalog relationship switch is moot
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
)
SELECT st.s_city, st.s_store_name, ROUND(SUM(ss.ss_ext_sales_price), 0) AS m0
FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date IN (SELECT dt FROM ly)
LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
GROUP BY ALL
HAVING SUM(ss.ss_ext_sales_price) IS NOT NULL
