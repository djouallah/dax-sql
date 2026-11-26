-- the ship mode does not filter store_sales: every ship mode has the average over the last year
WITH a AS (
  SELECT ROUND(ROUND(ROUND(AVG(ss.ss_ext_sales_price), 4), 2), 1) AS v
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_year = (SELECT MAX(d_year) FROM date_dim)
)
SELECT DISTINCT sm.sm_type, a.v FROM ship_mode sm CROSS JOIN a WHERE a.v IS NOT NULL
