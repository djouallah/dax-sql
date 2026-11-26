-- items priced 37.82, per class and promotion: the years between Aug 30 and Jul 18 2025 (no dates: blank),
-- and the top store sales price
SELECT i.i_class, p.p_promo_name, CAST(NULL AS BIGINT) AS m0, MAX(ss.ss_ext_sales_price) AS m1
FROM store_sales ss
JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_current_price = 37.82
LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
GROUP BY ALL
HAVING MAX(ss.ss_ext_sales_price) IS NOT NULL
