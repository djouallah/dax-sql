-- store revenue over the calendar's last year (its year to date)
SELECT SUM(ss.ss_ext_sales_price) AS m0
FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
WHERE d.d_date BETWEEN (SELECT date_trunc('year', MAX(d_date))::DATE FROM date_dim) AND (SELECT MAX(d_date) FROM date_dim)
HAVING SUM(ss.ss_ext_sales_price) IS NOT NULL
