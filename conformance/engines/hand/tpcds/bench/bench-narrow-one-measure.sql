SELECT d.d_year, SUM(ss.ss_ext_sales_price) AS a
FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
GROUP BY d.d_year
HAVING a IS NOT NULL
