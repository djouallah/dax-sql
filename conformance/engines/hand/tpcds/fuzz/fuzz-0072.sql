-- m0: RANKX of the promotion's quantity (no state filter) among its quantities by billing state:
-- one more than the states above it
WITH q AS (
  SELECT p.p_promo_name AS p, ca.ca_state AS st, SUM(cs.cs_quantity) AS v
  FROM catalog_sales cs
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  WHERE (i.i_category IS NULL OR i.i_category <> 'Jewelry') AND i.i_brand IN ('edupack #9', 'scholaruniv #4')
  GROUP BY 1, 2
), states AS (SELECT DISTINCT ca_state AS st FROM customer_address),
promos AS (SELECT DISTINCT p_promo_name AS p FROM promotion),
tot AS (SELECT p, ABS(SUM(v)) AS v FROM q GROUP BY 1),
per AS (
  SELECT pr.p, s.st, ABS(q.v) AS v
  FROM promos pr CROSS JOIN states s
  LEFT JOIN q ON q.p IS NOT DISTINCT FROM pr.p AND q.st IS NOT DISTINCT FROM s.st
), rk AS (
  SELECT per.p, 1 + COUNT(*) FILTER (WHERE COALESCE(per.v, 0) > COALESCE(tot.v, 0)) AS r
  FROM per LEFT JOIN tot ON tot.p IS NOT DISTINCT FROM per.p
  GROUP BY 1
), np AS (
  SELECT p.p_promo_name AS p, SUM(cs.cs_net_profit) AS v
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY 1
)
SELECT pr.p, rk.r, np.v
FROM promos pr
JOIN rk ON rk.p IS NOT DISTINCT FROM pr.p
LEFT JOIN np ON np.p IS NOT DISTINCT FROM pr.p
