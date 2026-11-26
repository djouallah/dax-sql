-- SUMMARIZE's extension column sees its group as a filter on store_sales' rows, which filters
-- store: per existing promotion name x month of store sales (no match: blank), their stores, or 0
SELECT p.p_promo_name, d.d_moy, COUNT(DISTINCT s.s_store_sk) AS m0
FROM store_sales ss LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
GROUP BY ALL
