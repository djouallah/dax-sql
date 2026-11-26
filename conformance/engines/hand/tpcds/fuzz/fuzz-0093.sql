-- under city Fairview or Oak Grove and state TN or GA (store_sales only). m0 is never blank (0 or the
-- catalog's MAX for the category, which the store does not filter): every city left by the filters
-- with every category. m1: the months whose profit share of the item's total is over 10.
WITH st AS (SELECT * FROM store WHERE s_city IN ('Fairview', 'Oak Grove') AND s_state IN ('TN', 'GA')),
f AS (
  SELECT st.s_city AS c, i.i_category AS k, d.d_moy AS moy, SUM(ss.ss_net_profit) AS p
  FROM store_sales ss
  JOIN st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1, 2, 3
), cm AS (SELECT c, moy, SUM(p) AS p FROM f GROUP BY 1, 2),
ck AS (SELECT c, k, SUM(p) AS p FROM f GROUP BY 1, 2),
share AS (
  SELECT f.c, f.k, COUNT(*) FILTER (WHERE f.p / NULLIF(cm.p, 0) > 10) AS n
  FROM f JOIN cm ON cm.c IS NOT DISTINCT FROM f.c AND cm.moy = f.moy
  GROUP BY 1, 2
), cq AS (
  SELECT i.i_category AS k, MAX(cs.cs_quantity) AS mx
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY 1
), g AS (
  SELECT * FROM (SELECT DISTINCT s_city AS c FROM st) CROSS JOIN (SELECT DISTINCT i_category AS k FROM item)
)
SELECT g.c, g.k, CASE WHEN ck.p IS NULL THEN 0 ELSE cq.mx END, NULLIF(share.n, 0)
FROM g
LEFT JOIN ck ON ck.c IS NOT DISTINCT FROM g.c AND ck.k IS NOT DISTINCT FROM g.k
LEFT JOIN cq ON cq.k IS NOT DISTINCT FROM g.k
LEFT JOIN share ON share.c IS NOT DISTINCT FROM g.c AND share.k IS NOT DISTINCT FROM g.k
