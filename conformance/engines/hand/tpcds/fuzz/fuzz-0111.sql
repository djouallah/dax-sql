-- YTD with no date filter: the last year
SELECT p.p_promo_name, SUM(cs.cs_ext_sales_price)
FROM catalog_sales cs
JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_brand = 'eduuniv #3'
JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year = (SELECT MAX(d_year) FROM date_dim)
LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
GROUP BY 1
HAVING SUM(cs.cs_ext_sales_price) IS NOT NULL
