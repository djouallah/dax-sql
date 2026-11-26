-- per brand and promotion name: RANKX over the months of 2 x 12 months + the pair's store revenue in the month
-- (CALCULATE turns both row contexts into filters), the pair's own value being 24 + its revenue over every month
WITH m AS (
  SELECT i.i_brand AS b, p.p_promo_name AS pn, d.d_moy AS moy, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), t AS (SELECT b, pn, SUM(rev) AS rev FROM m GROUP BY ALL)
SELECT g.i_brand, g.p_promo_name,
  1 + (SELECT COUNT(*) FROM m WHERE m.b IS NOT DISTINCT FROM g.i_brand AND m.pn IS NOT DISTINCT FROM g.p_promo_name
         AND m.moy IS NOT NULL AND COALESCE(m.rev, 0) > COALESCE(t.rev, 0)) AS m0
FROM (SELECT DISTINCT i_brand FROM item) gb
CROSS JOIN (SELECT DISTINCT p_promo_name FROM promotion) gp
CROSS JOIN LATERAL (SELECT gb.i_brand, gp.p_promo_name) g
LEFT JOIN t ON t.b IS NOT DISTINCT FROM g.i_brand AND t.pn IS NOT DISTINCT FROM g.p_promo_name
