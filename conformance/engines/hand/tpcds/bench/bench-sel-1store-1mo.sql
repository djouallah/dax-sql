SELECT SUM(ss.ss_quantity * ss.ss_ext_sales_price)
FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
WHERE ss.ss_store_sk = 1 AND d.d_year = 2025 AND d.d_moy = 6
