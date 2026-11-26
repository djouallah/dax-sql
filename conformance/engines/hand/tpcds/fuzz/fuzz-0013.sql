-- the average of a fixed decimal: the exact sum over the count, rounded half away from zero to 4 places
WITH g AS (
  SELECT i.i_class, p.p_promo_name, ca.ca_state, MIN(cs.cs_net_profit) AS m0, SUM(cs.cs_quantity) AS qty,
    CAST(SUM(cs.cs_ext_sales_price) * 10000 AS HUGEINT) AS s, NULLIF(COUNT(cs.cs_ext_sales_price), 0) AS n
  FROM catalog_sales cs
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY ALL
), a AS (
  SELECT *, sign(s) * ((2 * abs(s) + n) // (2 * n)) / 10000 AS avgp FROM g
)
SELECT i_class, p_promo_name, ca_state, m0,
  CASE WHEN qty IS NOT NULL OR avgp IS NOT NULL THEN COALESCE(qty, 0) - COALESCE(avgp, 0) END AS m1
FROM a
WHERE m0 IS NOT NULL OR qty IS NOT NULL OR avgp IS NOT NULL
