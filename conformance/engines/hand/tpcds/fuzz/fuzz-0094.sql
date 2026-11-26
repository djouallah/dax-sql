-- no CALCULATE: no category or state row filters anything; SUMX adds the total quantity once a state
WITH c AS (SELECT SUM(cs_quantity) AS qty, MIN(cs_net_profit) AS mn FROM catalog_sales),
n AS (SELECT COUNT(DISTINCT s_state) + MAX(CASE WHEN s_state IS NULL THEN 1 ELSE 0 END) AS states FROM store)
SELECT g.i_category,
  CASE WHEN c.qty IS NULL AND c.mn IS NULL THEN NULL ELSE COALESCE(n.states * c.qty, 0) - COALESCE(c.mn, 0) END
FROM (SELECT DISTINCT i_category FROM item) g CROSS JOIN c CROSS JOIN n
