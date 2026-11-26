-- per item price: the customer states where the catalog profit of the price, the state and a marital status (a
-- context transition takes every row context: price, state, status) summed over the statuses is above 0
-- (the store cities over it are 3, no filter reaches store). The statuses, blank among them, cover every sale;
-- a sale with no address is the blank state's, a state in VALUES like a stored blank one. The prices: the
-- blank one too when the model has item's blank row.
WITH g AS (
  SELECT i.i_current_price, ca.ca_state, SUM(cs.cs_net_profit) AS profit
  FROM catalog_sales cs
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY ALL
), cities AS (
  SELECT NULLIF(COUNT(DISTINCT s_city) + (COUNT(*) > COUNT(s_city))::INT, 0) AS n FROM store
), k AS (
  SELECT g.i_current_price, NULLIF(COUNT(*), 0) AS n
  FROM g CROSS JOIN cities
  WHERE cities.n / NULLIF(g.profit, 0) > 0
  GROUP BY ALL
)
SELECT p.i_current_price, k.n AS m0
FROM (SELECT i_current_price FROM item
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
        OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
        OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))) p
LEFT JOIN k ON k.i_current_price IS NOT DISTINCT FROM p.i_current_price
