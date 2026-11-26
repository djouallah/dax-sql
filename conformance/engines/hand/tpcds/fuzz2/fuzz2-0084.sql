-- m0: the store revenue over every date a year back. m1's denominator is blank: HASONEVALUE(cd_marital_status)
-- is false, customer_demographics holding more than one marital status, so DIVIDE is blank.
-- The groups are the brands x cities with revenue; sales of no item or no store are in the blank brand / city
-- (the dimensions' blank rows).
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date))
SELECT i.i_brand, st.s_city, ABS(SUM(ss.ss_ext_sales_price)) AS m0, NULL::DOUBLE AS m1
FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
WHERE d.d_date IN (SELECT dt FROM ly)
GROUP BY 1, 2
HAVING m0 IS NOT NULL
