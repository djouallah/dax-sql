-- INDEX(-1) of the names sorted descending (blanks last) is the first ascending, blanks first;
-- last year: each sale counted in the quarter of its date a year on. Quarters and names include the blank row
-- when some sale has no date, no promotion (the blank quarter has no last year: blank)
WITH f AS (
  SELECT d.d_qoy AS q, n.d_qoy AS nq, ss.ss_ext_sales_price AS rev
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  WHERE p.p_promo_name IS NOT DISTINCT FROM (SELECT p_promo_name FROM promotion ORDER BY p_promo_name NULLS FIRST LIMIT 1)
), cur AS (SELECT q, SUM(rev) AS r FROM f GROUP BY q),
ly AS (SELECT nq AS q, SUM(rev) AS r FROM f WHERE nq IS NOT NULL GROUP BY nq),
colors AS (SELECT COUNT(DISTINCT i_color) + MAX((i_color IS NULL)::INT) AS n FROM item)
SELECT g.q, pn.p_promo_name, colors.n / NULLIF((COALESCE(cur.r, 0) - ly.r) / NULLIF(ly.r, 0), 0) AS m0
FROM (SELECT d_qoy AS q FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
    OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)) g
CROSS JOIN (SELECT p_promo_name FROM promotion
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN promotion ON p_promo_sk = ss_promo_sk)
    OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN promotion ON p_promo_sk = cs_promo_sk)) pn
CROSS JOIN colors
LEFT JOIN cur ON cur.q = g.q
LEFT JOIN ly ON ly.q = g.q
