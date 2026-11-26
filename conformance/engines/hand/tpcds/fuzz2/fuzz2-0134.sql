-- HASONEVALUE(d_moy) with no date filter: true only when the date table holds a single month; then the larger of
-- store revenue year to date (from 1 January of the last date's year) and the count of education statuses
WITH ytd AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS d0, MAX(d_date) AS d1 FROM date_dim
)
SELECT GREATEST(
    (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, ytd WHERE d.d_date BETWEEN ytd.d0 AND ytd.d1),
    (SELECT COUNT(DISTINCT cd_education_status) FROM customer_demographics)) AS m0
WHERE (SELECT COUNT(DISTINCT d_moy) FROM date_dim) = 1
