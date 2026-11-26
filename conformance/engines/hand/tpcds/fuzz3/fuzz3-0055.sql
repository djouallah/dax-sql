-- per class and education status (a sale whose item or demographics is missing is in that table's blank row):
-- SUM/MIN of store profit ignore the promotion (no measure, no context transition), so past 100 of profit it
-- counts every promotion name (the blank row's too, when a sale's promotion is missing; when the smallest profit
-- is positive); else the promotion names whose catalog quantity is positive
WITH s AS (
  SELECT i.i_class AS c, cd.cd_education_status AS e, SUM(ss.ss_net_profit) AS sm, MIN(ss.ss_net_profit) AS mn
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), q AS (
  SELECT c, e, COUNT(*) AS n FROM (
    SELECT i.i_class AS c, cd.cd_education_status AS e, p.p_promo_name
    FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
    LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
    LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
    GROUP BY ALL HAVING SUM(cs.cs_quantity) > 0)
  GROUP BY ALL
), pn AS (
  SELECT DISTINCT p_promo_name FROM promotion
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN promotion ON p_promo_sk = ss_promo_sk)
                       OR EXISTS (FROM catalog_sales ANTI JOIN promotion ON p_promo_sk = cs_promo_sk)
), k AS (SELECT c, e FROM s UNION SELECT c, e FROM q)
SELECT k.c, k.e,
  CASE WHEN s.sm > 100 THEN CASE WHEN s.mn > 0 THEN (SELECT COUNT(*) FROM pn) END
  ELSE q.n END AS m0
FROM k
LEFT JOIN s ON s.c IS NOT DISTINCT FROM k.c AND s.e IS NOT DISTINCT FROM k.e
LEFT JOIN q ON q.c IS NOT DISTINCT FROM k.c AND q.e IS NOT DISTINCT FROM k.e
WHERE m0 IS NOT NULL
