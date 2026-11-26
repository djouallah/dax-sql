-- under brand importcorp #7. m0: DISTINCTCOUNT of the (unfiltered) marital statuses is never blank,
-- so for each of the brand's prices the catalog net profit, and the largest of them
WITH it AS (SELECT * FROM item WHERE i_brand = 'importcorp #7'),
c AS (
  SELECT p.p_promo_name AS n, it.i_current_price AS pr, SUM(cs.cs_net_profit) AS v
  FROM catalog_sales cs
  JOIN it ON it.i_item_sk = cs.cs_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY 1, 2
), m0 AS (SELECT n, MAX(v) AS v FROM c GROUP BY 1),
m1 AS (
  SELECT p.p_promo_name AS n, COUNT(*) AS v
  FROM store_sales ss
  JOIN it ON it.i_item_sk = ss.ss_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  GROUP BY 1
)
SELECT COALESCE(m0.n, m1.n), m0.v, m1.v
FROM m0 FULL JOIN m1 ON m1.n IS NOT DISTINCT FROM m0.n
WHERE m0.v IS NOT NULL OR m1.v IS NOT NULL
