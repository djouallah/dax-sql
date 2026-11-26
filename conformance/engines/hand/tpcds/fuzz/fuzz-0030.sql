-- per item price: the customer states where the catalog profit of the price, the state and a marital status (a
-- context transition takes every row context: price, state, status) summed over the statuses is above 0
-- (the store cities over it are 3, no filter reaches store)
WITH g AS (
  SELECT i.i_current_price, ca.ca_state, SUM(cs.cs_net_profit) AS profit
  FROM catalog_sales cs
  JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY ALL
), cities AS (
  SELECT NULLIF(COUNT(DISTINCT s_city) + (COUNT(*) > COUNT(s_city))::INT, 0) AS n FROM store
), k AS (
  SELECT g.i_current_price, NULLIF(COUNT(*), 0) AS n
  FROM g CROSS JOIN cities
  WHERE (g.ca_state IN (SELECT DISTINCT ca_state FROM customer_address WHERE ca_state IS NOT NULL)
    OR (g.ca_state IS NULL AND EXISTS (SELECT 1 FROM customer_address WHERE ca_state IS NULL)))
    AND cities.n / NULLIF(g.profit, 0) > 0
  GROUP BY ALL
)
SELECT p.i_current_price, k.n AS m0
FROM (SELECT DISTINCT i_current_price FROM item) p
LEFT JOIN k ON k.i_current_price IS NOT DISTINCT FROM p.i_current_price
