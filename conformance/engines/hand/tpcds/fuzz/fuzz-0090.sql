-- YTD with no date filter: the last year
SELECT p.p_promo_name, st.s_city, i.i_class, SUM(ss.ss_ext_sales_price)
FROM store_sales ss
JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year = (SELECT MAX(d_year) FROM date_dim)
LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
GROUP BY 1, 2, 3
HAVING SUM(ss.ss_ext_sales_price) IS NOT NULL
