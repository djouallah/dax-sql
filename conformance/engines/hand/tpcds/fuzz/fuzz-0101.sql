-- with no date filter, a year back is every year but the last
SELECT i.i_class, SUM(cs.cs_quantity)
FROM catalog_sales cs
LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year < (SELECT MAX(d_year) FROM date_dim)
GROUP BY 1
HAVING SUM(cs.cs_quantity) IS NOT NULL
