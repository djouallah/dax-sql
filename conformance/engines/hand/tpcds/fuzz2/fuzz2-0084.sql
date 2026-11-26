-- m0: the store revenue over every date a year back. m1's denominator is blank: HASONEVALUE(cd_marital_status)
-- is false, customer_demographics holding more than one marital status, so DIVIDE is blank.
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
s AS (
  SELECT i.i_brand, st.s_city, ABS(SUM(ss.ss_ext_sales_price)) AS m0
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  WHERE d.d_date IN (SELECT dt FROM ly)
  GROUP BY 1, 2)
-- groups of two tables: the brands x cities of item and store (sales of no store are in none)
SELECT g.i_brand, g.s_city, s.m0, NULL::DOUBLE AS m1
FROM (SELECT DISTINCT i.i_brand, st.s_city FROM item i, store st) g
JOIN s ON s.i_brand IS NOT DISTINCT FROM g.i_brand AND s.s_city IS NOT DISTINCT FROM g.s_city
WHERE s.m0 IS NOT NULL
