-- per promotion name: the average catalog quantity over every date a year back by whole years (all but the last year)
SELECT p.p_promo_name, AVG(cs.cs_quantity) AS m0
FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  AND d.d_year BETWEEN (SELECT MIN(d_year) - 1 FROM date_dim) AND (SELECT MAX(d_year) - 1 FROM date_dim)
LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
GROUP BY ALL
HAVING AVG(cs.cs_quantity) IS NOT NULL
