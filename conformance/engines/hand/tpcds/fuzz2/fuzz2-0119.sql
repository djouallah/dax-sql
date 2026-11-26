SELECT d.d_moy, st.s_state, d.d_qoy, SUM(ss.ss_ext_sales_price) AS m0
FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
GROUP BY ALL
HAVING m0 IS NOT NULL
