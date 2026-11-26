-- m0 is never blank (COALESCE), so every promotion name meets every class; m2's condition always
-- holds (a class's categories counted twice by UNION, RANKX of a constant is 1): Store Revenue.
-- Store Revenue YTD, with no date filter: the last year of the calendar
WITH f AS (
  SELECT p.p_promo_name AS pn, i.i_class AS cl,
    MAX(ss.ss_quantity) FILTER (WHERE d.d_date BETWEEN DATE '2024-05-30' AND DATE '2026-08-03') AS qb,
    MAX(ss.ss_quantity) AS q,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year = (SELECT MAX(d_year) FROM date_dim)) AS ytd,
    SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
)
SELECT pn.p_promo_name, cl.i_class, COALESCE(f.qb, 0) AS m0, f.q / NULLIF(f.ytd, 0) AS m1, f.rev AS m2
FROM (SELECT DISTINCT p_promo_name FROM promotion) pn
CROSS JOIN (SELECT DISTINCT i_class FROM item) cl
LEFT JOIN f ON f.pn IS NOT DISTINCT FROM pn.p_promo_name AND f.cl IS NOT DISTINCT FROM cl.i_class
