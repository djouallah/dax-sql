SELECT d.d_dow, SUM(ss_ext_sales_price) AS v
FROM store_sales ss LEFT JOIN date_dim d ON ss.ss_sold_date_sk = d.d_date_sk_1
WHERE ss.ss_ext_sales_price IN (4.14, 10.11)
GROUP BY d.d_dow
