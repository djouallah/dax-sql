SELECT d.d_dow, ss.cache_buster, SUM(ss_ext_sales_price) AS v
FROM store_sales ss LEFT JOIN date_dim d ON ss.ss_sold_date_sk = d.d_date_sk_1
GROUP BY d.d_dow, ss.cache_buster
