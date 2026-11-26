-- per month and store name. m0: PREVIOUSMONTH of a month over all years is the month before it in the first year,
-- whose year back is not in the date table: the YoY is blank. m1: store revenue on each date of the month a year
-- back (a month's last day also its month's); the months crossed with the store names (no blank name)
WITH lym AS (
  SELECT DISTINCT x.d_moy, d.d_date_sk_1 AS sk
  FROM (SELECT d_moy, (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT d_moy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
)
SELECT lym.d_moy, st.s_store_name, NULL::DOUBLE AS m0, SUM(ss.ss_ext_sales_price) AS m1
FROM store_sales ss JOIN lym ON lym.sk = ss.ss_sold_date_sk
JOIN store st ON st.s_store_sk = ss.ss_store_sk
GROUP BY ALL
HAVING m1 IS NOT NULL
